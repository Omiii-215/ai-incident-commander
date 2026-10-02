import {
  AppError,
  type ActionDTO,
  type ActionProposalBody,
  type ActionSpec,
  type ActionStatus,
  type DecisionBody,
  type Page,
} from '@aic/contracts';
import { APPROVAL_WINDOW_MS, PRE_DISPATCH_STATUSES, assertActionTransition, checkApprovable, computeSpecHash } from '@aic/domain';
import type { Filter } from 'mongodb';
import { ACTION_TOOLS, isActionTool } from '../connectors/catalog.js';
import { uuid, userActor, type ActorContext } from '../context.js';
import type { Deps } from '../deps.js';
import { auditDenied, record } from '../db/event-writer.js';
import { runCommand } from '../db/idempotency.js';
import type { Tx } from '../db/mongo.js';
import type { ActionDoc, IncidentDoc } from '../db/types.js';
import { checkVersion, loadAction, loadIncident, requireOp } from './common.js';
import { actionsToDTO } from './mappers.js';

type Meta = { idempotencyKey: string; expectedVersion?: number | undefined };

const PROPOSABLE_STATUSES = ['investigating', 'mitigating', 'monitoring'];

type Prepared = { spec: Omit<ActionSpec, 'incidentGeneration' | 'remediationRevision' | 'expiresAt' | 'workspaceId' | 'incidentId'> };

/**
 * Validate tool, arguments, target and grants, and run a fresh preflight.
 * Runs outside any transaction because preflight contacts the connector.
 */
