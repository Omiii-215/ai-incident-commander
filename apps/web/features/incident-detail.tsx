'use client';

import type {
  ActionDTO,
  EvidenceDTO,
  IncidentDTO,
  IncidentStatus,
  InvestigationDTO,
  Page,
  PostmortemDTO,
  ServiceDTO,
  SuggestedActionDTO,
  TimelineEntryDTO,
} from '@aic/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ActionStatusBadge,
  AiBadge,
  Badge,
  Banner,
  Button,
  Card,
  CommandError,
  Empty,
  ErrorState,
  Field,
  inputClass,
  SeverityBadge,
  SimulationBadge,
  Skeleton,
  StatusBadge,
  Time,
} from '@/components/ui';
import { api, qs } from '@/lib/api';
import { useCommand } from '@/lib/commands';
import { label, relative, whenText } from '@/lib/format';
import { useWorkspace, wsKey } from '@/lib/workspace';
import { PageHeader } from './shared';

const TOOL_LABEL: Record<string, string> = {
  'simulator.rollback_deployment': 'Roll back deployment',
  'simulator.restart_service': 'Restart service',
};

export function IncidentDetail({ id }: { id: string }) {
  const { workspace, base, can } = useWorkspace();
  const incident = useQuery({
    queryKey: wsKey(workspace.id, 'incident', id),
    queryFn: ({ signal }) => api.get<IncidentDTO>(`/workspaces/${workspace.id}/incidents/${id}`, signal),
  });
  const [proposal, setProposal] = useState<SuggestedActionDTO | 'manual' | null>(null);

  if (incident.isLoading) return <Skeleton lines={8} label="Loading incident" />;
  if (!incident.data) return <ErrorState error={incident.error} onRetry={() => void incident.refetch()} title="This incident could not load." />;
  const inc = incident.data;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm">
        <Link href={`${base}/incidents`} className="text-accent underline">
          Incidents
        </Link>{' '}
        / <span className="font-mono">{inc.reference}</span>
      </nav>
      <PageHeader
        title={<span className="break-anywhere">{inc.title}</span>}
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={inc.severity} />
            <StatusBadge status={inc.status} />
            <SimulationBadge />
          </span>
        }
        description={
          <span className="flex flex-col gap-0.5">
            <span>
              <strong>{inc.serviceName}</strong> · environment <strong>{inc.environment}</strong> · owner {inc.ownerName ?? 'Unassigned'}
            </span>
            <span className="text-sm text-fg-muted">
              Declared {whenText(inc.openedAt)} · updated {whenText(inc.updatedAt)} · {inc.occurrenceCount} alert occurrence{inc.occurrenceCount === 1 ? '' : 's'}
              {inc.generation > 1 ? ` · reopened (generation ${inc.generation})` : ''}
            </span>
          </span>
        }
      />
      {incident.error && <p className="mb-3 text-sm text-warning">Refresh failed; showing the last loaded version.</p>}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <LifecycleCard incident={inc} />
          <DiagnosisCard incident={inc} onPropose={(s) => setProposal(s)} />
          {proposal && can('action.propose') && <ProposalCard incident={inc} suggestion={proposal === 'manual' ? null : proposal} onClose={() => setProposal(null)} />}
          <IncidentActions incident={inc} onManual={() => setProposal('manual')} />
          <TimelineCard incident={inc} />
          <EvidenceCard incident={inc} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <RelatedCard incident={inc} />
          <PostmortemCard incident={inc} />
        </div>
      </div>
    </>
  );
}

