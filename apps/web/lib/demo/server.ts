// Browser-only demo backend for the public showcase. It serves a snapshot of the
// real API (recorded by scripts/demo-capture.ts) and simulates commands using the
// SAME domain rules as the server (@aic/domain): permissions, lifecycle,
// approval binding and dispatch checks. Nothing leaves the browser.
import {
  AppError,
  type ActionDTO,
  type ActionSpec,
  type AuditEventDTO,
  type DashboardDTO,
  type DiagnosisDTO,
  type EvidenceDTO,
  type IncidentDTO,
  type IncidentStatus,
  type InstallationDTO,
  type InvestigationDTO,
  type MeDTO,
  type PluginCatalogDTO,
  type PostmortemDTO,
  type Role,
  type RunbookDTO,
  type ServiceDTO,
  type StreamInvalidation,
  type TimelineEntryDTO,
} from '@aic/contracts';
import {
  allowedTransitions,
  applyAcknowledge,
  applyTransition,
  APPROVAL_WINDOW_MS,
  can,
  capabilitiesFor,
  checkApprovable,
  computeSpecHash,
  dispatchDenial,
  PRE_DISPATCH_STATUSES,
  type Operation,
} from '@aic/domain';
import fixtureJson from './fixture.json';

// ---------------------------------------------------------------- types
type IncDetail = {
  incident: IncidentDTO;
  timeline: TimelineEntryDTO[];
  evidence: EvidenceDTO[];
  diagnosis: DiagnosisDTO | null;
  investigation: InvestigationDTO | null;
  postmortem: PostmortemDTO | null;
};
type WsData = {
  incidents: Record<string, IncDetail>;
  actions: ActionDTO[];
  services: ServiceDTO[];
  runbooks: RunbookDTO[];
  audit: AuditEventDTO[];
  pluginCatalog: PluginCatalogDTO[];
  installations: InstallationDTO[];
};
type DevUser = { id: string; displayName: string; memberships: Array<{ workspace: string; roles: Role[] }> };
type Chunk = { workspaceId: string; runbookId: string; runbookTitle: string; versionId: string; revision: number; chunkId: string; heading: string; text: string };
type Target = { workspaceId: string; serviceId: string; environment: string; revision: number; deployedVersion: string; previousVersion: string | null; faultMode: string };
type Fixture = {
  capturedAt: string;
  workspaces: Array<{ id: string; name: string; slug: string }>;
  devUsers: DevUser[];
  data: Record<string, WsData>;
  chunks: Chunk[];
  targets: Target[];
  reserved: { incidents: string[]; actions: string[] };
};
type State = {
  v: 1;
  userId: string | null;
  seq: number;
  ws: Record<string, WsData & { dispatchStopped: boolean; nextNumber: number }>;
  chunks: Chunk[];
  targets: Target[];
  used: { incidents: number; actions: number; misc: number };
  lineage: Record<string, string[]>;
  idem: Record<string, { status: number; body: unknown }>;
  runbookText: Record<string, string>;
};

const FIX = fixtureJson as unknown as Fixture;
const KEY = 'aic-demo-state-v1';
const now = () => new Date();
const iso = () => new Date().toISOString();
const SERVICE_NAMES: Record<string, string> = {
  'svc-ingestion': 'Ingestion service',
  'svc-investigator': 'Investigator service',
  'svc-executor': 'Executor service',
  'svc-reconciler': 'Reconciler service',
  'svc-scheduler': 'Scheduler service',
  'svc-reporter': 'Reporter service',
  'svc-knowledge': 'Knowledge service',
};

// ---------------------------------------------------------------- state
function shiftDates<T>(value: T, offsetMs: number): T {
  const re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string' && re.test(v)) return new Date(Date.parse(v) + offsetMs).toISOString();
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

function fresh(): State {
  // Re-anchor the snapshot so "just now" in the recording means "just now" for the visitor.
  const data = shiftDates(FIX.data, Date.now() - Date.parse(FIX.capturedAt));
  const ws: State['ws'] = {};
  for (const w of FIX.workspaces) {
    const d = data[w.id]!;
    // Re-anchoring changed each recorded request's expiry, so re-issue its fingerprint.
    for (const a of d.actions) a.specHash = computeSpecHash(a.spec);
    const max = Math.max(0, ...Object.values(d.incidents).map((x) => Number(x.incident.reference.replace(/\D/g, ''))));
    ws[w.id] = { ...d, dispatchStopped: false, nextNumber: max + 1 };
  }
  const seq = Math.max(0, ...Object.values(data).flatMap((d) => Object.values(d.incidents).flatMap((x) => x.timeline.map((t) => Number(t.streamSeq)))));
  return { v: 1, userId: null, seq, ws, chunks: FIX.chunks, targets: FIX.targets, used: { incidents: 0, actions: 0, misc: 0 }, lineage: {}, idem: {}, runbookText: {} };
}

let S: State = load();
function load(): State {
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as State;
      if (parsed.v === 1) return parsed;
    }
  } catch {
    /* storage unavailable: start fresh */
  }
  return fresh();
}
function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(S));
  } catch {
    /* ignore */
  }
}
export function resetDemo() {
  S = fresh();
  save();
}

// ---------------------------------------------------------------- live stream
type Listener = (e: StreamInvalidation & { cursor: string }) => void;
const listeners = new Map<string, Set<Listener>>();
function emit(wsId: string, entityType: string, entityId: string, entityVersion: number, reason: string) {
  S.seq++;
  const ev = { entityType, entityId, entityVersion, reason, streamSeq: String(S.seq), cursor: `demo:${S.seq}` };
  save();
  listeners.get(wsId)?.forEach((l) => l(ev));
}

/** EventSource look-alike fed by the in-browser backend. */
export class DemoEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private readonly listener: Listener;
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  constructor(private readonly workspaceId: string) {
    super();
    this.listener = (e) => this.dispatchEvent(new MessageEvent('entity_changed', { data: JSON.stringify(e), lastEventId: e.cursor }));
    if (!listeners.has(workspaceId)) listeners.set(workspaceId, new Set());
    listeners.get(workspaceId)!.add(this.listener);
    this.timers.push(setTimeout(() => {
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    }, 60));
    this.timers.push(setInterval(() => this.dispatchEvent(new MessageEvent('heartbeat', { data: JSON.stringify({ at: iso() }) })), 15_000));
  }
  close() {
    this.readyState = 2;
    listeners.get(this.workspaceId)?.delete(this.listener);
    this.timers.forEach((t) => clearInterval(t));
  }
}

