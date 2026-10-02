import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actions, expireActions, HANDLERS, incidents, plugins, processOutbox, SEED } from '../src/index.js';
import { ctx, incidentFor, key, processAll, setupEnv, teardownEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await setupEnv();
});
afterAll(() => teardownEnv(env));

/** Acknowledge an incident for the service and propose a rollback as `who`. */
async function propose(serviceKey: string, who: 'alice' | 'rita' | 'bob' = 'alice', args: Record<string, unknown> = {}) {
  let inc = await incidentFor(env, serviceKey);
  if (inc.status === 'declared') {
    await incidents.acknowledgeIncident(env.deps, ctx(who), inc._id, { ...key(), expectedVersion: inc.version });
    inc = (await env.db.c.incidents.findOne({ _id: inc._id }))!;
  }
  const target = (await env.db.c.simulatorTargets.findOne({ serviceId: inc.serviceId }))!;
  const r = await actions.proposeAction(
    env.deps,
    ctx(who),
    inc._id,
    { toolId: 'simulator.rollback_deployment', arguments: { toVersion: target.previousVersion!, ...args }, target: { serviceId: inc.serviceId, environment: inc.environment } },
    { ...key(), expectedVersion: inc.version },
  );
  return { inc, action: r.body };
}

const approve = (who: 'bob' | 'carol' | 'alice' | 'dave', a: { id: string; specHash: string; version: number }, decision: 'approve' | 'reject' = 'approve') =>
  actions.decideAction(env.deps, ctx(who), a.id, { decision, specHash: a.specHash, reason: 'Reviewed target and version.' }, { ...key(), expectedVersion: a.version });

