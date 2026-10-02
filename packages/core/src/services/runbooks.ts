import { createHash } from 'node:crypto';
import {
  AppError,
  RUNBOOK_MAX_BYTES,
  notFound,
  type CreateRunbookBody,
  type CreateRunbookVersionBody,
  type Page,
  type RunbookDTO,
  type RunbookSearchHit,
} from '@aic/contracts';
import type { Filter } from 'mongodb';
import type { z } from 'zod';
import { uuid, userActor, type ActorContext } from '../context.js';
import type { Deps } from '../deps.js';
import { record } from '../db/event-writer.js';
import { runCommand } from '../db/idempotency.js';
import type { RunbookChunkDoc, RunbookDoc, RunbookVersionDoc } from '../db/types.js';
import { LIMITS } from '../ai/workflow-constants.js';
import { casUpdate, checkVersion, requireOp } from './common.js';

type Meta = { idempotencyKey: string; expectedVersion?: number | undefined };

const objectKey = (workspaceId: string, runbookId: string, versionId: string) => `ws/${workspaceId}/runbooks/${runbookId}/${versionId}`;

async function toDTO(deps: Deps, docs: RunbookDoc[], tx?: import('mongodb').ClientSession): Promise<RunbookDTO[]> {
  if (!docs.length) return [];
  const versions = await deps.db.c.runbookVersions
    .find({ workspaceId: docs[0]!.workspaceId, runbookId: { $in: docs.map((d) => d._id) } }, tx ? { session: tx } : {})
    .sort({ revision: -1 })
    .toArray();
  return docs.map((d) => ({
    id: d._id,
    title: d.title,
    serviceIds: d.serviceIds,
    environments: d.environments,
    activeVersionId: d.activeVersionId,
    versions: versions
      .filter((v) => v.runbookId === d._id)
      .map((v) => ({ id: v._id, revision: v.revision, state: v.state, fileName: v.fileName, checksum: v.checksum, error: v.error, createdAt: v.createdAt.toISOString() })),
    version: d.version,
    updatedAt: d.updatedAt.toISOString(),
  }));
}

async function loadRunbook(deps: Deps, workspaceId: string, id: string, tx?: import('mongodb').ClientSession) {
  const doc = await deps.db.c.runbooks.findOne({ _id: id, workspaceId }, tx ? { session: tx } : {});
  if (!doc) throw notFound();
  return doc;
}

export async function listRunbooks(deps: Deps, ctx: ActorContext, q: { serviceId?: string; cursor?: string; limit: number }): Promise<Page<RunbookDTO>> {
  requireOp(ctx, 'read');
  const filterKey = { serviceId: q.serviceId ?? null };
  const filter: Filter<RunbookDoc> = { workspaceId: ctx.workspaceId, archivedAt: null };
  if (q.serviceId) filter.serviceIds = q.serviceId;
  if (q.cursor) {
    const [at, id] = deps.cursors.decodeList(q.cursor, ctx.workspaceId, filterKey) as [string, string];
    const d = new Date(at);
    filter.$or = [{ updatedAt: { $lt: d } }, { updatedAt: d, _id: { $lt: id } }];
  }
  const docs = await deps.db.c.runbooks.find(filter).sort({ updatedAt: -1, _id: -1 }).limit(q.limit + 1).toArray();
  const page = docs.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: await toDTO(deps, page),
    nextCursor: docs.length > q.limit && last ? deps.cursors.encodeList(ctx.workspaceId, filterKey, [last.updatedAt.toISOString(), last._id]) : null,
  };
}

export async function getRunbook(deps: Deps, ctx: ActorContext, id: string): Promise<RunbookDTO> {
  requireOp(ctx, 'read');
  return (await toDTO(deps, [await loadRunbook(deps, ctx.workspaceId, id)]))[0]!;
}

