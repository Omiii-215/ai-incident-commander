import { AppError } from '@aic/contracts';
import { auth, dashboard, type Deps } from '@aic/core';
import type { Request, Response } from 'express';
import type { Logger } from 'pino';
import { actor } from './http.js';

// Workspace invalidation stream (API_CONTRACTS.md §6, ADR-004). Carries IDs,
// versions and safe reasons only. Last-Event-ID takes precedence over `after`.

const POLL_MS = 500;
const HEARTBEAT_MS = 15_000;
const RECHECK_MS = 30_000;
const MAX_BUFFER_BYTES = 1024 * 1024;
const MAX_STREAMS_PER_USER = 3;

const openStreams = new Map<string, number>();

export function streamHandler(deps: Deps, log: Logger) {
  return async (req: Request, res: Response) => {
    const ctx = actor(req);
    const lastEventId = req.get('Last-Event-ID');
    const after = typeof req.query.after === 'string' ? req.query.after : undefined;
    const cursor = lastEventId || after;
    if (!cursor) throw new AppError('INVALID_CURSOR', 'Provide the snapshot cursor from the dashboard response.');
    // Rejects malformed cursors and cursors from another workspace with 400.
    let seq = deps.cursors.decodeStream(cursor, ctx.workspaceId);

    const userKey = ctx.subjectId;
    const count = openStreams.get(userKey) ?? 0;
    if (count >= MAX_STREAMS_PER_USER) throw new AppError('RATE_LIMITED', 'Too many live connections. Close another tab and retry.', { retryAfterSeconds: 15 });
    openStreams.set(userKey, count + 1);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 3000\n\n');

    let closed = false;
    let busy = false;
    const timers: NodeJS.Timeout[] = [];
    const close = () => {
      if (closed) return;
      closed = true;
      timers.forEach(clearInterval);
      openStreams.set(userKey, Math.max(0, (openStreams.get(userKey) ?? 1) - 1));
      res.end();
    };
    req.on('close', close);

    const write = (chunk: string) => {
      if (closed) return;
      res.write(chunk);
      if (res.writableLength > MAX_BUFFER_BYTES) {
        // Slow consumer: ask for resync rather than buffering unboundedly.
        res.write(`event: resync_required\ndata: {"reason":"slow_consumer"}\n\n`);
        close();
      }
    };

    const poll = async () => {
      if (closed || busy) return;
      busy = true;
      try {
        const r = await dashboard.readStream(deps, ctx.workspaceId, seq);
        if (r.kind === 'resync') {
          write(`event: resync_required\ndata: ${JSON.stringify({ reason: r.reason })}\n\n`);
          close();
          return;
        }
        for (const e of r.events) {
          const id = deps.cursors.encodeStream(ctx.workspaceId, e.streamSeq);
          const data = { entityType: e.entityType, entityId: e.entityId, entityVersion: e.entityVersion, reason: e.reason, streamSeq: String(e.streamSeq) };
          write(`id: ${id}\nevent: entity_changed\ndata: ${JSON.stringify(data)}\n\n`);
          seq = e.streamSeq;
        }
      } catch (err) {
        log.warn({ requestId: req.requestId, err: (err as Error).message }, 'stream poll failed');
      } finally {
        busy = false;
      }
    };

    const recheck = async () => {
      // Revalidate session and membership; close promptly on revocation.
      try {
        const s = await auth.resolveSession(deps, req.sessionToken);
        if (!s) throw new Error('session');
        await auth.resolveActor(deps, s.userId, ctx.workspaceId, req.requestId);
      } catch {
        write(`event: access_revoked\ndata: {}\n\n`);
        close();
      }
    };

    timers.push(setInterval(poll, POLL_MS));
    timers.push(setInterval(() => write(`event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`), HEARTBEAT_MS));
    timers.push(setInterval(recheck, RECHECK_MS));
    await poll();
  };
}
