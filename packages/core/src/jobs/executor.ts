import { dispatchDenial } from '@aic/domain';
import { ACTION_TOOLS, isActionTool } from '../connectors/catalog.js';
import { SimulatorTimeoutError, withTimeout, type ExecutionReceipt } from '../connectors/simulator.js';
import { SERVICE_PRINCIPALS, uuid } from '../context.js';
import type { Deps } from '../deps.js';
import { record } from '../db/event-writer.js';
import { RETENTION } from '../db/migrations.js';
import { isDuplicateKey, type Tx } from '../db/mongo.js';
import type { ActionDoc, EvidenceDoc } from '../db/types.js';
import { sha256Hex } from '@aic/domain';
import { completeJob, PermanentJobError, RetryableJobError, type JobContext } from './runtime.js';

// Action executor (LLD.md §7, EVENT_FLOWS.md §6). Every dispatch rechecks
// membership, grants, stop controls, expiry and revisions immediately before
// the external call. A timeout after possible effect yields outcome_unknown
// and a reconciliation task — never a blind retry.

export const EXECUTE_TIMEOUT_MS = 5000;
const TARGET_LEASE_MS = 2 * 60_000;
const MAX_RECONCILE_ATTEMPTS = 5;

const actor = SERVICE_PRINCIPALS.executor;

async function loadAction(deps: Deps, job: JobContext) {
  const a = await deps.db.c.actions.findOne({ _id: job.outbox.aggregateId, workspaceId: job.outbox.workspaceId });
  if (!a) throw new PermanentJobError('Action not found.');
  return a;
}

async function setStatus(
  deps: Deps,
  tx: Tx,
  job: JobContext,
  action: ActionDoc,
  from: ActionDoc['status'],
  to: ActionDoc['status'],
  reason: string | null,
  event: { type: Parameters<typeof record>[2]['events'][number]['type']; summary: string; auditOp: string; reasonCode?: string },
  outbox: Parameters<typeof record>[2]['outbox'] = [],
) {
  const now = deps.clock.now();
  const res = await deps.db.c.actions.findOneAndUpdate(
    { _id: action._id, workspaceId: action.workspaceId, status: from },
    { $set: { status: to, statusReason: reason, updatedAt: now }, $inc: { version: 1 } },
    { session: tx, returnDocument: 'after' },
  );
  if (!res) return null;
  await record(deps.db, tx, {
    workspaceId: action.workspaceId,
    actor,
    requestId: job.outbox.requestId,
    now,
    events: [{ type: event.type, entityType: 'action', entityId: action._id, entityVersion: res.version, reason: to, timeline: { incidentId: action.incidentId, summary: event.summary, refs: [{ type: 'action', id: action._id }] } }],
    audit: [{ operation: event.auditOp, resource: { type: 'action', id: action._id }, specHash: action.specHash, reasonCode: event.reasonCode ?? null, beforeVersion: action.version, afterVersion: res.version }],
    outbox,
  });
  return res;
}