// ---------------------------------------------------------------- helpers
const users = () => FIX.devUsers;
const nameOf = (id: string) => users().find((u) => u.id === id)?.displayName ?? SERVICE_NAMES[id] ?? 'Former member';
const wsByName = (name: string) => FIX.workspaces.find((w) => w.name === name);
function rolesIn(userId: string, wsId: string): Role[] | null {
  const u = users().find((x) => x.id === userId);
  const w = FIX.workspaces.find((x) => x.id === wsId);
  return u?.memberships.find((m) => m.workspace === w?.name)?.roles ?? null;
}
function me(userId: string): MeDTO {
  const u = users().find((x) => x.id === userId)!;
  return {
    user: { id: u.id, displayName: u.displayName },
    workspaces: u.memberships.flatMap((m) => {
      const w = wsByName(m.workspace);
      return w ? [{ id: w.id, name: w.name, slug: w.slug, roles: m.roles, capabilities: capabilitiesFor(m.roles), dispatchStopped: S.ws[w.id]!.dispatchStopped }] : [];
    }),
    csrfToken: 'demo',
  };
}
type Ctx = { userId: string; roles: Role[]; ws: State['ws'][string]; wsId: string };
function ctxFor(wsId: string): Ctx {
  if (!S.userId) throw new AppError('SESSION_EXPIRED', 'Your session expired. Sign in again.');
  const roles = rolesIn(S.userId, wsId);
  if (!roles || !S.ws[wsId]) throw new AppError('NOT_FOUND', 'This item is unavailable.');
  return { userId: S.userId, roles, ws: S.ws[wsId]!, wsId };
}
function need(c: Ctx, op: Operation, message?: string) {
  if (!can(c.roles, op)) throw new AppError('FORBIDDEN', message ?? 'You do not have permission for this operation.');
}
function checkVersion(current: number, ifMatch: string | null, what = 'item') {
  if (!ifMatch) throw new AppError('PRECONDITION_REQUIRED', 'This change requires the version you reviewed (If-Match).');
  const v = Number(ifMatch.replace(/\D/g, ''));
  if (v !== current) throw new AppError('VERSION_CONFLICT', `This ${what} changed. Refresh it before trying again.`, { currentVersion: current });
}
function incidentOf(c: Ctx, id: string): IncDetail {
  const d = c.ws.incidents[id];
  if (!d) throw new AppError('NOT_FOUND', 'This item is unavailable.');
  return d;
}
function actionOf(c: Ctx, id: string): ActionDTO {
  const a = c.ws.actions.find((x) => x.id === id);
  if (!a) throw new AppError('NOT_FOUND', 'This item is unavailable.');
  return a;
}
const INCIDENT_CAPS = ['incident.acknowledge', 'incident.update', 'incident.transition', 'incident.comment', 'investigation.request', 'action.propose', 'postmortem.request'];
const ACTION_CAPS = ['action.decide', 'action.cancel', 'action.renew'];
const viewIncident = (i: IncidentDTO, roles: Role[]): IncidentDTO => ({
  ...i,
  allowedTransitions: i.status === 'declared' ? [] : [...allowedTransitions(i.status)],
  capabilities: capabilitiesFor(roles).filter((x) => INCIDENT_CAPS.includes(x)),
});
const viewAction = (a: ActionDTO, roles: Role[]): ActionDTO => ({ ...a, capabilities: capabilitiesFor(roles).filter((x) => ACTION_CAPS.includes(x)) });
const nextId = (kind: 'incidents' | 'actions') => {
  const id = FIX.reserved[kind][S.used[kind]];
  if (!id) throw new AppError('CAPACITY_EXCEEDED', 'The demo has reached its limit. Use "Reset demo" to start over.');
  S.used[kind]++;
  return id;
};
const miscId = () => `demo-${++S.used.misc}-${Math.random().toString(36).slice(2, 8)}`;

