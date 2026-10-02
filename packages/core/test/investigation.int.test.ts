import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DisabledProvider, FakeProvider, incidents, investigations, postmortems, type ModelProvider } from '../src/index.js';
import { ctx, incidentFor, key, processAll, setupEnv, teardownEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await setupEnv();
});
afterAll(() => teardownEnv(env));

const withProvider = async (p: ModelProvider, fn: () => Promise<void>) => {
  const prev = env.deps.provider;
  (env.deps as { provider: ModelProvider }).provider = p;
  try {
    await fn();
  } finally {
    (env.deps as { provider: ModelProvider }).provider = prev;
  }
};

describe('bounded investigation workflow', () => {
  it('produces a cited diagnosis with redacted evidence and bumps remediationRevision', async () => {
    const before = await incidentFor(env, 'checkout');
    await processAll(env, 'investigation.run');
    const inc = (await env.db.c.incidents.findOne({ _id: before._id }))!;
    expect(inc.latestDiagnosisId).toBeTruthy();
    expect(inc.remediationRevision).toBe(before.remediationRevision + 1);
    const d = (await investigations.getDiagnosis(env.deps, ctx('victor'), inc._id))!;
    expect(d.validity.citationsValid).toBe(true);
    expect(d.hypotheses.length).toBeGreaterThanOrEqual(1);
    expect(d.suggestedActions[0]?.toolId).toBe('simulator.rollback_deployment');
    expect(d.suggestedActions[0]?.arguments).toEqual({ toVersion: 'v2.13.4' });
    // Every cited ID is a real evidence record for this incident.
    const cited = new Set([...d.facts.flatMap((f) => f.support), ...d.hypotheses.flatMap((h) => [...h.support, ...h.contradictions])]);
    const found = await env.db.c.evidence.countDocuments({ _id: { $in: [...cited] }, incidentId: inc._id });
    expect(found).toBe(cited.size);
    // Secret canaries never reach stored evidence.
    const logs = await env.db.c.evidence.find({ incidentId: inc._id, sourceType: 'log' }).toArray();
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(l.redactedExcerpt).not.toMatch(/hunter2|FAKE\.CANARY\.TOKEN/);
    expect(logs.some((l) => l.redactionCount > 0)).toBe(true);
  });

  it('flags injected source text and excludes it from action justification', async () => {
    const inc = await incidentFor(env, 'search');
    const ev = await env.db.c.evidence.findOne({ incidentId: inc._id, sourceType: 'log' });
    expect(ev?.suspectedInjection).toBe(true);
    const d = await investigations.getDiagnosis(env.deps, ctx('victor'), inc._id);
    for (const a of d?.suggestedActions ?? []) expect(a.support).not.toContain(ev!._id);
    expect(d?.missingEvidence.join(' ')).toMatch(/instruction-like/);
  });

  it('coalesces concurrent requests and schedules at most one follow-up', async () => {
    const inc = await incidentFor(env, 'inventory');
    const r1 = await investigations.requestInvestigation(env.deps, ctx('alice'), inc._id, { reason: 'first' }, { ...key(), expectedVersion: inc.version });
    const r2 = await investigations.requestInvestigation(env.deps, ctx('alice'), inc._id, { reason: 'second' }, { ...key(), expectedVersion: inc.version });
    const r3 = await investigations.requestInvestigation(env.deps, ctx('alice'), inc._id, { reason: 'third' }, { ...key(), expectedVersion: inc.version });
    expect(r1.body.coalesced).toBe(false);
    expect(r2.body).toMatchObject({ id: r1.body.id, coalesced: true });
    expect(r3.body.coalesced).toBe(true);
    await processAll(env, 'investigation.run');
    const runs = await env.db.c.investigationRuns.find({ incidentId: inc._id }).toArray();
    expect(runs.filter((r) => r.active)).toHaveLength(1); // exactly one follow-up queued
  });

  it('degrades with a human-review reason when the provider is unavailable; manual work continues', async () => {
    const inc = await incidentFor(env, 'notifications');
    await investigations.requestInvestigation(env.deps, ctx('alice'), inc._id, { reason: 'provider outage test' }, { ...key(), expectedVersion: inc.version });
    await withProvider(new DisabledProvider(), async () => {
      await processAll(env, 'investigation.run');
    });
    const run = await investigations.latestInvestigation(env.deps, ctx('victor'), inc._id);
    expect(run?.state).toBe('degraded');
    expect(run?.degradedReason).toMatch(/unavailable/);
    const fresh = (await env.db.c.incidents.findOne({ _id: inc._id }))!;
    const ack = await incidents.acknowledgeIncident(env.deps, ctx('alice'), inc._id, { ...key(), expectedVersion: fresh.version });
    expect(ack.body.status).toBe('investigating');
  });

  it('repairs an invented citation once, and degrades when repair fails', async () => {
    const inc = await incidentFor(env, 'auth');
    await investigations.requestInvestigation(env.deps, ctx('alice'), inc._id, { reason: 'repair test' }, { ...key(), expectedVersion: inc.version });
    await withProvider(new FakeProvider('invalid-citation-once'), () => processAll(env, 'investigation.run').then(() => undefined));
    expect((await investigations.latestInvestigation(env.deps, ctx('victor'), inc._id))?.state).toBe('completed');

    const inc2 = (await env.db.c.incidents.findOne({ _id: inc._id }))!;
    await investigations.requestInvestigation(env.deps, ctx('alice'), inc._id, { reason: 'always invalid' }, { ...key(), expectedVersion: inc2.version });
    await withProvider(new FakeProvider('invalid-always'), () => processAll(env, 'investigation.run').then(() => undefined));
    const run = await investigations.latestInvestigation(env.deps, ctx('victor'), inc._id);
    expect(run?.state).toBe('degraded');
    expect(run?.degradedReason).toMatch(/Unresolved references/);
  });

  it('drafts a postmortem separating confirmed facts from hypotheses and uncertainty', async () => {
    const inc = await incidentFor(env, 'checkout');
    await postmortems.requestPostmortem(env.deps, ctx('alice'), inc._id, { ...key(), expectedVersion: inc.version });
    await processAll(env, 'postmortem.generate');
    const pm = await postmortems.latestPostmortem(env.deps, ctx('victor'), inc._id);
    expect(pm?.state).toBe('ready');
    expect(pm?.markdown).toContain('## Confirmed by responders');
    expect(pm?.markdown).toContain('## AI-assisted analysis (unconfirmed)');
    expect(pm?.markdown).toContain('## Remaining uncertainty');
  });
});