export async function executeActionJob(deps: Deps, job: JobContext): Promise<void> {
  const { db, clock } = deps;
  const action = await loadAction(deps, job);

  if (action.status === 'executing') {
    // Redelivery after a crash between claim and receipt: the external effect may
    // have happened. Never re-execute; move to reconciliation.
    await db.transact(async (tx) => {
      await db.c.executions.updateOne({ workspaceId: action.workspaceId, actionId: action._id, attempt: 1 }, { $set: { status: 'outcome_unknown', reconciliationState: 'pending', updatedAt: clock.now() } }, { session: tx });
      await setStatus(deps, tx, job, action, 'executing', 'outcome_unknown', 'Executor restarted before a receipt was recorded.', {
        type: 'action.outcome_unknown',
        summary: 'Execution outcome is unknown. Reconciliation is in progress.',
        auditOp: 'action.outcome_unknown',
      }, [{ kind: 'action.reconcile', aggregateId: action._id }]);
      await completeJob(deps, tx, job);
    });
    return;
  }
  if (action.status !== 'queued') return; // cancelled, expired or already handled

  // ---- Fresh preflight (outside transaction; reads connector state) ----
  const ws = action.workspaceId;
  const [incident, approval, workspace] = await Promise.all([
    db.c.incidents.findOne({ _id: action.incidentId, workspaceId: ws }),
    db.c.approvals.findOne({ workspaceId: ws, actionId: action._id }),
    db.c.workspaces.findOne({ _id: ws }),
  ]);
  const [approverM, requesterM] = await Promise.all([
    approval ? db.c.memberships.findOne({ workspaceId: ws, userId: approval.decidedBy, status: 'active' }) : null,
    db.c.memberships.findOne({ workspaceId: ws, userId: action.requestedBy, status: 'active' }),
  ]);
  let installationPermits = false;
  if (isActionTool(action.spec.toolId)) {
    const tool = ACTION_TOOLS[action.spec.toolId];
    const inst = await deps.gateway.installation(ws, tool.pluginId);
    const denial = await deps.gateway.denial(inst, tool.scope, tool.capability, action.spec.target);
    installationPermits = !denial && inst?._id === action.spec.installationId;
  }
  const pre = await deps.simulator.preflight({ workspaceId: ws, serviceId: action.spec.target.serviceId, environment: action.spec.target.environment });
  const denial = dispatchDenial({
    spec: action.spec,
    specHash: action.specHash,
    now: clock.now(),
    incident,
    approverIsActiveCommander: !!approval && approval.decision === 'approve' && approval.specHash === action.specHash && !!approverM?.roles.includes('commander'),
    requesterIsActiveMember: !!requesterM,
    installationPermits,
    dispatchStopped: workspace?.dispatchStopped ?? true,
    currentTargetRevision: pre?.revision ?? null,
  });

  if (denial) {
    const to = denial === 'EXPIRED' ? 'expired' : 'cancelled';
    await db.transact(async (tx) => {
      await setStatus(deps, tx, job, action, 'queued', to, `Dispatch denied: ${denial}`, {
        type: to === 'expired' ? 'action.expired' : 'action.cancelled',
        summary: `Dispatch blocked by policy recheck (${denial.replaceAll('_', ' ').toLowerCase()}). No change was made.`,
        auditOp: 'action.dispatch',
        reasonCode: denial,
      });
      await completeJob(deps, tx, job);
    });
    return;
  }

  // ---- Claim target lease and execution record, mark executing (one tx) ----
  const executionId = uuid();
  let fence = 0;
  try {
    const claimed = await db.transact(async (tx) => {
      const now = clock.now();
      const lease = await db.c.targetLeases.findOneAndUpdate(
        {
          workspaceId: ws,
          serviceId: action.spec.target.serviceId,
          environment: action.spec.target.environment,
          $or: [{ leaseUntil: { $lt: now } }, { holderActionId: action._id }, { holderActionId: null }],
        },
        { $set: { holderActionId: action._id, leaseUntil: new Date(now.getTime() + TARGET_LEASE_MS) }, $inc: { fence: 1 }, $setOnInsert: { _id: uuid() } },
        { session: tx, upsert: true, returnDocument: 'after' },
      );
      fence = lease!.fence;
      await db.c.executions.insertOne(
        {
          _id: executionId,
          workspaceId: ws,
          actionId: action._id,
          attempt: 1,
          executionKey: action.executionKey,
          connectorVersion: deps.simulator.version,
          targetFence: fence,
          dispatchAt: now,
          status: 'dispatching',
          receipt: null,
          reconciliationState: 'not_required',
          updatedAt: now,
          createdAt: now,
        },
        { session: tx },
      );
      return setStatus(deps, tx, job, action, 'queued', 'executing', null, {
        type: 'action.dispatched',
        summary: 'Simulated action dispatched with a stable execution key.',
        auditOp: 'action.dispatch',
      });
    });
    if (!claimed) return; // lost race to cancel/expiry
  } catch (e) {
    // Another action holds the target, or an attempt record already exists.
    if (isDuplicateKey(e)) throw new RetryableJobError('Target is busy; retrying dispatch later.');
    throw e;
  }

  // ---- External call (outside any transaction) ----
  let receipt: ExecutionReceipt | null = null;
  let unknown = false;
  try {
    receipt = await withTimeout(deps.simulator.execute(action.spec, action.executionKey), EXECUTE_TIMEOUT_MS);
  } catch (e) {
    if (e instanceof SimulatorTimeoutError) unknown = true;
    else unknown = true; // any ambiguous transport failure after dispatch
  }

  await recordOutcome(deps, job, action, executionId, receipt, unknown);
}

