import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actions, dashboard, incidents, investigations, runbooks } from '../src/index.js';
import { ctx, incidentFor, key, setupEnv, teardownEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await setupEnv();
});
afterAll(() => teardownEnv(env));

describe('incident commands', () => {
  it('acknowledges with version precondition and replays idempotently', async () => {
    const inc = await incidentFor(env, 'checkout');
    expect(inc.status).toBe('declared');
    const meta = { idempotencyKey: randomUUID(), expectedVersion: inc.version };
    const first = await incidents.acknowledgeIncident(env.deps, ctx('alice'), inc._id, meta);
    expect(first.body.status).toBe('investigating');
    expect(first.body.ownerId).toBe(ctx('alice').subjectId);
    const again = await incidents.acknowledgeIncident(env.deps, ctx('alice'), inc._id, meta);
    expect(again.replayed).toBe(true);
    expect(again.body).toEqual(first.body);
    const timeline = await env.db.c.timeline.countDocuments({ incidentId: inc._id, eventType: 'incident.acknowledged' });
    expect(timeline).toBe(1);
  });

  it('distinguishes missing precondition (428), stale version (412) and key reuse (409)', async () => {
    const inc = await incidentFor(env, 'search');
    await expect(incidents.acknowledgeIncident(env.deps, ctx('alice'), inc._id, key())).rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED' });
    await expect(incidents.acknowledgeIncident(env.deps, ctx('alice'), inc._id, { ...key(), expectedVersion: inc.version + 5 })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { currentVersion: inc.version },
    });
    const k = randomUUID();
    await incidents.patchIncident(env.deps, ctx('alice'), inc._id, { title: 'Search shard 3 errors' }, { idempotencyKey: k, expectedVersion: inc.version });
    await expect(
      incidents.patchIncident(env.deps, ctx('alice'), inc._id, { title: 'Different title' }, { idempotencyKey: k, expectedVersion: inc.version }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('enforces roles: viewer, admin and auditor cannot change incidents', async () => {
    const inc = await incidentFor(env, 'shipping');
    for (const who of ['victor', 'dave', 'erin'] as const) {
      await expect(incidents.acknowledgeIncident(env.deps, ctx(who), inc._id, { ...key(), expectedVersion: inc.version })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect((await env.db.c.incidents.findOne({ _id: inc._id }))!.version).toBe(inc.version);
  });

  it('rejects invalid transitions with 409', async () => {
    const inc = await incidentFor(env, 'notifications');
    await expect(
      incidents.transitionIncident(env.deps, ctx('alice'), inc._id, { targetStatus: 'resolved', reason: 'x' }, { ...key(), expectedVersion: inc.version }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('runs the full lifecycle and reopens with a new generation', async () => {
    let inc = await incidentFor(env, 'catalog');
    const c = ctx('rita');
    let r = await incidents.acknowledgeIncident(env.deps, c, inc._id, { ...key(), expectedVersion: inc.version });
    for (const to of ['mitigating', 'monitoring', 'resolved'] as const) {
      r = await incidents.transitionIncident(env.deps, c, inc._id, { targetStatus: to, reason: `to ${to}` }, { ...key(), expectedVersion: r.body.version });
    }
    expect(r.body.status).toBe('resolved');
    r = await incidents.transitionIncident(env.deps, c, inc._id, { targetStatus: 'investigating', reason: 'Regression' }, { ...key(), expectedVersion: r.body.version });
    expect(r.body.generation).toBe(2);
    inc = (await env.db.c.incidents.findOne({ _id: inc._id }))!;
    expect(inc.active).toBe(true);
  });

  it('paginates with signed cursors bound to filters', async () => {
    const page1 = await incidents.listIncidents(env.deps, ctx('victor'), { limit: 3 });
    expect(page1.items).toHaveLength(3);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await incidents.listIncidents(env.deps, ctx('victor'), { limit: 3, cursor: page1.nextCursor! });
    const ids = new Set([...page1.items, ...page2.items].map((i) => i.id));
    expect(ids.size).toBe(page1.items.length + page2.items.length);
    await expect(incidents.listIncidents(env.deps, ctx('victor'), { limit: 3, cursor: page1.nextCursor!, severity: ['sev1'] })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    // Sorted by severity ascending.
    const sev = page1.items.map((i) => i.severity);
    expect([...sev].sort()).toEqual(sev);
  });
});

describe('tenant isolation (cross-workspace negative cases)', () => {
  it('returns uniform NOT_FOUND for another workspace incident across reads and commands', async () => {
    const acme = await incidentFor(env, 'payments');
    const gina = ctx('gina'); // globex commander
    await expect(incidents.getIncident(env.deps, gina, acme._id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(incidents.listTimeline(env.deps, gina, acme._id, { limit: 10, order: 'desc' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(incidents.listEvidence(env.deps, gina, acme._id, { limit: 10 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(incidents.acknowledgeIncident(env.deps, ctx('hank'), acme._id, { ...key(), expectedVersion: acme.version })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(investigations.requestInvestigation(env.deps, ctx('hank'), acme._id, { reason: 'x' }, { ...key(), expectedVersion: acme.version })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const ev = await env.db.c.evidence.findOne({ incidentId: acme._id });
    await expect(incidents.getEvidence(env.deps, gina, ev!._id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // No work was enqueued for the foreign incident.
    expect(await env.db.c.outbox.countDocuments({ workspaceId: gina.workspaceId, 'payloadRefs.incidentId': acme._id })).toBe(0);
  });

  it('does not leak lists, actions, runbooks or stream cursors across workspaces', async () => {
    const globexList = await incidents.listIncidents(env.deps, ctx('gina'), { limit: 100 });
    expect(globexList.items.every((i) => i.workspaceId === ctx('gina').workspaceId)).toBe(true);
    const acmeCursor = (await dashboard.getDashboard(env.deps, ctx('bob'))).snapshotCursor;
    expect(() => env.deps.cursors.decodeStream(acmeCursor, ctx('gina').workspaceId)).toThrow(expect.objectContaining({ code: 'INVALID_CURSOR' }));
    const acmePage = await incidents.listIncidents(env.deps, ctx('bob'), { limit: 1 });
    await expect(incidents.listIncidents(env.deps, ctx('gina'), { limit: 1, cursor: acmePage.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    const hits = await runbooks.searchRunbooks(env.deps, ctx('gina'), { q: 'checkout rollback' });
    expect(hits.every((h) => h.runbookTitle.startsWith('Globex'))).toBe(true);
    const acmeRunbook = await env.db.c.runbooks.findOne({ workspaceId: ctx('bob').workspaceId });
    await expect(runbooks.getRunbook(env.deps, ctx('gina'), acmeRunbook!._id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(actions.getAction(env.deps, ctx('gina'), randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('dashboard snapshot and stream', () => {
  it('replays invalidations committed after the snapshot cursor', async () => {
    const snap = await dashboard.getDashboard(env.deps, ctx('bob'));
    expect(snap.data.metrics.pendingApprovals).not.toBeNull();
    const seq = env.deps.cursors.decodeStream(snap.snapshotCursor, ctx('bob').workspaceId);
    const inc = await incidentFor(env, 'auth');
    await incidents.commentOnIncident(env.deps, ctx('alice'), inc._id, { text: 'Looking into it' }, { ...key(), expectedVersion: inc.version });
    const r = await dashboard.readStream(env.deps, ctx('bob').workspaceId, seq);
    expect(r.kind).toBe('events');
    if (r.kind === 'events') {
      expect(r.events.map((e) => e.entityId)).toContain(inc._id);
      expect(r.events[0]!.streamSeq).toBe(seq + 1);
    }
  });

  it('omits approval counters for roles that cannot see the queue', async () => {
    const snap = await dashboard.getDashboard(env.deps, ctx('alice'));
    expect(snap.data.metrics.pendingApprovals).toBeNull();
    expect(snap.data.pendingApprovals).toBeNull();
  });

  it('requires resync for cursors ahead of the head or older than retention', async () => {
    const ws = ctx('bob').workspaceId;
    expect(await dashboard.readStream(env.deps, ws, 10_000_000)).toEqual({ kind: 'resync', reason: 'cursor_ahead' });
    // Simulate retention expiry of the oldest events.
    await env.db.c.workspaceEvents.deleteMany({ workspaceId: ws, streamSeq: { $lte: 5 } });
    expect(await dashboard.readStream(env.deps, ws, 2)).toEqual({ kind: 'resync', reason: 'cursor_expired' });
  });
});
