import { AppError, notFound, type InstallationDTO, type PluginCatalogDTO, type PluginScope } from '@aic/contracts';
import type { InstallPluginBody, PatchInstallationBody } from '@aic/contracts';
import type { z } from 'zod';
import { uuid, userActor, type ActorContext } from '../context.js';
import type { Deps } from '../deps.js';
import { record } from '../db/event-writer.js';
import { runCommand } from '../db/idempotency.js';
import { isDuplicateKey } from '../db/mongo.js';
import type { InstallationDoc, PluginCatalogDoc } from '../db/types.js';
import { casUpdate, checkVersion, iso, requireOp } from './common.js';

type Meta = { idempotencyKey: string; expectedVersion?: number | undefined };

const toCatalogDTO = (c: PluginCatalogDoc): PluginCatalogDTO => ({
  pluginId: c.pluginId,
  version: c.version,
  displayName: c.manifest.displayName,
  publisher: c.publisher,
  reviewStatus: c.reviewStatus,
  permissions: c.manifest.permissions,
  capabilities: c.manifest.capabilities.map((k) => ({ name: k.name, version: k.version, kind: k.kind, approval: k.approval })),
  manifestHash: c.manifestHash,
});

async function toInstallationDTO(deps: Deps, docs: InstallationDoc[]): Promise<InstallationDTO[]> {
  const catalog = await deps.db.c.pluginCatalog.find({ pluginId: { $in: docs.map((d) => d.pluginId) } }).toArray();
  return docs.map((d) => ({
    id: d._id,
    pluginId: d.pluginId,
    pinnedVersion: d.pinnedVersion,
    displayName: catalog.find((c) => c.pluginId === d.pluginId && c.version === d.pinnedVersion)?.manifest.displayName ?? d.pluginId,
    grants: d.grants,
    allowedServiceIds: d.allowedServiceIds,
    allowedEnvironments: d.allowedEnvironments,
    status: d.status,
    health: { status: d.health.status, checkedAt: iso(d.health.checkedAt), lastError: d.health.lastError },
    configuredBy: d.configuredBy,
    version: d.version,
    updatedAt: d.updatedAt.toISOString(),
  }));
}

export async function listCatalog(deps: Deps, ctx: ActorContext): Promise<PluginCatalogDTO[]> {
  requireOp(ctx, 'plugin.manage');
  return (await deps.db.c.pluginCatalog.find({}).sort({ pluginId: 1, version: -1 }).toArray()).map(toCatalogDTO);
}

export async function listInstallations(deps: Deps, ctx: ActorContext): Promise<InstallationDTO[]> {
  requireOp(ctx, 'plugin.manage');
  return toInstallationDTO(deps, await deps.db.c.installations.find({ workspaceId: ctx.workspaceId, status: { $ne: 'removed' } }).sort({ pluginId: 1 }).toArray());
}

async function validateGrants(deps: Deps, workspaceId: string, catalog: PluginCatalogDoc, grants: PluginScope[], serviceIds: string[]) {
  const undeclared = grants.filter((g) => !catalog.manifest.permissions.includes(g));
  if (undeclared.length) throw new AppError('INVALID_INPUT', `Grants not declared by this plugin: ${undeclared.join(', ')}.`);
  if (new Set(grants).size !== grants.length) throw new AppError('INVALID_INPUT', 'Grants must be unique.');
  if (grants.includes('remediations:execute')) throw new AppError('FORBIDDEN', 'Production write grants are disabled in this release.');
  if (serviceIds.length) {
    const n = await deps.db.c.services.countDocuments({ workspaceId, _id: { $in: serviceIds } });
    if (n !== new Set(serviceIds).size) throw new AppError('INVALID_INPUT', 'Allowed services must belong to this workspace.');
  }
}