async function recordOutcome(deps: Deps, job: JobContext, action: ActionDoc, executionId: string | null, receipt: ExecutionReceipt | null, unknown: boolean) {
  const { db, clock } = deps;
  await db.transact(async (tx) => {
    const now = clock.now();
    const current = await db.c.actions.findOne({ _id: action._id, workspaceId: action.workspaceId }, { session: tx });
    if (!current) throw new PermanentJobError('Action disappeared.');
    const execFilter = executionId ? { _id: executionId, workspaceId: action.workspaceId } : { workspaceId: action.workspaceId, actionId: action._id, attempt: 1 };
    if (unknown || !receipt) {
      await db.c.executions.updateOne(execFilter, { $set: { status: 'outcome_unknown', reconciliationState: 'pending', updatedAt: now } }, { session: tx });
      await setStatus(deps, tx, job, current, current.status, 'outcome_unknown', 'No conclusive receipt before the deadline.', {
        type: 'action.outcome_unknown',
        summary: 'Execution outcome is unknown. Reconciliation is in progress.',
        auditOp: 'action.outcome_unknown',
      }, [{ kind: 'action.reconcile', aggregateId: action._id, delayMs: 2000 }]);
    } else {
      const to = receipt.outcome === 'succeeded' ? 'succeeded' : 'failed';
      await db.c.executions.updateOne(
        execFilter,
        { $set: { status: to, receipt: receipt as unknown as Record<string, unknown>, reconciliationState: current.status === 'outcome_unknown' ? 'confirmed_applied' : 'not_required', updatedAt: now } },
        { session: tx },
      );
      await setStatus(deps, tx, job, current, current.status, to, to === 'failed' ? receipt.detail : null, {
        type: 'action.completed',
        summary: to === 'succeeded' ? `Simulated action succeeded: ${receipt.detail} Verify recovery before resolving.` : `Simulated action failed: ${receipt.detail}`,
        auditOp: `action.${to}`,
      });
      if (to === 'succeeded') await addRecoveryEvidence(deps, tx, action, receipt);
    }
    await db.c.targetLeases.updateOne(
      { workspaceId: action.workspaceId, serviceId: action.spec.target.serviceId, environment: action.spec.target.environment, holderActionId: action._id },
      { $set: { holderActionId: null, leaseUntil: now } },
      { session: tx },
    );
    await completeJob(deps, tx, job);
  });
}

async function addRecoveryEvidence(deps: Deps, tx: Tx, action: ActionDoc, receipt: ExecutionReceipt) {
  const metrics = await deps.simulator.readMetrics({ workspaceId: action.workspaceId, serviceId: action.spec.target.serviceId, environment: action.spec.target.environment });
  const now = deps.clock.now();
  const text = `Receipt ${receipt.providerRequestId}: ${receipt.detail}\nPost-action sample: error_rate=${metrics?.errorRate.toFixed(4) ?? 'unavailable'} latency_p95_ms=${metrics?.latencyP95Ms ?? 'unavailable'}\nVerification target: ${action.spec.verification.metric} ${action.spec.verification.operator} ${action.spec.verification.value} over ${action.spec.verification.windowSeconds}s.`;
  const ev: EvidenceDoc = {
    _id: uuid(),
    workspaceId: action.workspaceId,
    incidentId: action.incidentId,
    runId: null,
    sourceType: 'execution',
    sourceId: `execution:${action.executionKey}`,
    sourceVersion: receipt.newRevision !== null ? `rev-${receipt.newRevision}` : null,
    title: 'Simulated action receipt and recovery observation',
    collectedAt: now,
    observedFrom: now,
    observedTo: now,
    completeness: metrics ? 'complete' : 'partial',
    checksum: `sha256:${sha256Hex(text)}`,
    objectKey: null,
    redactedExcerpt: text,
    redactionCount: 0,
    truncated: false,
    suspectedInjection: false,
    expiresAt: new Date(now.getTime() + RETENTION.auditSeconds * 1000),
    createdAt: now,
    schemaVersion: 1,
  };
  await deps.db.c.evidence.insertOne(ev, { session: tx });
}

