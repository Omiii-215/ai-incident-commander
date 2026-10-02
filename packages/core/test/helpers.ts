import { randomUUID } from 'node:crypto';
import type { Role } from '@aic/contracts';
import { inject } from 'vitest';
import {
  buildDeps,
  Database,
  drainOutbox,
  FakeProvider,
  HANDLERS,
  MapSecretStore,
  MemoryObjectStore,
  migrate,
  processOutbox,
  SEED,
  SeedClock,
  seedDemo,
  type ActorContext,
  type Deps,
  type FakeMode,
  type ModelProvider,
} from '../src/index.js';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

export const SECRETS = { 'synthetic-alerts-dev': 'test-acme-secret', 'synthetic-alerts-globex': 'test-globex-secret' };

export type TestEnv = { deps: Deps; clock: SeedClock; db: Database; seeded: Awaited<ReturnType<typeof seedDemo>> };

export async function setupEnv(opts: { provider?: ModelProvider; fakeMode?: FakeMode; runInvestigations?: boolean } = {}): Promise<TestEnv> {
  const uri = inject('mongoUri');
  const client = await Database.connect(uri, `t_${randomUUID().replace(/-/g, '').slice(0, 20)}`);
  await migrate(client);
  const clock = new SeedClock();
  const deps = buildDeps({
    db: client,
    cursorKey: 'test-cursor-signing-key-0123456789',
    clock,
    objects: new MemoryObjectStore(),
    secrets: new MapSecretStore(SECRETS),
    provider: opts.provider ?? new FakeProvider(opts.fakeMode ?? 'normal'),
  });
  const seeded = await seedDemo(deps, { runInvestigations: opts.runInvestigations ?? false });
  return { deps, clock, db: client, seeded };
}

export async function teardownEnv(env: TestEnv) {
  await env.db.db.dropDatabase();
  await env.db.close();
}

const ROLES: Record<keyof typeof SEED.users, { ws: 'acme' | 'globex'; roles: Role[] }> = {
  alice: { ws: 'acme', roles: ['responder'] },
  rita: { ws: 'acme', roles: ['responder'] },
  bob: { ws: 'acme', roles: ['commander', 'responder'] },
  carol: { ws: 'acme', roles: ['commander'] },
  dave: { ws: 'acme', roles: ['admin'] },
  erin: { ws: 'acme', roles: ['auditor'] },
  victor: { ws: 'acme', roles: ['viewer'] },
  gina: { ws: 'globex', roles: ['commander'] },
  hank: { ws: 'globex', roles: ['responder'] },
};

export function ctx(user: keyof typeof SEED.users, workspace?: 'acme' | 'globex'): ActorContext {
  const r = ROLES[user];
  return {
    subjectId: SEED.users[user],
    workspaceId: SEED.workspaces[workspace ?? r.ws],
    roles: r.roles,
    membershipVersion: 1,
    requestId: randomUUID(),
  };
}

export const key = () => ({ idempotencyKey: randomUUID() });

export async function incidentFor(env: TestEnv, serviceKey: string, ws: 'acme' | 'globex' = 'acme') {
  const serviceId = env.seeded.serviceIds[ws]![serviceKey]!;
  const inc = await env.db.c.incidents.findOne({ workspaceId: SEED.workspaces[ws], serviceId, active: true }, { sort: { openedAt: -1 } });
  if (!inc) throw new Error(`no active incident for ${serviceKey}`);
  return inc;
}

export async function runPending(env: TestEnv, kinds: string[]) {
  await drainOutbox(env.deps, null, kinds);
}

export async function processAll(env: TestEnv, kind: string) {
  const rows = await env.db.c.outbox.find({ kind: kind as never, state: 'pending' }).toArray();
  for (const r of rows) await processOutbox(env.deps, r._id, HANDLERS);
  return rows;
}
