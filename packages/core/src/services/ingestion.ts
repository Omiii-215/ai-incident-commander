import { createHmac, timingSafeEqual } from 'node:crypto';
import { AlertIngestBody, AppError } from '@aic/contracts';
import { alertFingerprint, normalizedAlertHash, severityRank, sha256Hex } from '@aic/domain';
import { SERVICE_PRINCIPALS, uuid } from '../context.js';
import type { Deps } from '../deps.js';
import { allocateIncidentNumber, record, type EventInput, type OutboxInput } from '../db/event-writer.js';
import { RETENTION } from '../db/migrations.js';
import type { AlertDoc, EvidenceDoc, IncidentDoc, InvestigationRunDoc } from '../db/types.js';
import { redact } from '../redaction.js';
import { newRunDoc } from './investigations.js';

// Alert ingestion (API_CONTRACTS.md §3, LLD.md §5). Workspace comes from the
// connector record, never from the request. 202 only after durable commit.

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type IngestResult = { status: 200 | 202; body: { receiptId: string; incidentId: string; duplicate: boolean } };

const invalidSignature = () => new AppError('INVALID_CONNECTOR_SIGNATURE', 'Connector authentication failed.');

export function signAlert(secret: string, timestamp: string, rawBody: string | Buffer): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

export async function ingestAlert(
  deps: Deps,
  input: { connectorId: string; rawBody: Buffer; timestamp: string | undefined; signature: string | undefined; requestId: string },
): Promise<IngestResult> {
  const { db, clock } = deps;
  const now = clock.now();

  // 1. Authenticate the connector before parsing the body.
  if (!/^[0-9a-f-]{36}$/i.test(input.connectorId)) throw invalidSignature();
  const connector = await db.c.connectorInstances.findOne({ _id: input.connectorId });
  if (!connector || connector.status !== 'active') throw invalidSignature();
  const secret = deps.secrets.resolve(connector.secretRef);
  if (!secret || !input.timestamp || !input.signature) throw invalidSignature();
  const ts = Number(input.timestamp);
  if (!Number.isInteger(ts) || Math.abs(now.getTime() / 1000 - ts) > SIGNATURE_TOLERANCE_SECONDS) throw invalidSignature();
  const expected = Buffer.from(signAlert(secret, input.timestamp, input.rawBody), 'hex');
  const given = Buffer.from(input.signature.replace(/^sha256=/, ''), 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalidSignature();

  // 2. Validate schema.
  let json: unknown;
  try {
    json = JSON.parse(input.rawBody.toString('utf8'));
  } catch {
    throw new AppError('INVALID_INPUT', 'Body is not valid JSON.');
  }
  const parsed = AlertIngestBody.safeParse(json);
  if (!parsed.success) {
    throw new AppError('INVALID_INPUT', 'Alert payload is invalid.', { issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  const alert = parsed.data;
  const workspaceId = connector.workspaceId;

  // 3. Installation grant and trusted mapping.
  const inst = await db.c.installations.findOne({ _id: connector.pluginInstallationId, workspaceId });
  if (!inst || inst.status !== 'enabled' || !inst.grants.includes('alerts:ingest')) {
    throw new AppError('FORBIDDEN', 'This connector is not permitted to ingest alerts.');
  }
  const serviceId = connector.externalMapping.services[alert.serviceKey];
  const service = serviceId ? await db.c.services.findOne({ _id: serviceId, workspaceId }) : null;
  if (!service || !service.environments.includes(alert.environment)) {
    throw new AppError('INVALID_INPUT', 'Unknown service key or environment for this connector.');
  }
  const workspace = await db.c.workspaces.findOne({ _id: workspaceId });
  if (!workspace || workspace.status !== 'active') throw new AppError('FORBIDDEN', 'Workspace is not accepting alerts.');

  const fingerprint = alertFingerprint({
    alertType: alert.alertType,
    labels: alert.labels,
    ...(connector.externalMapping.identityLabels ? { identityLabels: connector.externalMapping.identityLabels } : {}),
  });
  const normalizedHash = normalizedAlertHash(alert);
  const actor = SERVICE_PRINCIPALS.ingestion;

  // 4. One transaction: receipt, incident create/attach, history, events, outbox.
  return db.transact(async (tx) => {
    const existing = await db.c.alerts.findOne(
      { workspaceId, connectorId: connector._id, externalEventId: alert.externalEventId },
      { session: tx },
    );
    if (existing) {
      if (existing.normalizedHash !== normalizedHash) {
        throw new AppError('SOURCE_EVENT_CONFLICT', 'This source event ID was already used for different content.');
      }
      return { status: 200, body: { receiptId: existing._id, incidentId: existing.incidentId, duplicate: true } };
    }

    let incident = await db.c.incidents.findOne(
      { workspaceId, serviceId: service._id, environment: alert.environment, fingerprint, active: true },
      { session: tx },
    );
    const events: EventInput[] = [];
    const outbox: OutboxInput[] = [];
    const occurredAt = new Date(alert.occurredAt);
    const receiptId = uuid();
    const red = redact(alert.summary, [], 2000);

    if (!incident) {
      const number = await allocateIncidentNumber(db, tx, workspaceId);
      incident = {
        _id: uuid(),
        workspaceId,
        number,
        serviceId: service._id,
        environment: alert.environment,
        fingerprint,
        active: true,
        generation: 1,
        status: 'declared',
        severity: alert.severity,
        title: `${service.name}: ${red.text}`.slice(0, 200),
        ownerId: null,
        occurrenceCount: 1,
        openedAt: now,
        acknowledgedAt: null,
        resolvedAt: null,
        lastAlertAt: occurredAt,
        remediationRevision: 1,
        latestDiagnosisId: null,
        searchText: `${service.name} ${service.slug} ${red.text}`.toLowerCase(),
        createdAt: now,
        updatedAt: now,
        version: 1,
      } satisfies IncidentDoc;
      // Unique partial index on active fingerprint prevents parallel creators;
      // the losing transaction retries and attaches to the winner.
      await db.c.incidents.insertOne(incident, { session: tx });
      const run: InvestigationRunDoc = newRunDoc(deps, {
        workspaceId,
        incident,
        requesterId: actor.id,
        reason: 'New incident declared from alert',
        now,
      });
      await db.c.investigationRuns.insertOne(run, { session: tx });
      events.push({
        type: 'incident.created',
        entityType: 'incident',
        entityId: incident._id,
        entityVersion: 1,
        reason: 'created',
        timeline: { incidentId: incident._id, summary: `Incident declared from ${alert.alertType} alert (${alert.severity}).`, refs: [{ type: 'alert', id: receiptId }] },
      });
      events.push({
        type: 'investigation.requested',
        entityType: 'investigation',
        entityId: run._id,
        entityVersion: 1,
        reason: 'queued',
        timeline: { incidentId: incident._id, summary: 'Automatic investigation queued.', refs: [{ type: 'investigation', id: run._id }] },
      });
      outbox.push({ kind: 'investigation.run', aggregateId: run._id, payloadRefs: { incidentId: incident._id } });
    } else {
      const escalate = severityRank(alert.severity) < severityRank(incident.severity);
      const nextVersion = incident.version + 1;
      const res = await db.c.incidents.updateOne(
        { _id: incident._id, workspaceId, version: incident.version },
        {
          $set: {
            version: nextVersion,
            updatedAt: now,
            lastAlertAt: occurredAt > (incident.lastAlertAt ?? new Date(0)) ? occurredAt : incident.lastAlertAt,
            ...(escalate ? { severity: alert.severity } : {}),
          },
          $inc: { occurrenceCount: 1 },
        },
        { session: tx },
      );
      if (res.matchedCount !== 1) throw new AppError('CAPACITY_EXCEEDED', 'Incident is busy; retry the alert.');
      events.push({
        type: 'alert.accepted',
        entityType: 'incident',
        entityId: incident._id,
        entityVersion: nextVersion,
        reason: escalate ? 'severity_escalated' : 'alert_attached',
        timeline: {
          incidentId: incident._id,
          summary: escalate ? `Repeat alert escalated severity to ${alert.severity}.` : `Repeat ${alert.alertType} alert attached (occurrence ${incident.occurrenceCount + 1}).`,
          refs: [{ type: 'alert', id: receiptId }],
        },
      });
    }

    const evidence: EvidenceDoc = {
      _id: uuid(),
      workspaceId,
      incidentId: incident._id,
      runId: null,
      sourceType: 'alert',
      sourceId: `${connector._id}:${alert.externalEventId}`,
      sourceVersion: null,
      title: `Alert ${alert.alertType} (${alert.severity})`,
      collectedAt: now,
      observedFrom: occurredAt,
      observedTo: occurredAt,
      completeness: 'complete',
      checksum: `sha256:${sha256Hex(red.text)}`,
      objectKey: null,
      redactedExcerpt: `${red.text}\n${Object.entries(alert.measurements).map(([k, v]) => `${k}=${v}`).join(' ')}`.trim(),
      redactionCount: red.count,
      truncated: red.truncated,
      suspectedInjection: false,
      expiresAt: new Date(now.getTime() + RETENTION.evidenceSeconds * 1000),
      createdAt: now,
      schemaVersion: 1,
    };
    await db.c.evidence.insertOne(evidence, { session: tx });

    const alertDoc: AlertDoc = {
      _id: receiptId,
      workspaceId,
      connectorId: connector._id,
      externalEventId: alert.externalEventId,
      normalizedHash,
      serviceId: service._id,
      environment: alert.environment,
      alertType: alert.alertType,
      fingerprint,
      severity: alert.severity,
      occurredAt,
      receivedAt: now,
      incidentId: incident._id,
      summary: red.text,
      measurements: alert.measurements,
      evidenceRefs: [evidence._id],
      expiresAt: new Date(now.getTime() + RETENTION.evidenceSeconds * 1000),
      schemaVersion: 1,
      createdAt: now,
    };
    await db.c.alerts.insertOne(alertDoc, { session: tx });

    await record(db, tx, {
      workspaceId,
      actor,
      requestId: input.requestId,
      now,
      events,
      audit: [{ operation: 'alert.ingest', resource: { type: 'alert', id: receiptId }, afterVersion: null }],
      outbox,
    });
    return { status: 202, body: { receiptId, incidentId: incident._id, duplicate: false } };
  });
}
