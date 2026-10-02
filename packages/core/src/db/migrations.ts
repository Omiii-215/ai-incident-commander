import { ACTION_STATUSES, INCIDENT_STATUSES, INVESTIGATION_STATES, SEVERITIES } from '@aic/contracts';
import type { Document, IndexDescription } from 'mongodb';
import { COLLECTION_NAMES, type Collections, type Database } from './mongo.js';

// Named, idempotent migrations (DATA_MODEL.md §6, §9). Indexes are created
// before traffic; the API readiness check requires the latest migration.

type IndexSpec = { collection: keyof Collections; indexes: IndexDescription[] };

const DAY = 24 * 60 * 60;

const INDEXES: IndexSpec[] = [
  { collection: 'users', indexes: [{ key: { identityIssuer: 1, identitySubject: 1 }, name: 'uniq_identity', unique: true }] },
  { collection: 'workspaces', indexes: [{ key: { slug: 1 }, name: 'uniq_slug', unique: true }] },
  {
    collection: 'memberships',
    indexes: [
      { key: { workspaceId: 1, userId: 1 }, name: 'uniq_member', unique: true },
      { key: { userId: 1, status: 1 }, name: 'by_user' },
    ],
  },
  {
    collection: 'sessions',
    indexes: [{ key: { absoluteExpiresAt: 1 }, name: 'ttl_session', expireAfterSeconds: 0 }],
  },
  { collection: 'services', indexes: [{ key: { workspaceId: 1, slug: 1 }, name: 'uniq_slug', unique: true }] },
  {
    collection: 'alerts',
    indexes: [
      { key: { workspaceId: 1, connectorId: 1, externalEventId: 1 }, name: 'uniq_source_event', unique: true },
      { key: { workspaceId: 1, incidentId: 1, receivedAt: -1, _id: -1 }, name: 'by_incident' },
      { key: { expiresAt: 1 }, name: 'ttl_alert', expireAfterSeconds: 0 },
    ],
  },
  {
    collection: 'incidents',
    indexes: [
      {
        key: { workspaceId: 1, serviceId: 1, environment: 1, fingerprint: 1 },
        name: 'uniq_active_fingerprint',
        unique: true,
        partialFilterExpression: { active: true },
      },
      { key: { workspaceId: 1, status: 1, severity: 1, updatedAt: -1, _id: -1 }, name: 'queue' },
      { key: { workspaceId: 1, active: 1, severity: 1, updatedAt: -1, _id: -1 }, name: 'active_queue' },
      { key: { workspaceId: 1, ownerId: 1, active: 1, updatedAt: -1, _id: -1 }, name: 'by_owner' },
      { key: { workspaceId: 1, number: 1 }, name: 'uniq_number', unique: true },
    ],
  },
  { collection: 'timeline', indexes: [{ key: { workspaceId: 1, incidentId: 1, streamSeq: 1 }, name: 'uniq_seq', unique: true }] },
  {
    collection: 'investigationRuns',
    indexes: [
      { key: { workspaceId: 1, incidentId: 1 }, name: 'uniq_active_run', unique: true, partialFilterExpression: { active: true } },
      { key: { workspaceId: 1, incidentId: 1, createdAt: -1 }, name: 'by_incident' },
    ],
  },
  { collection: 'diagnoses', indexes: [{ key: { workspaceId: 1, incidentId: 1, createdAt: -1 }, name: 'by_incident' }] },
  {
    collection: 'evidence',
    indexes: [
      { key: { workspaceId: 1, incidentId: 1, collectedAt: -1, _id: -1 }, name: 'by_incident' },
      { key: { expiresAt: 1 }, name: 'ttl_evidence', expireAfterSeconds: 0 },
    ],
  },
  {
    collection: 'actions',
    indexes: [
      { key: { workspaceId: 1, status: 1, expiresAt: 1, _id: 1 }, name: 'queue_expiry' },
      { key: { workspaceId: 1, incidentId: 1, createdAt: -1 }, name: 'by_incident' },
      { key: { workspaceId: 1, createdAt: -1, _id: -1 }, name: 'by_created' },
    ],
  },
  { collection: 'approvals', indexes: [{ key: { workspaceId: 1, actionId: 1 }, name: 'uniq_decision', unique: true }] },
  { collection: 'executions', indexes: [{ key: { workspaceId: 1, actionId: 1, attempt: 1 }, name: 'uniq_attempt', unique: true }] },
  { collection: 'targetLeases', indexes: [{ key: { workspaceId: 1, serviceId: 1, environment: 1 }, name: 'uniq_target', unique: true }] },
  { collection: 'runbooks', indexes: [{ key: { workspaceId: 1, updatedAt: -1, _id: -1 }, name: 'by_updated' }] },
  { collection: 'runbookVersions', indexes: [{ key: { workspaceId: 1, runbookId: 1, revision: 1 }, name: 'uniq_revision', unique: true }] },
  {
    collection: 'runbookChunks',
    indexes: [
      { key: { workspaceId: 1, versionId: 1, ordinal: 1 }, name: 'uniq_chunk', unique: true },
      // Text index prefixed by workspaceId: every $text query must supply a workspace equality.
      { key: { workspaceId: 1, published: 1, heading: 'text', text: 'text' }, name: 'lexical', weights: { heading: 3, text: 1 } },
    ],
  },
  { collection: 'pluginCatalog', indexes: [{ key: { pluginId: 1, version: 1 }, name: 'uniq_version', unique: true }] },
  { collection: 'installations', indexes: [{ key: { workspaceId: 1, pluginId: 1 }, name: 'uniq_install', unique: true }] },
  {
    collection: 'idempotency',
    indexes: [
      { key: { workspaceId: 1, subjectId: 1, operation: 1, key: 1 }, name: 'uniq_command', unique: true },
      { key: { expiresAt: 1 }, name: 'ttl_idem', expireAfterSeconds: 0 },
    ],
  },
  {
    collection: 'workspaceEvents',
    indexes: [
      { key: { workspaceId: 1, streamSeq: 1 }, name: 'uniq_seq', unique: true },
      { key: { expiresAt: 1 }, name: 'ttl_stream', expireAfterSeconds: 0 },
    ],
  },
  {
    collection: 'audit',
    indexes: [
      { key: { workspaceId: 1, createdAt: -1, _id: -1 }, name: 'by_time' },
      { key: { expiresAt: 1 }, name: 'ttl_audit', expireAfterSeconds: 0 },
    ],
  },
  {
    collection: 'outbox',
    indexes: [
      { key: { state: 1, nextAttemptAt: 1, leaseUntil: 1 }, name: 'dispatch_scan' },
      // Only completed rows carry expiresAt; pending intent never expires.
      { key: { expiresAt: 1 }, name: 'ttl_outbox', expireAfterSeconds: 0 },
    ],
  },
  {
    collection: 'jobRuns',
    indexes: [
      { key: { workspaceId: 1, outboxId: 1 }, name: 'uniq_job', unique: true },
      { key: { expiresAt: 1 }, name: 'ttl_job', expireAfterSeconds: 0 },
    ],
  },
  { collection: 'postmortems', indexes: [{ key: { workspaceId: 1, incidentId: 1, createdAt: -1 }, name: 'by_incident' }] },
  {
    collection: 'simulatorTargets',
    indexes: [{ key: { workspaceId: 1, serviceId: 1, environment: 1 }, name: 'uniq_sim_target', unique: true }],
  },
];

