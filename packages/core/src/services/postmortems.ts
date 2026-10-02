import { AppError, type PostmortemDTO } from '@aic/contracts';
import { uuid, userActor, type ActorContext } from '../context.js';
import type { Deps } from '../deps.js';
import { record } from '../db/event-writer.js';
import { runCommand } from '../db/idempotency.js';
import type { PostmortemDoc } from '../db/types.js';
import { checkVersion, loadIncident, requireOp } from './common.js';

type Meta = { idempotencyKey: string; expectedVersion?: number | undefined };

const toDTO = (d: PostmortemDoc): PostmortemDTO => ({
  id: d._id,
  incidentId: d.incidentId,
  state: d.state,
  markdown: d.markdown,
  createdAt: d.createdAt.toISOString(),
});

export async function requestPostmortem(deps: Deps, ctx: ActorContext, incidentId: string, meta: Meta) {
  requireOp(ctx, 'postmortem.request');
  return runCommand(deps.db, deps.clock, ctx, { operation: `postmortem:${incidentId}`, key: meta.idempotencyKey, payload: {}, expectedVersion: meta.expectedVersion }, async (tx) => {
    const incident = await loadIncident(deps.db, ctx.workspaceId, incidentId, tx);
    checkVersion(incident.version, meta.expectedVersion, 'incident');
    const pending = await deps.db.c.postmortems.findOne({ workspaceId: ctx.workspaceId, incidentId, state: 'generating' }, { session: tx });
    if (pending) return { status: 202, body: toDTO(pending) };
    const now = deps.clock.now();
    const doc: PostmortemDoc = { _id: uuid(), workspaceId: ctx.workspaceId, incidentId, requestedBy: ctx.subjectId, state: 'generating', markdown: null, createdAt: now, updatedAt: now };
    await deps.db.c.postmortems.insertOne(doc, { session: tx });
    await record(deps.db, tx, {
      workspaceId: ctx.workspaceId,
      actor: userActor(ctx),
      requestId: ctx.requestId,
      now,
      events: [{ type: 'postmortem.requested', entityType: 'postmortem', entityId: doc._id, entityVersion: 1, reason: 'generating', timeline: { incidentId, summary: 'Postmortem draft requested.' } }],
      audit: [{ operation: 'postmortem.request', resource: { type: 'postmortem', id: doc._id } }],
      outbox: [{ kind: 'postmortem.generate', aggregateId: doc._id, payloadRefs: { incidentId } }],
    });
    return { status: 202, body: toDTO(doc) };
  });
}

export async function latestPostmortem(deps: Deps, ctx: ActorContext, incidentId: string): Promise<PostmortemDTO | null> {
  requireOp(ctx, 'read');
  await loadIncident(deps.db, ctx.workspaceId, incidentId);
  const doc = await deps.db.c.postmortems.find({ workspaceId: ctx.workspaceId, incidentId }).sort({ createdAt: -1 }).limit(1).next();
  return doc ? toDTO(doc) : null;
}

