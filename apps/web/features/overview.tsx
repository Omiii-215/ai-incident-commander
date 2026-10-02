'use client';

import Link from 'next/link';
import { ActionStatusBadge, Card, Empty, ErrorState, HealthBadge, SimulationBadge, Skeleton, Time } from '@/components/ui';
import { relative, whenText } from '@/lib/format';
import { useDashboard } from '@/lib/realtime';
import { useWorkspace } from '@/lib/workspace';
import { IncidentCollection, PageHeader } from './shared';

function Metric({ label, value, scope, href }: { label: string; value: number; scope: string; href: string }) {
  return (
    <Link href={href} className="card flex min-w-[136px] flex-col gap-1 rounded-[10px] border border-line bg-surface p-4 hover:bg-surface-hover">
      <span className="text-sm font-medium text-fg-secondary">{label}</span>
      <span className="tabular text-[1.75rem] font-[650] leading-tight lg:text-[2rem]">{value}</span>
      <span className="text-xs text-fg-muted">{scope}</span>
    </Link>
  );
}

export function Overview() {
  const { workspace, base, can } = useWorkspace();
  const q = useDashboard(workspace.id);
  const d = q.data?.data;
  const showApprovals = can('action.queue.read');

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          <>
            Current incident load and service health for {workspace.name}.{' '}
            {d && <span className="text-fg-muted">Snapshot {whenText(d.generatedAt)}.</span>}
          </>
        }
        actions={<SimulationBadge />}
      />
      {q.isLoading && <Skeleton lines={6} label="Loading overview" />}
      {q.error && !d ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.error && d ? <p className="mb-3 text-sm text-warning">Background refresh failed; showing data from {whenText(d.generatedAt)}.</p> : null}
      {d && (
        <div className="flex flex-col gap-6">
          <section aria-labelledby="metrics-h">
            <h2 id="metrics-h" className="sr-only">
              Summary metrics
            </h2>
            <div className={`grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 ${showApprovals ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
              <Metric label="Open SEV1" value={d.metrics.openSev1} scope="Active · demo · all services" href={`${base}/incidents?severity=sev1`} />
              <Metric label="Open incidents" value={d.metrics.openIncidents} scope="Active · demo · all services" href={`${base}/incidents`} />
              {showApprovals && d.metrics.pendingApprovals !== null && (
                <Metric label="Pending approvals" value={d.metrics.pendingApprovals} scope="Awaiting review · simulation" href={`${base}/approvals`} />
              )}
              <Metric label="Services with unknown health" value={d.metrics.unknownServices} scope="No fresh telemetry sample" href={`${base}/services`} />
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <Card
              title="Active incidents"
              meta="Severity first, then latest change"
              className={showApprovals ? 'lg:col-span-8' : 'lg:col-span-12'}
              actions={
                <Link href={`${base}/incidents`} className="text-accent underline">
                  All incidents
                </Link>
              }
            >
              {d.activeIncidents.length ? (
                <IncidentCollection incidents={d.activeIncidents.slice(0, 8)} caption="Active incidents" />
              ) : (
                <Empty title="No active incidents.">Send a sample alert to try the workflow (pnpm send-alert).</Empty>
              )}
            </Card>
            {showApprovals && d.pendingApprovals && (
              <Card title="Pending approvals" meta="Soonest expiry first" className="lg:col-span-4">
                {d.pendingApprovals.length ? (
                  <ul className="flex flex-col divide-y divide-line">
                    {d.pendingApprovals.map((a) => (
                      <li key={a.id} className="py-3 first:pt-0">
                        <Link href={`${base}/approvals/${a.id}`} className="font-semibold text-accent underline-offset-2 hover:underline">
                          <span className="break-anywhere">{a.incidentTitle}</span>
                        </Link>
                        <p className="text-sm">
                          {a.spec.toolId.replace('simulator.', '').replace(/_/g, ' ')} · {a.spec.target.environment}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-secondary">
                          <ActionStatusBadge status={a.status} />
                          <span>
                            expires {relative(a.expiresAt)} (<Time iso={a.expiresAt} />)
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty title="Nothing awaiting review." />
                )}
              </Card>
            )}
          </div>

          <Card title="Service health" meta="Simulated health · healthy only with a fresh sample">
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {d.services.map((s) => (
                <li key={s.id} className="rounded-[10px] border border-line p-3">
                  <Link href={`${base}/services/${s.id}`} className="break-anywhere line-clamp-2 font-semibold text-accent underline-offset-2 hover:underline">
                    {s.name}
                  </Link>
                  {s.health.map((h) => (
                    <div key={h.environment} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <HealthBadge status={h.status} />
                      <span className="text-fg-muted">
                        {h.environment} · {h.sampledAt ? <>sampled {relative(h.sampledAt)}</> : h.source}
                      </span>
                    </div>
                  ))}
                  <p className="mt-1 text-sm text-fg-secondary">{s.activeIncidentCount} active incident{s.activeIncidentCount === 1 ? '' : 's'}</p>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Recent workspace activity">
            {d.recentActivity.length ? (
              <ol className="flex flex-col divide-y divide-line">
                {d.recentActivity.map((t) => (
                  <li key={t.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
                    <span className="w-24 shrink-0 text-sm text-fg-muted">
                      <Time iso={t.createdAt} />
                    </span>
                    <span className="break-anywhere min-w-0">
                      <span className="font-medium">{t.actor.name}</span>: {t.summary}{' '}
                      <Link href={`${base}/incidents/${t.incidentId}`} className="text-accent underline">
                        Open incident
                      </Link>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty title="No activity yet." />
            )}
          </Card>
        </div>
      )}
    </>
  );
}