function timeline(c: { ws: State['ws'][string] }, incidentId: string, eventType: string, actorId: string, summary: string, refs: Array<{ type: string; id: string }> = []) {
  S.seq++;
  c.ws.incidents[incidentId]?.timeline.push({
    id: miscId(),
    incidentId,
    streamSeq: String(S.seq),
    eventType,
    actor: { type: actorId.startsWith('svc-') ? 'service' : 'user', id: actorId, name: nameOf(actorId) },
    summary,
    refs,
    createdAt: iso(),
  });
}
function audit(c: { ws: State['ws'][string] }, actorId: string, operation: string, resource: { type: string; id: string }, extra: Partial<AuditEventDTO> = {}) {
  c.ws.audit.unshift({
    id: miscId(),
    createdAt: iso(),
    actor: { type: actorId.startsWith('svc-') ? 'service' : 'user', id: actorId, name: nameOf(actorId) },
    operation,
    resource,
    decision: 'allowed',
    reasonCode: null,
    requestId: `demo-${Math.random().toString(36).slice(2, 10)}`,
    specHash: null,
    beforeVersion: null,
    afterVersion: null,
    ...extra,
  });
}
function bump(i: IncidentDTO, patch: Partial<IncidentDTO>) {
  Object.assign(i, patch, { version: i.version + 1, updatedAt: iso() });
}
const stateOf = (i: IncidentDTO) => ({
  status: i.status,
  active: i.status !== 'resolved',
  generation: i.generation,
  remediationRevision: i.remediationRevision,
  ownerId: i.ownerId,
  acknowledgedAt: i.acknowledgedAt ? new Date(i.acknowledgedAt) : null,
  resolvedAt: i.resolvedAt ? new Date(i.resolvedAt) : null,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const later = (ms: number, fn: () => void) => setTimeout(() => {
  fn();
  save();
}, ms);

// ---------------------------------------------------------------- reviewed action tools (same texts as the server catalog)
const TOOLS: Record<string, { label: string; valid: (a: Record<string, unknown>) => boolean; describe: (a: Record<string, unknown>, service: string, env: string) => Pick<ActionSpec, 'expectedEffect' | 'riskSummary' | 'verification'> }> = {
  'simulator.rollback_deployment': {
    label: 'Roll back deployment',
    valid: (a) => Object.keys(a).length === 1 && typeof a.toVersion === 'string' && /^v?\d+\.\d+\.\d+$/.test(a.toVersion),
    describe: (a, s, e) => ({
      expectedEffect: `Simulated deployment of ${s} in ${e} returns to ${String(a.toVersion)}; error rate should fall below 1% within 5 minutes.`,
      riskSummary: 'Simulation only. Rollback reverts the latest release; features shipped in that release become unavailable.',
      verification: { metric: 'error_rate', operator: 'lt', value: 0.01, windowSeconds: 300 },
    }),
  },
  'simulator.restart_service': {
    label: 'Restart service',
    valid: (a) => Object.keys(a).length === 1 && (a.strategy === 'rolling' || a.strategy === 'all-at-once'),
    describe: (a, s, e) => ({
      expectedEffect: `Simulated ${String(a.strategy)} restart of ${s} in ${e}; transient errors should clear if caused by process state.`,
      riskSummary: a.strategy === 'all-at-once' ? 'Simulation only. All-at-once restart briefly drops all capacity.' : 'Simulation only. Rolling restart briefly reduces capacity.',
      verification: { metric: 'error_rate', operator: 'lt', value: 0.01, windowSeconds: 300 },
    }),
  },
};
const targetOf = (wsId: string, serviceId: string, environment: string) => S.targets.find((t) => t.workspaceId === wsId && t.serviceId === serviceId && t.environment === environment);
function simulatorPermits(c: Ctx, serviceId: string, environment: string) {
  const inst = c.ws.installations.find((x) => x.pluginId === 'core.simulator');
  if (!inst) return { ok: true, id: 'demo-simulator' }; // installation not captured for this workspace
  const ok = inst.status === 'enabled' && inst.grants.includes('simulations:execute') && inst.allowedServiceIds.includes(serviceId) && inst.allowedEnvironments.includes(environment);
  return { ok, id: inst.id };
}

// ---------------------------------------------------------------- execution simulation
function scheduleExecution(wsId: string, actionId: string) {
  const c = { ws: S.ws[wsId]!, wsId };
  const a = () => c.ws.actions.find((x) => x.id === actionId)!;
  const setStatus = (status: ActionDTO['status'], reason: string | null) => {
    const act = a();
    Object.assign(act, { status, statusReason: reason, version: act.version + 1, updatedAt: iso() });
    emit(wsId, 'action', act.id, act.version, status);
    emit(wsId, 'incident', act.incidentId, c.ws.incidents[act.incidentId]!.incident.version, 'action_changed');
  };
  later(1400, () => {
    const act = a();
    if (act.status !== 'queued') return;
    const inc = c.ws.incidents[act.incidentId]!.incident;
    const tgt = targetOf(wsId, act.spec.target.serviceId, act.spec.target.environment);
    const approverId = act.decision?.decidedBy.id ?? '';
    const denial = dispatchDenial({
      spec: act.spec,
      specHash: act.specHash,
      now: now(),
      incident: { generation: inc.generation, remediationRevision: inc.remediationRevision, active: inc.status !== 'resolved' },
      approverIsActiveCommander: (rolesIn(approverId, wsId) ?? []).includes('commander'),
      requesterIsActiveMember: !!rolesIn(act.requestedBy.id, wsId),
      installationPermits: simulatorPermits({ ...c, userId: '', roles: [] } as Ctx, act.spec.target.serviceId, act.spec.target.environment).ok,
      dispatchStopped: c.ws.dispatchStopped,
      currentTargetRevision: tgt ? `rev-${tgt.revision}` : act.spec.target.revision,
    });
    if (denial) {
      setStatus(denial === 'EXPIRED' ? 'expired' : 'cancelled', `Dispatch denied: ${denial}`);
      timeline(c, act.incidentId, 'action.cancelled', 'svc-executor', `Dispatch blocked by policy recheck (${denial.replaceAll('_', ' ').toLowerCase()}). No change was made.`, [{ type: 'action', id: act.id }]);
      audit(c, 'svc-executor', 'action.dispatch', { type: 'action', id: act.id }, { reasonCode: denial, specHash: act.specHash });
      return;
    }
    act.execution = { executionKey: `exec-${act.id}`, status: 'dispatching', dispatchAt: iso(), receipt: null, reconciliationState: 'not_required' };
    setStatus('executing', null);
    timeline(c, act.incidentId, 'action.dispatched', 'svc-executor', 'Simulated action dispatched with a stable execution key.', [{ type: 'action', id: act.id }]);
    audit(c, 'svc-executor', 'action.dispatch', { type: 'action', id: act.id }, { specHash: act.specHash });
    const succeed = (reconciled: boolean) => {
      const x = a();
      const t = targetOf(wsId, x.spec.target.serviceId, x.spec.target.environment);
      if (t) {
        t.revision++;
        if (x.spec.toolId === 'simulator.rollback_deployment') {
          t.previousVersion = t.deployedVersion;
          t.deployedVersion = String(x.spec.arguments.toVersion);
        }
      }
      const detail = x.spec.toolId === 'simulator.rollback_deployment' ? `Rolled back to ${String(x.spec.arguments.toVersion)}.` : `Restarted (${String(x.spec.arguments.strategy)}).`;
      x.execution = { ...x.execution!, status: 'succeeded', receipt: { outcome: 'succeeded', providerRequestId: `sim-exec-${x.id}`, executionKey: `exec-${x.id}`, detail, newRevision: t?.revision ?? null }, reconciliationState: reconciled ? 'confirmed_applied' : 'not_required' };
      setStatus('succeeded', null);
      const ev = c.ws.incidents[x.incidentId]!;
      ev.evidence.unshift({
        id: miscId(), incidentId: x.incidentId, runId: null, sourceType: 'execution', sourceId: `execution:exec-${x.id}`, sourceVersion: t ? `rev-${t.revision}` : null,
        title: 'Simulated action receipt and recovery observation', collectedAt: iso(), observedFrom: iso(), observedTo: iso(), completeness: 'complete',
        redactedExcerpt: `Receipt sim-exec-${x.id}: ${detail}\nPost-action sample: error_rate=0.0040 latency_p95_ms=180\nVerification target: error_rate lt 0.01 over 300s.`,
        redactionCount: 0, truncated: false, suspectedInjection: false, checksum: 'sha256:demo', expired: false,
      });
      timeline(c, x.incidentId, 'action.completed', reconciled ? 'svc-reconciler' : 'svc-executor', `Simulated action succeeded: ${detail} Verify recovery before resolving.`, [{ type: 'action', id: x.id }]);
      audit(c, reconciled ? 'svc-reconciler' : 'svc-executor', 'action.succeeded', { type: 'action', id: x.id }, { specHash: x.specHash });
    };
    later(2600, () => {
      const x = a();
      if (x.status !== 'executing') return;
      const fault = tgt?.faultMode ?? 'none';
      if (fault === 'fail') {
        x.execution = { ...x.execution!, status: 'failed', receipt: { outcome: 'failed', detail: 'Simulated provider rejected the operation.' } };
        setStatus('failed', 'Simulated provider rejected the operation.');
        timeline(c, x.incidentId, 'action.completed', 'svc-executor', 'Simulated action failed: the provider rejected the operation.', [{ type: 'action', id: x.id }]);
        return;
      }
      if (fault.startsWith('timeout')) {
        x.execution = { ...x.execution!, status: 'outcome_unknown', reconciliationState: 'pending' };
        setStatus('outcome_unknown', 'No conclusive receipt before the deadline.');
        timeline(c, x.incidentId, 'action.outcome_unknown', 'svc-executor', 'Execution outcome is unknown. Reconciliation is in progress.', [{ type: 'action', id: x.id }]);
        later(3200, () => a().status === 'outcome_unknown' && succeed(true));
        return;
      }
      succeed(false);
    });
  });
}

function expireDue() {
  let changed = false;
  for (const [wsId, w] of Object.entries(S.ws)) {
    for (const a of w.actions) {
      if (['awaiting_approval', 'approved', 'queued'].includes(a.status) && Date.parse(a.expiresAt) <= Date.now()) {
        Object.assign(a, { status: 'expired', statusReason: 'Approval window ended.', version: a.version + 1, updatedAt: iso() });
        timeline({ ws: w }, a.incidentId, 'action.expired', 'svc-scheduler', 'Action request expired before dispatch. Renew the review to continue.', [{ type: 'action', id: a.id }]);
        emit(wsId, 'action', a.id, a.version, 'expired');
        changed = true;
      }
    }
  }
  if (changed) save();
}
if (typeof window !== 'undefined') {
  setInterval(expireDue, 3000);
  // Resume simulations interrupted by a reload.
  for (const [wsId, w] of Object.entries(S.ws)) for (const a of w.actions) if (a.status === 'queued') scheduleExecution(wsId, a.id);
}

// ---------------------------------------------------------------- dashboard & lists
const SEV = { sev1: 1, sev2: 2, sev3: 3, sev4: 4 } as const;
const sortIncidents = (list: IncidentDTO[]) => [...list].sort((a, b) => SEV[a.severity] - SEV[b.severity] || b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));

function dashboard(c: Ctx): DashboardDTO {
  const inc = Object.values(c.ws.incidents).map((d) => d.incident);
  const active = sortIncidents(inc.filter((i) => i.status !== 'resolved'));
  const seeQueue = can(c.roles, 'action.queue.read');
  const pending = c.ws.actions.filter((a) => a.status === 'awaiting_approval').sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  const recent = Object.values(c.ws.incidents).flatMap((d) => d.timeline).sort((a, b) => Number(b.streamSeq) - Number(a.streamSeq)).slice(0, 10);
  return {
    metrics: {
      openSev1: active.filter((i) => i.severity === 'sev1').length,
      openIncidents: active.length,
      pendingApprovals: seeQueue ? pending.length : null,
      unknownServices: c.ws.services.filter((s) => s.health.some((h) => h.status === 'unknown')).length,
    },
    activeIncidents: active.slice(0, 25).map((i) => viewIncident(i, c.roles)),
    pendingApprovals: seeQueue ? pending.slice(0, 5).map((a) => viewAction(a, c.roles)) : null,
    services: c.ws.services,
    recentActivity: recent,
    dispatchStopped: c.ws.dispatchStopped,
    generatedAt: iso(),
  };
}

function postmortemMarkdown(d: IncDetail, w: State['ws'][string]) {
  const i = d.incident;
  const acts = w.actions.filter((a) => a.incidentId === i.id);
  const lines = [`# Postmortem draft: ${i.title}`, '', '> Draft generated from durable incident records. Review and edit before sharing. Hypotheses are not confirmed causes.', '', '## Summary', '',
    `- **Service:** ${i.serviceName} (${i.environment})`, `- **Severity:** ${i.severity.toUpperCase()}`, `- **Status:** ${i.status}`, `- **Declared:** ${i.openedAt}`, '', '## Confirmed by responders', ''];
  const done = acts.filter((a) => a.status === 'succeeded' || a.status === 'failed');
  lines.push(...(done.length ? done.map((a) => `- Action \`${a.spec.toolId}\` ${a.status} (simulation).`) : ['- No remediation action reached a conclusive outcome.']), '', '## AI-assisted analysis (unconfirmed)', '');
  lines.push(...(d.diagnosis ? d.diagnosis.hypotheses.map((h) => `- **${h.strength}**: ${h.statement}`) : ['- No structured diagnosis was produced.']), '', '## Remaining uncertainty', '');
  lines.push(...(d.diagnosis?.missingEvidence.length ? d.diagnosis.missingEvidence.map((m) => `- ${m}`) : ['- None recorded.']), '', '## Timeline (UTC)', '');
  lines.push(...d.timeline.map((t) => `- ${t.createdAt.slice(0, 16).replace('T', ' ')}: ${t.actor.name}: ${t.summary.replace(/\n/g, ' ')}`));
  return lines.join('\n');
}

function runbookHits(wsId: string, q: string, serviceId?: string) {
  const terms = q.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  const rb = S.ws[wsId]!.runbooks;
  const scored = S.chunks
    .filter((ch) => ch.workspaceId === wsId && rb.find((r) => r.id === ch.runbookId)?.activeVersionId === ch.versionId)
    .filter((ch) => !serviceId || (rb.find((r) => r.id === ch.runbookId)?.serviceIds ?? []).length === 0 || rb.find((r) => r.id === ch.runbookId)!.serviceIds.includes(serviceId))
    .map((ch) => {
      const hay = `${ch.heading} ${ch.heading} ${ch.text}`.toLowerCase();
      return { ch, score: terms.reduce((n, t) => n + (hay.split(t).length - 1), 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  return scored.map(({ ch, score }) => ({ runbookId: ch.runbookId, runbookTitle: ch.runbookTitle, versionId: ch.versionId, revision: ch.revision, chunkId: ch.chunkId, heading: ch.heading, excerpt: ch.text.slice(0, 600), score, retrievalMode: 'lexical' as const }));
}

// ---------------------------------------------------------------- demo-only: a new alert arrives
const ALERTS = [
  { svc: 'Checkout API', sev: 'sev3' as const, text: 'Checkout API: Coupon validation errors rising' },
  { svc: 'Product Search', sev: 'sev2' as const, text: 'Product Search: Search latency above 2 seconds' },
  { svc: 'Shipping Quotes', sev: 'sev3' as const, text: 'Shipping Quotes: Carrier rate lookups timing out' },
  { svc: 'Inventory Service', sev: 'sev2' as const, text: 'Inventory Service: Stock reservations failing' },
];
function sendTestAlert(c: Ctx) {
  const pick = ALERTS[S.used.incidents % ALERTS.length]!;
  const service = c.ws.services.find((s) => s.name.startsWith(pick.svc)) ?? c.ws.services[0]!;
  const model = Object.values(c.ws.incidents).find((d) => d.incident.serviceId === service.id && d.diagnosis);
  const id = nextId('incidents');
  const n = c.ws.nextNumber++;
  const t = iso();
  const incident: IncidentDTO = {
    id, workspaceId: c.wsId, reference: `INC-${String(n).padStart(4, '0')}`, serviceId: service.id, serviceName: service.name, environment: 'demo', status: 'declared', severity: pick.sev,
    title: pick.text, ownerId: null, ownerName: null, occurrenceCount: 1, generation: 1, remediationRevision: 1, latestDiagnosisId: null, openedAt: t, acknowledgedAt: null, resolvedAt: null,
    lastAlertAt: t, updatedAt: t, version: 1, allowedTransitions: [],
  };
  const evidence: EvidenceDTO[] = [{ id: miscId(), incidentId: id, runId: null, sourceType: 'alert', sourceId: 'demo-alert', sourceVersion: null, title: `Alert from monitoring (${pick.sev})`, collectedAt: t, observedFrom: t, observedTo: t, completeness: 'complete', redactedExcerpt: pick.text, redactionCount: 0, truncated: false, suspectedInjection: false, checksum: 'sha256:demo', expired: false }];
  const run: InvestigationDTO = { id: miscId(), incidentId: id, state: 'queued', phase: null, rerunRequested: false, reason: 'New incident declared from alert', degradedReason: null, diagnosis: null, evidenceIds: [], createdAt: t, updatedAt: t };
  c.ws.incidents[id] = { incident, timeline: [], evidence, diagnosis: null, investigation: run, postmortem: null };
  timeline(c, id, 'incident.created', 'svc-ingestion', `Incident declared from a signed alert (${pick.sev}).`, [{ type: 'alert', id: 'demo' }]);
  timeline(c, id, 'investigation.requested', 'svc-ingestion', 'Automatic investigation queued.');
  audit(c, 'svc-ingestion', 'alert.ingest', { type: 'alert', id: miscId() });
  emit(c.wsId, 'incident', id, 1, 'created');
  runInvestigation(c.wsId, id, model ?? null);
  return { incidentId: id };
}

function runInvestigation(wsId: string, incidentId: string, model: IncDetail | null) {
  const w = S.ws[wsId]!;
  const d = w.incidents[incidentId]!;
  later(900, () => {
    if (d.investigation) Object.assign(d.investigation, { state: 'running', phase: 'collecting', updatedAt: iso() });
    emit(wsId, 'investigation', d.investigation?.id ?? incidentId, 2, 'running');
  });
  later(3200, () => {
    const source = model?.diagnosis ? model : d.diagnosis ? d : null;
    if (!source?.diagnosis) {
      Object.assign(d.investigation!, { state: 'degraded', phase: null, degradedReason: 'Not enough evidence for a diagnosis. Review the available logs.', updatedAt: iso() });
      timeline({ ws: w }, incidentId, 'investigation.degraded', 'svc-investigator', 'Automatic diagnosis incomplete: not enough evidence.');
    } else {
      if (source !== d) {
        // Reuse the evidence set this service's recorded diagnosis cites.
        const ids = new Set(source.diagnosis.evidenceIds);
        d.evidence.push(...source.evidence.filter((e) => ids.has(e.id) && e.sourceType !== 'alert').map((e) => ({ ...e, incidentId, collectedAt: iso() })));
      }
      const diag: DiagnosisDTO = { ...source.diagnosis, id: miscId(), incidentId, createdAt: iso(), remediationRevision: d.incident.remediationRevision + 1, validity: { ...source.diagnosis.validity, superseded: false } };
      bump(d.incident, { latestDiagnosisId: diag.id, remediationRevision: d.incident.remediationRevision + 1 });
      d.diagnosis = diag;
      Object.assign(d.investigation!, { state: 'completed', phase: null, diagnosis: diag, evidenceIds: diag.evidenceIds, updatedAt: iso() });
      timeline({ ws: w }, incidentId, 'investigation.completed', 'svc-investigator', `AI suggestion ready (${diag.hypotheses.length} hypotheses, ${diag.evidenceIds.length} evidence records).`, [{ type: 'diagnosis', id: diag.id }]);
      audit({ ws: w }, 'svc-investigator', 'investigation.completed', { type: 'investigation', id: d.investigation!.id });
    }
    emit(wsId, 'incident', incidentId, d.incident.version, 'diagnosis_ready');
    emit(wsId, 'investigation', d.investigation!.id, 3, 'completed');
  });
}

// ---------------------------------------------------------------- router
type Req = { method: string; path: string; query: URLSearchParams; body: Record<string, unknown>; ifMatch: string | null; key: string | null };
type Res = { status: number; body: unknown; meta?: Record<string, unknown> };
type Handler = (r: Req, p: string[]) => Res | Promise<Res>;
const routes: Array<[string, RegExp, Handler]> = [];
const on = (method: string, pattern: string, h: Handler) =>
  routes.push([method, new RegExp(`^${pattern.replace(/:[a-z]+/gi, '([^/]+)')}$`), h]);
const ok = (body: unknown, status = 200, meta?: Record<string, unknown>): Res => ({ status, body, ...(meta ? { meta } : {}) });

// Auth (demo identities; same people as the seeded local app)
on('GET', '/auth/mode', () => ok({ mode: 'dev' }));
on('GET', '/auth/dev-users', () => ok(users()));
on('POST', '/auth/dev-login', (r) => {
  const u = users().find((x) => x.id === r.body.userId);
  if (!u) throw new AppError('UNAUTHENTICATED', 'Unknown demo user.');
  S.userId = u.id;
  save();
  return ok(me(u.id));
});
on('POST', '/auth/logout', () => {
  S.userId = null;
  save();
  return ok({ signedOut: true });
});
on('GET', '/me', () => {
  if (!S.userId) throw new AppError('SESSION_EXPIRED', 'Your session expired. Sign in again.');
  return ok(me(S.userId));
});
on('POST', '/demo/alert/:ws', (_r, [ws]) => ok(sendTestAlert(ctxFor(ws!)), 202));

// Dashboard
on('GET', '/workspaces/:ws/dashboard', (_r, [ws]) => {
  const c = ctxFor(ws!);
  return ok(dashboard(c), 200, { snapshotCursor: `demo:${S.seq}`, snapshotStreamSeq: String(S.seq) });
});

// Incidents
on('GET', '/workspaces/:ws/incidents', (r, [ws]) => {
  const c = ctxFor(ws!);
  const status = r.query.getAll('status'), severity = r.query.getAll('severity'), q = (r.query.get('q') ?? '').toLowerCase(), serviceId = r.query.get('serviceId');
  let list = Object.values(c.ws.incidents).map((d) => d.incident);
  list = status.length ? list.filter((i) => status.includes(i.status)) : list.filter((i) => i.status !== 'resolved');
  if (severity.length) list = list.filter((i) => severity.includes(i.severity));
  if (serviceId) list = list.filter((i) => i.serviceId === serviceId);
  if (q) list = list.filter((i) => `${i.title} ${i.serviceName}`.toLowerCase().includes(q));
  return ok({ items: sortIncidents(list).map((i) => viewIncident(i, c.roles)), nextCursor: null });
});
on('GET', '/workspaces/:ws/incidents/:id', (_r, [ws, id]) => {
  const c = ctxFor(ws!);
  return ok(viewIncident(incidentOf(c, id!).incident, c.roles));
});
on('GET', '/workspaces/:ws/incidents/:id/timeline', (r, [ws, id]) => {
  const c = ctxFor(ws!);
  const t = [...incidentOf(c, id!).timeline].sort((a, b) => Number(a.streamSeq) - Number(b.streamSeq));
  return ok({ items: r.query.get('order') === 'asc' ? t : t.reverse(), nextCursor: null });
});
on('GET', '/workspaces/:ws/incidents/:id/evidence', (r, [ws, id]) => {
  const c = ctxFor(ws!);
  const type = r.query.get('sourceType');
  return ok({ items: incidentOf(c, id!).evidence.filter((e) => !type || e.sourceType === type), nextCursor: null });
});
on('GET', '/workspaces/:ws/incidents/:id/diagnosis', (_r, [ws, id]) => {
  const d = incidentOf(ctxFor(ws!), id!);
  return ok(d.diagnosis ? { ...d.diagnosis, validity: { ...d.diagnosis.validity, superseded: d.diagnosis.remediationRevision !== d.incident.remediationRevision } } : null);
});
on('GET', '/workspaces/:ws/incidents/:id/investigations/latest', (_r, [ws, id]) => ok(incidentOf(ctxFor(ws!), id!).investigation));
on('GET', '/workspaces/:ws/incidents/:id/postmortem-drafts/latest', (_r, [ws, id]) => ok(incidentOf(ctxFor(ws!), id!).postmortem));

on('POST', '/workspaces/:ws/incidents/:id/acknowledge', (r, [ws, id]) => {
  const c = ctxFor(ws!);
  need(c, 'incident.acknowledge');
  const d = incidentOf(c, id!);
  checkVersion(d.incident.version, r.ifMatch, 'incident');
  const next = applyAcknowledge(stateOf(d.incident), c.userId, now());
  bump(d.incident, { status: next.status, ownerId: c.userId, ownerName: nameOf(c.userId), acknowledgedAt: iso() });
  timeline(c, id!, 'incident.acknowledged', c.userId, 'Acknowledged and assigned; status declared → investigating.');
  audit(c, c.userId, 'incident.acknowledge', { type: 'incident', id: id! }, { beforeVersion: d.incident.version - 1, afterVersion: d.incident.version });
  emit(ws!, 'incident', id!, d.incident.version, 'acknowledged');
  return ok(viewIncident(d.incident, c.roles));
});
on('POST', '/workspaces/:ws/incidents/:id/transitions', (r, [ws, id]) => {
  const c = ctxFor(ws!);
  need(c, 'incident.transition');
  const d = incidentOf(c, id!);
  checkVersion(d.incident.version, r.ifMatch, 'incident');
  const to = r.body.targetStatus as IncidentStatus;
  const reason = String(r.body.reason ?? '').trim();
  if (!reason) throw new AppError('INVALID_INPUT', 'A reason is required.');
  const from = d.incident.status;
  const next = applyTransition(stateOf(d.incident), to, now());
  bump(d.incident, { status: next.status, generation: next.generation, remediationRevision: next.remediationRevision, resolvedAt: next.resolvedAt ? next.resolvedAt.toISOString() : null });
  timeline(c, id!, 'incident.transitioned', c.userId, next.reopened ? `Reopened (generation ${next.generation}): ${reason}` : `Status ${from} → ${to}: ${reason}`);
  audit(c, c.userId, 'incident.transition', { type: 'incident', id: id! }, { reasonCode: `${from}->${to}` });
  emit(ws!, 'incident', id!, d.incident.version, `status_${to}`);
  return ok(viewIncident(d.incident, c.roles));
});
on('POST', '/workspaces/:ws/incidents/:id/comments', (r, [ws, id]) => {
  const c = ctxFor(ws!);
  need(c, 'incident.comment');
  const d = incidentOf(c, id!);
  checkVersion(d.incident.version, r.ifMatch, 'incident');
  const text = String(r.body.text ?? '').trim().slice(0, 4000);
  if (!text) throw new AppError('INVALID_INPUT', 'Write a comment first.');
  bump(d.incident, {});
  timeline(c, id!, 'incident.commented', c.userId, text);
  emit(ws!, 'incident', id!, d.incident.version, 'commented');
  return ok({ incidentVersion: d.incident.version }, 201);
});
on('POST', '/workspaces/:ws/incidents/:id/investigations', (r, [ws, id]) => {
  const c = ctxFor(ws!);
  need(c, 'investigation.request');
  const d = incidentOf(c, id!);
  checkVersion(d.incident.version, r.ifMatch, 'incident');
  if (d.incident.status === 'resolved') throw new AppError('INVALID_TRANSITION', 'A resolved incident cannot be investigated. Reopen it first.');
  if (d.investigation && ['queued', 'running'].includes(d.investigation.state)) {
    d.investigation.rerunRequested = true;
    return ok({ id: d.investigation.id, state: d.investigation.state, coalesced: true }, 202);
  }
  const t = iso();
  d.investigation = { id: miscId(), incidentId: id!, state: 'queued', phase: null, rerunRequested: false, reason: String(r.body.reason ?? 'Requested'), degradedReason: null, diagnosis: null, evidenceIds: [], createdAt: t, updatedAt: t };
  timeline(c, id!, 'investigation.requested', c.userId, `Diagnosis requested: ${String(r.body.reason ?? '')}`);
  emit(ws!, 'investigation', d.investigation.id, 1, 'queued');
  runInvestigation(ws!, id!, null);
  return ok({ id: d.investigation.id, state: 'queued', coalesced: false }, 202);
});
on('POST', '/workspaces/:ws/incidents/:id/postmortem-drafts', (r, [ws, id]) => {
  const c = ctxFor(ws!);
  need(c, 'postmortem.request');
  const d = incidentOf(c, id!);
  checkVersion(d.incident.version, r.ifMatch, 'incident');
  d.postmortem = { id: miscId(), incidentId: id!, state: 'generating', markdown: null, createdAt: iso() };
  timeline(c, id!, 'postmortem.requested', c.userId, 'Postmortem draft requested.');
  later(1500, () => {
    d.postmortem = { ...d.postmortem!, state: 'ready', markdown: postmortemMarkdown(d, c.ws) };
    timeline(c, id!, 'postmortem.drafted', 'svc-reporter', 'Postmortem draft ready for review.');
    emit(ws!, 'postmortem', d.postmortem.id, 2, 'ready');
  });
  return ok(d.postmortem, 202);
});

// Actions and approvals
function buildProposal(c: Ctx, d: IncDetail, toolId: string, args: Record<string, unknown>, extra: { requestedBy: string; renewedBy: string | null; supersedes: string | null; diagnosisId: string | null }) {
  const tool = TOOLS[toolId];
  if (!tool) throw new AppError('INVALID_ACTION_ARGUMENTS', 'Unknown tool. Only reviewed tools can be proposed.');
  if (!tool.valid(args)) throw new AppError('INVALID_ACTION_ARGUMENTS', 'Tool arguments are invalid.');
  const inc = d.incident;
  const perm = simulatorPermits(c, inc.serviceId, inc.environment);
  if (!perm.ok) throw new AppError('FORBIDDEN', 'The core.simulator connector is not permitted to run this action (GRANT_REVOKED).');
  const tgt = targetOf(c.wsId, inc.serviceId, inc.environment);
  const spec: ActionSpec = {
    workspaceId: c.wsId, incidentId: inc.id, incidentGeneration: inc.generation, toolId, toolVersion: '1', installationId: perm.id, arguments: args,
    target: { serviceId: inc.serviceId, environment: inc.environment, revision: `rev-${tgt?.revision ?? 1}` }, remediationRevision: inc.remediationRevision,
    ...tool.describe(args, inc.serviceName, inc.environment), simulation: true, expiresAt: new Date(Date.now() + APPROVAL_WINDOW_MS).toISOString(),
  };
  const id = nextId('actions');
  const t = iso();
  const action: ActionDTO = {
    id, incidentId: inc.id, incidentTitle: inc.title, spec, specHash: computeSpecHash(spec), status: 'awaiting_approval',
    requestedBy: { id: extra.requestedBy, name: nameOf(extra.requestedBy) }, renewedBy: extra.renewedBy ? { id: extra.renewedBy, name: nameOf(extra.renewedBy) } : null,
    supersedesActionId: extra.supersedes, supersededByActionId: null, diagnosisId: extra.diagnosisId, decision: null, execution: null, statusReason: null,
    expiresAt: spec.expiresAt, createdAt: t, updatedAt: t, version: 1,
  };
  c.ws.actions.unshift(action);
  timeline(c, inc.id, 'action.proposed', c.userId, extra.supersedes ? 'Action review renewed as a new request.' : `Action requested: ${tool.label} (simulation); awaiting independent approval.`, [{ type: 'action', id }]);
  audit(c, c.userId, extra.supersedes ? 'action.renew' : 'action.propose', { type: 'action', id }, { specHash: action.specHash, afterVersion: 1 });
  emit(c.wsId, 'action', id, 1, 'awaiting_approval');
  emit(c.wsId, 'incident', inc.id, inc.version, 'action_proposed');
  return action;
}
on('POST', '/workspaces/:ws/incidents/:id/actions', (r, [ws, id]) => {
  const c = ctxFor(ws!);
  need(c, 'action.propose');
  const d = incidentOf(c, id!);
  checkVersion(d.incident.version, r.ifMatch, 'incident');
  if (!['investigating', 'mitigating', 'monitoring'].includes(d.incident.status)) {
    throw new AppError('INVALID_TRANSITION', 'Actions can be requested only while an incident is investigating, mitigating or monitoring.');
  }
  const target = r.body.target as { serviceId?: string; environment?: string } | undefined;
  if (target?.serviceId !== d.incident.serviceId || target?.environment !== d.incident.environment) {
    throw new AppError('INVALID_ACTION_ARGUMENTS', "The target must be this incident's service and environment.");
  }
  const a = buildProposal(c, d, String(r.body.toolId), (r.body.arguments ?? {}) as Record<string, unknown>, { requestedBy: c.userId, renewedBy: null, supersedes: null, diagnosisId: (r.body.diagnosisId as string) ?? null });
  return ok(viewAction(a, c.roles), 201);
});
on('GET', '/workspaces/:ws/actions', (r, [ws]) => {
  const c = ctxFor(ws!);
  const incidentId = r.query.get('incidentId');
  if (!incidentId) need(c, 'action.queue.read', 'You need the commander or auditor role to view the approval queue.');
  const status = r.query.getAll('status');
  const items = c.ws.actions.filter((a) => (!incidentId || a.incidentId === incidentId) && (!status.length || status.includes(a.status)));
  return ok({ items: items.map((a) => viewAction(a, c.roles)), nextCursor: null });
});
on('GET', '/workspaces/:ws/actions/:id', (_r, [ws, id]) => {
  const c = ctxFor(ws!);
  return ok(viewAction(actionOf(c, id!), c.roles));
});
on('POST', '/workspaces/:ws/actions/:id/decisions', (r, [ws, id]) => {
  const c = ctxFor(ws!);
  if (!c.roles.includes('commander')) {
    audit(c, c.userId, 'action.decide', { type: 'action', id: id! }, { decision: 'denied', reasonCode: 'ROLE_REQUIRED' });
    throw new AppError('FORBIDDEN', 'You need the commander role to approve this request.');
  }
  const a = actionOf(c, id!);
  checkVersion(a.version, r.ifMatch, 'request');
  const inc = c.ws.incidents[a.incidentId]!.incident;
  const reason = String(r.body.reason ?? '').trim();
  if (!reason) throw new AppError('INVALID_INPUT', 'A reason is required.');
  try {
    checkApprovable({
      action: { status: a.status, spec: a.spec, specHash: a.specHash, requestedBy: a.requestedBy.id, renewedBy: a.renewedBy?.id ?? null, lineageRequesters: S.lineage[a.id] ?? [] },
      incident: { generation: inc.generation, remediationRevision: inc.remediationRevision, active: inc.status !== 'resolved' },
      deciderId: c.userId,
      submittedSpecHash: String(r.body.specHash ?? ''),
      now: now(),
    });
  } catch (e) {
    if (e instanceof AppError && e.code === 'SELF_APPROVAL_DENIED') audit(c, c.userId, 'action.decide', { type: 'action', id: a.id }, { decision: 'denied', reasonCode: 'SELF_APPROVAL' });
    throw e;
  }
  const approve = r.body.decision === 'approve';
  Object.assign(a, {
    status: approve ? 'queued' : 'rejected',
    statusReason: approve ? null : reason,
    decision: { decision: approve ? 'approve' : 'reject', decidedBy: { id: c.userId, name: nameOf(c.userId) }, reason, decidedAt: iso() },
    version: a.version + 1,
    updatedAt: iso(),
  });
  timeline(c, a.incidentId, 'action.decided', c.userId, approve ? `Simulated action approved; queued for dispatch. Reason: ${reason}` : `Action rejected: ${reason}`, [{ type: 'action', id: a.id }]);
  audit(c, c.userId, approve ? 'action.approve' : 'action.reject', { type: 'action', id: a.id }, { specHash: a.specHash, beforeVersion: a.version - 1, afterVersion: a.version });
  emit(ws!, 'action', a.id, a.version, approve ? 'approved_queued' : 'rejected');
  if (approve) scheduleExecution(ws!, a.id);
  return ok(viewAction(a, c.roles));
});
on('POST', '/workspaces/:ws/actions/:id/cancel', (r, [ws, id]) => {
  const c = ctxFor(ws!);
  need(c, 'action.cancel');
  const a = actionOf(c, id!);
  if (a.requestedBy.id !== c.userId && !c.roles.includes('commander')) throw new AppError('FORBIDDEN', 'Only the requester or a commander can cancel this request.');
  checkVersion(a.version, r.ifMatch, 'request');
  if (!PRE_DISPATCH_STATUSES.includes(a.status) || a.status === 'proposed') throw new AppError('ACTION_ALREADY_DISPATCHED', `This request is ${a.status.replace('_', ' ')}; it can no longer be cancelled.`);
  Object.assign(a, { status: 'cancelled', statusReason: String(r.body.reason ?? 'Cancelled'), version: a.version + 1, updatedAt: iso() });
  timeline(c, a.incidentId, 'action.cancelled', c.userId, `Action request cancelled before dispatch: ${a.statusReason}`, [{ type: 'action', id: a.id }]);
  audit(c, c.userId, 'action.cancel', { type: 'action', id: a.id }, { specHash: a.specHash });
  emit(ws!, 'action', a.id, a.version, 'cancelled');
  return ok(viewAction(a, c.roles));
});
on('POST', '/workspaces/:ws/actions/:id/renew', (r, [ws, id]) => {
  const c = ctxFor(ws!);
  need(c, 'action.renew');
  const old = actionOf(c, id!);
  checkVersion(old.version, r.ifMatch, 'request');
  if (!['awaiting_approval', 'approved', 'queued', 'expired'].includes(old.status) || old.supersededByActionId) {
    throw new AppError('INVALID_TRANSITION', `A ${old.status.replace('_', ' ')} request cannot be renewed.`);
  }
  const d = c.ws.incidents[old.incidentId]!;
  const fresh = buildProposal(c, d, old.spec.toolId, old.spec.arguments, { requestedBy: old.requestedBy.id, renewedBy: c.userId, supersedes: old.id, diagnosisId: old.diagnosisId });
  S.lineage[fresh.id] = [...new Set([...(S.lineage[old.id] ?? []), old.requestedBy.id, ...(old.renewedBy ? [old.renewedBy.id] : [])])];
  Object.assign(old, { supersededByActionId: fresh.id, version: old.version + 1, updatedAt: iso(), ...(old.status === 'expired' ? {} : { status: 'cancelled', statusReason: 'Superseded by renewal' }) });
  emit(ws!, 'action', old.id, old.version, 'superseded');
  return ok(viewAction(fresh, c.roles), 201);
});
on('POST', '/workspaces/:ws/dispatch-controls', (r, [ws]) => {
  const c = ctxFor(ws!);
  need(c, 'dispatch.stop');
  c.ws.dispatchStopped = Boolean(r.body.stopped);
  audit(c, c.userId, c.ws.dispatchStopped ? 'dispatch.stop' : 'dispatch.resume', { type: 'workspace', id: ws! }, { reasonCode: String(r.body.reason ?? '').slice(0, 120) });
  emit(ws!, 'incident', 'workspace', S.seq, 'dispatch_control');
  return ok({ dispatchStopped: c.ws.dispatchStopped });
});

// Services, runbooks, audit, plugins
on('GET', '/workspaces/:ws/services', (_r, [ws]) => ok({ items: [...ctxFor(ws!).ws.services].sort((a, b) => a.name.localeCompare(b.name)), nextCursor: null }));
on('GET', '/workspaces/:ws/services/:id', (_r, [ws, id]) => {
  const s = ctxFor(ws!).ws.services.find((x) => x.id === id);
  if (!s) throw new AppError('NOT_FOUND', 'This item is unavailable.');
  return ok(s);
});
on('GET', '/workspaces/:ws/runbooks/search', (r, [ws]) => {
  ctxFor(ws!);
  return ok(runbookHits(ws!, r.query.get('q') ?? '', r.query.get('serviceId') ?? undefined));
});
on('GET', '/workspaces/:ws/runbooks', (r, [ws]) => {
  const c = ctxFor(ws!);
  const svc = r.query.get('serviceId');
  return ok({ items: c.ws.runbooks.filter((x) => !svc || x.serviceIds.includes(svc)), nextCursor: null });
});
on('POST', '/workspaces/:ws/runbooks', (r, [ws]) => {
  const c = ctxFor(ws!);
  need(c, 'runbook.create');
  const rb: RunbookDTO = { id: miscId(), title: String(r.body.title ?? 'Untitled').slice(0, 120), serviceIds: (r.body.serviceIds as string[]) ?? [], environments: ['demo'], activeVersionId: null, versions: [], version: 1, updatedAt: iso() };
  c.ws.runbooks.unshift(rb);
  audit(c, c.userId, 'runbook.create', { type: 'runbook', id: rb.id });
  emit(ws!, 'runbook', rb.id, 1, 'created');
  return ok(rb, 201);
});
const runbookOf = (c: Ctx, id: string) => {
  const rb = c.ws.runbooks.find((x) => x.id === id);
  if (!rb) throw new AppError('NOT_FOUND', 'This item is unavailable.');
  return rb;
};
on('POST', '/workspaces/:ws/runbooks/:id/versions', (r, [ws, id]) => {
  const c = ctxFor(ws!);
  need(c, 'runbook.create');
  const rb = runbookOf(c, id!);
  checkVersion(rb.version, r.ifMatch, 'runbook');
  const v: RunbookDTO['versions'][number] = { id: miscId(), revision: rb.versions.length + 1, state: 'uploading', fileName: String(r.body.fileName ?? 'runbook.md'), checksum: String(r.body.checksum ?? ''), error: null, createdAt: iso() };
  rb.versions.unshift(v);
  Object.assign(rb, { version: rb.version + 1, updatedAt: iso() });
  emit(ws!, 'runbook', rb.id, rb.version, 'uploading');
  return ok({ versionId: v.id, revision: v.revision, runbookVersion: rb.version, upload: { method: 'PUT', path: `runbooks/${rb.id}/versions/${v.id}/content` } }, 201);
});
on('PUT', '/workspaces/:ws/runbooks/:id/versions/:vid/content', (r, [ws, id, vid]) => {
  const c = ctxFor(ws!);
  need(c, 'runbook.create');
  runbookOf(c, id!);
  S.runbookText[vid!] = String(r.body.__raw ?? '');
  return ok({ checksum: 'sha256:demo', size: S.runbookText[vid!]!.length });
});
on('POST', '/workspaces/:ws/runbooks/:id/versions/:vid/complete', (r, [ws, id, vid]) => {
  const c = ctxFor(ws!);
  need(c, 'runbook.create');
  const rb = runbookOf(c, id!);
  checkVersion(rb.version, r.ifMatch, 'runbook');
  const v = rb.versions.find((x) => x.id === vid);
  if (!v || v.state !== 'uploading') throw new AppError('INVALID_TRANSITION', 'This version is no longer accepting uploads.');
  v.state = 'indexing';
  Object.assign(rb, { version: rb.version + 1, updatedAt: iso() });
  emit(ws!, 'runbook', rb.id, rb.version, 'indexing');
  later(1500, () => {
    const text = S.runbookText[vid!] ?? '';
    const parts = text.split(/\n(?=#{1,6}\s)/).filter((p) => p.trim());
    v.state = parts.length ? 'ready' : 'failed';
    v.error = parts.length ? null : 'No readable text was found in the document.';
    parts.forEach((p, i) => {
      const heading = /^#{1,6}\s+(.*)/.exec(p)?.[1] ?? 'Introduction';
      S.chunks.push({ workspaceId: ws!, runbookId: rb.id, runbookTitle: rb.title, versionId: v.id, revision: v.revision, chunkId: `${v.id}-${i}`, heading, text: p.replace(/^#{1,6}\s+.*\n?/, '').trim() });
    });
    Object.assign(rb, { version: rb.version + 1, updatedAt: iso() });
    emit(ws!, 'runbook', rb.id, rb.version, v.state);
  });
  return ok({ versionId: v.id, state: 'indexing', runbookVersion: rb.version }, 202);
});
on('POST', '/workspaces/:ws/runbooks/:id/publish', (r, [ws, id]) => {
  const c = ctxFor(ws!);
  need(c, 'runbook.publish', 'You need the commander role to publish a runbook version.');
  const rb = runbookOf(c, id!);
  checkVersion(rb.version, r.ifMatch, 'runbook');
  const v = rb.versions.find((x) => x.id === r.body.readyVersionId);
  if (!v || v.state !== 'ready') throw new AppError('INVALID_TRANSITION', 'Only a ready version can be published.');
  v.state = 'published';
  Object.assign(rb, { activeVersionId: v.id, version: rb.version + 1, updatedAt: iso() });
  audit(c, c.userId, 'runbook.publish', { type: 'runbook_version', id: v.id });
  emit(ws!, 'runbook', rb.id, rb.version, 'published');
  return ok(rb);
});
on('GET', '/workspaces/:ws/audit', (r, [ws]) => {
  const c = ctxFor(ws!);
  need(c, 'audit.read', 'You need the commander or auditor role to view the audit log.');
  const op = r.query.get('operation');
  return ok({ items: c.ws.audit.filter((a) => !op || a.operation.startsWith(op)), nextCursor: null });
});
on('GET', '/workspaces/:ws/plugins/catalog', (_r, [ws]) => {
  const c = ctxFor(ws!);
  need(c, 'plugin.manage');
  return ok(c.ws.pluginCatalog);
});
on('GET', '/workspaces/:ws/plugins/installations', (_r, [ws]) => {
  const c = ctxFor(ws!);
  need(c, 'plugin.manage');
  return ok(c.ws.installations);
});
const installationOf = (c: Ctx, id: string) => {
  const i = c.ws.installations.find((x) => x.id === id);
  if (!i) throw new AppError('NOT_FOUND', 'This item is unavailable.');
  return i;
};
on('POST', '/workspaces/:ws/plugins/installations/:id/test', (r, [ws, id]) => {
  const c = ctxFor(ws!);
  need(c, 'plugin.manage');
  const inst = installationOf(c, id!);
  checkVersion(inst.version, r.ifMatch, 'installation');
  later(1000, () => {
    inst.health = { status: 'ok', checkedAt: iso(), lastError: null };
    emit(ws!, 'plugin_installation', inst.id, inst.version, 'health_ok');
  });
  return ok({ installationId: inst.id, state: 'testing' }, 202);
});
on('PATCH', '/workspaces/:ws/plugins/installations/:id', (r, [ws, id]) => {
  const c = ctxFor(ws!);
  need(c, 'plugin.manage');
  const inst = installationOf(c, id!);
  checkVersion(inst.version, r.ifMatch, 'installation');
  if (r.body.status === 'enabled' && inst.status !== 'enabled' && inst.health.status !== 'ok') throw new AppError('INVALID_TRANSITION', 'Run a passing connection test before enabling this plugin.');
  if (Array.isArray(r.body.grants)) inst.grants = r.body.grants as InstallationDTO['grants'];
  if (r.body.status === 'enabled' || r.body.status === 'disabled') inst.status = r.body.status;
  Object.assign(inst, { version: inst.version + 1, updatedAt: iso() });
  audit(c, c.userId, 'plugin.update', { type: 'plugin_installation', id: inst.id });
  emit(ws!, 'plugin_installation', inst.id, inst.version, 'updated');
  return ok(inst);
});
on('POST', '/workspaces/:ws/plugins/installations/:id/revoke', (r, [ws, id]) => {
  const c = ctxFor(ws!);
  need(c, 'plugin.manage');
  const inst = installationOf(c, id!);
  checkVersion(inst.version, r.ifMatch, 'installation');
  Object.assign(inst, { status: 'disabled', health: { status: 'unknown', checkedAt: null, lastError: null }, version: inst.version + 1, updatedAt: iso() });
  audit(c, c.userId, 'plugin.revoke', { type: 'plugin_installation', id: inst.id }, { reasonCode: String(r.body.reason ?? '').slice(0, 120) });
  emit(ws!, 'plugin_installation', inst.id, inst.version, 'revoked');
  return ok(inst);
});

// ---------------------------------------------------------------- entry point used by lib/api.ts
export async function demoFetch(method: string, rawPath: string, init: { body?: string | Blob; headers?: Record<string, string> }): Promise<Response> {
  await sleep(90 + Math.random() * 160); // feel like a network round trip
  const url = new URL(rawPath, 'https://demo.local');
  const path = url.pathname.replace(/^\/api\/v1/, '').replace(/\/$/, '');
  const headers = init.headers ?? {};
  let body: Record<string, unknown> = {};
  if (typeof init.body === 'string' && init.body) body = JSON.parse(init.body) as Record<string, unknown>;
  else if (init.body instanceof Blob) body = { __raw: await init.body.text() };
  const req: Req = { method, path, query: url.searchParams, body, ifMatch: headers['If-Match'] ?? null, key: headers['Idempotency-Key'] ?? null };
  const requestId = `demo-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const idemKey = req.key && method !== 'GET' ? `${S.userId}:${method}:${path}:${req.key}` : null;
    const replay = idemKey ? S.idem[idemKey] : undefined;
    let res: Res | undefined = replay ? { status: replay.status, body: replay.body } : undefined;
    if (!res) {
      for (const [m, re, h] of routes) {
        const match = m === method ? re.exec(path) : null;
        if (match) {
          res = await h(req, match.slice(1).map(decodeURIComponent));
          break;
        }
      }
    }
    if (!res) throw new AppError('NOT_FOUND', 'This item is unavailable.');
    if (idemKey && !replay) S.idem[idemKey] = { status: res.status, body: res.body };
    save();
    const version = (res.body as { version?: unknown } | null)?.version;
    return new Response(JSON.stringify({ data: res.body, meta: { requestId, ...(res.meta ?? {}) } }), {
      status: res.status,
      headers: { 'Content-Type': 'application/json', ...(typeof version === 'number' ? { ETag: `"${version}"` } : {}) },
    });
  } catch (e) {
    const err = e instanceof AppError ? e : new AppError('INTERNAL', 'Something went wrong in the demo.');
    return new Response(JSON.stringify(err.toEnvelope(requestId)), { status: err.status, headers: { 'Content-Type': 'application/json' } });
  }
}

export const demoSendAlert = (workspaceId: string) => demoFetch('POST', `/demo/alert/${workspaceId}`, {});
export const demoPeople = () => FIX.devUsers;
