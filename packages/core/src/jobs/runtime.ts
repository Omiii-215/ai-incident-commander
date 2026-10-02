import type { OutboxKind } from '@aic/contracts';
import { uuid } from '../context.js';
import type { Deps } from '../deps.js';
import { RETENTION } from '../db/migrations.js';
import { isDuplicateKey, type Tx } from '../db/mongo.js';
import type { JobRunDoc, OutboxDoc } from '../db/types.js';

// Durable job execution (LLD.md §6). Queue delivery is at least once; the
// job_runs lease with a fencing token and durable completion make duplicate
// deliveries harmless. Redis payloads carry IDs only.

export const LEASE_MS = 60_000;
export const RENEW_EVERY_MS = 15_000;
export const MAX_DISPATCH_ATTEMPTS = 8;

export type JobPayload = {
  schemaVersion: 1;
  outboxId: string;
  workspaceId: string;
  kind: OutboxKind;
  aggregateId: string;
  requestId: string;
};

export class RetryableJobError extends Error {}
export class PermanentJobError extends Error {}
/** The lease was lost to another worker; stop without writing. */
export class LeaseLostError extends Error {}

export type JobContext = {
  outbox: OutboxDoc;
  jobRunId: string;
  token: number;
  attempt: number;
  signal: AbortSignal;
};

export type JobHandler = (deps: Deps, job: JobContext) => Promise<void>;

export const toPayload = (o: OutboxDoc): JobPayload => ({
  schemaVersion: 1,
  outboxId: o._id,
  workspaceId: o.workspaceId,
  kind: o.kind,
  aggregateId: o.aggregateId,
  requestId: o.requestId,
});

async function claim(deps: Deps, outbox: OutboxDoc): Promise<JobRunDoc | null> {
  const now = deps.clock.now();
  try {
    return await deps.db.c.jobRuns.findOneAndUpdate(
      {
        workspaceId: outbox.workspaceId,
        outboxId: outbox._id,
        state: { $nin: ['completed', 'failed'] },
        leaseUntil: { $lt: now },
      },
      {
        $set: { state: 'running', leaseUntil: new Date(now.getTime() + LEASE_MS) },
        $inc: { leaseToken: 1, attempt: 1 },
        $setOnInsert: { _id: uuid(), resultRef: null, lastError: null, completedAt: null, expiresAt: null, createdAt: now },
      },
      { upsert: true, returnDocument: 'after' },
    );
  } catch (e) {
    // Upsert collided with an existing row whose lease is held or which is complete.
    if (isDuplicateKey(e)) return null;
    throw e;
  }
}

/** Compare-and-set completion inside the handler's result transaction. */
export async function completeJob(deps: Deps, tx: Tx, job: JobContext, resultRef: string | null = null): Promise<void> {
  const now = deps.clock.now();
  const res = await deps.db.c.jobRuns.updateOne(
    { _id: job.jobRunId, workspaceId: job.outbox.workspaceId, leaseToken: job.token, state: 'running' },
    {
      $set: {
        state: 'completed',
        completedAt: now,
        resultRef,
        expiresAt: new Date(now.getTime() + RETENTION.jobRunCompletedSeconds * 1000),
      },
    },
    { session: tx },
  );
  if (res.matchedCount !== 1) throw new LeaseLostError('Job lease lost before completion.');
  await deps.db.c.outbox.updateOne(
    { _id: job.outbox._id, workspaceId: job.outbox.workspaceId },
    { $set: { state: 'completed', completedAt: now, expiresAt: new Date(now.getTime() + RETENTION.outboxCompletedSeconds * 1000) } },
    { session: tx },
  );
}

/** Verify the fencing token is still current (use inside transactions before writing results). */
export async function assertLease(deps: Deps, tx: Tx | undefined, job: JobContext): Promise<void> {
  const row = await deps.db.c.jobRuns.findOne({ _id: job.jobRunId, leaseToken: job.token, state: 'running' }, tx ? { session: tx } : {});
  if (!row) throw new LeaseLostError('Job lease lost.');
}

export type ProcessResult = 'completed' | 'skipped' | 'failed';

/**
 * Process one delivered job. Throws RetryableJobError to let the queue retry
 * with backoff; permanent errors mark the durable intent failed (visible).
 */
