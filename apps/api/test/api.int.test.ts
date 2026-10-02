import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { SEED, ingestion } from '@aic/core';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SECRETS, setupEnv, teardownEnv, type TestEnv } from '../../../packages/core/test/helpers.js';
import { createApp } from '../src/app.js';

const ORIGIN = 'http://localhost:3000';
let env: TestEnv;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  env = await setupEnv();
  app = createApp(env.deps, { APP_ENV: 'ci', AUTH_MODE: 'dev', PUBLIC_APP_ORIGIN: ORIGIN }, pino({ level: 'silent' }));
});
afterAll(() => teardownEnv(env));

async function login(user: keyof typeof SEED.users) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/dev-login').set('Origin', ORIGIN).send({ userId: SEED.users[user] });
  expect(res.status).toBe(200);
  expect(res.headers['set-cookie']?.[0]).toMatch(/HttpOnly/);
  return { agent, csrf: res.body.data.csrfToken as string };
}

const acme = `/api/v1/workspaces/${SEED.workspaces.acme}`;

describe('HTTP boundary', () => {
  it('requires a session and returns the standard error envelope', async () => {
    const res = await request(app).get(`${acme}/incidents`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'SESSION_EXPIRED', retryable: false });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('hides another workspace behind a uniform 404', async () => {
    const { agent } = await login('gina');
    const res = await agent.get(`${acme}/incidents`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    const bad = await agent.get(`/api/v1/workspaces/not-a-uuid/incidents`);
    expect(bad.status).toBe(404);
  });

  it('enforces CSRF token and origin on commands', async () => {
    const { agent, csrf } = await login('alice');
    const list = await agent.get(`${acme}/incidents?limit=5`);
    expect(list.status).toBe(200);
    expect(list.headers['cache-control']).toContain('no-store');
    const inc = list.body.data.items.find((i: { status: string }) => i.status === 'declared');
    const path = `${acme}/incidents/${inc.id}/acknowledge`;
    const noToken = await agent.post(path).set('Idempotency-Key', randomUUID()).set('If-Match', `"${inc.version}"`).send({});
    expect(noToken.status).toBe(403);
    const badOrigin = await agent.post(path).set('Origin', 'https://evil.example').set('X-CSRF-Token', csrf).set('Idempotency-Key', randomUUID()).set('If-Match', `"${inc.version}"`).send({});
    expect(badOrigin.status).toBe(403);
    const missingKey = await agent.post(path).set('X-CSRF-Token', csrf).set('If-Match', `"${inc.version}"`).send({});
    expect(missingKey.status).toBe(400);
    const missingIfMatch = await agent.post(path).set('X-CSRF-Token', csrf).set('Idempotency-Key', randomUUID()).send({});
    expect(missingIfMatch.status).toBe(428);
    const stale = await agent.post(path).set('X-CSRF-Token', csrf).set('Idempotency-Key', randomUUID()).set('If-Match', `"${inc.version + 9}"`).send({});
    expect(stale.status).toBe(412);
    expect(stale.body.error.details.currentVersion).toBe(inc.version);
    const k = randomUUID();
    const ok = await agent.post(path).set('Origin', ORIGIN).set('X-CSRF-Token', csrf).set('Idempotency-Key', k).set('If-Match', `"${inc.version}"`).send({});
    expect(ok.status).toBe(200);
    expect(ok.headers.etag).toBe(`"${inc.version + 1}"`);
    const replay = await agent.post(path).set('X-CSRF-Token', csrf).set('Idempotency-Key', k).set('If-Match', `"${inc.version}"`).send({});
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
  });

  it('rejects unknown body fields and oversized payloads', async () => {
    const { agent, csrf } = await login('alice');
    const inc = (await agent.get(`${acme}/incidents?limit=1`)).body.data.items[0];
    const res = await agent
      .post(`${acme}/incidents/${inc.id}/comments`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', randomUUID())
      .set('If-Match', `"${inc.version}"`)
      .send({ text: 'hi', role: 'admin' });
    expect(res.status).toBe(400);
    const big = await agent.post(`${acme}/incidents/${inc.id}/comments`).set('X-CSRF-Token', csrf).set('Content-Type', 'application/json').send(JSON.stringify({ text: 'x'.repeat(300 * 1024) }));
    expect(big.status).toBe(413);
  });

  it('accepts signed connector alerts with 202 and rejects bad signatures with 401', async () => {
    const body = JSON.stringify({ externalEventId: `http-${randomUUID()}`, serviceKey: 'checkout', environment: 'demo', alertType: 'http_test', severity: 'sev3', occurredAt: new Date().toISOString(), summary: 'http path', labels: {}, measurements: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    const url = `/api/v1/connectors/${SEED.connectors.acme}/alerts`;
    const ok = await request(app).post(url).set('Content-Type', 'application/json').set('X-Connector-Timestamp', ts).set('X-Connector-Signature', ingestion.signAlert(SECRETS['synthetic-alerts-dev'], ts, body)).send(body);
    expect(ok.status).toBe(202);
    const dup = await request(app).post(url).set('Content-Type', 'application/json').set('X-Connector-Timestamp', ts).set('X-Connector-Signature', ingestion.signAlert(SECRETS['synthetic-alerts-dev'], ts, body)).send(body);
    expect(dup.status).toBe(200);
    expect(dup.body.data.duplicate).toBe(true);
    const bad = await request(app).post(url).set('Content-Type', 'application/json').set('X-Connector-Timestamp', ts).set('X-Connector-Signature', 'deadbeef').send(body);
    expect(bad.status).toBe(401);
  });

  it('denies queue/audit views to responders and plugin settings to commanders', async () => {
    const { agent } = await login('alice');
    expect((await agent.get(`${acme}/actions`)).status).toBe(403);
    expect((await agent.get(`${acme}/audit`)).status).toBe(403);
    const { agent: bob } = await login('bob');
    expect((await bob.get(`${acme}/plugins/installations`)).status).toBe(403);
    expect((await bob.get(`${acme}/audit`)).status).toBe(200);
  });
});

describe('SSE stream', () => {
  async function openStream(cookie: string, query: string, headers: Record<string, string> = {}) {
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const ctl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}${acme}/events${query}`, { headers: { cookie, ...headers }, signal: ctl.signal });
    return { res, close: () => { ctl.abort(); server.close(); } };
  }

  it('replays after the snapshot cursor and rejects foreign cursors', async () => {
    const { agent, csrf } = await login('bob');
    const dash = await agent.get(`${acme}/dashboard`);
    expect(dash.status).toBe(200);
    const cursor = dash.body.meta.snapshotCursor as string;
    expect(dash.body.meta.snapshotStreamSeq).toMatch(/^\d+$/);
    const inc = dash.body.data.activeIncidents[0];
    await agent.post(`${acme}/incidents/${inc.id}/comments`).set('X-CSRF-Token', csrf).set('Idempotency-Key', randomUUID()).set('If-Match', `"${inc.version}"`).send({ text: 'stream test' }).expect(201);

    const login2 = await request(app).post('/api/v1/auth/dev-login').send({ userId: SEED.users.bob });
    const cookie = login2.headers['set-cookie']![0]!.split(';')[0]!;
    const { res, close } = await openStream(cookie, `?after=${encodeURIComponent(cursor)}`);
    try {
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      let text = '';
      const deadline = Date.now() + 3000;
      while (!text.includes('entity_changed') && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      expect(text).toContain('event: entity_changed');
      expect(text).toContain(inc.id);
      expect(text).not.toContain('stream test'); // invalidations never carry content
    } finally {
      close();
    }

    const { res: foreign, close: close2 } = await openStream(cookie, `?after=${encodeURIComponent(env.deps.cursors.encodeStream(SEED.workspaces.globex, 1))}`);
    expect(foreign.status).toBe(400);
    close2();
  });

  it('sends resync_required for a cursor ahead of the stream', async () => {
    const login2 = await request(app).post('/api/v1/auth/dev-login').send({ userId: SEED.users.bob });
    const cookie = login2.headers['set-cookie']![0]!.split(';')[0]!;
    const { res, close } = await openStream(cookie, '', { 'Last-Event-ID': env.deps.cursors.encodeStream(SEED.workspaces.acme, 99_999_999) });
    const text = await res.text();
    expect(text).toContain('event: resync_required');
    close();
  });
});
