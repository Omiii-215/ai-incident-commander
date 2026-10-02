import { AppError } from '@aic/contracts';
import { hashCanonical } from '@aic/domain';
import type { ActorContext, Clock } from '../context.js';
import { RETENTION } from './migrations.js';
import { isDuplicateKey, type Database, type Tx } from './mongo.js';

// Command idempotency (LLD.md §4 steps 2–7). Keys are scoped by workspace,
// subject and operation. Same key + same canonical payload → saved response;
// changed payload → IDEMPOTENCY_CONFLICT.

export type CommandResult<T> = { status: number; body: T };

export type CommandInput = {
  operation: string; // route template including path IDs, e.g. "POST /incidents/{id}/transitions:<id>"
  key: string;
  payload: unknown;
  expectedVersion?: number | undefined;
};

export async function runCommand<T>(
  db: Database,
  clock: Clock,
  ctx: ActorContext,
  input: CommandInput,
  fn: (tx: Tx) => Promise<CommandResult<T>>,
): Promise<CommandResult<T> & { replayed: boolean }> {
  const requestHash = hashCanonical({
    workspaceId: ctx.workspaceId,
    subjectId: ctx.subjectId,
    operation: input.operation,
    payload: input.payload ?? null,
    expectedVersion: input.expectedVersion ?? null,
  });
  const filter = { workspaceId: ctx.workspaceId, subjectId: ctx.subjectId, operation: input.operation, key: input.key };

  const readSaved = async (tx?: Tx) => {
    const saved = await db.c.idempotency.findOne(filter, tx ? { session: tx } : {});
    if (!saved) return null;
    if (saved.requestHash !== requestHash) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'This request key was already used for a different command.');
    }
    return { status: saved.responseStatus, body: saved.responseBody as T, replayed: true };
  };

  try {
    return await db.transact(async (tx) => {
      const saved = await readSaved(tx);
      if (saved) return saved;
      const result = await fn(tx);
      const now = clock.now();
      await db.c.idempotency.insertOne(
        {
          _id: `${ctx.workspaceId}:${ctx.subjectId}:${input.operation}:${input.key}`,
          ...filter,
          requestHash,
          responseStatus: result.status,
          responseBody: result.body,
          expiresAt: new Date(now.getTime() + RETENTION.idempotencySeconds * 1000),
          createdAt: now,
        },
        { session: tx },
      );
      return { ...result, replayed: false };
    });
  } catch (e) {
    // A concurrent request with the same key committed first: return its result.
    if (isDuplicateKey(e)) {
      const saved = await readSaved();
      if (saved) return saved;
    }
    throw e;
  }
}
