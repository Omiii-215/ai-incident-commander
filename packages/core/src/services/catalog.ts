import { AppError, notFound, type Page, type ServiceDTO, type ServiceHealth } from '@aic/contracts';
import type { z } from 'zod';
import type { CreateServiceBody, PatchServiceBody } from '@aic/contracts';
import { uuid, userActor, type ActorContext } from '../context.js';
import type { Deps } from '../deps.js';
import { record } from '../db/event-writer.js';
import { runCommand } from '../db/idempotency.js';
import { isDuplicateKey } from '../db/mongo.js';
import type { ServiceDoc, SimulatorTargetDoc } from '../db/types.js';
import { casUpdate, checkVersion, requireOp } from './common.js';

type Meta = { idempotencyKey: string; expectedVersion?: number | undefined };

const HEALTH_FRESHNESS_MS = 15 * 60 * 1000;

/** Health never infers "healthy" from absent alerts; stale or missing samples are unknown. */
export function healthFromSample(sample: SimulatorTargetDoc | undefined, now: Date): { status: ServiceHealth; sampledAt: string | null; source: string } {
  if (!sample) return { status: 'unknown', sampledAt: null, source: 'No telemetry source' };
  const fresh = now.getTime() - sample.sampledAt.getTime() <= HEALTH_FRESHNESS_MS;
  const status: ServiceHealth = !fresh ? 'unknown' : sample.errorRate < 0.01 ? 'healthy' : sample.errorRate < 0.05 ? 'degraded' : 'unhealthy';
  return { status, sampledAt: sample.sampledAt.toISOString(), source: 'Simulated health' };
}

export async function servicesToDTO(deps: Deps, workspaceId: string, docs: ServiceDoc[]): Promise<ServiceDTO[]> {
  const ids = docs.map((d) => d._id);
  const [samples, counts] = await Promise.all([
    deps.db.c.simulatorTargets.find({ workspaceId, serviceId: { $in: ids } }).toArray(),
    deps.db.c.incidents
      .aggregate<{ _id: string; n: number }>([{ $match: { workspaceId, serviceId: { $in: ids }, active: true } }, { $group: { _id: '$serviceId', n: { $sum: 1 } } }])
      .toArray(),
  ]);
  const now = deps.clock.now();
  const countBy = new Map(counts.map((c) => [c._id, c.n]));
  return docs.map((d) => ({
    id: d._id,
    slug: d.slug,
    name: d.name,
    environments: d.environments,
    ownerTeam: d.ownerTeam,
    criticality: d.criticality,
    dependencyIds: d.dependencyIds,
    health: d.environments.map((env) => ({
      environment: env,
      ...healthFromSample(samples.find((s) => s.serviceId === d._id && s.environment === env), now),
    })),
    activeIncidentCount: countBy.get(d._id) ?? 0,
    version: d.version,
  }));
}

export async function listServices(deps: Deps, ctx: ActorContext, q: { cursor?: string; limit: number }): Promise<Page<ServiceDTO>> {
  requireOp(ctx, 'read');
  const filter: Record<string, unknown> = { workspaceId: ctx.workspaceId };
  if (q.cursor) {
    const [name, id] = deps.cursors.decodeList(q.cursor, ctx.workspaceId, 'services') as [string, string];
    filter.$or = [{ name: { $gt: name } }, { name, _id: { $gt: id } }];
  }
  const docs = await deps.db.c.services.find(filter).sort({ name: 1, _id: 1 }).limit(q.limit + 1).toArray();
  const page = docs.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: await servicesToDTO(deps, ctx.workspaceId, page),
    nextCursor: docs.length > q.limit && last ? deps.cursors.encodeList(ctx.workspaceId, 'services', [last.name, last._id]) : null,
  };
}

export async function getService(deps: Deps, ctx: ActorContext, id: string): Promise<ServiceDTO> {
  requireOp(ctx, 'read');
  const doc = await deps.db.c.services.findOne({ _id: id, workspaceId: ctx.workspaceId });
  if (!doc) throw notFound();
  return (await servicesToDTO(deps, ctx.workspaceId, [doc]))[0]!;
}

async function assertDependencies(deps: Deps, workspaceId: string, ids: string[], selfId?: string) {
  if (!ids.length) return;
  if (selfId && ids.includes(selfId)) throw new AppError('INVALID_INPUT', 'A service cannot depend on itself.');
  const n = await deps.db.c.services.countDocuments({ workspaceId, _id: { $in: ids } });
  if (n !== new Set(ids).size) throw new AppError('INVALID_INPUT', 'Dependencies must be services in this workspace.');
}

export async function createService(deps: Deps, ctx: ActorContext, body: z.infer<typeof CreateServiceBody>, meta: Meta) {
  requireOp(ctx, 'service.manage');
  await assertDependencies(deps, ctx.workspaceId, body.dependencyIds);
  try {
    return await runCommand(deps.db, deps.clock, ctx, { operation: 'create-service', key: meta.idempotencyKey, payload: body }, async (tx) => {
      const now = deps.clock.now();
      const doc: ServiceDoc = { _id: uuid(), workspaceId: ctx.workspaceId, ...body, createdAt: now, updatedAt: now, version: 1 };
      await deps.db.c.services.insertOne(doc, { session: tx });
      await record(deps.db, tx, {
        workspaceId: ctx.workspaceId,
        actor: userActor(ctx),
        requestId: ctx.requestId,
        now,
        events: [{ type: 'service.created', entityType: 'service', entityId: doc._id, entityVersion: 1, reason: 'created' }],
        audit: [{ operation: 'service.create', resource: { type: 'service', id: doc._id }, afterVersion: 1 }],
      });
      return { status: 201, body: (await servicesToDTO(deps, ctx.workspaceId, [doc]))[0]! };
    }, );
  } catch (e) {
    if (isDuplicateKey(e)) throw new AppError('CONFLICT', 'A service with this slug already exists.');
    throw e;
  }
}

export async function patchService(deps: Deps, ctx: ActorContext, id: string, body: z.infer<typeof PatchServiceBody>, meta: Meta) {
  requireOp(ctx, 'service.manage');
  if (body.dependencyIds) await assertDependencies(deps, ctx.workspaceId, body.dependencyIds, id);
  return runCommand(deps.db, deps.clock, ctx, { operation: `patch-service:${id}`, key: meta.idempotencyKey, payload: body, expectedVersion: meta.expectedVersion }, async (tx) => {
    const doc = await deps.db.c.services.findOne({ _id: id, workspaceId: ctx.workspaceId }, { session: tx });
    if (!doc) throw notFound();
    checkVersion(doc.version, meta.expectedVersion, 'service');
    const now = deps.clock.now();
    const version = await casUpdate(deps.db.c.services, tx, doc, { ...body, updatedAt: now } as Partial<ServiceDoc>, 'service');
    await record(deps.db, tx, {
      workspaceId: ctx.workspaceId,
      actor: userActor(ctx),
      requestId: ctx.requestId,
      now,
      events: [{ type: 'service.updated', entityType: 'service', entityId: id, entityVersion: version, reason: 'updated' }],
      audit: [{ operation: 'service.update', resource: { type: 'service', id }, beforeVersion: doc.version, afterVersion: version }],
    });
    const fresh = await deps.db.c.services.findOne({ _id: id, workspaceId: ctx.workspaceId }, { session: tx });
    return { status: 200, body: (await servicesToDTO(deps, ctx.workspaceId, [fresh!]))[0]! };
  });
}
