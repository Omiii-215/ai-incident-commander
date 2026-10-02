import type { DashboardDTO } from '@aic/contracts';
import { can } from '@aic/domain';
import type { ActorContext } from '../context.js';
import type { Deps } from '../deps.js';
import type { WorkspaceEventDoc } from '../db/types.js';
import { requireOp } from './common.js';
import { servicesToDTO } from './catalog.js';
import { actionsToDTO, incidentsToDTO, timelineToDTO } from './mappers.js';

/**
 * Dashboard snapshot and stream watermark read in one snapshot transaction
 * (API_CONTRACTS.md §6) so the client can subscribe after exactly this point.
 */
export async function getDashboard(deps: Deps, ctx: ActorContext): Promise<{ data: DashboardDTO; snapshotStreamSeq: string; snapshotCursor: string }> {
  requireOp(ctx, 'read');
  const { db } = deps;
  const ws = ctx.workspaceId;
  const canSeeApprovals = can(ctx.roles, 'action.queue.read');
  return db.transact(async (tx) => {
    const s = { session: tx };
    const counter = await db.c.counters.findOne({ _id: ws }, s);
    // Sequential reads: operations on one transaction session must not run in parallel.
    const openSev1 = await db.c.incidents.countDocuments({ workspaceId: ws, active: true, severity: 'sev1' }, s);
    const openIncidents = await db.c.incidents.countDocuments({ workspaceId: ws, active: true }, s);
    const pendingApprovals = canSeeApprovals ? await db.c.actions.countDocuments({ workspaceId: ws, status: 'awaiting_approval' }, s) : null;
    const incidents = await db.c.incidents.find({ workspaceId: ws, active: true }, s).sort({ severity: 1, updatedAt: -1, _id: -1 }).limit(25).toArray();
    const services = await db.c.services.find({ workspaceId: ws }, s).sort({ name: 1 }).limit(50).toArray();
    const recent = await db.c.timeline.find({ workspaceId: ws }, s).sort({ streamSeq: -1 }).limit(10).toArray();
    const pending = canSeeApprovals
      ? await db.c.actions.find({ workspaceId: ws, status: 'awaiting_approval' }, s).sort({ expiresAt: 1 }).limit(5).toArray()
      : null;
    const workspace = await db.c.workspaces.findOne({ _id: ws }, s);
    const serviceDTOs = await servicesToDTO(deps, ws, services);
    const seq = counter?.nextSeq ?? 0;
    return {
      data: {
        metrics: {
          openSev1,
          openIncidents,
          pendingApprovals,
          unknownServices: serviceDTOs.filter((x) => x.health.some((h) => h.status === 'unknown')).length,
        },
        activeIncidents: await incidentsToDTO(db, ws, incidents, ctx),
        pendingApprovals: pending ? await actionsToDTO(db, ws, pending, ctx) : null,
        services: serviceDTOs,
        recentActivity: await timelineToDTO(db, ws, recent),
        dispatchStopped: workspace?.dispatchStopped ?? false,
        generatedAt: deps.clock.now().toISOString(),
      },
      snapshotStreamSeq: String(seq),
      snapshotCursor: deps.cursors.encodeStream(ws, seq),
    };
  });
}

export type StreamRead =
  | { kind: 'events'; events: WorkspaceEventDoc[] }
  | { kind: 'resync'; reason: 'cursor_ahead' | 'cursor_expired' };

/** Read retained invalidations after `afterSeq`; detect gaps that require a snapshot resync. */
export async function readStream(deps: Deps, workspaceId: string, afterSeq: number, limit = 200): Promise<StreamRead> {
  const counter = await deps.db.c.counters.findOne({ _id: workspaceId });
  const head = counter?.nextSeq ?? 0;
  if (afterSeq > head) return { kind: 'resync', reason: 'cursor_ahead' };
  if (afterSeq === head) return { kind: 'events', events: [] };
  const events = await deps.db.c.workspaceEvents
    .find({ workspaceId, streamSeq: { $gt: afterSeq } })
    .sort({ streamSeq: 1 })
    .limit(limit)
    .toArray();
  // Sequences are dense; a missing next value means it expired out of retention.
  const first = events[0];
  if (!first || first.streamSeq !== afterSeq + 1) {
    // Allow an in-flight transaction that allocated but has not yet committed: only
    // treat as expired when the oldest retained event is already beyond the gap.
    const oldest = await deps.db.c.workspaceEvents.find({ workspaceId }).sort({ streamSeq: 1 }).limit(1).next();
    if (oldest && oldest.streamSeq > afterSeq + 1) return { kind: 'resync', reason: 'cursor_expired' };
    if (!oldest && head > afterSeq) return { kind: 'resync', reason: 'cursor_expired' };
    return { kind: 'events', events: [] };
  }
  // Stop at the first gap so a later-committed lower sequence is never skipped.
  const contiguous: WorkspaceEventDoc[] = [];
  let expect = afterSeq + 1;
  for (const e of events) {
    if (e.streamSeq !== expect) break;
    contiguous.push(e);
    expect++;
  }
  return { kind: 'events', events: contiguous };
}
