import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestion, SEED } from '../src/index.js';
import { SECRETS, setupEnv, teardownEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await setupEnv();
});
afterAll(() => teardownEnv(env));

const send = (body: object, opts: { secret?: string; ts?: number; connector?: string } = {}) => {
  const raw = JSON.stringify(body);
  const ts = String(opts.ts ?? Math.floor(env.clock.now().getTime() / 1000));
  return ingestion.ingestAlert(env.deps, {
    connectorId: opts.connector ?? SEED.connectors.acme,
    rawBody: Buffer.from(raw),
    timestamp: ts,
    signature: ingestion.signAlert(opts.secret ?? SECRETS['synthetic-alerts-dev'], ts, raw),
    requestId: 'test',
  });
};
const alert = (over: object = {}) => ({
  externalEventId: `evt-${Math.random()}`,
  serviceKey: 'catalog',
  environment: 'demo',
  alertType: 'disk_full',
  severity: 'sev3',
  occurredAt: new Date().toISOString(),
  summary: 'Disk usage above 95%',
  labels: { volume: 'data' },
  measurements: { usedRatio: 0.96 },
  ...over,
});

describe('alert ingestion', () => {
  it('returns 202 after commit, 200 duplicate on exact replay and 409 on reused ID', async () => {
    const a = alert({ externalEventId: 'replay-1' });
    const first = await send(a);
    expect(first.status).toBe(202);
    expect(first.body.duplicate).toBe(false);
    const replay = await send(a);
    expect(replay).toEqual({ status: 200, body: { ...first.body, duplicate: true } });
    await expect(send({ ...a, summary: 'different' })).rejects.toMatchObject({ code: 'SOURCE_EVENT_CONFLICT' });
    expect(await env.db.c.alerts.countDocuments({ externalEventId: 'replay-1' })).toBe(1);
  });

  it('rejects invalid signatures and stale timestamps without enqueueing work', async () => {
    const before = await env.db.c.outbox.countDocuments({});
    await expect(send(alert(), { secret: 'wrong' })).rejects.toMatchObject({ code: 'INVALID_CONNECTOR_SIGNATURE' });
    await expect(send(alert(), { ts: Math.floor(Date.now() / 1000) - 400 })).rejects.toMatchObject({ code: 'INVALID_CONNECTOR_SIGNATURE' });
    // A globex secret cannot sign for the acme connector.
    await expect(send(alert(), { secret: SECRETS['synthetic-alerts-globex'] })).rejects.toMatchObject({ code: 'INVALID_CONNECTOR_SIGNATURE' });
    expect(await env.db.c.outbox.countDocuments({})).toBe(before);
  });

  it('cannot address another workspace through the payload', async () => {
    // "billing" exists only in globex; the acme connector cannot map it.
    await expect(send(alert({ serviceKey: 'billing' }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(send({ ...alert(), workspaceId: SEED.workspaces.globex })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('attaches concurrent alerts with the same fingerprint to exactly one active incident', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => send(alert({ externalEventId: `burst-${i}`, alertType: 'burst_test', labels: { pod: `p-${i}` } }))),
    );
    const ids = new Set(results.map((r) => r.body.incidentId));
    expect(ids.size).toBe(1);
    const inc = await env.db.c.incidents.findOne({ _id: [...ids][0]! });
    expect(inc!.occurrenceCount).toBe(12);
    expect(await env.db.c.investigationRuns.countDocuments({ incidentId: inc!._id })).toBe(1);
  });

  it('commits incident, timeline, stream event, audit and outbox together', async () => {
    const r = await send(alert({ alertType: 'atomic_check' }));
    const incidentId = r.body.incidentId;
    expect(await env.db.c.timeline.countDocuments({ incidentId })).toBeGreaterThanOrEqual(2);
    expect(await env.db.c.workspaceEvents.countDocuments({ entityId: incidentId })).toBeGreaterThanOrEqual(1);
    expect(await env.db.c.audit.countDocuments({ 'resource.id': r.body.receiptId })).toBe(1);
    expect(await env.db.c.outbox.countDocuments({ kind: 'investigation.run', 'payloadRefs.incidentId': incidentId })).toBe(1);
  });
});
