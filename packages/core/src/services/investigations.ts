import { AppError, notFound, type InvestigationDTO } from '@aic/contracts';
import { uuid, userActor, type ActorContext } from '../context.js';
import type { Deps } from '../deps.js';
import { record } from '../db/event-writer.js';
import { runCommand } from '../db/idempotency.js';
import type { IncidentDoc, InvestigationRunDoc } from '../db/types.js';
import { PROMPT_VERSION, WORKFLOW_VERSION } from '../ai/workflow-constants.js';
import { checkVersion, loadIncident, requireOp } from './common.js';
import { toDiagnosisDTO, toInvestigationDTO } from './mappers.js';

export function newRunDoc(
  deps: Pick<Deps, 'provider'>,
  i: { workspaceId: string; incident: IncidentDoc; requesterId: string; reason: string; now: Date },
): InvestigationRunDoc {
  return {
    _id: uuid(),
    workspaceId: i.workspaceId,
    incidentId: i.incident._id,
    requesterId: i.requesterId,
    reason: i.reason,
    generation: i.incident.generation,
    inputRevision: i.incident.version,
    state: 'queued',
    active: true,
    phase: null,
    rerunRequested: false,
    budget: { modelCalls: 0, toolCalls: 0, nodeTransitions: 0, inputTokens: 0, outputTokens: 0, deadlineAt: null },
    providerProfile: deps.provider.profile,
    promptVersion: PROMPT_VERSION,
    workflowVersion: WORKFLOW_VERSION,
    evidenceIds: [],
    checkpointRef: null,
    resultRef: null,
    degradedReason: null,
    leaseToken: 0,
    createdAt: i.now,
    updatedAt: i.now,
    version: 1,
  };
}

/** POST /incidents/{id}/investigations — coalesces with an active run (LLD.md §5). */
export async function requestInvestigation(
  deps: Deps,
  ctx: ActorContext,
  incidentId: string,
  body: { reason: string },
  meta: { idempotencyKey: string; expectedVersion?: number },
) {
  requireOp(ctx, 'investigation.request');
  const { db, clock } = deps;
  return runCommand(db, clock, ctx, { operation: `investigations:${incidentId}`, key: meta.idempotencyKey, payload: body, expectedVersion: meta.expectedVersion }, async (tx) => {
    const incident = await loadIncident(db, ctx.workspaceId, incidentId, tx);
    checkVersion(incident.version, meta.expectedVersion, 'incident');
    if (!incident.active) throw new AppError('INVALID_TRANSITION', 'A resolved incident cannot be investigated. Reopen it first.');
    const now = clock.now();
    const active = await db.c.investigationRuns.findOne({ workspaceId: ctx.workspaceId, incidentId, active: true }, { session: tx });
    if (active) {
      const next = active.version + 1;
      await db.c.investigationRuns.updateOne(
        { _id: active._id, workspaceId: ctx.workspaceId },
        { $set: { rerunRequested: true, updatedAt: now, version: next } },
        { session: tx },
      );
      await record(db, tx, {
        workspaceId: ctx.workspaceId,
        actor: userActor(ctx),
        requestId: ctx.requestId,
        now,
        events: [{ type: 'investigation.requested', entityType: 'investigation', entityId: active._id, entityVersion: next, reason: 'rerun_coalesced' }],
        audit: [{ operation: 'investigation.request', resource: { type: 'investigation', id: active._id }, reasonCode: 'COALESCED' }],
      });
      return { status: 202, body: { id: active._id, state: active.state, coalesced: true } };
    }
    const run = newRunDoc(deps, { workspaceId: ctx.workspaceId, incident, requesterId: ctx.subjectId, reason: body.reason, now });
    await db.c.investigationRuns.insertOne(run, { session: tx });
    await record(db, tx, {
      workspaceId: ctx.workspaceId,
      actor: userActor(ctx),
      requestId: ctx.requestId,
      now,
      events: [
        {
          type: 'investigation.requested',
          entityType: 'investigation',
          entityId: run._id,
          entityVersion: 1,
          reason: 'queued',
          timeline: { incidentId, summary: `Diagnosis requested: ${body.reason}`, refs: [{ type: 'investigation', id: run._id }] },
        },
      ],
      audit: [{ operation: 'investigation.request', resource: { type: 'investigation', id: run._id } }],
      outbox: [{ kind: 'investigation.run', aggregateId: run._id, payloadRefs: { incidentId } }],
    });
    return { status: 202, body: { id: run._id, state: run.state, coalesced: false } };
  });
}

export async function getInvestigation(deps: Deps, ctx: ActorContext, runId: string): Promise<InvestigationDTO> {
  requireOp(ctx, 'read');
  const run = await deps.db.c.investigationRuns.findOne({ _id: runId, workspaceId: ctx.workspaceId });
  if (!run) throw notFound();
  return investigationDTO(deps, ctx.workspaceId, run);
}

export async function latestInvestigation(deps: Deps, ctx: ActorContext, incidentId: string): Promise<InvestigationDTO | null> {
  requireOp(ctx, 'read');
  await loadIncident(deps.db, ctx.workspaceId, incidentId);
  const run = await deps.db.c.investigationRuns.find({ workspaceId: ctx.workspaceId, incidentId }).sort({ createdAt: -1 }).limit(1).next();
  return run ? investigationDTO(deps, ctx.workspaceId, run) : null;
}

async function investigationDTO(deps: Deps, workspaceId: string, run: InvestigationRunDoc) {
  const [diag, incident] = await Promise.all([
    run.resultRef ? deps.db.c.diagnoses.findOne({ _id: run.resultRef, workspaceId }) : null,
    deps.db.c.incidents.findOne({ _id: run.incidentId, workspaceId }),
  ]);
  return toInvestigationDTO(run, diag ? toDiagnosisDTO(diag, incident?.remediationRevision ?? -1) : null);
}

export async function getDiagnosis(deps: Deps, ctx: ActorContext, incidentId: string) {
  requireOp(ctx, 'read');
  const incident = await loadIncident(deps.db, ctx.workspaceId, incidentId);
  if (!incident.latestDiagnosisId) return null;
  const d = await deps.db.c.diagnoses.findOne({ _id: incident.latestDiagnosisId, workspaceId: ctx.workspaceId });
  return d ? toDiagnosisDTO(d, incident.remediationRevision) : null;
}