async function prepareSpec(deps: Deps, workspaceId: string, body: ActionProposalBody): Promise<Prepared> {
  if (!isActionTool(body.toolId)) {
    throw new AppError('INVALID_ACTION_ARGUMENTS', 'Unknown tool. Only reviewed tools can be proposed.');
  }
  const tool = ACTION_TOOLS[body.toolId];
  const args = tool.args.safeParse(body.arguments);
  if (!args.success) {
    throw new AppError('INVALID_ACTION_ARGUMENTS', 'Tool arguments are invalid.', {
      issues: args.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const service = await deps.db.c.services.findOne({ _id: body.target.serviceId, workspaceId });
  if (!service || !service.environments.includes(body.target.environment)) {
    throw new AppError('INVALID_ACTION_ARGUMENTS', 'The target service or environment is not in this workspace inventory.');
  }
  const inst = await deps.gateway.installation(workspaceId, tool.pluginId);
  const denial = await deps.gateway.denial(inst, tool.scope, tool.capability, body.target);
  if (denial || !inst) {
    throw new AppError('FORBIDDEN', `The ${tool.pluginId} connector is not permitted to run this action (${denial}).`, { reasonCode: denial });
  }
  const pre = await deps.simulator.preflight({ workspaceId, ...body.target });
  if (!pre) throw new AppError('INVALID_ACTION_ARGUMENTS', 'Preflight could not find the target.');
  const described = tool.describe(args.data as Record<string, unknown>, service.name, body.target.environment);
  return {
    spec: {
      toolId: body.toolId,
      toolVersion: tool.toolVersion,
      installationId: inst._id,
      arguments: args.data as Record<string, unknown>,
      target: { serviceId: body.target.serviceId, environment: body.target.environment, revision: pre.revision },
      expectedEffect: described.expectedEffect,
      riskSummary: described.riskSummary,
      verification: described.verification,
      simulation: true,
    },
  };
}

async function insertProposal(
  deps: Deps,
  ctx: ActorContext,
  tx: Tx,
  incident: IncidentDoc,
  prepared: Prepared,
  extra: { requestedBy: string; renewedBy: string | null; lineage: string[]; supersedes: string | null; diagnosisId: string | null; reasonSummary: string },
): Promise<ActionDoc> {
  const now = deps.clock.now();
  const expiresAt = new Date(now.getTime() + APPROVAL_WINDOW_MS);
  const spec: ActionSpec = {
    ...prepared.spec,
    workspaceId: ctx.workspaceId,
    incidentId: incident._id,
    incidentGeneration: incident.generation,
    remediationRevision: incident.remediationRevision,
    expiresAt: expiresAt.toISOString(),
  };
  const specHash = computeSpecHash(spec);
  const id = uuid();
  // proposed → awaiting_approval in one transaction after validation and preflight.
  assertActionTransition('proposed', 'awaiting_approval');
  const doc: ActionDoc = {
    _id: id,
    workspaceId: ctx.workspaceId,
    incidentId: incident._id,
    spec,
    specHash,
    status: 'awaiting_approval',
    statusReason: null,
    requestedBy: extra.requestedBy,
    renewedBy: extra.renewedBy,
    lineageRequesters: extra.lineage,
    supersedesActionId: extra.supersedes,
    supersededByActionId: null,
    diagnosisId: extra.diagnosisId,
    approvalId: null,
    executionKey: `exec-${id}`,
    expiresAt,
    remediationRevision: incident.remediationRevision,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  await deps.db.c.actions.insertOne(doc, { session: tx });
  await record(deps.db, tx, {
    workspaceId: ctx.workspaceId,
    actor: userActor(ctx),
    requestId: ctx.requestId,
    now,
    events: [
      {
        type: 'action.proposed',
        entityType: 'action',
        entityId: id,
        entityVersion: 1,
        reason: 'awaiting_approval',
        timeline: { incidentId: incident._id, summary: extra.reasonSummary, refs: [{ type: 'action', id }] },
      },
    ],
    audit: [{ operation: extra.supersedes ? 'action.renew' : 'action.propose', resource: { type: 'action', id }, specHash, afterVersion: 1 }],
  });
  return doc;
}

export async function proposeAction(deps: Deps, ctx: ActorContext, incidentId: string, body: ActionProposalBody, meta: Meta) {
  requireOp(ctx, 'action.propose');
  const { db, clock } = deps;
  // Authorize incident access before contacting any connector.
  const pre = await loadIncident(db, ctx.workspaceId, incidentId);
  checkVersion(pre.version, meta.expectedVersion, 'incident');
  const prepared = await prepareSpec(deps, ctx.workspaceId, body);
  return runCommand(db, clock, ctx, { operation: `propose:${incidentId}`, key: meta.idempotencyKey, payload: body, expectedVersion: meta.expectedVersion }, async (tx) => {
    const incident = await loadIncident(db, ctx.workspaceId, incidentId, tx);
    checkVersion(incident.version, meta.expectedVersion, 'incident');
    if (!incident.active || !PROPOSABLE_STATUSES.includes(incident.status)) {
      throw new AppError('INVALID_TRANSITION', 'Actions can be requested only while an incident is investigating, mitigating or monitoring.');
    }
    if (body.target.serviceId !== incident.serviceId || body.target.environment !== incident.environment) {
      // Cross-service remediation is allowed only for the incident's own target in the MVP.
      throw new AppError('INVALID_ACTION_ARGUMENTS', "The target must be this incident's service and environment.");
    }
    if (body.diagnosisId) {
      const d = await db.c.diagnoses.findOne({ _id: body.diagnosisId, workspaceId: ctx.workspaceId, incidentId }, { session: tx });
      if (!d) throw new AppError('INVALID_ACTION_ARGUMENTS', 'The referenced diagnosis does not belong to this incident.');
    }
    const tool = ACTION_TOOLS[prepared.spec.toolId as keyof typeof ACTION_TOOLS];
    const doc = await insertProposal(deps, ctx, tx, incident, prepared, {
      requestedBy: ctx.subjectId,
      renewedBy: null,
      lineage: [],
      supersedes: null,
      diagnosisId: body.diagnosisId ?? null,
      reasonSummary: `Action requested: ${tool.label} (simulation); awaiting independent approval.`,
    });
    return { status: 201, body: (await actionsToDTO(db, ctx.workspaceId, [doc], ctx, tx))[0]! };
  });
}

export async function decideAction(deps: Deps, ctx: ActorContext, actionId: string, body: DecisionBody, meta: Meta) {
  const { db, clock } = deps;
  if (!ctx.roles.includes('commander')) {
    await auditDenied(db, { workspaceId: ctx.workspaceId, actor: userActor(ctx), requestId: ctx.requestId, now: clock.now(), operation: 'action.decide', resource: { type: 'action', id: actionId }, reasonCode: 'ROLE_REQUIRED' });
    throw new AppError('FORBIDDEN', 'You need the commander role to approve this request.');
  }
  return runCommand(db, clock, ctx, { operation: `decide:${actionId}`, key: meta.idempotencyKey, payload: body, expectedVersion: meta.expectedVersion }, async (tx) => {
    const action = await loadAction(db, ctx.workspaceId, actionId, tx);
    checkVersion(action.version, meta.expectedVersion, 'request');
    const incident = await loadIncident(db, ctx.workspaceId, action.incidentId, tx);
    const now = clock.now();
    // Re-verify current membership inside the transaction (never trust the session snapshot).
    const membership = await db.c.memberships.findOne({ workspaceId: ctx.workspaceId, userId: ctx.subjectId, status: 'active' }, { session: tx });
    if (!membership || !membership.roles.includes('commander')) {
      throw new AppError('FORBIDDEN', 'You need the commander role to approve this request.');
    }
    checkApprovable({
      action,
      incident,
      deciderId: ctx.subjectId,
      submittedSpecHash: body.specHash,
      now,
    });
    const workspace = await db.c.workspaces.findOne({ _id: ctx.workspaceId }, { session: tx });
    const approvalId = uuid();
    await db.c.approvals.insertOne(
      {
        _id: approvalId,
        workspaceId: ctx.workspaceId,
        actionId,
        specHash: action.specHash,
        decision: body.decision,
        decidedBy: ctx.subjectId,
        decisionAt: now,
        reason: body.reason,
        membershipVersion: membership.grantVersion,
        policyVersion: workspace?.policyVersion ?? 1,
        createdAt: now,
        schemaVersion: 1,
      },
      { session: tx },
    );
    const approve = body.decision === 'approve';
    let status: ActionStatus;
    if (approve) {
      assertActionTransition('awaiting_approval', 'approved');
      assertActionTransition('approved', 'queued');
      status = 'queued'; // approved and queued recorded together (EVENT_FLOWS.md §5)
    } else {
      assertActionTransition('awaiting_approval', 'rejected');
      status = 'rejected';
    }
    const version = action.version + 1;
    const res = await db.c.actions.updateOne(
      { _id: actionId, workspaceId: ctx.workspaceId, version: action.version, status: 'awaiting_approval' },
      { $set: { status, approvalId, statusReason: approve ? null : body.reason, updatedAt: now, version } },
      { session: tx },
    );
    if (res.matchedCount !== 1) throw new AppError('VERSION_CONFLICT', 'This request changed. Refresh it before deciding.');
    await record(db, tx, {
      workspaceId: ctx.workspaceId,
      actor: userActor(ctx),
      requestId: ctx.requestId,
      now,
      events: [
        {
          type: 'action.decided',
          entityType: 'action',
          entityId: actionId,
          entityVersion: version,
          reason: approve ? 'approved_queued' : 'rejected',
          timeline: {
            incidentId: action.incidentId,
            summary: approve ? `Simulated action approved; queued for dispatch. Reason: ${body.reason}` : `Action rejected: ${body.reason}`,
            refs: [{ type: 'action', id: actionId }],
          },
        },
      ],
      audit: [{ operation: `action.${body.decision}`, resource: { type: 'action', id: actionId }, specHash: action.specHash, beforeVersion: action.version, afterVersion: version }],
      outbox: approve ? [{ kind: 'action.execute', aggregateId: actionId, payloadRefs: { specHash: action.specHash } }] : [],
    });
    const fresh = await loadAction(db, ctx.workspaceId, actionId, tx);
    return { status: 200, body: (await actionsToDTO(db, ctx.workspaceId, [fresh], ctx, tx))[0]! };
  });
}

export async function cancelAction(deps: Deps, ctx: ActorContext, actionId: string, body: { reason: string }, meta: Meta) {
  requireOp(ctx, 'action.cancel');
  const { db, clock } = deps;
  return runCommand(db, clock, ctx, { operation: `cancel:${actionId}`, key: meta.idempotencyKey, payload: body, expectedVersion: meta.expectedVersion }, async (tx) => {
    const action = await loadAction(db, ctx.workspaceId, actionId, tx);
    if (action.requestedBy !== ctx.subjectId && !ctx.roles.includes('commander')) {
      throw new AppError('FORBIDDEN', 'Only the requester or a commander can cancel this request.');
    }
    checkVersion(action.version, meta.expectedVersion, 'request');
    if (!PRE_DISPATCH_STATUSES.includes(action.status) || action.status === 'proposed') {
      throw new AppError('ACTION_ALREADY_DISPATCHED', `This request is ${action.status.replace('_', ' ')}; it can no longer be cancelled.`, {
        currentStatus: action.status,
      });
    }
    const now = clock.now();
    const version = action.version + 1;
    const res = await db.c.actions.updateOne(
      { _id: actionId, workspaceId: ctx.workspaceId, version: action.version },
      { $set: { status: 'cancelled', statusReason: body.reason, updatedAt: now, version } },
      { session: tx },
    );
    if (res.matchedCount !== 1) throw new AppError('VERSION_CONFLICT', 'This request changed. Refresh it.');
    await cancelPendingDispatch(deps, tx, ctx.workspaceId, actionId);
    await record(db, tx, {
      workspaceId: ctx.workspaceId,
      actor: userActor(ctx),
      requestId: ctx.requestId,
      now,
      events: [{ type: 'action.cancelled', entityType: 'action', entityId: actionId, entityVersion: version, reason: 'cancelled', timeline: { incidentId: action.incidentId, summary: `Action request cancelled before dispatch: ${body.reason}`, refs: [{ type: 'action', id: actionId }] } }],
      audit: [{ operation: 'action.cancel', resource: { type: 'action', id: actionId }, specHash: action.specHash, beforeVersion: action.version, afterVersion: version }],
    });
    const fresh = await loadAction(db, ctx.workspaceId, actionId, tx);
    return { status: 200, body: (await actionsToDTO(db, ctx.workspaceId, [fresh], ctx, tx))[0]! };
  });
}

async function cancelPendingDispatch(deps: Deps, tx: Tx, workspaceId: string, actionId: string) {
  await deps.db.c.outbox.updateMany(
    { workspaceId, kind: 'action.execute', aggregateId: actionId, state: { $in: ['pending', 'dispatching', 'dispatched'] } },
    { $set: { state: 'cancelled', completedAt: deps.clock.now() } },
    { session: tx },
  );
}

export async function renewAction(deps: Deps, ctx: ActorContext, actionId: string, body: { reason: string }, meta: Meta) {
  requireOp(ctx, 'action.renew');
  const { db, clock } = deps;
  const old = await loadAction(db, ctx.workspaceId, actionId);
  checkVersion(old.version, meta.expectedVersion, 'request');
  // Fresh preflight outside the transaction.
  const prepared = await prepareSpec(deps, ctx.workspaceId, {
    toolId: old.spec.toolId,
    arguments: old.spec.arguments,
    target: { serviceId: old.spec.target.serviceId, environment: old.spec.target.environment },
  });
  return runCommand(db, clock, ctx, { operation: `renew:${actionId}`, key: meta.idempotencyKey, payload: body, expectedVersion: meta.expectedVersion }, async (tx) => {
    const action = await loadAction(db, ctx.workspaceId, actionId, tx);
    checkVersion(action.version, meta.expectedVersion, 'request');
    if (!['awaiting_approval', 'approved', 'queued', 'expired'].includes(action.status) || action.supersededByActionId) {
      throw new AppError('INVALID_TRANSITION', `A ${action.status.replace('_', ' ')} request cannot be renewed.`, { currentStatus: action.status });
    }
    const incident = await loadIncident(db, ctx.workspaceId, action.incidentId, tx);
    if (!incident.active) throw new AppError('INVALID_TRANSITION', 'The incident is resolved; create a new request after reopening.');
    // Lineage keeps every earlier requester so renewals cannot erase independence.
    const lineage = [...new Set([...action.lineageRequesters, action.requestedBy, ...(action.renewedBy ? [action.renewedBy] : [])])];
    const doc = await insertProposal(deps, ctx, tx, incident, prepared, {
      requestedBy: action.requestedBy,
      renewedBy: ctx.subjectId,
      lineage,
      supersedes: action._id,
      diagnosisId: action.diagnosisId,
      reasonSummary: `Action review renewed as a new request: ${body.reason}`,
    });
    const now = clock.now();
    const terminal = action.status === 'expired';
    const version = action.version + 1;
    await db.c.actions.updateOne(
      { _id: action._id, workspaceId: ctx.workspaceId, version: action.version },
      { $set: { supersededByActionId: doc._id, updatedAt: now, version, ...(terminal ? {} : { status: 'cancelled' as const, statusReason: 'Superseded by renewal' }) } },
      { session: tx },
    );
    if (!terminal) await cancelPendingDispatch(deps, tx, ctx.workspaceId, action._id);
    await record(db, tx, {
      workspaceId: ctx.workspaceId,
      actor: userActor(ctx),
      requestId: ctx.requestId,
      now,
      events: [{ type: 'action.cancelled', entityType: 'action', entityId: action._id, entityVersion: version, reason: 'superseded' }],
    });
    return { status: 201, body: (await actionsToDTO(db, ctx.workspaceId, [doc], ctx, tx))[0]! };
  });
}

export async function listActions(
  deps: Deps,
  ctx: ActorContext,
  q: { status?: ActionStatus[]; incidentId?: string; cursor?: string; limit: number },
): Promise<Page<ActionDTO>> {
  // The review queue is for commanders/auditors; incident-scoped lists are readable by members.
  if (!q.incidentId) requireOp(ctx, 'action.queue.read', 'You need the commander or auditor role to view the approval queue.');
  else requireOp(ctx, 'read');
  const filterKey = { status: q.status ?? null, incidentId: q.incidentId ?? null };
  const filter: Filter<ActionDoc> = { workspaceId: ctx.workspaceId };
  if (q.status) filter.status = { $in: q.status };
  if (q.incidentId) filter.incidentId = q.incidentId;
  if (q.cursor) {
    const [at, id] = deps.cursors.decodeList(q.cursor, ctx.workspaceId, filterKey) as [string, string];
    const d = new Date(at);
    filter.$or = [{ createdAt: { $lt: d } }, { createdAt: d, _id: { $lt: id } }];
  }
  const docs = await deps.db.c.actions.find(filter).sort({ createdAt: -1, _id: -1 }).limit(q.limit + 1).toArray();
  const page = docs.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: await actionsToDTO(deps.db, ctx.workspaceId, page, ctx),
    nextCursor: docs.length > q.limit && last ? deps.cursors.encodeList(ctx.workspaceId, filterKey, [last.createdAt.toISOString(), last._id]) : null,
  };
}

export async function getAction(deps: Deps, ctx: ActorContext, actionId: string): Promise<ActionDTO> {
  requireOp(ctx, 'read');
  const doc = await loadAction(deps.db, ctx.workspaceId, actionId);
  return (await actionsToDTO(deps.db, ctx.workspaceId, [doc], ctx))[0]!;
}

/** Commander/admin stop control for incident action dispatch (PLUGIN_SYSTEM.md §9). */
export async function setDispatchStopped(deps: Deps, ctx: ActorContext, body: { stopped: boolean; reason: string }, meta: Meta) {
  requireOp(ctx, 'dispatch.stop');
  const { db, clock } = deps;
  return runCommand(db, clock, ctx, { operation: 'dispatch-controls', key: meta.idempotencyKey, payload: body }, async (tx) => {
    const ws = await db.c.workspaces.findOne({ _id: ctx.workspaceId }, { session: tx });
    if (!ws) throw new AppError('NOT_FOUND', 'This item is unavailable.');
    const now = clock.now();
    await db.c.workspaces.updateOne(
      { _id: ws._id },
      { $set: { dispatchStopped: body.stopped, dispatchStoppedReason: body.stopped ? body.reason : null, updatedAt: now }, $inc: { version: 1, policyVersion: 1 } },
      { session: tx },
    );
    await record(db, tx, {
      workspaceId: ctx.workspaceId,
      actor: userActor(ctx),
      requestId: ctx.requestId,
      now,
      events: [],
      audit: [{ operation: body.stopped ? 'dispatch.stop' : 'dispatch.resume', resource: { type: 'workspace', id: ws._id }, reasonCode: body.reason.slice(0, 120) }],
    });
    return { status: 200, body: { dispatchStopped: body.stopped } };
  });
}