/** Query receipt by stable execution key; only a conclusive answer changes state. */
export async function reconcileActionJob(deps: Deps, job: JobContext): Promise<void> {
  const action = await loadAction(deps, job);
  if (action.status !== 'outcome_unknown') return;
  const result = await deps.simulator.reconcile(
    { workspaceId: action.workspaceId, serviceId: action.spec.target.serviceId, environment: action.spec.target.environment },
    action.executionKey,
  );
  if (result.state === 'applied') {
    await recordOutcome(deps, job, action, null, result.receipt, false);
    return;
  }
  if (result.state === 'not_applied') {
    // Confirmed absence: record failure with no effect. A new attempt needs a new authorized command.
    await deps.db.transact(async (tx) => {
      const now = deps.clock.now();
      await deps.db.c.executions.updateOne(
        { workspaceId: action.workspaceId, actionId: action._id, attempt: 1 },
        { $set: { status: 'failed', reconciliationState: 'confirmed_no_effect', updatedAt: now } },
        { session: tx },
      );
      await setStatus(deps, tx, job, action, 'outcome_unknown', 'failed', 'Reconciliation confirmed the change was not applied.', {
        type: 'action.completed',
        summary: 'Reconciliation confirmed no change was applied. Request a new action if still needed.',
        auditOp: 'action.reconciled',
        reasonCode: 'CONFIRMED_NO_EFFECT',
      });
      await deps.db.c.targetLeases.updateOne(
        { workspaceId: action.workspaceId, serviceId: action.spec.target.serviceId, environment: action.spec.target.environment, holderActionId: action._id },
        { $set: { holderActionId: null, leaseUntil: now } },
        { session: tx },
      );
      await completeJob(deps, tx, job);
    });
    return;
  }
  if (job.attempt >= MAX_RECONCILE_ATTEMPTS) {
    await deps.db.transact(async (tx) => {
      await deps.db.c.executions.updateOne(
        { workspaceId: action.workspaceId, actionId: action._id, attempt: 1 },
        { $set: { reconciliationState: 'manual_review_required', updatedAt: deps.clock.now() } },
        { session: tx },
      );
      await completeJob(deps, tx, job);
    });
    return;
  }
  throw new RetryableJobError('Provider state still unknown; will reconcile again.');
}

/** Periodic expiry scan. Authorization checks still compare timestamps explicitly. */
export async function expireActions(deps: Deps, limit = 100): Promise<number> {
  const now = deps.clock.now();
  const due = await deps.db.c.actions.find({ status: { $in: ['awaiting_approval', 'approved', 'queued'] }, expiresAt: { $lte: now } }).limit(limit).toArray();
  let n = 0;
  for (const a of due) {
    await deps.db.transact(async (tx) => {
      const res = await deps.db.c.actions.findOneAndUpdate(
        { _id: a._id, workspaceId: a.workspaceId, status: a.status, version: a.version },
        { $set: { status: 'expired', statusReason: 'Approval window ended.', updatedAt: now }, $inc: { version: 1 } },
        { session: tx, returnDocument: 'after' },
      );
      if (!res) return;
      n++;
      await deps.db.c.outbox.updateMany(
        { workspaceId: a.workspaceId, kind: 'action.execute', aggregateId: a._id, state: { $in: ['pending', 'dispatching', 'dispatched'] } },
        { $set: { state: 'cancelled', completedAt: now } },
        { session: tx },
      );
      await record(deps.db, tx, {
        workspaceId: a.workspaceId,
        actor: SERVICE_PRINCIPALS.scheduler,
        requestId: `expiry-${a._id}`,
        now,
        events: [{ type: 'action.expired', entityType: 'action', entityId: a._id, entityVersion: res.version, reason: 'expired', timeline: { incidentId: a.incidentId, summary: 'Action request expired before dispatch. Renew the review to continue.', refs: [{ type: 'action', id: a._id }] } }],
        audit: [{ operation: 'action.expire', resource: { type: 'action', id: a._id }, specHash: a.specHash, beforeVersion: a.version, afterVersion: res.version }],
      });
    });
  }
  return n;
}
