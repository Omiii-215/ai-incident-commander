import type { AuditEventDTO, Page } from '@aic/contracts';
import type { Filter } from 'mongodb';
import { z } from 'zod';
import type { ActorContext } from '../context.js';
import type { Deps } from '../deps.js';
import type { AuditDoc } from '../db/types.js';
import { requireOp } from './common.js';
import { memberNames } from './mappers.js';

export const AuditQuery = z
  .object({
    actorId: z.string().max(80).optional(),
    operation: z.string().max(80).regex(/^[a-z0-9_.-]+$/).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    cursor: z.string().max(1000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

/** Read-only view of durable audit records; there is no write path from the UI. */
export async function listAudit(deps: Deps, ctx: ActorContext, q: z.infer<typeof AuditQuery>): Promise<Page<AuditEventDTO>> {
  requireOp(ctx, 'audit.read', 'You need the commander or auditor role to view the audit log.');
  const filterKey = { actorId: q.actorId ?? null, operation: q.operation ?? null, from: q.from ?? null, to: q.to ?? null };
  const filter: Filter<AuditDoc> = { workspaceId: ctx.workspaceId };
  if (q.actorId) filter['actor.id'] = q.actorId;
  if (q.operation) filter.operation = { $regex: `^${q.operation.replace(/\./g, '\\.')}` };
  if (q.from || q.to) filter.createdAt = { ...(q.from ? { $gte: new Date(q.from) } : {}), ...(q.to ? { $lte: new Date(q.to) } : {}) };
  if (q.cursor) {
    const [at, id] = deps.cursors.decodeList(q.cursor, ctx.workspaceId, filterKey) as [string, string];
    const d = new Date(at);
    filter.$or = [{ createdAt: { $lt: d } }, { createdAt: d, _id: { $lt: id } }];
  }
  const docs = await deps.db.c.audit.find(filter).sort({ createdAt: -1, _id: -1 }).limit(q.limit + 1).toArray();
  const page = docs.slice(0, q.limit);
  const names = await memberNames(deps.db, ctx.workspaceId, page.map((d) => d.actor.id));
  const last = page.at(-1);
  return {
    items: page.map((d) => ({
      id: d._id,
      createdAt: d.createdAt.toISOString(),
      actor: { type: d.actor.type, id: d.actor.id, name: names.get(d.actor.id) ?? d.actor.id },
      operation: d.operation,
      resource: d.resource,
      decision: d.decision,
      reasonCode: d.reasonCode,
      requestId: d.requestId,
      specHash: d.specHash,
      beforeVersion: d.beforeVersion,
      afterVersion: d.afterVersion,
    })),
    nextCursor: docs.length > q.limit && last ? deps.cursors.encodeList(ctx.workspaceId, filterKey, [last.createdAt.toISOString(), last._id]) : null,
  };
}
