import type {
  ActionDTO,
  DiagnosisDTO,
  EvidenceDTO,
  IncidentDTO,
  InvestigationDTO,
  TimelineEntryDTO,
} from '@aic/contracts';
import { allowedTransitions, capabilitiesFor } from '@aic/domain';
import type { ActorContext } from '../context.js';
import { SERVICE_PRINCIPALS } from '../context.js';
import type { Database } from '../db/mongo.js';
import type {
  ActionDoc,
  ApprovalDoc,
  DiagnosisDoc,
  EvidenceDoc,
  ExecutionDoc,
  IncidentDoc,
  InvestigationRunDoc,
  TimelineDoc,
} from '../db/types.js';
import { incidentRef, iso } from './common.js';

const SERVICE_NAMES: Record<string, string> = Object.fromEntries(
  Object.values(SERVICE_PRINCIPALS).map((p) => [p.id, p.id.replace('svc-', '').replace(/^\w/, (c) => c.toUpperCase()) + ' service']),
);

/** Display names for workspace members only; non-members resolve to a neutral label. */
export async function memberNames(db: Database, workspaceId: string, ids: Iterable<string>): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter(Boolean))];
  const out = new Map<string, string>();
  const userIds = unique.filter((id) => !SERVICE_NAMES[id]);
  if (userIds.length) {
    const members = await db.c.memberships.find({ workspaceId, userId: { $in: userIds } }).project({ userId: 1 }).toArray();
    const memberIds = members.map((m) => m.userId as string);
    const users = await db.c.users.find({ _id: { $in: memberIds } }).toArray();
    for (const u of users) out.set(u._id, u.displayName);
  }
  for (const id of unique) if (!out.has(id)) out.set(id, SERVICE_NAMES[id] ?? 'Former member');
  return out;
}

export async function serviceNames(db: Database, workspaceId: string, ids: Iterable<string>): Promise<Map<string, string>> {
  const docs = await db.c.services.find({ workspaceId, _id: { $in: [...new Set(ids)] } }).project({ name: 1 }).toArray();
  return new Map(docs.map((d) => [d._id as string, d.name as string]));
}

const INCIDENT_CAPABILITIES = [
  'incident.acknowledge',
  'incident.update',
  'incident.transition',
  'incident.comment',
  'investigation.request',
  'action.propose',
  'postmortem.request',
] as const;

export function toIncidentDTO(
  d: IncidentDoc,
  names: Map<string, string>,
  services: Map<string, string>,
  ctx?: ActorContext,
): IncidentDTO {
  const caps = ctx ? capabilitiesFor(ctx.roles).filter((c) => (INCIDENT_CAPABILITIES as readonly string[]).includes(c)) : undefined;
  return {
    id: d._id,
    workspaceId: d.workspaceId,
    reference: incidentRef(d.number),
    serviceId: d.serviceId,
    serviceName: services.get(d.serviceId) ?? 'Unknown service',
    environment: d.environment,
    status: d.status,
    severity: d.severity,
    title: d.title,
    ownerId: d.ownerId,
    ownerName: d.ownerId ? (names.get(d.ownerId) ?? null) : null,
    occurrenceCount: d.occurrenceCount,
    generation: d.generation,
    remediationRevision: d.remediationRevision,
    latestDiagnosisId: d.latestDiagnosisId,
    openedAt: d.openedAt.toISOString(),
    acknowledgedAt: iso(d.acknowledgedAt),
    resolvedAt: iso(d.resolvedAt),
    lastAlertAt: iso(d.lastAlertAt),
    updatedAt: d.updatedAt.toISOString(),
    version: d.version,
    allowedTransitions: d.status === 'declared' ? [] : [...allowedTransitions(d.status)],
    ...(caps ? { capabilities: caps } : {}),
  };
}

export async function incidentsToDTO(db: Database, workspaceId: string, docs: IncidentDoc[], ctx?: ActorContext) {
  const [names, services] = await Promise.all([
    memberNames(db, workspaceId, docs.map((d) => d.ownerId ?? '')),
    serviceNames(db, workspaceId, docs.map((d) => d.serviceId)),
  ]);
  return docs.map((d) => toIncidentDTO(d, names, services, ctx));
}

export async function timelineToDTO(db: Database, workspaceId: string, docs: TimelineDoc[]): Promise<TimelineEntryDTO[]> {
  const names = await memberNames(db, workspaceId, docs.map((d) => d.actor.id));
  return docs.map((d) => ({
    id: d._id,
    incidentId: d.incidentId,
    streamSeq: String(d.streamSeq),
    eventType: d.eventType,
    actor: { type: d.actor.type, id: d.actor.id, name: names.get(d.actor.id) ?? d.actor.id },
    summary: d.summary,
    refs: d.refs,
    createdAt: d.createdAt.toISOString(),
  }));
}