function LifecycleCard({ incident }: { incident: IncidentDTO }) {
  const { workspace, can } = useWorkspace();
  const keys = [wsKey(workspace.id, 'incident', incident.id), wsKey(workspace.id, 'timeline', incident.id), wsKey(workspace.id, 'incidents'), wsKey(workspace.id, 'dashboard')];
  const ack = useCommand((key: string) => api.command<IncidentDTO>('POST', `/workspaces/${workspace.id}/incidents/${incident.id}/acknowledge`, { key, version: incident.version }), { invalidate: keys });
  const [target, setTarget] = useState<IncidentStatus | ''>('');
  const [reason, setReason] = useState('');
  const transition = useCommand(
    (key: string, to: IncidentStatus, why: string) =>
      api.command<IncidentDTO>('POST', `/workspaces/${workspace.id}/incidents/${incident.id}/transitions`, { key, version: incident.version, body: { targetStatus: to, reason: why } }),
    {
      invalidate: keys,
      onSuccess: () => {
        setTarget('');
        setReason('');
      },
    },
  );
  const diagnose = useCommand(
    (key: string) => api.command('POST', `/workspaces/${workspace.id}/incidents/${incident.id}/investigations`, { key, version: incident.version, body: { reason: 'Requested from incident view' } }),
    { invalidate: [wsKey(workspace.id, 'investigation', incident.id), wsKey(workspace.id, 'timeline', incident.id)] },
  );

  if (!can('incident.transition') && !can('investigation.request')) {
    return (
      <Banner tone="info" title="Read-only view">
        Your role can follow this incident but not change it.
      </Banner>
    );
  }
  const transitionLabel = (s: IncidentStatus) => (incident.status === 'resolved' && s === 'investigating' ? 'Reopen (investigating)' : label(s));

  return (
    <Card title="Response" meta="Commands are validated by the server against the version you are viewing.">
      <div className="flex flex-col gap-4">
        {incident.status === 'declared' && can('incident.acknowledge') && (
          <div className="flex flex-col gap-2">
            <p>This incident is unacknowledged. Acknowledging assigns it to you and starts the investigation.</p>
            <div>
              <Button variant="primary" onClick={() => void ack.run()} pending={ack.pending} pendingLabel="Acknowledging…">
                Acknowledge incident
              </Button>
            </div>
            <CommandError error={ack.error} />
          </div>
        )}
        {incident.allowedTransitions.length > 0 && can('incident.transition') && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (target && reason.trim()) void transition.run(target, reason.trim());
            }}
          >
            <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
              <Field id="transition-target" label="Change state to">
                <select id="transition-target" className={inputClass} value={target} onChange={(e) => setTarget(e.target.value as IncidentStatus)}>
                  <option value="">Choose a state</option>
                  {incident.allowedTransitions.map((s) => (
                    <option key={s} value={s}>
                      {transitionLabel(s)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="transition-reason" label="Reason" hint={target === 'resolved' ? 'Describe the recovery evidence you confirmed.' : 'Recorded in the timeline and audit log.'}>
                <textarea id="transition-reason" className={`${inputClass} min-h-20`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} aria-describedby="transition-reason-hint" />
              </Field>
            </div>
            <div>
              <Button type="submit" variant={target === 'resolved' ? 'primary' : 'secondary'} disabled={!target || !reason.trim()} pending={transition.pending} pendingLabel="Saving…">
                {target ? `Move to ${transitionLabel(target).toLowerCase()}` : 'Change state'}
              </Button>
            </div>
            <CommandError error={transition.error} />
          </form>
        )}
        {incident.status !== 'resolved' && can('investigation.request') && (
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void diagnose.run()} pending={diagnose.pending} pendingLabel="Requesting…">
                Generate diagnosis
              </Button>
              <span className="text-sm text-fg-muted">An active run is reused; a new request queues at most one follow-up.</span>
            </div>
            <CommandError error={diagnose.error} />
          </div>
        )}
      </div>
    </Card>
  );
}

function EvidenceRef({ id, evidence }: { id: string; evidence: Map<string, EvidenceDTO> }) {
  const e = evidence.get(id);
  return (
    <a href={`#evidence-${id}`} className="inline-flex min-h-8 items-center rounded-[4px] border border-line px-1.5 text-sm text-accent underline-offset-2 hover:underline">
      {e ? `${label(e.sourceType)}: ${e.title.replace(/ \(simulated\)$/, '')}` : 'Evidence unavailable'}
    </a>
  );
}