const VALIDATORS: Partial<Record<keyof Collections, Document>> = {
  incidents: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'workspaceId', 'serviceId', 'environment', 'fingerprint', 'active', 'generation', 'status', 'severity', 'title', 'version', 'remediationRevision'],
      properties: {
        _id: { bsonType: 'string' },
        workspaceId: { bsonType: 'string' },
        status: { enum: [...INCIDENT_STATUSES] },
        severity: { enum: [...SEVERITIES] },
        active: { bsonType: 'bool' },
        version: { bsonType: ['int', 'long', 'double'], minimum: 1 },
        title: { bsonType: 'string', minLength: 1, maxLength: 200 },
      },
    },
  },
  actions: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'workspaceId', 'incidentId', 'spec', 'specHash', 'status', 'requestedBy', 'expiresAt', 'version'],
      properties: {
        workspaceId: { bsonType: 'string' },
        status: { enum: [...ACTION_STATUSES] },
        specHash: { bsonType: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
      },
    },
  },
  investigationRuns: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'workspaceId', 'incidentId', 'state', 'active'],
      properties: { workspaceId: { bsonType: 'string' }, state: { enum: [...INVESTIGATION_STATES] } },
    },
  },
  workspaceEvents: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['workspaceId', 'streamSeq', 'entityType', 'entityId', 'entityVersion', 'expiresAt'],
      properties: { workspaceId: { bsonType: 'string' } },
    },
  },
};

export const LATEST_MIGRATION = '0001_initial_indexes_and_validators';

export async function migrate(database: Database, log: (msg: string) => void = () => {}): Promise<void> {
  const { db } = database;
  const applied = db.collection<{ _id: string; appliedAt: Date }>('_migrations');
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

  for (const [key, name] of Object.entries(COLLECTION_NAMES) as Array<[keyof Collections, string]>) {
    const validator = VALIDATORS[key];
    if (!existing.has(name)) {
      await db.createCollection(name, validator ? { validator, validationLevel: 'strict' } : {});
    } else if (validator) {
      await db.command({ collMod: name, validator, validationLevel: 'strict' });
    }
  }
  for (const spec of INDEXES) {
    await db.collection(COLLECTION_NAMES[spec.collection]).createIndexes(spec.indexes);
  }
  await applied.updateOne({ _id: LATEST_MIGRATION }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
  log(`migration ${LATEST_MIGRATION} applied (${INDEXES.reduce((n, s) => n + s.indexes.length, 0)} indexes)`);
}

export async function migrationsCurrent(database: Database): Promise<boolean> {
  const row = await database.db.collection('_migrations').findOne({ _id: LATEST_MIGRATION as never });
  return row !== null;
}

export const RETENTION = {
  streamSeconds: 7 * DAY,
  auditSeconds: 365 * DAY,
  evidenceSeconds: 30 * DAY,
  idempotencySeconds: DAY,
  outboxCompletedSeconds: 7 * DAY,
  jobRunCompletedSeconds: 90 * DAY,
} as const;
