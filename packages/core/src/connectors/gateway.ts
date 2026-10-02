import type { PluginScope } from '@aic/contracts';
import { sha256Hex } from '@aic/domain';
import { uuid, type Clock } from '../context.js';
import { auditDenied } from '../db/event-writer.js';
import { RETENTION } from '../db/migrations.js';
import type { Database } from '../db/mongo.js';
import type { Actor, EvidenceDoc, InstallationDoc } from '../db/types.js';
import { looksLikeInjection, redact } from '../redaction.js';
import { READ_TOOLS, type ReadToolId } from './catalog.js';
import { withTimeout, type Simulator, type ToolTarget } from './simulator.js';

// Policy gateway (PLUGIN_SYSTEM.md §5). Effective permission is the
// intersection of workspace policy, installation grant, capability declaration,
// workflow allowlist and target restriction. The model never supplies workspace.

export class GatewayDenied extends Error {
  constructor(readonly reasonCode: string) {
    super(`Tool call denied: ${reasonCode}`);
  }
}

export const READ_CALL_TIMEOUT_MS = 8000;

export class PolicyGateway {
  constructor(
    private readonly db: Database,
    private readonly simulator: Simulator,
    private readonly clock: Clock,
  ) {}

  async installation(workspaceId: string, pluginId: string): Promise<InstallationDoc | null> {
    return this.db.c.installations.findOne({ workspaceId, pluginId });
  }

  /** Returns a denial reason code or null when the installation permits this scope on this target. */
  async denial(inst: InstallationDoc | null, scope: PluginScope, capability: string, target?: { serviceId: string; environment: string }) {
    if (!inst) return 'NOT_INSTALLED';
    if (inst.status !== 'enabled') return 'INSTALLATION_NOT_ENABLED';
    if (!inst.grants.includes(scope)) return 'SCOPE_NOT_GRANTED';
    const catalog = await this.db.c.pluginCatalog.findOne({ pluginId: inst.pluginId, version: inst.pinnedVersion });
    if (!catalog || catalog.reviewStatus !== 'reviewed') return 'PLUGIN_VERSION_NOT_REVIEWED';
    if (!catalog.manifest.permissions.includes(scope)) return 'SCOPE_NOT_DECLARED';
    if (!catalog.manifest.capabilities.some((c) => c.name === capability)) return 'CAPABILITY_NOT_DECLARED';
    if (target) {
      // Empty allowed-target lists grant no target access.
      if (!inst.allowedServiceIds.includes(target.serviceId)) return 'TARGET_SERVICE_NOT_ALLOWED';
      if (!inst.allowedEnvironments.includes(target.environment)) return 'TARGET_ENVIRONMENT_NOT_ALLOWED';
    }
    return null;
  }

  /** Bounded, redacted read producing one immutable evidence record. */
  async read(
    ctx: { workspaceId: string; incidentId: string; runId: string | null; requestId: string; actor: Actor },
    toolId: ReadToolId,
    target: ToolTarget,
  ): Promise<EvidenceDoc> {
    const tool = READ_TOOLS[toolId];
    const inst = await this.installation(ctx.workspaceId, tool.pluginId);
    const reason = await this.denial(inst, tool.scope, tool.capability, target);
    if (reason) {
      await auditDenied(this.db, {
        workspaceId: ctx.workspaceId,
        actor: ctx.actor,
        requestId: ctx.requestId,
        now: this.clock.now(),
        operation: `tool.${toolId}`,
        resource: { type: 'service', id: target.serviceId },
        reasonCode: reason,
      });
      throw new GatewayDenied(reason);
    }

    const scoped: ToolTarget = { workspaceId: ctx.workspaceId, serviceId: target.serviceId, environment: target.environment };
    let title: string;
    let raw: string;
    let sourceType: EvidenceDoc['sourceType'];
    let observedFrom: Date | null = null;
    let observedTo: Date | null = null;
    let sourceVersion: string | null = null;

    switch (toolId) {
      case 'simulator.read_recent_errors': {
        const r = await withTimeout(this.simulator.readRecentErrors(scoped), READ_CALL_TIMEOUT_MS);
        if (!r) throw new GatewayDenied('TARGET_UNAVAILABLE');
        sourceType = 'log';
        title = 'Recent error log excerpt (simulated)';
        raw = r.lines.join('\n') || 'No error lines in the window.';
        observedFrom = r.observedFrom;
        observedTo = r.observedTo;
        break;
      }
      case 'simulator.read_metrics': {
        const r = await withTimeout(this.simulator.readMetrics(scoped), READ_CALL_TIMEOUT_MS);
        if (!r) throw new GatewayDenied('TARGET_UNAVAILABLE');
        sourceType = 'metric';
        title = 'Service metrics sample (simulated)';
        raw = `error_rate=${r.errorRate.toFixed(4)} latency_p95_ms=${r.latencyP95Ms} healthy=${r.healthy}`;
        observedFrom = new Date(r.sampledAt.getTime() - 5 * 60_000);
        observedTo = r.sampledAt;
        break;
      }
      case 'simulator.read_deployments': {
        const r = await withTimeout(this.simulator.readDeployments(scoped), READ_CALL_TIMEOUT_MS);
        if (!r) throw new GatewayDenied('TARGET_UNAVAILABLE');
        sourceType = 'deployment';
        title = 'Deployment history (simulated)';
        raw = r.deployments
          .map((d) => `${d.deployedAt.toISOString()} ${d.version} commit=${d.commit} author=${d.author} ${d.notes}`)
          .join('\n');
        sourceVersion = r.deployedVersion;
        const last = r.deployments.at(-1);
        observedFrom = r.deployments[0]?.deployedAt ?? null;
        observedTo = last?.deployedAt ?? null;
        break;
      }
    }

    const red = redact(raw);
    const now = this.clock.now();
    const doc: EvidenceDoc = {
      _id: uuid(),
      workspaceId: ctx.workspaceId,
      incidentId: ctx.incidentId,
      runId: ctx.runId,
      sourceType,
      sourceId: `${toolId}:${target.serviceId}:${target.environment}`,
      sourceVersion,
      title,
      collectedAt: now,
      observedFrom,
      observedTo,
      completeness: red.truncated ? 'partial' : 'complete',
      checksum: `sha256:${sha256Hex(red.text)}`,
      objectKey: null,
      redactedExcerpt: red.text,
      redactionCount: red.count,
      truncated: red.truncated,
      suspectedInjection: looksLikeInjection(raw),
      expiresAt: new Date(now.getTime() + RETENTION.evidenceSeconds * 1000),
      createdAt: now,
      schemaVersion: 1,
    };
    await this.db.c.evidence.insertOne(doc);
    return doc;
  }
}
