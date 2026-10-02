import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUEUE_BY_KIND, type OutboxKind } from '@aic/contracts';
import {
  createDeps,
  expireActions,
  HANDLERS,
  leaseDueOutbox,
  loadConfig,
  markDispatched,
  markDispatchFailed,
  processOutbox,
  ROLE_KINDS,
  RetryableJobError,
  toPayload,
  type JobHandler,
  type JobPayload,
} from '@aic/core';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';

// Worker process (ADR-001/003). The dispatcher moves durable outbox intent into
// BullMQ using the outbox ID as job ID; consumers dedupe through job_runs.
// WORKER_ROLE separates the investigator and the restricted executor.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const log = pino({ name: 'worker' });

async function main() {
  const config = loadConfig();
  const deps = await createDeps(config, ROOT);
  const role = config.WORKER_ROLE;
  const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, enableOfflineQueue: false, lazyConnect: false });
  connection.on('error', (e) => log.warn({ err: e.message }, 'redis connection error'));

  const queueNames = [...new Set(Object.values(QUEUE_BY_KIND))];
  const queues = new Map(queueNames.map((n) => [n, new Queue<JobPayload>(n, { connection })]));
  const stops: Array<() => Promise<void> | void> = [];

  // ---- Dispatcher ----
  if (role === 'all' || role === 'dispatcher') {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const rows = await leaseDueOutbox(deps, 50);
        for (const row of rows) {
          try {
            const queue = queues.get(QUEUE_BY_KIND[row.kind])!;
            await queue.add(row.kind, toPayload(row), {
              jobId: row._id, // duplicate enqueue of the same intent is a no-op while the job exists
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
              removeOnComplete: true,
              removeOnFail: true,
            });
            await markDispatched(deps, row);
          } catch (e) {
            await markDispatchFailed(deps, row, (e as Error).message);
            log.warn({ outboxId: row._id, kind: row.kind, err: (e as Error).message }, 'enqueue failed; intent remains durable');
          }
        }
        const expired = await expireActions(deps);
        if (expired) log.info({ expired }, 'expired action requests');
      } catch (e) {
        log.error({ err: (e as Error).message }, 'dispatcher tick failed');
      } finally {
        running = false;
      }
    };
    const timer = setInterval(tick, 500);
    stops.push(() => clearInterval(timer));
    log.info('dispatcher started');
  }

  // ---- Consumers ----
  const kinds: OutboxKind[] =
    role === 'all' ? (Object.keys(HANDLERS) as OutboxKind[]) : role === 'investigator' ? [...ROLE_KINDS.investigator] : role === 'executor' ? [...ROLE_KINDS.executor] : [];
  const handlers: Partial<Record<OutboxKind, JobHandler>> = Object.fromEntries(kinds.map((k) => [k, HANDLERS[k]]));
  const consumerQueues = [...new Set(kinds.map((k) => QUEUE_BY_KIND[k]))];
  for (const name of consumerQueues) {
    const concurrency = name === 'actions' ? 2 : name === 'investigations' ? 4 : 2;
    const worker = new Worker<JobPayload>(
      name,
      async (job) => {
        const p = job.data;
        if (p.schemaVersion !== 1) throw new Error('Unsupported job schema'); // visible failure
        const started = Date.now();
        const result = await processOutbox(deps, p.outboxId, handlers);
        log.info({ queue: name, kind: p.kind, outboxId: p.outboxId, workspaceId: p.workspaceId, result, ms: Date.now() - started }, 'job processed');
      },
      { connection: connection.duplicate(), concurrency },
    );
    worker.on('failed', (job, err) => {
      log.warn({ queue: name, outboxId: job?.data.outboxId, retryable: err instanceof RetryableJobError, err: err.message }, 'job attempt failed');
    });
    stops.push(() => worker.close());
  }
  log.info({ role, queues: consumerQueues, ai: deps.provider.profile }, 'worker started');

  const shutdown = async (signal: string) => {
    // Stop claiming; in-flight jobs finish or their lease expires for another worker to reconcile.
    log.info({ signal }, 'worker shutting down');
    for (const s of stops) await s();
    await Promise.all([...queues.values()].map((q) => q.close()));
    connection.disconnect();
    await deps.db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  log.fatal({ err: (e as Error).message }, 'worker failed to start');
  process.exit(1);
});