export async function createRunbook(deps: Deps, ctx: ActorContext, body: z.infer<typeof CreateRunbookBody>, meta: Meta) {
  requireOp(ctx, 'runbook.create');
  if (body.serviceIds.length) {
    const n = await deps.db.c.services.countDocuments({ workspaceId: ctx.workspaceId, _id: { $in: body.serviceIds } });
    if (n !== new Set(body.serviceIds).size) throw new AppError('INVALID_INPUT', 'Runbook services must belong to this workspace.');
  }
  return runCommand(deps.db, deps.clock, ctx, { operation: 'create-runbook', key: meta.idempotencyKey, payload: body }, async (tx) => {
    const now = deps.clock.now();
    const doc: RunbookDoc = {
      _id: uuid(),
      workspaceId: ctx.workspaceId,
      title: body.title,
      serviceIds: body.serviceIds,
      environments: body.environments,
      activeVersionId: null,
      visibility: 'workspace',
      archivedAt: null,
      nextRevision: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await deps.db.c.runbooks.insertOne(doc, { session: tx });
    await record(deps.db, tx, {
      workspaceId: ctx.workspaceId,
      actor: userActor(ctx),
      requestId: ctx.requestId,
      now,
      events: [{ type: 'runbook.created', entityType: 'runbook', entityId: doc._id, entityVersion: 1, reason: 'created' }],
      audit: [{ operation: 'runbook.create', resource: { type: 'runbook', id: doc._id }, afterVersion: 1 }],
    });
    return { status: 201, body: (await toDTO(deps, [doc], tx))[0]! };
  });
}

/** Creates an upload ticket for a new immutable version (state: uploading). */
export async function createRunbookVersion(deps: Deps, ctx: ActorContext, runbookId: string, body: z.infer<typeof CreateRunbookVersionBody>, meta: Meta) {
  requireOp(ctx, 'runbook.create');
  return runCommand(deps.db, deps.clock, ctx, { operation: `runbook-version:${runbookId}`, key: meta.idempotencyKey, payload: body, expectedVersion: meta.expectedVersion }, async (tx) => {
    const rb = await loadRunbook(deps, ctx.workspaceId, runbookId, tx);
    checkVersion(rb.version, meta.expectedVersion, 'runbook');
    const now = deps.clock.now();
    const versionId = uuid();
    const doc: RunbookVersionDoc = {
      _id: versionId,
      workspaceId: ctx.workspaceId,
      runbookId,
      revision: rb.nextRevision,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      artifactKey: objectKey(ctx.workspaceId, runbookId, versionId),
      checksum: body.checksum,
      authorId: ctx.subjectId,
      state: 'uploading',
      error: null,
      extractorVersion: 'text-extractor-v1',
      embeddingProfile: 'lexical-v1',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await deps.db.c.runbookVersions.insertOne(doc, { session: tx });
    const version = await casUpdate(deps.db.c.runbooks, tx, rb, { nextRevision: rb.nextRevision + 1, updatedAt: now }, 'runbook');
    await record(deps.db, tx, {
      workspaceId: ctx.workspaceId,
      actor: userActor(ctx),
      requestId: ctx.requestId,
      now,
      events: [{ type: 'runbook.version_created', entityType: 'runbook', entityId: runbookId, entityVersion: version, reason: 'uploading' }],
      audit: [{ operation: 'runbook.version.create', resource: { type: 'runbook_version', id: versionId } }],
    });
    return {
      status: 201,
      body: {
        versionId,
        revision: doc.revision,
        runbookVersion: version,
        upload: { method: 'PUT', path: `runbooks/${runbookId}/versions/${versionId}/content`, maxBytes: body.sizeBytes, contentType: body.contentType },
      },
    };
  });
}

/** Stores uploaded bytes for a version in `uploading` state (local upload ticket target). */
export async function uploadRunbookContent(deps: Deps, ctx: ActorContext, runbookId: string, versionId: string, data: Buffer) {
  requireOp(ctx, 'runbook.create');
  const v = await deps.db.c.runbookVersions.findOne({ _id: versionId, runbookId, workspaceId: ctx.workspaceId });
  if (!v) throw notFound();
  if (v.state !== 'uploading') throw new AppError('INVALID_TRANSITION', 'This version is no longer accepting uploads.');
  if (data.length > Math.min(v.sizeBytes, RUNBOOK_MAX_BYTES)) throw new AppError('PAYLOAD_TOO_LARGE', 'File exceeds the declared size or the 10 MiB limit.');
  if (data.includes(0)) throw new AppError('UNSUPPORTED_FILE', 'Only UTF-8 Markdown or plain text files are supported.');
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw new AppError('UNSUPPORTED_FILE', 'Only UTF-8 Markdown or plain text files are supported.');
  }
  const put = await deps.objects.put(v.artifactKey, data);
  return { checksum: put.checksum, size: put.size };
}

export async function completeRunbookVersion(deps: Deps, ctx: ActorContext, runbookId: string, versionId: string, body: { checksum: string }, meta: Meta) {
  requireOp(ctx, 'runbook.create');
  const v0 = await deps.db.c.runbookVersions.findOne({ _id: versionId, runbookId, workspaceId: ctx.workspaceId });
  if (!v0) throw notFound();
  const data = await deps.objects.get(v0.artifactKey);
  const actual = data ? `sha256:${createHash('sha256').update(data).digest('hex')}` : null;
  return runCommand(deps.db, deps.clock, ctx, { operation: `runbook-complete:${versionId}`, key: meta.idempotencyKey, payload: body, expectedVersion: meta.expectedVersion }, async (tx) => {
    const rb = await loadRunbook(deps, ctx.workspaceId, runbookId, tx);
    checkVersion(rb.version, meta.expectedVersion, 'runbook');
    const v = await deps.db.c.runbookVersions.findOne({ _id: versionId, runbookId, workspaceId: ctx.workspaceId }, { session: tx });
    if (!v) throw notFound();
    if (v.state !== 'uploading') throw new AppError('INVALID_TRANSITION', `This version is already ${v.state}.`);
    if (!actual) throw new AppError('INVALID_INPUT', 'No uploaded content was found for this version.');
    if (actual !== body.checksum || actual !== v.checksum) throw new AppError('INVALID_INPUT', 'Uploaded content does not match the declared checksum.');
    const now = deps.clock.now();
    await deps.db.c.runbookVersions.updateOne({ _id: versionId, workspaceId: ctx.workspaceId }, { $set: { state: 'indexing', updatedAt: now }, $inc: { version: 1 } }, { session: tx });
    const version = await casUpdate(deps.db.c.runbooks, tx, rb, { updatedAt: now }, 'runbook');
    await record(deps.db, tx, {
      workspaceId: ctx.workspaceId,
      actor: userActor(ctx),
      requestId: ctx.requestId,
      now,
      events: [{ type: 'runbook.version_created', entityType: 'runbook', entityId: runbookId, entityVersion: version, reason: 'indexing' }],
      audit: [{ operation: 'runbook.version.complete', resource: { type: 'runbook_version', id: versionId } }],
      outbox: [{ kind: 'runbook.index', aggregateId: versionId, payloadRefs: { runbookId } }],
    });
    return { status: 202, body: { versionId, state: 'indexing' as const, runbookVersion: version } };
  });
}

export async function publishRunbook(deps: Deps, ctx: ActorContext, runbookId: string, body: { readyVersionId: string }, meta: Meta) {
  requireOp(ctx, 'runbook.publish', 'You need the commander role to publish a runbook version.');
  return runCommand(deps.db, deps.clock, ctx, { operation: `runbook-publish:${runbookId}`, key: meta.idempotencyKey, payload: body, expectedVersion: meta.expectedVersion }, async (tx) => {
    const rb = await loadRunbook(deps, ctx.workspaceId, runbookId, tx);
    checkVersion(rb.version, meta.expectedVersion, 'runbook');
    const v = await deps.db.c.runbookVersions.findOne({ _id: body.readyVersionId, runbookId, workspaceId: ctx.workspaceId }, { session: tx });
    if (!v) throw notFound();
    if (v.state !== 'ready') throw new AppError('INVALID_TRANSITION', `Only a ready version can be published (this one is ${v.state}).`);
    const now = deps.clock.now();
    await deps.db.c.runbookVersions.updateOne({ _id: v._id, workspaceId: ctx.workspaceId }, { $set: { state: 'published', updatedAt: now }, $inc: { version: 1 } }, { session: tx });
    // Only the active version is searchable.
    await deps.db.c.runbookChunks.updateMany({ workspaceId: ctx.workspaceId, runbookId, versionId: { $ne: v._id } }, { $set: { published: false } }, { session: tx });
    await deps.db.c.runbookChunks.updateMany({ workspaceId: ctx.workspaceId, runbookId, versionId: v._id }, { $set: { published: true } }, { session: tx });
    const version = await casUpdate(deps.db.c.runbooks, tx, rb, { activeVersionId: v._id, updatedAt: now }, 'runbook');
    await record(deps.db, tx, {
      workspaceId: ctx.workspaceId,
      actor: userActor(ctx),
      requestId: ctx.requestId,
      now,
      events: [{ type: 'runbook.published', entityType: 'runbook', entityId: runbookId, entityVersion: version, reason: 'published' }],
      audit: [{ operation: 'runbook.publish', resource: { type: 'runbook_version', id: v._id }, beforeVersion: rb.version, afterVersion: version }],
    });
    return { status: 200, body: (await toDTO(deps, [await loadRunbook(deps, ctx.workspaceId, runbookId, tx)], tx))[0]! };
  });
}

// ---- Retrieval ----------------------------------------------------------------

export type ScopedChunk = RunbookChunkDoc & { score: number; runbookTitle: string; revision: number };

/**
 * Workspace-scoped lexical retrieval. The text index is prefixed by
 * workspaceId and published, and results are re-checked against the
 * authoritative active-version pointer to guard against index lag.
 */
export async function searchChunks(
  deps: Deps,
  workspaceId: string,
  query: string,
  scope: { serviceId?: string; environment?: string } = {},
  limit: number = LIMITS.maxChunks,
): Promise<ScopedChunk[]> {
  const q = query.slice(0, 200).trim();
  if (!q) return [];
  const raw = await deps.db.c.runbookChunks
    .find({ workspaceId, published: true, $text: { $search: q } }, { projection: { score: { $meta: 'textScore' } } })
    .sort({ score: { $meta: 'textScore' } })
    .limit(50)
    .toArray();
  if (!raw.length) return [];
  const runbooks = await deps.db.c.runbooks.find({ workspaceId, _id: { $in: [...new Set(raw.map((c) => c.runbookId))] }, archivedAt: null }).toArray();
  const versions = await deps.db.c.runbookVersions.find({ workspaceId, _id: { $in: [...new Set(raw.map((c) => c.versionId))] } }).toArray();
  const rbBy = new Map(runbooks.map((r) => [r._id, r]));
  const vBy = new Map(versions.map((v) => [v._id, v]));
  const perDoc = new Map<string, number>();
  const out: ScopedChunk[] = [];
  for (const c of raw as Array<RunbookChunkDoc & { score: number }>) {
    const rb = rbBy.get(c.runbookId);
    const v = vBy.get(c.versionId);
    if (!rb || !v || rb.activeVersionId !== c.versionId || v.state !== 'published') continue;
    if (scope.serviceId && rb.serviceIds.length && !rb.serviceIds.includes(scope.serviceId)) continue;
    if (scope.environment && rb.environments.length && !rb.environments.includes(scope.environment)) continue;
    const n = perDoc.get(c.runbookId) ?? 0;
    if (n >= LIMITS.maxChunksPerDocument) continue;
    perDoc.set(c.runbookId, n + 1);
    out.push({ ...c, runbookTitle: rb.title, revision: v.revision });
    if (out.length >= limit) break;
  }
  return out;
}

export async function searchRunbooks(deps: Deps, ctx: ActorContext, q: { q: string; serviceId?: string }): Promise<RunbookSearchHit[]> {
  requireOp(ctx, 'read');
  const hits = await searchChunks(deps, ctx.workspaceId, q.q, q.serviceId ? { serviceId: q.serviceId } : {});
  return hits.map((h) => ({
    runbookId: h.runbookId,
    runbookTitle: h.runbookTitle,
    versionId: h.versionId,
    revision: h.revision,
    chunkId: h._id,
    heading: h.heading,
    excerpt: h.text.slice(0, 600),
    score: Math.round(h.score * 100) / 100,
    retrievalMode: 'lexical',
  }));
}

// ---- Indexing (worker) -------------------------------------------------------

const CHUNK_CHARS = 2400; // ≈600 tokens
const OVERLAP_CHARS = 320; // ≈80 tokens

export function chunkDocument(text: string): Array<{ heading: string; text: string; start: number; end: number }> {
  const lines = text.split(/\r?\n/);
  const sections: Array<{ heading: string; start: number; body: string }> = [];
  let offset = 0;
  let current = { heading: 'Introduction', start: 0, body: '' };
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      if (current.body.trim()) sections.push(current);
      current = { heading: m[2]!.trim().slice(0, 200), start: offset, body: '' };
    } else {
      current.body += `${line}\n`;
    }
    offset += line.length + 1;
  }
  if (current.body.trim()) sections.push(current);
  const out: Array<{ heading: string; text: string; start: number; end: number }> = [];
  for (const s of sections) {
    const body = s.body.trim();
    for (let i = 0; i < body.length; i += CHUNK_CHARS - OVERLAP_CHARS) {
      const piece = body.slice(i, i + CHUNK_CHARS);
      out.push({ heading: s.heading, text: piece, start: s.start + i, end: s.start + i + piece.length });
      if (i + CHUNK_CHARS >= body.length) break;
    }
  }
  return out;
}