describe('proposals', () => {
  it('freezes an immutable spec with a 10-minute expiry and awaits approval', async () => {
    const { action } = await propose('checkout');
    expect(action.status).toBe('awaiting_approval');
    expect(action.spec.simulation).toBe(true);
    expect(action.specHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(new Date(action.expiresAt).getTime() - new Date(action.createdAt).getTime()).toBe(10 * 60_000);
  });

  it('rejects invented tools and invalid arguments, and requires responder/commander', async () => {
    const inc = await incidentFor(env, 'checkout');
    const base = { target: { serviceId: inc.serviceId, environment: 'demo' } };
    await expect(actions.proposeAction(env.deps, ctx('alice'), inc._id, { ...base, toolId: 'shell.exec', arguments: { cmd: 'rm -rf /' } }, { ...key(), expectedVersion: inc.version })).rejects.toMatchObject({ code: 'INVALID_ACTION_ARGUMENTS' });
    await expect(actions.proposeAction(env.deps, ctx('alice'), inc._id, { ...base, toolId: 'simulator.rollback_deployment', arguments: { toVersion: 'latest' } }, { ...key(), expectedVersion: inc.version })).rejects.toMatchObject({ code: 'INVALID_ACTION_ARGUMENTS' });
    await expect(actions.proposeAction(env.deps, ctx('dave'), inc._id, { ...base, toolId: 'simulator.restart_service', arguments: { strategy: 'rolling' } }, { ...key(), expectedVersion: inc.version })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('approval rules', () => {
  it('blocks self approval, non-commanders, admin-only and a wrong spec hash', async () => {
    const { action } = await propose('checkout', 'bob');
    await expect(approve('bob', action)).rejects.toMatchObject({ code: 'SELF_APPROVAL_DENIED' });
    await expect(approve('alice', action)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(approve('dave', action)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(approve('carol', { ...action, specHash: `sha256:${'a'.repeat(64)}` })).rejects.toMatchObject({ code: 'ACTION_STALE' });
    const denied = await env.db.c.audit.countDocuments({ 'resource.id': action.id, decision: 'denied' });
    expect(denied).toBeGreaterThanOrEqual(2);
  });

  it('lets exactly one of two concurrent commanders decide', async () => {
    const { action } = await propose('checkout', 'alice');
    const results = await Promise.allSettled([approve('bob', action), approve('carol', action)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(['VERSION_CONFLICT', 'INVALID_TRANSITION']).toContain(rejected.reason.code);
    expect(await env.db.c.approvals.countDocuments({ actionId: action.id })).toBe(1);
  });

  it('rejects expired approvals and the expiry scan marks them expired', async () => {
    const { action } = await propose('checkout', 'alice');
    env.clock.offsetMs = 11 * 60_000;
    try {
      await expect(approve('carol', action)).rejects.toMatchObject({ code: 'ACTION_EXPIRED' });
      expect(await expireActions(env.deps)).toBeGreaterThanOrEqual(1);
      expect((await env.db.c.actions.findOne({ _id: action.id }))!.status).toBe('expired');
    } finally {
      env.clock.offsetMs = 0;
    }
  });

  it('invalidates a pending approval when the remediation revision changes', async () => {
    const { inc, action } = await propose('checkout', 'alice');
    const fresh = (await env.db.c.incidents.findOne({ _id: inc._id }))!;
    // investigating → mitigating → investigating marks the plan invalidated.
    const m = await incidents.transitionIncident(env.deps, ctx('alice'), inc._id, { targetStatus: 'mitigating', reason: 'trying' }, { ...key(), expectedVersion: fresh.version });
    await incidents.transitionIncident(env.deps, ctx('alice'), inc._id, { targetStatus: 'investigating', reason: 'diagnosis invalidated' }, { ...key(), expectedVersion: m.body.version });
    await expect(approve('carol', action)).rejects.toMatchObject({ code: 'ACTION_STALE' });
  });
});

describe('execution', () => {
  it('approves, executes once despite duplicate delivery, and records recovery evidence', async () => {
    const { inc, action } = await propose('checkout', 'alice');
    const decided = await approve('carol', action);
    expect(decided.body.status).toBe('queued');
    expect(decided.body.decision?.decidedBy.id).toBe(SEED.users.carol);
    const [row] = await processAll(env, 'action.execute');
    // Duplicate queue delivery of the same intent.
    expect(await processOutbox(env.deps, row!._id, HANDLERS)).toBe('skipped');
    const done = (await env.db.c.actions.findOne({ _id: action.id }))!;
    expect(done.status).toBe('succeeded');
    const target = (await env.db.c.simulatorTargets.findOne({ serviceId: inc.serviceId }))!;
    expect(target.appliedOps.filter((o) => o.executionKey === done.executionKey)).toHaveLength(1);
    expect(target.deployedVersion).toBe(action.spec.arguments.toVersion);
    expect(await env.db.c.evidence.countDocuments({ incidentId: inc._id, sourceType: 'execution' })).toBe(1);
    // A later approval for the old target revision is stale at dispatch.
  });

  it('cannot cancel after dispatch', async () => {
    const done = await env.db.c.actions.findOne({ status: 'succeeded' });
    await expect(actions.cancelAction(env.deps, ctx('alice'), done!._id, { reason: 'late' }, { ...key(), expectedVersion: done!.version })).rejects.toMatchObject({ code: 'ACTION_ALREADY_DISPATCHED' });
  });

  it('denies dispatch when the connector is revoked after approval', async () => {
    const { action } = await propose('search', 'alice');
    await approve('bob', action);
    const inst = (await env.db.c.installations.findOne({ workspaceId: SEED.workspaces.acme, pluginId: 'core.simulator' }))!;
    await plugins.revokeInstallation(env.deps, ctx('dave'), inst._id, { reason: 'Security review' }, { ...key(), expectedVersion: inst.version });
    await processAll(env, 'action.execute');
    const a = (await env.db.c.actions.findOne({ _id: action.id }))!;
    expect(a.status).toBe('cancelled');
    expect(a.statusReason).toMatch(/GRANT_REVOKED/);
    const target = (await env.db.c.simulatorTargets.findOne({ serviceId: a.spec.target.serviceId }))!;
    expect(target.appliedOps).toHaveLength(0);
    // Re-enable for later tests.
    const now = (await env.db.c.installations.findOne({ _id: inst._id }))!;
    await env.db.c.installations.updateOne({ _id: inst._id }, { $set: { status: 'enabled', health: { status: 'ok', checkedAt: new Date(), lastError: null } } });
    expect(now.status).toBe('disabled');
  });

  it('denies dispatch when the approver loses commander membership', async () => {
    const { action } = await propose('search', 'alice');
    await approve('carol', action);
    await env.db.c.memberships.updateOne({ workspaceId: SEED.workspaces.acme, userId: SEED.users.carol }, { $set: { status: 'revoked' } });
    try {
      await processAll(env, 'action.execute');
      expect((await env.db.c.actions.findOne({ _id: action.id }))!.statusReason).toMatch(/APPROVER_MEMBERSHIP_REVOKED/);
    } finally {
      await env.db.c.memberships.updateOne({ workspaceId: SEED.workspaces.acme, userId: SEED.users.carol }, { $set: { status: 'active' } });
    }
  });

  it('honors the dispatch stop control', async () => {
    const { action } = await propose('search', 'alice');
    await approve('bob', action);
    await actions.setDispatchStopped(env.deps, ctx('bob'), { stopped: true, reason: 'Freeze' }, key());
    await processAll(env, 'action.execute');
    expect((await env.db.c.actions.findOne({ _id: action.id }))!.statusReason).toMatch(/DISPATCH_STOPPED/);
    await actions.setDispatchStopped(env.deps, ctx('bob'), { stopped: false, reason: 'Thaw' }, key());
  });

  it('turns a timeout after effect into outcome_unknown and reconciles to succeeded without re-executing', async () => {
    const { action } = await propose('payments', 'alice'); // faultMode timeout_after_apply
    await approve('carol', action);
    await processAll(env, 'action.execute');
    let a = (await env.db.c.actions.findOne({ _id: action.id }))!;
    expect(a.status).toBe('outcome_unknown');
    await processAll(env, 'action.reconcile');
    a = (await env.db.c.actions.findOne({ _id: action.id }))!;
    expect(a.status).toBe('succeeded');
    const exec = (await env.db.c.executions.findOne({ actionId: action.id }))!;
    expect(exec.reconciliationState).toBe('confirmed_applied');
    const target = (await env.db.c.simulatorTargets.findOne({ serviceId: a.spec.target.serviceId }))!;
    expect(target.appliedOps).toHaveLength(1);
  });

  it('reconciles a timeout before effect to failed with confirmed no effect', async () => {
    const inc = await incidentFor(env, 'shipping');
    await env.db.c.simulatorTargets.updateOne({ serviceId: inc.serviceId }, { $set: { faultMode: 'timeout_before_apply' } });
    const { action } = await propose('shipping', 'alice');
    await approve('bob', action);
    await processAll(env, 'action.execute');
    expect((await env.db.c.actions.findOne({ _id: action.id }))!.status).toBe('outcome_unknown');
    await processAll(env, 'action.reconcile');
    const a = (await env.db.c.actions.findOne({ _id: action.id }))!;
    expect(a.status).toBe('failed');
    expect((await env.db.c.executions.findOne({ actionId: action.id }))!.reconciliationState).toBe('confirmed_no_effect');
  });
});

describe('renewal', () => {
  it('creates a new action, preserves the requester and blocks both requesters from approving', async () => {
    const { action } = await propose('inventory', 'alice');
    const renewed = await actions.renewAction(env.deps, ctx('bob'), action.id, { reason: 'Need more time' }, { ...key(), expectedVersion: action.version });
    expect(renewed.status).toBe(201);
    expect(renewed.body.id).not.toBe(action.id);
    expect(renewed.body.requestedBy.id).toBe(SEED.users.alice);
    expect(renewed.body.renewedBy?.id).toBe(SEED.users.bob);
    expect(renewed.body.supersedesActionId).toBe(action.id);
    expect(renewed.body.specHash).not.toBe(action.specHash);
    const old = (await env.db.c.actions.findOne({ _id: action.id }))!;
    expect(old.status).toBe('cancelled');
    expect(old.supersededByActionId).toBe(renewed.body.id);
    await expect(approve('bob', renewed.body)).rejects.toMatchObject({ code: 'SELF_APPROVAL_DENIED' });
    // A second renewal by carol keeps both alice and bob in the lineage.
    const again = await actions.renewAction(env.deps, ctx('carol'), renewed.body.id, { reason: 'again' }, { idempotencyKey: randomUUID(), expectedVersion: renewed.body.version });
    await expect(approve('bob', again.body)).rejects.toMatchObject({ code: 'SELF_APPROVAL_DENIED' });
    await expect(approve('carol', again.body)).rejects.toMatchObject({ code: 'SELF_APPROVAL_DENIED' });
  });
});