export function toEvidenceDTO(d: EvidenceDoc, now: Date): EvidenceDTO {
  const expired = d.expiresAt.getTime() <= now.getTime();
  return {
    id: d._id,
    incidentId: d.incidentId,
    runId: d.runId,
    sourceType: d.sourceType,
    sourceId: d.sourceId,
    sourceVersion: d.sourceVersion,
    title: d.title,
    collectedAt: d.collectedAt.toISOString(),
    observedFrom: iso(d.observedFrom),
    observedTo: iso(d.observedTo),
    completeness: expired ? 'unavailable' : d.completeness,
    redactedExcerpt: expired ? 'Source artifact expired.' : d.redactedExcerpt,
    redactionCount: d.redactionCount,
    truncated: d.truncated,
    suspectedInjection: d.suspectedInjection,
    checksum: d.checksum,
    expired,
  };
}

export function toDiagnosisDTO(d: DiagnosisDoc, currentRemediationRevision: number): DiagnosisDTO {
  return {
    id: d._id,
    runId: d.runId,
    incidentId: d.incidentId,
    summary: d.output.summary,
    facts: d.output.facts,
    hypotheses: d.output.hypotheses,
    missingEvidence: d.output.missingEvidence,
    proposedChecks: d.output.proposedChecks,
    suggestedActions: d.output.suggestedActions.map((a) => ({ ...a, target: d.target })),
    evidenceIds: d.evidenceIds,
    validity: { ...d.validity, superseded: d.remediationRevision !== currentRemediationRevision },
    modelMetadata: d.modelMetadata,
    remediationRevision: d.remediationRevision,
    createdAt: d.createdAt.toISOString(),
  };
}

export function toInvestigationDTO(r: InvestigationRunDoc, diagnosis: DiagnosisDTO | null): InvestigationDTO {
  return {
    id: r._id,
    incidentId: r.incidentId,
    state: r.state,
    phase: r.phase,
    rerunRequested: r.rerunRequested,
    reason: r.reason,
    degradedReason: r.degradedReason,
    diagnosis,
    evidenceIds: r.evidenceIds,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const ACTION_CAPS = ['action.decide', 'action.cancel', 'action.renew'] as const;

export async function actionsToDTO(
  db: Database,
  workspaceId: string,
  docs: ActionDoc[],
  ctx?: ActorContext,
  tx?: import('mongodb').ClientSession,
): Promise<ActionDTO[]> {
  if (!docs.length) return [];
  const ids = docs.map((d) => d._id);
  // Sequential so the same transaction session (when given) is never used concurrently.
  const s = tx ? { session: tx } : {};
  const approvals = await db.c.approvals.find({ workspaceId, actionId: { $in: ids } }, s).toArray();
  const executions = await db.c.executions.find({ workspaceId, actionId: { $in: ids } }, s).sort({ attempt: -1 }).toArray();
  const incidents = await db.c.incidents.find({ workspaceId, _id: { $in: docs.map((d) => d.incidentId) } }, s).project({ title: 1 }).toArray();
  const approvalBy = new Map<string, ApprovalDoc>(approvals.map((a) => [a.actionId, a]));
  const execBy = new Map<string, ExecutionDoc>();
  for (const e of executions) if (!execBy.has(e.actionId)) execBy.set(e.actionId, e);
  const titles = new Map(incidents.map((i) => [i._id as string, i.title as string]));
  const names = await memberNames(db, workspaceId, [
    ...docs.flatMap((d) => [d.requestedBy, d.renewedBy ?? '']),
    ...approvals.map((a) => a.decidedBy),
  ]);
  const person = (id: string) => ({ id, name: names.get(id) ?? 'Former member' });
  const caps = ctx ? capabilitiesFor(ctx.roles).filter((c) => (ACTION_CAPS as readonly string[]).includes(c)) : undefined;

  return docs.map((d) => {
    const a = approvalBy.get(d._id);
    const e = execBy.get(d._id);
    return {
      id: d._id,
      incidentId: d.incidentId,
      incidentTitle: titles.get(d.incidentId) ?? 'Unavailable incident',
      spec: d.spec,
      specHash: d.specHash,
      status: d.status,
      requestedBy: person(d.requestedBy),
      renewedBy: d.renewedBy ? person(d.renewedBy) : null,
      supersedesActionId: d.supersedesActionId,
      supersededByActionId: d.supersededByActionId,
      diagnosisId: d.diagnosisId,
      decision: a
        ? { decision: a.decision, decidedBy: person(a.decidedBy), reason: a.reason, decidedAt: a.decisionAt.toISOString() }
        : null,
      execution: e
        ? {
            executionKey: e.executionKey,
            status: e.status,
            dispatchAt: iso(e.dispatchAt),
            receipt: e.receipt,
            reconciliationState: e.reconciliationState,
          }
        : null,
      statusReason: d.statusReason,
      expiresAt: d.expiresAt.toISOString(),
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      version: d.version,
      ...(caps ? { capabilities: caps } : {}),
    };
  });
}
