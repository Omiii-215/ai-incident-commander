import { randomUUID } from 'node:crypto';
import { AppError, isAppError } from '@aic/contracts';
import type { ActorContext, SessionDoc } from '@aic/core';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';
import { z, type ZodType } from 'zod';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      session?: SessionDoc;
      sessionToken?: string;
      actor?: ActorContext;
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get('X-Request-Id');
  req.requestId = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

export function parse<S extends ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new AppError('INVALID_INPUT', 'Some fields are invalid.', {
      issues: r.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

const UuidSchema = z.uuid();

export function actor(req: Request): ActorContext {
  if (!req.actor) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
  return req.actor;
}

export function param(req: Request, name: string): string {
  const v = req.params[name];
  const r = UuidSchema.safeParse(v);
  // Malformed identifiers are indistinguishable from missing ones.
  if (!r.success) throw new AppError('NOT_FOUND', 'This item is unavailable.');
  return r.data;
}

/** Idempotency-Key (UUID, required) and If-Match ("N") for commands. */
export function commandMeta(req: Request): { idempotencyKey: string; expectedVersion?: number } {
  const key = req.get('Idempotency-Key');
  if (!key || !UuidSchema.safeParse(key).success) {
    throw new AppError('INVALID_INPUT', 'Commands require a UUID Idempotency-Key header.');
  }
  const ifMatch = req.get('If-Match');
  if (ifMatch === undefined) return { idempotencyKey: key };
  const m = /^(?:W\/)?"?(\d{1,9})"?$/.exec(ifMatch.trim());
  if (!m) throw new AppError('INVALID_INPUT', 'If-Match must be a quoted version number.');
  return { idempotencyKey: key, expectedVersion: Number(m[1]) };
}

export function send(res: Response, req: Request, status: number, data: unknown, extraMeta: Record<string, unknown> = {}) {
  const version = (data as { version?: unknown } | null)?.version;
  if (typeof version === 'number') res.setHeader('ETag', `"${version}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(status).json({ data, meta: { requestId: req.requestId, ...extraMeta } });
}

export function sendCommand(res: Response, req: Request, result: { status: number; body: unknown; replayed: boolean }) {
  if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
  send(res, req, result.status, result.body);
}

export function errorHandler(log: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const rid = req.requestId ?? randomUUID();
    let appErr: AppError;
    if (isAppError(err)) appErr = err;
    else if ((err as { type?: string }).type === 'entity.too.large') appErr = new AppError('PAYLOAD_TOO_LARGE', 'Request body exceeds the documented limit.');
    else if ((err as { type?: string }).type === 'entity.parse.failed') appErr = new AppError('INVALID_INPUT', 'Request body is not valid JSON.');
    else if ((err as { name?: string }).name === 'MongoServerSelectionError' || (err as { name?: string }).name === 'MongoNetworkError') {
      appErr = new AppError('DEPENDENCY_UNAVAILABLE', 'The service is temporarily unavailable. Retry shortly.');
    } else {
      // Never expose stack traces, provider errors or database details.
      log.error({ requestId: rid, err: err instanceof Error ? { name: err.name, message: err.message } : String(err) }, 'unhandled error');
      appErr = new AppError('INTERNAL', 'Something went wrong. Use the request reference when reporting this.');
    }
    if (appErr.status >= 500 && isAppError(err)) log.warn({ requestId: rid, code: appErr.code }, 'dependency error');
    if (appErr.code === 'RATE_LIMITED') res.setHeader('Retry-After', String(appErr.details?.retryAfterSeconds ?? 30));
    res.status(appErr.status).json(appErr.toEnvelope(rid));
  };
}

/** Fixed-window in-memory limiter. Per-process; a shared store is needed for multiple API replicas. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}
  hit(key: string, now = Date.now()) {
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      if (this.windows.size > 50_000) this.windows.clear();
      return;
    }
    w.count++;
    if (w.count > this.limit) {
      throw new AppError('RATE_LIMITED', 'Too many requests. Wait a moment and retry.', { retryAfterSeconds: Math.ceil((w.start + this.windowMs - now) / 1000) });
    }
  }
}
