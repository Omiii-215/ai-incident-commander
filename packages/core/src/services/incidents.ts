import {
  AppError,
  EVIDENCE_SOURCE_TYPES,
  notFound,
  type IncidentDTO,
  type IncidentStatus,
  type Page,
  type PatchIncidentBody,
  type Severity,
  type TimelineEntryDTO,
  type EvidenceDTO,
} from '@aic/contracts';
import { applyAcknowledge, applyTransition } from '@aic/domain';
import type { Filter } from 'mongodb';
import { z } from 'zod';
import { userActor, type ActorContext } from '../context.js';
import type { Deps } from '../deps.js';
import { record } from '../db/event-writer.js';
import { runCommand } from '../db/idempotency.js';
import { isDuplicateKey } from '../db/mongo.js';
import type { IncidentDoc } from '../db/types.js';
import { casUpdate, checkVersion, loadIncident, requireOp } from './common.js';
import { incidentsToDTO, timelineToDTO, toEvidenceDTO } from './mappers.js';

type Meta = { idempotencyKey: string; expectedVersion?: number | undefined };

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function listIncidents(
  deps: Deps,
  ctx: ActorContext,
  q: { status?: IncidentStatus[]; severity?: Severity[]; serviceId?: string; ownerId?: string; q?: string; cursor?: string; limit: number },
): Promise<Page<IncidentDTO>> {
  requireOp(ctx, 'read');
  const filterKey = { status: q.status ?? null, severity: q.severity ?? null, serviceId: q.serviceId ?? null, ownerId: q.ownerId ?? null, q: q.q ?? null };
  const filter: Filter<IncidentDoc> = { workspaceId: ctx.workspaceId };
  if (q.status) filter.status = { $in: q.status };
  else filter.active = true;
  if (q.severity) filter.severity = { $in: q.severity };
  if (q.serviceId) filter.serviceId = q.serviceId;
  if (q.ownerId) filter.ownerId = q.ownerId;
  if (q.q) filter.searchText = { $regex: escapeRegex(q.q.toLowerCase().slice(0, 200)) };

  if (q.cursor) {
    const [sev, updatedAt, id] = deps.cursors.decodeList(q.cursor, ctx.workspaceId, filterKey) as [Severity, string, string];
    const u = new Date(updatedAt);
    filter.$or = [
      { severity: { $gt: sev } },
      { severity: sev, updatedAt: { $lt: u } },
      { severity: sev, updatedAt: u, _id: { $lt: id } },
    ];
  }
  const docs = await deps.db.c.incidents
    .find(filter)
    .sort({ severity: 1, updatedAt: -1, _id: -1 })
    .limit(q.limit + 1)
    .toArray();
  const more = docs.length > q.limit;
  const page = docs.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: await incidentsToDTO(deps.db, ctx.workspaceId, page, ctx),
    nextCursor: more && last ? deps.cursors.encodeList(ctx.workspaceId, filterKey, [last.severity, last.updatedAt.toISOString(), last._id]) : null,
  };
}

export async function getIncident(deps: Deps, ctx: ActorContext, id: string): Promise<IncidentDTO> {
  requireOp(ctx, 'read');
  const doc = await loadIncident(deps.db, ctx.workspaceId, id);
  return (await incidentsToDTO(deps.db, ctx.workspaceId, [doc], ctx))[0]!;
}

async function respond(deps: Deps, ctx: ActorContext, incidentId: string, tx: import('mongodb').ClientSession) {
  const fresh = await loadIncident(deps.db, ctx.workspaceId, incidentId, tx);
  return { status: 200, body: (await incidentsToDTO(deps.db, ctx.workspaceId, [fresh], ctx))[0]! };
}

export async function acknowledgeIncident(deps: Deps, ctx: ActorContext, id: string, meta: Meta) {
  requireOp(ctx, 'incident.acknowledge');
  const { db, clock } = deps;
  return runCommand(db, clock, ctx, { operation: `acknowledge:${id}`, key: meta.idempotencyKey, payload: {}, expectedVersion: meta.expectedVersion }, async (tx) => {
    const doc = await loadIncident(db, ctx.workspaceId, id, tx);
    checkVersion(doc.version, meta.expectedVersion, 'incident');
    const now = clock.now();
    const next = applyAcknowledge(doc, ctx.subjectId, now);
    const version = await casUpdate(db.c.incidents, tx, doc, {
      status: next.status,
      ownerId: next.ownerId,
      acknowledgedAt: next.acknowledgedAt,
      updatedAt: now,
    }, 'incident');
    await record(db, tx, {
      workspaceId: ctx.workspaceId,
      actor: userActor(ctx),
      requestId: ctx.requestId,
      now,
      events: [
        {
          type: 'incident.acknowledged',
          entityType: 'incident',
          entityId: id,
          entityVersion: version,
          reason: 'acknowledged',
          timeline: { incidentId: id, summary: 'Acknowledged and assigned; status declared → investigating.' },
        },
      ],
      audit: [{ operation: 'incident.acknowledge', resource: { type: 'incident', id }, beforeVersion: doc.version, afterVersion: version }],
    });
    return respond(deps, ctx, id, tx);
  });
}

