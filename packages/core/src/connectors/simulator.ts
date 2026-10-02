import type { ActionSpec } from '@aic/contracts';
import type { Clock } from '../context.js';
import type { Database } from '../db/mongo.js';
import type { SimulatorTargetDoc } from '../db/types.js';

// Deterministic recovery simulator (ADR-010). It stands in for an external
// provider: it has its own state, applies each executionKey at most once,
// and exposes preflight, execute, receipt lookup (reconcile) and verification.
// Fault modes reproduce failure, and ambiguous timeouts before/after effect.

export class SimulatorTimeoutError extends Error {
  constructor() {
    super('Simulator did not respond before the deadline.');
  }
}

export type ExecutionReceipt = {
  outcome: 'succeeded' | 'failed';
  providerRequestId: string;
  executionKey: string;
  detail: string;
  newRevision: number | null;
  deployedVersion: string | null;
};

export type ReconcileResult =
  | { state: 'applied'; receipt: ExecutionReceipt }
  | { state: 'not_applied' }
  | { state: 'unknown' };

export type ToolTarget = { workspaceId: string; serviceId: string; environment: string };

export class Simulator {
  readonly version = '1.0.0';
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  private filter(t: ToolTarget) {
    return { workspaceId: t.workspaceId, serviceId: t.serviceId, environment: t.environment };
  }

  async target(t: ToolTarget): Promise<SimulatorTargetDoc | null> {
    return this.db.c.simulatorTargets.findOne(this.filter(t));
  }

  async preflight(t: ToolTarget): Promise<{ revision: string; deployedVersion: string; previousVersion: string | null } | null> {
    const doc = await this.target(t);
    if (!doc) return null;
    return { revision: `rev-${doc.revision}`, deployedVersion: doc.deployedVersion, previousVersion: doc.previousVersion };
  }

  async readRecentErrors(t: ToolTarget) {
    const doc = await this.target(t);
    if (!doc) return null;
    const to = this.clock.now();
    return { lines: doc.logLines, observedFrom: new Date(to.getTime() - 15 * 60_000), observedTo: to };
  }

  async readMetrics(t: ToolTarget) {
    const doc = await this.target(t);
    if (!doc) return null;
    return { errorRate: doc.errorRate, latencyP95Ms: doc.latencyP95Ms, healthy: doc.healthy, sampledAt: doc.sampledAt };
  }

  async readDeployments(t: ToolTarget) {
    const doc = await this.target(t);
    if (!doc) return null;
    return { deployments: doc.deployments.slice(-5), deployedVersion: doc.deployedVersion };
  }

  /** Apply the approved spec at most once per executionKey. */
  async execute(spec: ActionSpec, executionKey: string): Promise<ExecutionReceipt> {
    const t = { workspaceId: spec.workspaceId, ...spec.target };
    const doc = await this.target(t);
    if (!doc) {
      return this.receipt(executionKey, 'failed', 'Target not found in simulator.', null, null);
    }
    const prior = doc.appliedOps.find((o) => o.executionKey === executionKey);
    if (prior) return prior.receipt as unknown as ExecutionReceipt;

    if (doc.faultMode === 'timeout_before_apply') throw new SimulatorTimeoutError();
    if (doc.faultMode === 'fail') {
      return this.receipt(executionKey, 'failed', 'Simulated provider rejected the operation (fault mode: fail).', null, null);
    }

    const now = this.clock.now();
    const set: Partial<SimulatorTargetDoc> = { sampledAt: now };
    let detail: string;
    if (spec.toolId === 'simulator.rollback_deployment') {
      const toVersion = String(spec.arguments.toVersion);
      set.deployedVersion = toVersion;
      set.previousVersion = doc.deployedVersion;
      set.errorRate = 0.004;
      set.latencyP95Ms = 180;
      set.healthy = true;
      set.logLines = [`${now.toISOString()} INFO checkout rollback to ${toVersion} complete; error rate nominal`];
      detail = `Rolled back from ${doc.deployedVersion} to ${toVersion}.`;
    } else {
      // A restart clears process state but does not fix a bad release.
      set.errorRate = doc.errorRate > 0.05 ? doc.errorRate * 0.9 : 0.004;
      set.healthy = set.errorRate < 0.01;
      detail = `Restarted (${String(spec.arguments.strategy)}).`;
    }
    const newRevision = doc.revision + 1;
    const receipt = this.receipt(executionKey, 'succeeded', detail, newRevision, set.deployedVersion ?? doc.deployedVersion);
    const res = await this.db.c.simulatorTargets.updateOne(
      { _id: doc._id, revision: doc.revision, 'appliedOps.executionKey': { $ne: executionKey } },
      {
        $set: { ...set, revision: newRevision },
        $push: { appliedOps: { executionKey, op: spec.toolId, receipt: receipt as unknown as Record<string, unknown>, appliedAt: now } },
      },
    );
    if (res.modifiedCount === 0) {
      // Either applied concurrently under the same key, or the target moved.
      const again = await this.target(t);
      const applied = again?.appliedOps.find((o) => o.executionKey === executionKey);
      if (applied) return applied.receipt as unknown as ExecutionReceipt;
      return this.receipt(executionKey, 'failed', 'Target revision changed during execution.', null, null);
    }
    if (doc.faultMode === 'timeout_after_apply') throw new SimulatorTimeoutError();
    return receipt;
  }

  /** Receipt lookup by stable execution key. */
  async reconcile(t: ToolTarget, executionKey: string): Promise<ReconcileResult> {
    const doc = await this.target(t);
    if (!doc) return { state: 'unknown' };
    const applied = doc.appliedOps.find((o) => o.executionKey === executionKey);
    if (applied) return { state: 'applied', receipt: applied.receipt as unknown as ExecutionReceipt };
    return { state: 'not_applied' };
  }

  private receipt(
    executionKey: string,
    outcome: 'succeeded' | 'failed',
    detail: string,
    newRevision: number | null,
    deployedVersion: string | null,
  ): ExecutionReceipt {
    return { outcome, providerRequestId: `sim-${executionKey}`, executionKey, detail, newRevision, deployedVersion };
  }
}

export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SimulatorTimeoutError()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
