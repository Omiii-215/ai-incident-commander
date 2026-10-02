// Records a snapshot of the running local app (after `pnpm seed`) for the
// browser-only demo in apps/web. Run: pnpm demo:capture
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Database, loadConfig, SEED } from '@aic/core';

const API = `http://localhost:${process.env.API_PORT ?? 4000}/api/v1`;
const OUT = path.resolve('apps/web/lib/demo/fixture.json');

type Session = { cookie: string; csrf: string };

async function login(userId: string): Promise<Session> {
  const res = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
  if (!res.ok) throw new Error(`login failed ${res.status}`);
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
  const me = (await res.json()).data;
  return { cookie, csrf: me.csrfToken };
}
async function get<T>(s: Session, p: string): Promise<T> {
  const res = await fetch(`${API}${p}`, { headers: { cookie: s.cookie } });
  if (!res.ok) throw new Error(`GET ${p} → ${res.status}`);
  return (await res.json()).data as T;
}
async function command<T>(s: Session, p: string, body: unknown, version?: number): Promise<T> {
  const res = await fetch(`${API}${p}`, {
    method: 'POST',
    headers: { cookie: s.cookie, 'X-CSRF-Token': s.csrf, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), ...(version ? { 'If-Match': `"${version}"` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${p} → ${res.status} ${await res.text()}`);
  return (await res.json()).data as T;
}
async function all<T>(s: Session, p: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const sep = p.includes('?') ? '&' : '?';
    const page: { items: T[]; nextCursor: string | null } = await get(s, `${p}${sep}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

const STATUSES = ['declared', 'investigating', 'mitigating', 'monitoring', 'resolved'];

async function captureWorkspace(s: Session, workspaceId: string, admin?: Session) {
  const ws = `/workspaces/${workspaceId}`;
  const incidents = (await Promise.all(STATUSES.map((st) => all<{ id: string }>(s, `${ws}/incidents?status=${st}`)))).flat();
  const detail: Record<string, unknown> = {};
  for (const inc of incidents) {
    const id = inc.id;
    detail[id] = {
      incident: await get(s, `${ws}/incidents/${id}`),
      timeline: await all(s, `${ws}/incidents/${id}/timeline?order=asc`),
      evidence: await all(s, `${ws}/incidents/${id}/evidence`),
      diagnosis: await get(s, `${ws}/incidents/${id}/diagnosis`),
      investigation: await get(s, `${ws}/incidents/${id}/investigations/latest`),
      postmortem: await get(s, `${ws}/incidents/${id}/postmortem-drafts/latest`),
    };
  }
  const actionList = await all<{ id: string }>(s, `${ws}/actions`).catch(() => []);
  const actions = await Promise.all(actionList.map((a) => get(s, `${ws}/actions/${a.id}`)));
  const services = await all<{ id: string }>(s, `${ws}/services`);
  return {
    incidents: detail,
    actions,
    services: await Promise.all(services.map((x) => get(s, `${ws}/services/${x.id}`))),
    runbooks: await all(s, `${ws}/runbooks`),
    audit: await all(s, `${ws}/audit`).catch(() => []),
    pluginCatalog: admin ? await get(admin, `${ws}/plugins/catalog`) : [],
    installations: admin ? await get(admin, `${ws}/plugins/installations`) : [],
  };
}

const bob = await login(SEED.users.bob);
const dave = await login(SEED.users.dave);
const gina = await login(SEED.users.gina);

// One request already waiting for review, so commanders have something to approve.
const acme = `/workspaces/${SEED.workspaces.acme}`;
const payments = (await get<{ items: Array<{ id: string; serviceName: string; version: number; serviceId: string; environment: string; latestDiagnosisId: string | null }> }>(bob, `${acme}/incidents?q=payments`)).items.find((i) => i.serviceName === 'Payments Gateway');
if (payments) {
  const diag = await get<{ suggestedActions: Array<{ toolId: string; arguments: Record<string, unknown> }> } | null>(bob, `${acme}/incidents/${payments.id}/diagnosis`);
  const suggestion = diag?.suggestedActions[0];
  if (suggestion) {
    await command(bob, `${acme}/incidents/${payments.id}/actions`, { toolId: suggestion.toolId, arguments: suggestion.arguments, target: { serviceId: payments.serviceId, environment: payments.environment }, diagnosisId: payments.latestDiagnosisId }, payments.version);
  }
}

const config = loadConfig();
const db = await Database.connect(config.MONGODB_URI);
const chunks = await db.c.runbookChunks.find({ published: true }).toArray();
const runbookDocs = await db.c.runbooks.find({}).toArray();
const versions = await db.c.runbookVersions.find({}).toArray();
const targets = await db.c.simulatorTargets.find({}).toArray();
await db.close();

const meBob = await get<{ workspaces: Array<{ id: string; name: string; slug: string }> }>(bob, '/me');
const meGina = await get<{ workspaces: Array<{ id: string; name: string; slug: string }> }>(gina, '/me');

const fixture = {
  capturedAt: new Date().toISOString(),
  workspaces: [...meBob.workspaces, ...meGina.workspaces].map((w) => ({ id: w.id, name: w.name, slug: w.slug })),
  devUsers: await get(bob, '/auth/dev-users'),
  data: {
    [SEED.workspaces.acme]: await captureWorkspace(bob, SEED.workspaces.acme, dave),
    [SEED.workspaces.globex]: await captureWorkspace(gina, SEED.workspaces.globex),
  },
  chunks: chunks.map((c) => {
    const rb = runbookDocs.find((r) => r._id === c.runbookId);
    return { workspaceId: c.workspaceId, runbookId: c.runbookId, runbookTitle: rb?.title ?? '', versionId: c.versionId, revision: versions.find((v) => v._id === c.versionId)?.revision ?? 1, chunkId: c._id, heading: c.heading, text: c.text };
  }),
  targets: targets.map((t) => ({ workspaceId: t.workspaceId, serviceId: t.serviceId, environment: t.environment, revision: t.revision, deployedVersion: t.deployedVersion, previousVersion: t.previousVersion, faultMode: t.faultMode })),
  // Pre-generated IDs for things visitors create, so the static export has a page for each.
  reserved: { incidents: Array.from({ length: 30 }, () => randomUUID()), actions: Array.from({ length: 40 }, () => randomUUID()) },
};

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(fixture));
const counts = Object.values(fixture.data).map((d) => `${Object.keys(d.incidents).length} incidents, ${d.actions.length} actions, ${d.audit.length} audit`);
console.log(`demo fixture written (${(JSON.stringify(fixture).length / 1024).toFixed(0)} KB): ${counts.join(' | ')}`);