/** Worker: build a draft that separates human-confirmed facts from AI hypotheses and unknowns. */
export async function generatePostmortemMarkdown(deps: Deps, workspaceId: string, incidentId: string): Promise<string> {
  const { db } = deps;
  const incident = await db.c.incidents.findOne({ _id: incidentId, workspaceId });
  if (!incident) throw new AppError('NOT_FOUND', 'Incident unavailable.');
  const service = await db.c.services.findOne({ _id: incident.serviceId, workspaceId });
  const timeline = await db.c.timeline.find({ workspaceId, incidentId }).sort({ streamSeq: 1 }).limit(500).toArray();
  const diagnosis = incident.latestDiagnosisId ? await db.c.diagnoses.findOne({ _id: incident.latestDiagnosisId, workspaceId }) : null;
  const actions = await db.c.actions.find({ workspaceId, incidentId }).sort({ createdAt: 1 }).toArray();
  const executions = await db.c.executions.find({ workspaceId, actionId: { $in: actions.map((a) => a._id) } }).toArray();
  const evidence = await db.c.evidence.find({ workspaceId, incidentId }).sort({ collectedAt: 1 }).limit(100).toArray();
  const users = await db.c.users.find({ _id: { $in: [...new Set(timeline.map((t) => t.actor.id))] } }).toArray();
  const name = (id: string) => users.find((u) => u._id === id)?.displayName ?? id;
  const ts = (d: Date) => d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  const dur = (a: Date, b: Date | null) => {
    if (!b) return 'n/a';
    const m = Math.round((b.getTime() - a.getTime()) / 60000);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  };

  const lines: string[] = [];
  lines.push(`# Postmortem draft: ${incident.title}`, '');
  lines.push('> Draft generated from durable incident records. Review and edit before sharing. Hypotheses are not confirmed causes.', '');
  lines.push('## Summary', '');
  lines.push(`- **Service:** ${service?.name ?? 'Unknown'} (${incident.environment})`);
  lines.push(`- **Severity:** ${incident.severity.toUpperCase()}`);
  lines.push(`- **Status:** ${incident.status}`);
  lines.push(`- **Declared:** ${ts(incident.openedAt)}`);
  lines.push(`- **Acknowledged:** ${incident.acknowledgedAt ? ts(incident.acknowledgedAt) : 'not acknowledged'} (time to acknowledge: ${dur(incident.openedAt, incident.acknowledgedAt)})`);
  lines.push(`- **Resolved:** ${incident.resolvedAt ? ts(incident.resolvedAt) : 'not resolved'} (time to resolve: ${dur(incident.openedAt, incident.resolvedAt)})`);
  lines.push(`- **Alert occurrences:** ${incident.occurrenceCount}`, '');

  lines.push('## Confirmed by responders', '');
  const executed = actions.filter((a) => a.status === 'succeeded' || a.status === 'failed');
  if (!executed.length) lines.push('- No remediation action reached a conclusive outcome.');
  for (const a of executed) {
    const e = executions.find((x) => x.actionId === a._id);
    lines.push(`- Action \`${a.spec.toolId}\` on ${a.spec.target.environment} ${a.status}${a.spec.simulation ? ' (simulation)' : ''}; receipt \`${String(e?.receipt?.providerRequestId ?? 'n/a')}\`; spec \`${a.specHash.slice(0, 19)}…\`.`);
  }
  const resolution = [...timeline].reverse().find((t) => t.eventType === 'incident.transitioned' && t.summary.includes('→ resolved'));
  if (resolution) lines.push(`- Recovery confirmed by ${name(resolution.actor.id)}: ${resolution.summary}`);
  lines.push('');

  lines.push('## AI-assisted analysis (unconfirmed)', '');
  if (!diagnosis) lines.push('- No structured diagnosis was produced.');
  else {
    lines.push(`_${diagnosis.output.summary}_ (model profile \`${diagnosis.modelMetadata.providerProfile}\`)`, '');
    for (const h of diagnosis.output.hypotheses) {
      lines.push(`- **${h.strength}** — ${h.statement} (supporting evidence: ${h.support.length}, contradicting: ${h.contradictions.length})`);
    }
  }
  lines.push('');
  lines.push('## Remaining uncertainty', '');
  const missing = diagnosis?.output.missingEvidence ?? [];
  if (!missing.length) lines.push('- None recorded. Confirm with the team before publishing.');
  for (const m of missing) lines.push(`- ${m}`);
  const unknown = actions.filter((a) => a.status === 'outcome_unknown');
  for (const a of unknown) lines.push(`- Action \`${a.spec.toolId}\` outcome is still unknown pending reconciliation.`);
  lines.push('');

  lines.push('## Timeline (UTC)', '');
  for (const t of timeline) lines.push(`- ${ts(t.createdAt)} — ${name(t.actor.id)}: ${t.summary.replace(/\n/g, ' ')}`);
  lines.push('');
  lines.push('## Evidence references', '');
  for (const e of evidence) {
    lines.push(`- \`${e._id}\` ${e.title} — collected ${ts(e.collectedAt)}${e.expiresAt <= deps.clock.now() ? ' (source artifact expired)' : ''}`);
  }
  lines.push('', '## Follow-up actions', '', '- [ ] Owner to add corrective actions after review.');
  return lines.join('\n');
}