export async function transitionIncident(
  deps: Deps,
  ctx: ActorContext,
  id: string,
  body: { targetStatus: IncidentStatus; reason: string },
  meta: Meta,
) {
  requireOp(ctx, 'incident.transition');
  const { db, clock } = deps;
  try {
    return await runCommand(db, clock, ctx, { operation: `transition:${id}`, key: meta.idempotencyKey, payload: body, expectedVersion: meta.expectedVersion }, async (tx) => {
      const doc = await loadIncident(db, ctx.workspaceId, id, tx);
      checkVersion(doc.version, meta.expectedVersion, 'incident');
      const now = clock.now();
      const next = applyTransition(doc, body.targetStatus, now);
      if (next.reopened) {
        const clash = await db.c.incidents.findOne(
          { workspaceId: ctx.workspaceId, serviceId: doc.serviceId, environment: doc.environment, fingerprint: doc.fingerprint, active: true },
          { session: tx },
        );
        if (clash) {
          throw new AppError('ACTIVE_INCIDENT_CONFLICT', 'Another active incident already tracks this alert. Continue in that incident instead.', {
            activeIncidentId: clash._id,
          });
        }
      }
      const version = await casUpdate(db.c.incidents, tx, doc, {
        status: next.status,
        active: next.active,
        generation: next.generation,
        remediationRevision: next.remediationRevision,
        resolvedAt: next.resolvedAt,
        updatedAt: now,
      }, 'incident');
      const summary = next.reopened
        ? `Reopened (generation ${next.generation}): ${body.reason}`
        : `Status ${doc.status} → ${next.status}: ${body.reason}`;
      await record(db, tx, {
        workspaceId: ctx.workspaceId,
        actor: userActor(ctx),
        requestId: ctx.requestId,
        now,
        events: [{ type: 'incident.transitioned', entityType: 'incident', entityId: id, entityVersion: version, reason: `status_${next.status}`, timeline: { incidentId: id, summary } }],
        audit: [{ operation: 'incident.transition', resource: { type: 'incident', id }, reasonCode: `${doc.status}->${next.status}`, beforeVersion: doc.version, afterVersion: version }],
      });
      return respond(deps, ctx, id, tx);
    });
  } catch (e) {
    if (isDuplicateKey(e)) throw new AppError('ACTIVE_INCIDENT_CONFLICT', 'Another active incident already tracks this alert.');
    throw e;
  }
}

export async function patchIncident(deps: Deps, ctx: ActorContext, id: string, body: PatchIncidentBody, meta: Meta) {
  requireOp(ctx, 'incident.update');
  const { db, clock } = deps;
  return runCommand(db, clock, ctx, { operation: `patch:${id}`, key: meta.idempotencyKey, payload: body, expectedVersion: meta.expectedVersion }, async (tx) => {
    const doc = await loadIncident(db, ctx.workspaceId, id, tx);
    checkVersion(doc.version, meta.expectedVersion, 'incident');
    if (body.ownerId) {
      const m = await db.c.memberships.findOne({ workspaceId: ctx.workspaceId, userId: body.ownerId, status: 'active' }, { session: tx });
      if (!m || !m.roles.some((r) => r === 'responder' || r === 'commander')) {
        throw new AppError('INVALID_INPUT', 'The owner must be an active responder or commander in this workspace.');
      }
    }
    const now = clock.now();
    const set: Partial<IncidentDoc> = { updatedAt: now };
    const changes: string[] = [];
    if (body.title !== undefined && body.title !== doc.title) {
      set.title = body.title;
      set.searchText = `${doc.searchText} ${body.title.toLowerCase()}`.slice(-2000);
      changes.push('title updated');
    }
    if (body.severity !== undefined && body.severity !== doc.severity) {
      set.severity = body.severity;
      changes.push(`severity ${doc.severity} → ${body.severity}`);
    }
    if (body.ownerId !== undefined && body.ownerId !== doc.ownerId) {
      set.ownerId = body.ownerId;
      changes.push(body.ownerId ? 'owner reassigned' : 'owner cleared');
    }
    if (!changes.length) return respond(deps, ctx, id, tx);
    const version = await casUpdate(db.c.incidents, tx, doc, set, 'incident');
    await record(db, tx, {
      workspaceId: ctx.workspaceId,
      actor: userActor(ctx),
      requestId: ctx.requestId,
      now,
      events: [{ type: 'incident.updated', entityType: 'incident', entityId: id, entityVersion: version, reason: 'updated', timeline: { incidentId: id, summary: `Incident ${changes.join(', ')}.` } }],
      audit: [{ operation: 'incident.update', resource: { type: 'incident', id }, beforeVersion: doc.version, afterVersion: version }],
    });
    return respond(deps, ctx, id, tx);
  });
}