function DiagnosisCard({ incident, onPropose }: { incident: IncidentDTO; onPropose: (s: SuggestedActionDTO) => void }) {
  const { workspace, can } = useWorkspace();
  const run = useQuery({
    queryKey: wsKey(workspace.id, 'investigation', incident.id),
    queryFn: ({ signal }) => api.get<InvestigationDTO | null>(`/workspaces/${workspace.id}/incidents/${incident.id}/investigations/latest`, signal),
    refetchInterval: (q) => (q.state.data && ['queued', 'running'].includes(q.state.data.state) ? 5000 : false),
  });
  const evidence = useEvidence(incident.id);
  const evMap = new Map((evidence.data?.pages.flatMap((p) => p.items) ?? []).map((e) => [e.id, e]));
  const diag = useQuery({
    queryKey: wsKey(workspace.id, 'diagnosis', incident.id),
    queryFn: ({ signal }) => api.get<import('@aic/contracts').DiagnosisDTO | null>(`/workspaces/${workspace.id}/incidents/${incident.id}/diagnosis`, signal),
  });

  const r = run.data;
  const d = diag.data;
  return (
    <Card title="Diagnosis" actions={<AiBadge />} meta="Suggestions are evidence-based proposals for human review, never approvals.">
      {(run.isLoading || diag.isLoading) && <Skeleton label="Loading diagnosis" />}
      {run.error ? <ErrorState error={run.error} onRetry={() => void run.refetch()} /> : null}
      {r && ['queued', 'running'].includes(r.state) && (
        <p role="status" className="mb-3 text-fg-secondary">
          Investigation {r.state}
          {r.phase ? ` (${r.phase})` : ''}… Manual investigation remains available.
        </p>
      )}
      {r?.state === 'degraded' && (
        <div className="mb-3">
          <Banner tone="warning" title="Automatic diagnosis incomplete">
            {r.degradedReason} {d ? 'The previous diagnosis below is historical.' : ''}
          </Banner>
        </div>
      )}
      {!d && r && !['queued', 'running'].includes(r.state) && <Empty title="No diagnosis available.">Review the evidence below and continue manually.</Empty>}
      {!r && !run.isLoading && <Empty title="No investigation has run yet." />}
      {d && (
        <div className="flex flex-col gap-4">
          {d.validity.superseded && (
            <Banner tone="warning" title="This diagnosis is superseded">
              The incident plan changed after it was produced (remediation revision {d.remediationRevision} vs current {incident.remediationRevision}). Use it as history and request a fresh diagnosis.
            </Banner>
          )}
          <p className="text-sm text-fg-muted">
            AI suggestion · based on {d.evidenceIds.length} evidence records · model profile <code>{d.modelMetadata.providerProfile}</code> · {whenText(d.createdAt)}
          </p>
          <p className="prose-width font-medium">{d.summary}</p>
          {d.facts.length > 0 && (
            <section aria-labelledby="facts-h">
              <h3 id="facts-h" className="font-semibold">
                Observed facts
              </h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {d.facts.map((f, i) => (
                  <li key={i}>
                    {f.statement}{' '}
                    <span className="inline-flex flex-wrap gap-1">
                      {f.support.map((s) => (
                        <EvidenceRef key={s} id={s} evidence={evMap} />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="hyp-h">
            <h3 id="hyp-h" className="font-semibold">
              Hypotheses
            </h3>
            {d.hypotheses.length === 0 && <p className="text-fg-secondary">There is not enough evidence to propose a hypothesis.</p>}
            <ol className="mt-1 flex flex-col gap-3">
              {d.hypotheses.map((h) => (
                <li key={h.id} className="rounded-[10px] border border-line p-3">
                  <p className="font-medium">
                    {h.statement} <Badge tone={h.strength === 'strong' ? 'info' : 'neutral'}>{label(h.strength)} support</Badge>
                  </p>
                  <p className="mt-1 text-sm">
                    Supporting: {h.support.length ? h.support.map((s) => <EvidenceRef key={s} id={s} evidence={evMap} />) : 'none'}
                  </p>
                  {h.contradictions.length > 0 && (
                    <p className="mt-1 text-sm">
                      Contradicting: {h.contradictions.map((s) => <EvidenceRef key={s} id={s} evidence={evMap} />)}
                    </p>
                  )}
                  <p className="mt-1 text-sm text-fg-secondary">Next check: {h.nextCheck}</p>
                </li>
              ))}
            </ol>
          </section>
          {d.missingEvidence.length > 0 && (
            <section aria-labelledby="missing-h">
              <h3 id="missing-h" className="font-semibold">
                Known gaps
              </h3>
              <ul className="mt-1 list-disc pl-5 text-fg-secondary">
                {d.missingEvidence.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </section>
          )}
          {d.suggestedActions.length > 0 && (
            <section aria-labelledby="sugg-h">
              <h3 id="sugg-h" className="font-semibold">
                Suggested action plan
              </h3>
              {d.suggestedActions.map((a, i) => (
                <div key={i} className="mt-2 rounded-[10px] border border-line p-3">
                  <p className="font-medium">
                    {TOOL_LABEL[a.toolId] ?? a.toolId} · {Object.entries(a.arguments).map(([k, v]) => `${k} = ${String(v)}`).join(', ')} <SimulationBadge />
                  </p>
                  <p className="mt-1 text-sm">{a.rationale}</p>
                  <p className="mt-1 text-sm text-fg-secondary">Expected effect: {a.expectedEffect}</p>
                  {can('action.propose') && !d.validity.superseded && incident.status !== 'declared' && incident.status !== 'resolved' && (
                    <div className="mt-2">
                      <Button onClick={() => onPropose(a)}>Review and request this action</Button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </Card>
  );
}

function ProposalCard({ incident, suggestion, onClose }: { incident: IncidentDTO; suggestion: SuggestedActionDTO | null; onClose: () => void }) {
  const { workspace, base } = useWorkspace();
  const router = useRouter();
  const [toolId, setToolId] = useState(suggestion?.toolId ?? 'simulator.rollback_deployment');
  const [toVersion, setToVersion] = useState(String(suggestion?.arguments.toVersion ?? ''));
  const [strategy, setStrategy] = useState(String(suggestion?.arguments.strategy ?? 'rolling'));
  const propose = useCommand(
    (key: string) =>
      api.command<ActionDTO>('POST', `/workspaces/${workspace.id}/incidents/${incident.id}/actions`, {
        key,
        version: incident.version,
        body: {
          toolId,
          arguments: toolId === 'simulator.rollback_deployment' ? { toVersion: toVersion.trim() } : { strategy },
          target: { serviceId: incident.serviceId, environment: incident.environment },
          ...(incident.latestDiagnosisId && suggestion ? { diagnosisId: incident.latestDiagnosisId } : {}),
        },
      }),
    { invalidate: [wsKey(workspace.id, 'incident-actions', incident.id), wsKey(workspace.id, 'timeline', incident.id)], onSuccess: (a) => router.push(`${base}/approvals/${a.id}`) },
  );
  return (
    <Card title="Request an action" meta="Creates an immutable request. Another commander must approve it before the simulator runs it." actions={<SimulationBadge />}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void propose.run();
        }}
      >
        <dl className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)]">
          <dt className="font-medium">Target service</dt>
          <dd className="break-anywhere">{incident.serviceName}</dd>
          <dt className="font-medium">Environment</dt>
          <dd>{incident.environment} (simulation)</dd>
        </dl>
        <Field id="tool" label="Action">
          <select id="tool" className={inputClass} value={toolId} onChange={(e) => setToolId(e.target.value)}>
            <option value="simulator.rollback_deployment">Roll back deployment (simulated)</option>
            <option value="simulator.restart_service">Restart service (simulated)</option>
          </select>
        </Field>
        {toolId === 'simulator.rollback_deployment' ? (
          <Field id="toVersion" label="Roll back to version" hint="Exact release identifier, for example v2.13.4.">
            <input id="toVersion" className={`${inputClass} font-mono`} value={toVersion} onChange={(e) => setToVersion(e.target.value)} pattern="v?\d+\.\d+\.\d+" required aria-describedby="toVersion-hint" />
          </Field>
        ) : (
          <Field id="strategy" label="Restart strategy">
            <select id="strategy" className={inputClass} value={strategy} onChange={(e) => setStrategy(e.target.value)}>
              <option value="rolling">Rolling (keeps partial capacity)</option>
              <option value="all-at-once">All at once (drops capacity briefly)</option>
            </select>
          </Field>
        )}
        <CommandError error={propose.error} />
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit" variant="primary" pending={propose.pending} pendingLabel="Submitting request…">
            Submit action request
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function IncidentActions({ incident, onManual }: { incident: IncidentDTO; onManual: () => void }) {
  const { workspace, base, can } = useWorkspace();
  const q = useQuery({
    queryKey: wsKey(workspace.id, 'incident-actions', incident.id),
    queryFn: ({ signal }) => api.get<Page<ActionDTO>>(`/workspaces/${workspace.id}/actions${qs({ incidentId: incident.id, limit: 20 })}`, signal),
  });
  const canPropose = can('action.propose') && ['investigating', 'mitigating', 'monitoring'].includes(incident.status);
  return (
    <Card title="Action requests" actions={canPropose ? <Button onClick={onManual}>Request an action</Button> : undefined}>
      {q.isLoading && <Skeleton label="Loading action requests" />}
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data && q.data.items.length === 0 && <p className="text-fg-secondary">No action has been requested for this incident.</p>}
      {q.data && q.data.items.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {q.data.items.map((a) => (
            <li key={a.id} className="flex flex-col gap-1 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Link href={`${base}/approvals/${a.id}`} className="font-medium text-accent underline">
                  {TOOL_LABEL[a.spec.toolId] ?? a.spec.toolId} → {Object.values(a.spec.arguments).map(String).join(', ')}
                </Link>
                <p className="text-sm text-fg-secondary">
                  Requested by {a.requestedBy.name} · {whenText(a.createdAt)}
                </p>
              </div>
              <ActionStatusBadge status={a.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TimelineCard({ incident }: { incident: IncidentDTO }) {
  const { workspace, can } = useWorkspace();
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const q = useInfiniteQuery({
    queryKey: wsKey(workspace.id, 'timeline', incident.id, order),
    queryFn: ({ pageParam, signal }) => api.get<Page<TimelineEntryDTO>>(`/workspaces/${workspace.id}/incidents/${incident.id}/timeline${qs({ cursor: pageParam, limit: 30, order })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const [text, setText] = useState('');
  const comment = useCommand(
    (key: string, body: string) => api.command('POST', `/workspaces/${workspace.id}/incidents/${incident.id}/comments`, { key, version: incident.version, body: { text: body } }),
    { invalidate: [wsKey(workspace.id, 'timeline', incident.id), wsKey(workspace.id, 'incident', incident.id)], onSuccess: () => setText('') },
  );
  const entries = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Card
      title="Timeline"
      meta="Durable history in committed order"
      actions={
        <Button onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')} aria-label={`Sort ${order === 'desc' ? 'oldest' : 'newest'} first`}>
          {order === 'desc' ? 'Newest first' : 'Oldest first'}
        </Button>
      }
    >
      {can('incident.comment') && (
        <form
          className="mb-4 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void comment.run(text.trim());
          }}
        >
          <Field id="comment" label="Add a comment" hint="Comments are context for responders; they never grant permissions or change the plan.">
            <textarea id="comment" className={`${inputClass} min-h-20`} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} aria-describedby="comment-hint" />
          </Field>
          <div>
            <Button type="submit" disabled={!text.trim()} pending={comment.pending} pendingLabel="Posting…">
              Post comment
            </Button>
          </div>
          <CommandError error={comment.error} />
        </form>
      )}
      {q.isLoading && <Skeleton label="Loading timeline" />}
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      <ol className="flex flex-col">
        {entries.map((t) => (
          <li key={t.id} className="grid grid-cols-1 gap-1 border-t border-line py-3 first:border-t-0 md:grid-cols-[96px_minmax(0,1fr)] md:gap-4">
            <span className="text-sm text-fg-muted">
              <Time iso={t.createdAt} withDate={Date.now() - new Date(t.createdAt).getTime() > 86400_000} />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-fg-secondary">
                {t.actor.name} · {t.eventType.replace('.', ' ')}
              </p>
              <p className="break-anywhere whitespace-pre-wrap">{t.summary}</p>
            </div>
          </li>
        ))}
      </ol>
      {q.hasNextPage && (
        <Button onClick={() => void q.fetchNextPage()} pending={q.isFetchingNextPage} pendingLabel="Loading…">
          Load earlier entries
        </Button>
      )}
    </Card>
  );
}

function useEvidence(incidentId: string) {
  const { workspace } = useWorkspace();
  return useInfiniteQuery({
    queryKey: wsKey(workspace.id, 'evidence', incidentId),
    queryFn: ({ pageParam, signal }) => api.get<Page<EvidenceDTO>>(`/workspaces/${workspace.id}/incidents/${incidentId}/evidence${qs({ cursor: pageParam, limit: 50 })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
}

function EvidenceCard({ incident }: { incident: IncidentDTO }) {
  const { workspace } = useWorkspace();
  const q = useEvidence(incident.id);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Card title="Evidence and citations" meta="Bounded, redacted excerpts with source, version and collection time">
      {q.isLoading && <Skeleton label="Loading evidence" />}
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data && items.length === 0 && <p className="text-fg-secondary">No evidence collected yet.</p>}
      <ul className="flex flex-col gap-3">
        {items.map((e) => (
          <li key={e.id} id={`evidence-${e.id}`} className="scroll-mt-24 rounded-[10px] border border-line p-3 target:border-accent target:ring-2 target:ring-accent">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{label(e.sourceType)}</Badge>
              <span className="font-medium break-anywhere">{e.title}</span>
              {e.completeness !== 'complete' && <Badge tone="warning">{label(e.completeness)}</Badge>}
              {e.suspectedInjection && (
                <Badge tone="warning" icon="sev2">
                  Instruction-like text · excluded from justification
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-fg-muted">
              Collected {whenText(e.collectedAt)}
              {e.observedFrom && e.observedTo ? ` · window ${e.observedFrom.slice(11, 16)}–${e.observedTo.slice(11, 16)} UTC` : ''}
              {e.sourceVersion ? ` · version ${e.sourceVersion}` : ''}
              {e.redactionCount ? ` · ${e.redactionCount} redaction${e.redactionCount === 1 ? '' : 's'}` : ''}
            </p>
            <details className="mt-2">
              <summary className="min-h-11 cursor-pointer content-center text-accent">Show excerpt</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-[6px] bg-surface-subtle p-3 font-mono text-sm whitespace-pre-wrap break-words" tabIndex={0} aria-label={`Excerpt: ${e.title}`}>
                {e.redactedExcerpt}
              </pre>
              <a
                className="mt-2 inline-flex min-h-11 items-center text-accent underline"
                href={
                  process.env.NEXT_PUBLIC_DEMO === '1'
                    ? `data:text/plain;charset=utf-8,${encodeURIComponent(`# ${e.title}\n# source: ${e.sourceId} (redacted excerpt)\n\n${e.redactedExcerpt}\n`)}`
                    : `/api/v1/workspaces/${workspace.id}/evidence/${e.id}/download`
                }
                download={`evidence-${e.id}.txt`}
              >
                Download redacted excerpt
              </a>
            </details>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RelatedCard({ incident }: { incident: IncidentDTO }) {
  const { workspace, base } = useWorkspace();
  const svc = useQuery({
    queryKey: wsKey(workspace.id, 'service', incident.serviceId),
    queryFn: ({ signal }) => api.get<ServiceDTO>(`/workspaces/${workspace.id}/services/${incident.serviceId}`, signal),
  });
  const all = useQuery({
    queryKey: wsKey(workspace.id, 'services'),
    queryFn: ({ signal }) => api.get<Page<ServiceDTO>>(`/workspaces/${workspace.id}/services?limit=100`, signal),
  });
  const name = (id: string) => all.data?.items.find((s) => s.id === id)?.name ?? 'Service';
  return (
    <Card title="Related context">
      {svc.isLoading && <Skeleton label="Loading service" />}
      {svc.error ? <ErrorState error={svc.error} onRetry={() => void svc.refetch()} /> : null}
      {svc.data && (
        <dl className="flex flex-col gap-2">
          <div>
            <dt className="text-sm text-fg-muted">Service</dt>
            <dd>
              <Link href={`${base}/services/${svc.data.id}`} className="break-anywhere text-accent underline">
                {svc.data.name}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-fg-muted">Owner team</dt>
            <dd>{svc.data.ownerTeam}</dd>
          </div>
          <div>
            <dt className="text-sm text-fg-muted">Dependencies</dt>
            <dd>
              {svc.data.dependencyIds.length ? (
                <ul className="list-disc pl-5">
                  {svc.data.dependencyIds.map((d) => (
                    <li key={d}>
                      <Link href={`${base}/services/${d}`} className="text-accent underline">
                        {name(d)}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                'No dependencies recorded'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-fg-muted">Last alert</dt>
            <dd>{incident.lastAlertAt ? `${relative(incident.lastAlertAt)}` : 'Unavailable'}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}

function PostmortemCard({ incident }: { incident: IncidentDTO }) {
  const { workspace, can } = useWorkspace();
  const q = useQuery({
    queryKey: wsKey(workspace.id, 'postmortem', incident.id),
    queryFn: ({ signal }) => api.get<PostmortemDTO | null>(`/workspaces/${workspace.id}/incidents/${incident.id}/postmortem-drafts/latest`, signal),
    refetchInterval: (s) => (s.state.data?.state === 'generating' ? 3000 : false),
  });
  const request = useCommand((key: string) => api.command('POST', `/workspaces/${workspace.id}/incidents/${incident.id}/postmortem-drafts`, { key, version: incident.version }), {
    invalidate: [wsKey(workspace.id, 'postmortem', incident.id)],
  });
  const download = (md: string) => {
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `postmortem-${incident.reference}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card title="Postmortem draft" meta="Separates confirmed findings from hypotheses and open questions">
      {q.data?.state === 'generating' && <p role="status">Generating draft…</p>}
      {q.data?.state === 'failed' && <Banner tone="danger" title="Draft generation failed." />}
      {q.data?.markdown && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-fg-muted">Draft from {whenText(q.data.createdAt)}</p>
          <pre className="max-h-72 overflow-auto rounded-[6px] bg-surface-subtle p-3 text-sm whitespace-pre-wrap" tabIndex={0} aria-label="Postmortem draft">
            {q.data.markdown}
          </pre>
          <Button onClick={() => download(q.data!.markdown!)}>Export Markdown</Button>
        </div>
      )}
      {can('postmortem.request') && (
        <div className="mt-3 flex flex-col gap-2">
          <Button onClick={() => void request.run()} pending={request.pending} pendingLabel="Requesting…">
            {q.data ? 'Regenerate draft' : 'Create draft'}
          </Button>
          <CommandError error={request.error} />
        </div>
      )}
    </Card>
  );
}
