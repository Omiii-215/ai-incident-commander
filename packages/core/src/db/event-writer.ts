import type { EntityType, EventType, OutboxKind } from '@aic/contracts';
import { uuid } from '../context.js';
import { RETENTION } from './migrations.js';
import type { Database, Tx } from './mongo.js';
import type { Actor, AuditDoc, OutboxDoc, TimelineDoc, WorkspaceEventDoc } from './types.js';

// Writes the durable side of every accepted domain change in the caller's
// transaction: timeline, workspace stream event, audit, and outbox intent.
// Sequence values are allocated atomically per workspace (AGENTS.md §3).

export type EventInput = {
  type: EventType;
  entityType: EntityType;
  entityId: string;
  entityVersion: number;
  reason: string;
  timeline?: { incidentId: string; summary: string; refs?: Array<{ type: string; id: string }> };
};

export type AuditInput = {
  operation: string;
  resource: { type: string; id: string };
  decision?: 'allowed' | 'denied';
  reasonCode?: string | null;
  specHash?: string | null;
  beforeVersion?: number | null;
  afterVersion?: number | null;
};

export type OutboxInput = {
  kind: OutboxKind;
  aggregateId: string;
  payloadRefs?: Record<string, string | number>;
  delayMs?: number;
};

export type RecordInput = {
  workspaceId: string;
  actor: Actor;
  requestId: string;
  now: Date;
  events: EventInput[];
  audit?: AuditInput[];
  outbox?: OutboxInput[];
};

export async function allocateSeq(db: Database, tx: Tx, workspaceId: string, count: number): Promise<number> {
  const counter = await db.c.counters.findOneAndUpdate(
    { _id: workspaceId },
    { $inc: { nextSeq: count }, $setOnInsert: { workspaceId, nextIncidentNumber: 0 } },
    { upsert: true, returnDocument: 'after', session: tx },
  );
  // nextSeq holds the last allocated value.
  return counter!.nextSeq - count + 1;
}

export async function allocateIncidentNumber(db: Database, tx: Tx, workspaceId: string): Promise<number> {
  const counter = await db.c.counters.findOneAndUpdate(
    { _id: workspaceId },
    { $inc: { nextIncidentNumber: 1 }, $setOnInsert: { workspaceId, nextSeq: 0 } },
    { upsert: true, returnDocument: 'after', session: tx },
  );
  // nextIncidentNumber holds the last allocated number.
  return counter!.nextIncidentNumber;
}

export async function record(db: Database, tx: Tx, input: RecordInput): Promise<{ outboxIds: string[]; lastSeq: number }> {
  const { workspaceId, actor, requestId, now } = input;
  const first = input.events.length ? await allocateSeq(db, tx, workspaceId, input.events.length) : 0;
  const streamExpiry = new Date(now.getTime() + RETENTION.streamSeconds * 1000);

  const events: WorkspaceEventDoc[] = [];
  const timeline: TimelineDoc[] = [];
  input.events.forEach((e, i) => {
    const seq = first + i;
    events.push({
      _id: uuid(),
      workspaceId,
      streamSeq: seq,
      eventType: e.type,
      entityType: e.entityType,
      entityId: e.entityId,
      entityVersion: e.entityVersion,
      reason: e.reason,
      occurredAt: now,
      causationId: requestId,
      expiresAt: streamExpiry,
    });
    if (e.timeline) {
      timeline.push({
        _id: uuid(),
        workspaceId,
        incidentId: e.timeline.incidentId,
        streamSeq: seq,
        eventType: e.type,
        actor,
        summary: e.timeline.summary.slice(0, 1000),
        refs: e.timeline.refs ?? [],
        causationId: requestId,
        createdAt: now,
        schemaVersion: 1,
      });
    }
  });
  if (events.length) await db.c.workspaceEvents.insertMany(events, { session: tx });
  if (timeline.length) await db.c.timeline.insertMany(timeline, { session: tx });

  const audit: AuditDoc[] = (input.audit ?? []).map((a) => ({
    _id: uuid(),
    workspaceId,
    actor,
    operation: a.operation,
    resource: a.resource,
    decision: a.decision ?? 'allowed',
    reasonCode: a.reasonCode ?? null,
    requestId,
    specHash: a.specHash ?? null,
    beforeVersion: a.beforeVersion ?? null,
    afterVersion: a.afterVersion ?? null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + RETENTION.auditSeconds * 1000),
    schemaVersion: 1,
  }));
  if (audit.length) await db.c.audit.insertMany(audit, { session: tx });

  const outbox: OutboxDoc[] = (input.outbox ?? []).map((o) => ({
    _id: uuid(),
    workspaceId,
    kind: o.kind,
    aggregateId: o.aggregateId,
    schemaVersion: 1,
    payloadRefs: o.payloadRefs ?? {},
    requestId,
    state: 'pending',
    leaseUntil: null,
    dispatchAttempt: 0,
    nextAttemptAt: new Date(now.getTime() + (o.delayMs ?? 0)),
    completedAt: null,
    lastError: null,
    expiresAt: null,
    createdAt: now,
  }));
  if (outbox.length) await db.c.outbox.insertMany(outbox, { session: tx });

  return { outboxIds: outbox.map((o) => o._id), lastSeq: first + events.length - 1 };
}

/** Audit a denied operation outside any domain transaction (no secrets, no foreign entity data). */
export async function auditDenied(
  db: Database,
  input: { workspaceId: string; actor: Actor; requestId: string; now: Date; operation: string; resource: { type: string; id: string }; reasonCode: string },
) {
  await db.c.audit.insertOne({
    _id: uuid(),
    workspaceId: input.workspaceId,
    actor: input.actor,
    operation: input.operation,
    resource: input.resource,
    decision: 'denied',
    reasonCode: input.reasonCode,
    requestId: input.requestId,
    specHash: null,
    beforeVersion: null,
    afterVersion: null,
    createdAt: input.now,
    expiresAt: new Date(input.now.getTime() + RETENTION.auditSeconds * 1000),
    schemaVersion: 1,
  });
}