export async function processOutbox(deps: Deps, outboxId: string, handlers: Partial<Record<OutboxKind, JobHandler>>): Promise<ProcessResult> {
  const outbox = await deps.db.c.outbox.findOne({ _id: outboxId });
  // Reject a job whose durable intent is absent, cancelled or completed.
  if (!outbox || ['completed', 'cancelled', 'failed'].includes(outbox.state)) return 'skipped';
  if (outbox.schemaVersion !== 1) {
    await markOutboxFailed(deps, outbox, 'Unsupported job schema version.');
    return 'failed';
  }
  const handler = handlers[outbox.kind];
  if (!handler) throw new RetryableJobError(`No handler registered for ${outbox.kind} in this worker.`);
  const run = await claim(deps, outbox);
  if (!run) return 'skipped';

  const controller = new AbortController();
  const job: JobContext = { outbox, jobRunId: run._id, token: run.leaseToken, attempt: run.attempt, signal: controller.signal };
  const renew = setInterval(() => {
    const now = deps.clock.now();
    deps.db.c.jobRuns
      .updateOne({ _id: run._id, leaseToken: run.leaseToken, state: 'running' }, { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS) } })
      .then((r) => {
        if (r.matchedCount !== 1) controller.abort(new LeaseLostError('Lease lost'));
      })
      .catch(() => controller.abort(new LeaseLostError('Lease renewal failed')));
  }, RENEW_EVERY_MS);

  try {
    await handler(deps, job);
    const after = await deps.db.c.jobRuns.findOne({ _id: run._id });
    if (after?.state === 'running' && after.leaseToken === run.leaseToken) {
      await deps.db.transact((tx) => completeJob(deps, tx, job));
    }
    return 'completed';
  } catch (e) {
    if (e instanceof LeaseLostError) return 'skipped';
    const message = e instanceof Error ? e.message.slice(0, 500) : 'Unknown error';
    if (e instanceof PermanentJobError) {
      await deps.db.c.jobRuns.updateOne({ _id: run._id, leaseToken: run.leaseToken }, { $set: { state: 'failed', lastError: message, completedAt: deps.clock.now() } });
      await markOutboxFailed(deps, outbox, message);
      return 'failed';
    }
    // Release the lease so the next delivery can claim immediately.
    await deps.db.c.jobRuns.updateOne(
      { _id: run._id, leaseToken: run.leaseToken },
      { $set: { leaseUntil: new Date(0), lastError: message } },
    );
    throw e instanceof RetryableJobError ? e : new RetryableJobError(message);
  } finally {
    clearInterval(renew);
  }
}

async function markOutboxFailed(deps: Deps, outbox: OutboxDoc, message: string) {
  await deps.db.c.outbox.updateOne({ _id: outbox._id }, { $set: { state: 'failed', lastError: message, completedAt: deps.clock.now() } });
}

// ---- Outbox dispatcher (DB side) -----------------------------------------------

/** Lease due outbox rows for enqueueing, including stale dispatches whose queue job may be lost. */
export async function leaseDueOutbox(deps: Deps, limit = 50): Promise<OutboxDoc[]> {
  const out: OutboxDoc[] = [];
  for (let i = 0; i < limit; i++) {
    const now = deps.clock.now();
    const row = await deps.db.c.outbox.findOneAndUpdate(
      {
        $or: [
          { state: 'pending', nextAttemptAt: { $lte: now } },
          { state: { $in: ['dispatching', 'dispatched'] }, leaseUntil: { $lt: now } },
        ],
      },
      { $set: { state: 'dispatching', leaseUntil: new Date(now.getTime() + 30_000) }, $inc: { dispatchAttempt: 1 } },
      { sort: { nextAttemptAt: 1 }, returnDocument: 'after' },
    );
    if (!row) break;
    if (row.dispatchAttempt > MAX_DISPATCH_ATTEMPTS) {
      await markOutboxFailed(deps, row, 'Dispatch attempts exhausted; operator retry required.');
      continue;
    }
    out.push(row);
  }
  return out;
}

/** After a successful enqueue: re-dispatch later only if the job never completes (e.g. Redis data loss). */
export async function markDispatched(deps: Deps, row: OutboxDoc) {
  const backoff = Math.min(2 ** row.dispatchAttempt * 30_000, 30 * 60_000);
  await deps.db.c.outbox.updateOne(
    { _id: row._id, state: 'dispatching' },
    { $set: { state: 'dispatched', leaseUntil: new Date(deps.clock.now().getTime() + backoff) } },
  );
}

export async function markDispatchFailed(deps: Deps, row: OutboxDoc, error: string) {
  const delay = Math.min(2 ** row.dispatchAttempt * 1000, 60_000) + Math.floor(Math.random() * 500);
  await deps.db.c.outbox.updateOne(
    { _id: row._id, state: 'dispatching' },
    { $set: { state: 'pending', leaseUntil: null, lastError: error.slice(0, 300), nextAttemptAt: new Date(deps.clock.now().getTime() + delay) } },
  );
}
