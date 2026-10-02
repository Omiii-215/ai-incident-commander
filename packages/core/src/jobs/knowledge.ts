import { SERVICE_PRINCIPALS, uuid } from '../context.js';
import type { Deps } from '../deps.js';
import { record } from '../db/event-writer.js';
import type { RunbookChunkDoc } from '../db/types.js';
import { redact } from '../redaction.js';
import { generatePostmortemMarkdown } from '../services/postmortems.js';
import { chunkDocument } from '../services/runbooks.js';
import { completeJob, PermanentJobError, type JobContext } from './runtime.js';

/** Extract → redact → chunk → index → ready. The prior published version stays active until publish. */
export async function indexRunbookJob(deps: Deps, job: JobContext): Promise<void> {
  const { db, clock } = deps;
  const ws = job.outbox.workspaceId;
  const version = await db.c.runbookVersions.findOne({ _id: job.outbox.aggregateId, workspaceId: ws });
  if (!version) throw new PermanentJobError('Runbook version not found.');
  if (version.state !== 'indexing') return;
  const runbook = await db.c.runbooks.findOne({ _id: version.runbookId, workspaceId: ws });
  const data = await deps.objects.get(version.artifactKey);

  let error: string | null = null;
  let chunks: RunbookChunkDoc[] = [];
  if (!runbook || !data) error = 'Uploaded artifact is unavailable. Upload a new version.';
  else {
    const text = redact(data.toString('utf8'), [], 10 * 1024 * 1024).text;
    const pieces = chunkDocument(text);
    if (!pieces.length) error = 'No readable text was found in the document.';
    const now = clock.now();
    chunks = pieces.map((p, i) => ({
      _id: uuid(),
      workspaceId: ws,
      runbookId: version.runbookId,
      versionId: version._id,
      ordinal: i,
      heading: p.heading,
      text: p.text,
      offsets: { start: p.start, end: p.end },
      serviceIds: runbook.serviceIds,
      environments: runbook.environments,
      published: false,
      embeddingProfile: version.embeddingProfile,
      createdAt: now,
    }));
  }

  await db.transact(async (tx) => {
    const now = clock.now();
    // Idempotent on redelivery: replace any chunks from an earlier partial attempt.
    await db.c.runbookChunks.deleteMany({ workspaceId: ws, versionId: version._id }, { session: tx });
    if (!error && chunks.length) await db.c.runbookChunks.insertMany(chunks, { session: tx });
    await db.c.runbookVersions.updateOne(
      { _id: version._id, workspaceId: ws, state: 'indexing' },
      { $set: { state: error ? 'failed' : 'ready', error, updatedAt: now }, $inc: { version: 1 } },
      { session: tx },
    );
    const rb = await db.c.runbooks.findOneAndUpdate({ _id: version.runbookId, workspaceId: ws }, { $set: { updatedAt: now }, $inc: { version: 1 } }, { session: tx, returnDocument: 'after' });
    await record(db, tx, {
      workspaceId: ws,
      actor: SERVICE_PRINCIPALS.knowledge,
      requestId: job.outbox.requestId,
      now,
      events: [{ type: 'runbook.indexed', entityType: 'runbook', entityId: version.runbookId, entityVersion: rb?.version ?? 1, reason: error ? 'failed' : 'ready' }],
      audit: [{ operation: 'runbook.index', resource: { type: 'runbook_version', id: version._id }, reasonCode: error ? 'FAILED' : `CHUNKS_${chunks.length}` }],
    });
    await completeJob(deps, tx, job);
  });
}

/** Harmless read-only connectivity probe; never a production write. */
export async function pluginTestJob(deps: Deps, job: JobContext): Promise<void> {
  const { db, clock } = deps;
  const ws = job.outbox.workspaceId;
  const inst = await db.c.installations.findOne({ _id: job.outbox.aggregateId, workspaceId: ws });
  if (!inst) throw new PermanentJobError('Installation not found.');
  const catalog = await db.c.pluginCatalog.findOne({ pluginId: inst.pluginId, version: inst.pinnedVersion });
  let ok = !!catalog && catalog.reviewStatus === 'reviewed';
  let lastError: string | null = ok ? null : 'Pinned version is not in the reviewed catalog.';
  if (ok && inst.pluginId === 'core.simulator') {
    const serviceId = inst.allowedServiceIds[0];
    const env = inst.allowedEnvironments[0];
    if (!serviceId || !env) {
      ok = false;
      lastError = 'No target services/environments are granted; nothing to probe.';
    } else {
      const sample = await deps.simulator.readMetrics({ workspaceId: ws, serviceId, environment: env });
      ok = !!sample;
      lastError = sample ? null : 'Simulator target not found for the first granted service.';
    }
  }
  if (ok && inst.pluginId === 'core.synthetic-alerts') {
    const connector = await db.c.connectorInstances.findOne({ workspaceId: ws, pluginInstallationId: inst._id });
    ok = !!connector && !!deps.secrets.resolve(connector.secretRef);
    lastError = ok ? null : 'Webhook secret is not configured in the secret store.';
  }
  await db.transact(async (tx) => {
    const now = clock.now();
    const res = await db.c.installations.findOneAndUpdate(
      { _id: inst._id, workspaceId: ws },
      { $set: { health: { status: ok ? 'ok' : 'error', checkedAt: now, lastError } } },
      { session: tx, returnDocument: 'after' },
    );
    await record(db, tx, {
      workspaceId: ws,
      actor: SERVICE_PRINCIPALS.scheduler,
      requestId: job.outbox.requestId,
      now,
      events: [{ type: 'plugin.updated', entityType: 'plugin_installation', entityId: inst._id, entityVersion: res?.version ?? inst.version, reason: ok ? 'health_ok' : 'health_error' }],
      audit: [{ operation: 'plugin.test.result', resource: { type: 'plugin_installation', id: inst._id }, reasonCode: ok ? 'OK' : 'ERROR' }],
    });
    await completeJob(deps, tx, job);
  });
}

export async function postmortemJob(deps: Deps, job: JobContext): Promise<void> {
  const { db, clock } = deps;
  const ws = job.outbox.workspaceId;
  const doc = await db.c.postmortems.findOne({ _id: job.outbox.aggregateId, workspaceId: ws });
  if (!doc) throw new PermanentJobError('Postmortem draft not found.');
  if (doc.state !== 'generating') return;
  let markdown: string | null = null;
  try {
    markdown = await generatePostmortemMarkdown(deps, ws, doc.incidentId);
  } catch {
    markdown = null;
  }
  await db.transact(async (tx) => {
    const now = clock.now();
    await db.c.postmortems.updateOne({ _id: doc._id, workspaceId: ws }, { $set: { state: markdown ? 'ready' : 'failed', markdown, updatedAt: now } }, { session: tx });
    await record(db, tx, {
      workspaceId: ws,
      actor: SERVICE_PRINCIPALS.reporter,
      requestId: job.outbox.requestId,
      now,
      events: [{ type: 'postmortem.drafted', entityType: 'postmortem', entityId: doc._id, entityVersion: 2, reason: markdown ? 'ready' : 'failed', timeline: { incidentId: doc.incidentId, summary: markdown ? 'Postmortem draft ready for review.' : 'Postmortem draft generation failed.' } }],
    });
    await completeJob(deps, tx, job);
  });
}
