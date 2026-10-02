'use client';

import type { ActionDTO, DiagnosisDTO, EvidenceDTO, IncidentDTO, Page } from '@aic/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ActionStatusBadge, Badge, Banner, Button, Card, CommandError, ErrorState, Field, inputClass, SeverityBadge, SimulationBadge, Skeleton, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { useCommand } from '@/lib/commands';
import { duration, label, whenText } from '@/lib/format';
import { useWorkspace, wsKey } from '@/lib/workspace';

const VERB: Record<string, string> = { 'simulator.rollback_deployment': 'rollback', 'simulator.restart_service': 'restart' };

/** Countdown updates visually every second without announcing each tick. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function ApprovalReview({ id }: { id: string }) {
  const { workspace, me, base, can } = useWorkspace();
  const router = useRouter();
  const action = useQuery({
    queryKey: wsKey(workspace.id, 'action', id),
    queryFn: ({ signal }) => api.get<ActionDTO>(`/workspaces/${workspace.id}/actions/${id}`, signal),
    refetchInterval: (q) => (q.state.data && ['queued', 'executing', 'outcome_unknown', 'approved'].includes(q.state.data.status) ? 3000 : false),
  });
  const a = action.data;
  const incident = useQuery({
    enabled: !!a,
    queryKey: wsKey(workspace.id, 'incident', a?.incidentId),
    queryFn: ({ signal }) => api.get<IncidentDTO>(`/workspaces/${workspace.id}/incidents/${a!.incidentId}`, signal),
  });
  const diagnosis = useQuery({
    enabled: !!a?.diagnosisId,
    queryKey: wsKey(workspace.id, 'diagnosis', a?.incidentId),
    queryFn: ({ signal }) => api.get<DiagnosisDTO | null>(`/workspaces/${workspace.id}/incidents/${a!.incidentId}/diagnosis`, signal),
  });
  const evidence = useQuery({
    enabled: !!a,
    queryKey: wsKey(workspace.id, 'evidence-flat', a?.incidentId),
    queryFn: ({ signal }) => api.get<Page<EvidenceDTO>>(`/workspaces/${workspace.id}/incidents/${a!.incidentId}/evidence?limit=100`, signal),
  });
  const awaiting = a?.status === 'awaiting_approval';
  const now = useNow(!!awaiting);

  // Acknowledgement binds to the exact spec; any change clears it.
  const [ackFor, setAckFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const binding = a ? `${a.id}:${a.specHash}:${a.version}:${incident.data?.remediationRevision ?? ''}` : null;
  const acknowledged = ackFor !== null && ackFor === binding;
  useEffect(() => {
    if (ackFor && ackFor !== binding) setAckFor(null);
  }, [ackFor, binding]);

  const invalidate = [wsKey(workspace.id, 'action', id), wsKey(workspace.id, 'actions'), wsKey(workspace.id, 'dashboard'), wsKey(workspace.id, 'incident-actions')];
  const decide = useCommand(
    (key: string, decision: 'approve' | 'reject') =>
      api.command<ActionDTO>('POST', `/workspaces/${workspace.id}/actions/${id}/decisions`, { key, version: a!.version, body: { decision, specHash: a!.specHash, reason: reason.trim() } }),
    { invalidate, onSuccess: () => setReason('') },
  );
  const renew = useCommand(
    (key: string) => api.command<ActionDTO>('POST', `/workspaces/${workspace.id}/actions/${id}/renew`, { key, version: a!.version, body: { reason: 'Review renewed after expiry or plan change' } }),
    { invalidate, onSuccess: (n) => router.push(`${base}/approvals/${n.id}`) },
  );
  const cancel = useCommand(
    (key: string) => api.command<ActionDTO>('POST', `/workspaces/${workspace.id}/actions/${id}/cancel`, { key, version: a!.version, body: { reason: reason.trim() || 'Withdrawn by requester' } }),
    { invalidate },
  );

  if (action.isLoading) return <Skeleton lines={10} label="Loading review" />;
  if (!a) return <ErrorState error={action.error} onRetry={() => void action.refetch()} title="This request could not load." />;

  const expiresMs = new Date(a.expiresAt).getTime() - now;
  const expired = awaiting && expiresMs <= 0;
  const inc = incident.data;
  const planChanged = !!inc && (inc.remediationRevision !== a.spec.remediationRevision || inc.generation !== a.spec.incidentGeneration);
  const isRequester = a.requestedBy.id === me.user.id || a.renewedBy?.id === me.user.id;
  const isCommander = can('action.decide');
  const verb = VERB[a.spec.toolId] ?? 'action';
  const blocker = !isCommander
    ? 'You need the commander role to approve this request.'
    : isRequester
      ? 'Another commander must review this request.'
      : expired
        ? 'This request expired. Renew the review to create a fresh request.'
        : planChanged
          ? 'The plan changed during review. Read the updated request before approving.'
          : workspace.dispatchStopped
            ? 'Action dispatch is stopped. An approval would not execute until dispatch resumes.'
            : null;
  const canDecide = awaiting && isCommander && !isRequester && !expired && !planChanged && !action.isFetching;
  const evMap = new Map((evidence.data?.items ?? []).map((e) => [e.id, e]));
  const suggestion = diagnosis.data?.suggestedActions.find((s) => s.toolId === a.spec.toolId);
  const citations = suggestion?.support ?? [];

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm">
        <Link href={can('action.queue.read') ? `${base}/approvals` : `${base}/incidents/${a.incidentId}`} className="text-accent underline">
          {can('action.queue.read') ? 'Approvals' : 'Incident'}
        </Link>{' '}
        / review
      </nav>
      <div className="mb-6 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ActionStatusBadge status={a.status} />
          <SimulationBadge />
          <Badge tone="neutral">Workspace: {workspace.name}</Badge>
          <Badge tone="neutral">Environment: {a.spec.target.environment}</Badge>
        </div>
        <h1 className="page-title">
          {label(verb)} {inc?.serviceName ?? 'service'} in {a.spec.target.environment} (simulation)
        </h1>
        <p className="text-fg-secondary">Simulation only. No production resources will change.</p>
      </div>

      {a.status === 'queued' && <Banner tone="info" title="Approval recorded; waiting for dispatch.">The executor re-checks permissions, revisions, expiry and stop controls immediately before running.</Banner>}
      {a.status === 'executing' && <Banner tone="info" title="Executing in the simulator…">Cancellation is no longer possible once dispatch has begun.</Banner>}
      {a.status === 'succeeded' && <Banner tone="success" title="Execution succeeded.">The connector completed the operation. Confirm recovery with the verification criteria before resolving the incident.</Banner>}
      {a.status === 'failed' && <Banner tone="danger" title="Execution failed.">{a.statusReason}</Banner>}
      {a.status === 'outcome_unknown' && (
        <Banner tone="warning" title="Execution outcome is unknown. Reconciliation is in progress.">
          The request may have taken effect. It will not be retried automatically; reconciliation queries the provider using the same execution key.
        </Banner>
      )}
      {(a.status === 'cancelled' || a.status === 'rejected' || a.status === 'expired') && (
        <Banner tone="warning" title={`This request was ${a.status}.`}>
          {a.statusReason}
          {a.supersededByActionId && (
            <>
              {' '}
              <Link className="underline" href={`${base}/approvals/${a.supersededByActionId}`}>
                Open the renewed request
              </Link>
            </>
          )}
        </Banner>
      )}

      {/* Side summary only when the content container is >= 900 px; DOM order keeps the decision after the details. */}
      <div className="@container mt-6">
      <div className="grid grid-cols-1 gap-6 @[900px]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="What will change">
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[180px_minmax(0,1fr)]">
              <dt className="font-medium">Tool</dt>
              <dd>
                <code>{a.spec.toolId}</code> version {a.spec.toolVersion}
              </dd>
              <dt className="font-medium">Target service</dt>
              <dd className="break-anywhere">
                {inc?.serviceName ?? a.spec.target.serviceId} <span className="font-mono text-sm text-fg-muted">({a.spec.target.serviceId})</span>
              </dd>
              <dt className="font-medium">Environment</dt>
              <dd>{a.spec.target.environment}</dd>
              <dt className="font-medium">Target revision</dt>
              <dd className="font-mono">{a.spec.target.revision}</dd>
              <dt className="font-medium">Arguments</dt>
              <dd>
                <ul>
                  {Object.entries(a.spec.arguments).map(([k, v]) => (
                    <li key={k}>
                      <span className="text-fg-secondary">{k}:</span> <code className="font-semibold">{String(v)}</code>
                    </li>
                  ))}
                </ul>
              </dd>
              <dt className="font-medium">Expected effect</dt>
              <dd>{a.spec.expectedEffect}</dd>
              <dt className="font-medium">Risk</dt>
              <dd>{a.spec.riskSummary}</dd>
              <dt className="font-medium">Verification</dt>
              <dd>
                {a.spec.verification.metric} {a.spec.verification.operator === 'lt' ? '<' : a.spec.verification.operator === 'gt' ? '>' : '='} {a.spec.verification.value} within{' '}
                {Math.round(a.spec.verification.windowSeconds / 60)} min
              </dd>
              <dt className="font-medium">Rollback</dt>
              <dd>No automatic rollback. Reverting requires a separate request and approval.</dd>
            </dl>
            <details className="mt-4">
              <summary className="min-h-11 cursor-pointer content-center text-accent">Raw specification (JSON)</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-[6px] bg-surface-subtle p-3 font-mono text-sm" tabIndex={0} aria-label="Raw action specification">
                {JSON.stringify(a.spec, null, 2)}
              </pre>
            </details>
          </Card>

          <Card title="Why" meta="Supporting evidence cited by the diagnosis">
            {inc && (
              <p className="mb-3">
                Incident:{' '}
                <Link href={`${base}/incidents/${a.incidentId}`} className="break-anywhere text-accent underline">
                  {inc.reference} {inc.title}
                </Link>{' '}
                <SeverityBadge severity={inc.severity} /> <StatusBadge status={inc.status} />
              </p>
            )}
            {suggestion ? <p className="mb-3">{suggestion.rationale}</p> : <p className="mb-3 text-fg-secondary">This request was created manually without an AI suggestion.</p>}
            {citations.length > 0 && (
              <ul className="flex flex-col gap-2">
                {citations.map((c) => {
                  const e = evMap.get(c);
                  return (
                    <li key={c} className="rounded-[6px] border border-line p-2">
                      <p className="font-medium">{e?.title ?? 'Evidence unavailable'}</p>
                      {e && (
                        <p className="text-sm text-fg-muted">
                          {label(e.sourceType)} · collected {whenText(e.collectedAt)}
                          {e.sourceVersion ? ` · version ${e.sourceVersion}` : ''}
                        </p>
                      )}
                      {e && <pre className="mt-1 max-h-32 overflow-auto font-mono text-xs whitespace-pre-wrap">{e.redactedExcerpt.slice(0, 600)}</pre>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {a.execution && (
            <Card title="Execution record">
              <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[180px_minmax(0,1fr)]">
                <dt className="font-medium">Execution key</dt>
                <dd className="font-mono text-sm break-anywhere">{a.execution.executionKey}</dd>
                <dt className="font-medium">Dispatched</dt>
                <dd>{whenText(a.execution.dispatchAt)}</dd>
                <dt className="font-medium">Status</dt>
                <dd>{label(a.execution.status)}</dd>
                <dt className="font-medium">Reconciliation</dt>
                <dd>{label(a.execution.reconciliationState ?? 'not required')}</dd>
                {a.execution.receipt && (
                  <>
                    <dt className="font-medium">Receipt</dt>
                    <dd className="break-anywhere">{String(a.execution.receipt.detail ?? '')} (provider request {String(a.execution.receipt.providerRequestId ?? '')})</dd>
                  </>
                )}
              </dl>
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Review requirements">
            <dl className="flex flex-col gap-2">
              <div>
                <dt className="text-sm text-fg-muted">Requested by</dt>
                <dd>{a.requestedBy.name}</dd>
              </div>
              {a.renewedBy && (
                <div>
                  <dt className="text-sm text-fg-muted">Renewed by</dt>
                  <dd>{a.renewedBy.name}</dd>
                </div>
              )}
              <div>
                <dt className="text-sm text-fg-muted">Approver</dt>
                <dd>{a.decision ? `${a.decision.decidedBy.name} (${a.decision.decision}) · ${whenText(a.decision.decidedAt)}` : 'An independent commander who did not request or renew this action'}</dd>
              </div>
              {a.decision && (
                <div>
                  <dt className="text-sm text-fg-muted">Decision reason</dt>
                  <dd className="break-anywhere">{a.decision.reason}</dd>
                </div>
              )}
              <div>
                <dt className="text-sm text-fg-muted">Expires</dt>
                <dd>
                  {whenText(a.expiresAt)}
                  {awaiting && (
                    <span className="block font-semibold tabular" aria-hidden={!expired}>
                      {expired ? 'Expired' : `${duration(expiresMs)} remaining`}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-fg-muted">Spec fingerprint</dt>
                <dd className="font-mono text-xs break-anywhere">{a.specHash}</dd>
              </div>
              <div>
                <dt className="text-sm text-fg-muted">Bound to</dt>
                <dd className="text-sm">
                  incident generation {a.spec.incidentGeneration} · remediation revision {a.spec.remediationRevision}
                </dd>
              </div>
            </dl>
          </Card>

          {awaiting && (
            <Card title="Decision">
              <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault() /* Enter never approves */}>
                {blocker && <Banner tone="warning" title={blocker} />}
                {canDecide && (
                  <>
                    <label className="flex items-start gap-3">
                      <input type="checkbox" className="mt-1 size-5 shrink-0" checked={acknowledged} onChange={(e) => setAckFor(e.target.checked ? binding : null)} />
                      <span>
                        I reviewed the environment <strong>{a.spec.target.environment}</strong>, the target <strong>{inc?.serviceName}</strong> at revision{' '}
                        <strong className="font-mono">{a.spec.target.revision}</strong>, and the arguments above.
                      </span>
                    </label>
                    <Field id="decision-reason" label="Reason" hint="Required for approval and rejection.">
                      <textarea id="decision-reason" className={`${inputClass} min-h-24`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} aria-describedby="decision-reason-hint" />
                    </Field>
                    <div className="flex flex-col gap-3">
                      <Button variant="primary" disabled={!acknowledged || !reason.trim()} pending={decide.pending} pendingLabel="Recording decision…" onClick={() => void decide.run('approve')}>
                        Approve simulated {verb}
                      </Button>
                      <Button variant="danger" disabled={!reason.trim()} pending={decide.pending} pendingLabel="Recording decision…" onClick={() => void decide.run('reject')}>
                        Reject request
                      </Button>
                    </div>
                  </>
                )}
                <CommandError error={decide.error} />
                {decide.uncertain && (
                  <Button onClick={() => void decide.retrySame()}>Check and retry the same decision</Button>
                )}
              </form>
            </Card>
          )}

          {(expired || planChanged || a.status === 'expired') && !a.supersededByActionId && can('action.renew') && (
            <Card title="Renew review">
              <p className="mb-3 text-sm">Renewal re-runs preflight and creates a new request with a new fingerprint and expiry. The previous approval never transfers; the original requester stays recorded.</p>
              <Button onClick={() => void renew.run()} pending={renew.pending} pendingLabel="Renewing…">
                Renew review
              </Button>
              <CommandError error={renew.error} />
            </Card>
          )}

          {['awaiting_approval', 'approved', 'queued'].includes(a.status) && (isRequester || isCommander) && can('action.cancel') && (
            <Card title="Withdraw">
              <Button variant="danger" onClick={() => void cancel.run()} pending={cancel.pending} pendingLabel="Cancelling…">
                Cancel this request
              </Button>
              <CommandError error={cancel.error} />
            </Card>
          )}
        </div>
      </div>
      </div>
    </>
  );
}