export async function installPlugin(deps: Deps, ctx: ActorContext, body: z.infer<typeof InstallPluginBody>, meta: Meta) {
  requireOp(ctx, 'plugin.manage');
  const catalog = await deps.db.c.pluginCatalog.findOne({ pluginId: body.pluginId, version: body.pinnedVersion });
  if (!catalog || catalog.reviewStatus !== 'reviewed') throw new AppError('INVALID_INPUT', 'This plugin version is not available in the reviewed catalog.');
  await validateGrants(deps, ctx.workspaceId, catalog, body.grants, body.allowedServiceIds);
  try {
    return await runCommand(deps.db, deps.clock, ctx, { operation: 'install-plugin', key: meta.idempotencyKey, payload: body }, async (tx) => {
      const now = deps.clock.now();
      const doc: InstallationDoc = {
        _id: uuid(),
        workspaceId: ctx.workspaceId,
        pluginId: body.pluginId,
        pinnedVersion: body.pinnedVersion,
        grants: body.grants,
        allowedServiceIds: body.allowedServiceIds,
        allowedEnvironments: body.allowedEnvironments,
        secretRefs: {},
        status: 'configured',
        policyVersion: 1,
        configuredBy: ctx.subjectId,
        health: { status: 'unknown', checkedAt: null, lastError: null },
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      await deps.db.c.installations.insertOne(doc, { session: tx });
      await record(deps.db, tx, {
        workspaceId: ctx.workspaceId,
        actor: userActor(ctx),
        requestId: ctx.requestId,
        now,
        events: [{ type: 'plugin.installed', entityType: 'plugin_installation', entityId: doc._id, entityVersion: 1, reason: 'configured' }],
        audit: [{ operation: 'plugin.install', resource: { type: 'plugin_installation', id: doc._id }, afterVersion: 1 }],
      });
      return { status: 201, body: (await toInstallationDTO(deps, [doc]))[0]! };
    });
  } catch (e) {
    if (isDuplicateKey(e)) throw new AppError('CONFLICT', 'This plugin is already installed in the workspace.');
    throw e;
  }
}

async function loadInstallation(deps: Deps, workspaceId: string, id: string, tx?: import('mongodb').ClientSession) {
  const doc = await deps.db.c.installations.findOne({ _id: id, workspaceId }, tx ? { session: tx } : {});
  if (!doc) throw notFound();
  return doc;
}

export async function patchInstallation(deps: Deps, ctx: ActorContext, id: string, body: z.infer<typeof PatchInstallationBody>, meta: Meta) {
  requireOp(ctx, 'plugin.manage');
  return runCommand(deps.db, deps.clock, ctx, { operation: `patch-installation:${id}`, key: meta.idempotencyKey, payload: body, expectedVersion: meta.expectedVersion }, async (tx) => {
    const doc = await loadInstallation(deps, ctx.workspaceId, id, tx);
    checkVersion(doc.version, meta.expectedVersion, 'installation');
    if (doc.status === 'removed' || doc.status === 'quarantined') throw new AppError('INVALID_TRANSITION', `A ${doc.status} installation cannot be changed.`);
    const catalog = await deps.db.c.pluginCatalog.findOne({ pluginId: doc.pluginId, version: doc.pinnedVersion }, { session: tx });
    if (!catalog) throw new AppError('INVALID_INPUT', 'Pinned plugin version is no longer available.');
    await validateGrants(deps, ctx.workspaceId, catalog, body.grants ?? doc.grants, body.allowedServiceIds ?? doc.allowedServiceIds);
    if (body.status === 'enabled' && doc.status !== 'enabled' && doc.health.status !== 'ok') {
      throw new AppError('INVALID_TRANSITION', 'Run a passing connection test before enabling this plugin.');
    }
    const now = deps.clock.now();
    const set: Partial<InstallationDoc> = { updatedAt: now, policyVersion: doc.policyVersion + 1 };
    if (body.grants) set.grants = body.grants;
    if (body.allowedServiceIds) set.allowedServiceIds = body.allowedServiceIds;
    if (body.allowedEnvironments) set.allowedEnvironments = body.allowedEnvironments;
    if (body.status) set.status = body.status;
    const version = await casUpdate(deps.db.c.installations, tx, doc, set, 'installation');
    await record(deps.db, tx, {
      workspaceId: ctx.workspaceId,
      actor: userActor(ctx),
      requestId: ctx.requestId,
      now,
      events: [{ type: body.status === 'disabled' ? 'plugin.revoked' : 'plugin.updated', entityType: 'plugin_installation', entityId: id, entityVersion: version, reason: body.status ?? 'grants_changed' }],
      audit: [{ operation: 'plugin.update', resource: { type: 'plugin_installation', id }, beforeVersion: doc.version, afterVersion: version }],
    });
    return { status: 200, body: (await toInstallationDTO(deps, [await loadInstallation(deps, ctx.workspaceId, id, tx)]))[0]! };
  });
}

export async function testInstallation(deps: Deps, ctx: ActorContext, id: string, meta: Meta) {
  requireOp(ctx, 'plugin.manage');
  return runCommand(deps.db, deps.clock, ctx, { operation: `test-installation:${id}`, key: meta.idempotencyKey, payload: {}, expectedVersion: meta.expectedVersion }, async (tx) => {
    const doc = await loadInstallation(deps, ctx.workspaceId, id, tx);
    checkVersion(doc.version, meta.expectedVersion, 'installation');
    const now = deps.clock.now();
    await record(deps.db, tx, {
      workspaceId: ctx.workspaceId,
      actor: userActor(ctx),
      requestId: ctx.requestId,
      now,
      events: [],
      audit: [{ operation: 'plugin.test', resource: { type: 'plugin_installation', id } }],
      outbox: [{ kind: 'plugin.test', aggregateId: id }],
    });
    return { status: 202, body: { installationId: id, state: 'testing' } };
  });
}

/** Revocation disables future dispatch. It cannot recall an in-flight external call. */
export async function revokeInstallation(deps: Deps, ctx: ActorContext, id: string, body: { reason: string }, meta: Meta) {
  requireOp(ctx, 'plugin.manage');
  return runCommand(deps.db, deps.clock, ctx, { operation: `revoke-installation:${id}`, key: meta.idempotencyKey, payload: body, expectedVersion: meta.expectedVersion }, async (tx) => {
    const doc = await loadInstallation(deps, ctx.workspaceId, id, tx);
    checkVersion(doc.version, meta.expectedVersion, 'installation');
    const now = deps.clock.now();
    const version = await casUpdate(
      deps.db.c.installations,
      tx,
      doc,
      { status: 'disabled', policyVersion: doc.policyVersion + 1, health: { status: 'unknown', checkedAt: null, lastError: null }, updatedAt: now },
      'installation',
    );
    await record(deps.db, tx, {
      workspaceId: ctx.workspaceId,
      actor: userActor(ctx),
      requestId: ctx.requestId,
      now,
      events: [{ type: 'plugin.revoked', entityType: 'plugin_installation', entityId: id, entityVersion: version, reason: 'revoked' }],
      audit: [{ operation: 'plugin.revoke', resource: { type: 'plugin_installation', id }, reasonCode: body.reason.slice(0, 120), beforeVersion: doc.version, afterVersion: version }],
    });
    return { status: 200, body: (await toInstallationDTO(deps, [await loadInstallation(deps, ctx.workspaceId, id, tx)]))[0]! };
  });
}