export async function commentOnIncident(deps: Deps, ctx: ActorContext, id: string, body: { text: string }, meta: Meta) {
  requireOp(ctx, 'incident.comment');
  const { db, clock } = deps;
  return runCommand(db, clock, ctx, { operation: `comment:${id}`, key: meta.idempotencyKey, payload: body, expectedVersion: meta.expectedVersion }, async (tx) => {
    const doc = await loadIncident(db, ctx.workspaceId, id, tx);
    checkVersion(doc.version, meta.expectedVersion, 'incident');
    const now = clock.now();
    // Comments do not change remediationRevision; they are human context, not authority.
    const version = await casUpdate(db.c.incidents, tx, doc, { updatedAt: now }, 'incident');
    await record(db, tx, {
      workspaceId: ctx.workspaceId,
      actor: userActor(ctx),
      requestId: ctx.requestId,
      now,
      events: [{ type: 'incident.commented', entityType: 'incident', entityId: id, entityVersion: version, reason: 'commented', timeline: { incidentId: id, summary: body.text } }],
      audit: [{ operation: 'incident.comment', resource: { type: 'incident', id }, beforeVersion: doc.version, afterVersion: version }],
    });
    return { status: 201, body: { incidentVersion: version } };
  });
}

export async function listTimeline(
  deps: Deps,
  ctx: ActorContext,
  incidentId: string,
  q: { cursor?: string; limit: number; order: 'asc' | 'desc' },
): Promise<Page<TimelineEntryDTO>> {
  requireOp(ctx, 'read');
  await loadIncident(deps.db, ctx.workspaceId, incidentId);
  const filterKey = { incidentId, order: q.order };
  const filter: Filter<import('../db/types.js').TimelineDoc> = { workspaceId: ctx.workspaceId, incidentId };
  if (q.cursor) {
    const [seq] = deps.cursors.decodeList(q.cursor, ctx.workspaceId, filterKey) as [number];
    filter.streamSeq = q.order === 'asc' ? { $gt: seq } : { $lt: seq };
  }
  const docs = await deps.db.c.timeline.find(filter).sort({ streamSeq: q.order === 'asc' ? 1 : -1 }).limit(q.limit + 1).toArray();
  const page = docs.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: await timelineToDTO(deps.db, ctx.workspaceId, page),
    nextCursor: docs.length > q.limit && last ? deps.cursors.encodeList(ctx.workspaceId, filterKey, [last.streamSeq]) : null,
  };
}

export const EvidenceQuery = z
  .object({
    sourceType: z.enum(EVIDENCE_SOURCE_TYPES).optional(),
    cursor: z.string().max(1000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export async function listEvidence(
  deps: Deps,
  ctx: ActorContext,
  incidentId: string,
  q: z.infer<typeof EvidenceQuery>,
): Promise<Page<EvidenceDTO>> {
  requireOp(ctx, 'read');
  await loadIncident(deps.db, ctx.workspaceId, incidentId);
  const filterKey = { incidentId, sourceType: q.sourceType ?? null };
  const filter: Filter<import('../db/types.js').EvidenceDoc> = { workspaceId: ctx.workspaceId, incidentId };
  if (q.sourceType) filter.sourceType = q.sourceType;
  if (q.cursor) {
    const [at, id] = deps.cursors.decodeList(q.cursor, ctx.workspaceId, filterKey) as [string, string];
    const d = new Date(at);
    filter.$or = [{ collectedAt: { $lt: d } }, { collectedAt: d, _id: { $lt: id } }];
  }
  const docs = await deps.db.c.evidence.find(filter).sort({ collectedAt: -1, _id: -1 }).limit(q.limit + 1).toArray();
  const page = docs.slice(0, q.limit);
  const last = page.at(-1);
  const now = deps.clock.now();
  return {
    items: page.map((d) => toEvidenceDTO(d, now)),
    nextCursor: docs.length > q.limit && last ? deps.cursors.encodeList(ctx.workspaceId, filterKey, [last.collectedAt.toISOString(), last._id]) : null,
  };
}

export async function getEvidence(deps: Deps, ctx: ActorContext, evidenceId: string): Promise<EvidenceDTO> {
  requireOp(ctx, 'read');
  const doc = await deps.db.c.evidence.findOne({ _id: evidenceId, workspaceId: ctx.workspaceId });
  if (!doc) throw notFound();
  return toEvidenceDTO(doc, deps.clock.now());
}
