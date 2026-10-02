import { AppError, forbidden, notFound } from '@aic/contracts';
import { can, type Operation } from '@aic/domain';
import type { ActorContext } from '../context.js';
import type { Database, Tx } from '../db/mongo.js';
import type { ActionDoc, IncidentDoc } from '../db/types.js';

export function requireOp(ctx: ActorContext, op: Operation, message?: string): void {
  if (!can(ctx.roles, op)) throw forbidden(message);
}

export function requireVersion(expected: number | undefined): number {
  if (expected === undefined) {
    throw new AppError('PRECONDITION_REQUIRED', 'This change requires the version you reviewed (If-Match).');
  }
  return expected;
}

export function checkVersion(current: number, expected: number | undefined, what = 'item'): void {
  const v = requireVersion(expected);
  if (current !== v) {
    throw new AppError('VERSION_CONFLICT', `This ${what} changed. Refresh it before trying again.`, { currentVersion: current });
  }
}

export async function loadIncident(db: Database, workspaceId: string, id: string, tx?: Tx): Promise<IncidentDoc> {
  const doc = await db.c.incidents.findOne({ _id: id, workspaceId }, tx ? { session: tx } : {});
  if (!doc) throw notFound();
  return doc;
}

export async function loadAction(db: Database, workspaceId: string, id: string, tx?: Tx): Promise<ActionDoc> {
  const doc = await db.c.actions.findOne({ _id: id, workspaceId }, tx ? { session: tx } : {});
  if (!doc) throw notFound();
  return doc;
}

/** Compare-and-set update; a lost race surfaces as VERSION_CONFLICT. */
export async function casUpdate<T extends { _id: string; workspaceId: string; version: number }>(
  coll: import('mongodb').Collection<T>,
  tx: Tx,
  doc: T,
  set: Partial<T>,
  what = 'item',
): Promise<number> {
  const next = doc.version + 1;
  const res = await coll.updateOne(
    { _id: doc._id, workspaceId: doc.workspaceId, version: doc.version } as never,
    { $set: { ...set, version: next } } as never,
    { session: tx },
  );
  if (res.matchedCount !== 1) {
    throw new AppError('VERSION_CONFLICT', `This ${what} changed. Refresh it before trying again.`);
  }
  return next;
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const incidentRef = (n: number) => `INC-${String(n).padStart(4, '0')}`;
