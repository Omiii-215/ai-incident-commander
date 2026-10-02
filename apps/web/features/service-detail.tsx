'use client';

import type { IncidentDTO, Page, RunbookDTO, ServiceDTO } from '@aic/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, Empty, ErrorState, HealthBadge, Skeleton } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { whenText } from '@/lib/format';
import { useWorkspace, wsKey } from '@/lib/workspace';
import { IncidentCollection, PageHeader } from './shared';

export function ServiceDetail({ id }: { id: string }) {
  const { workspace, base } = useWorkspace();
  const svc = useQuery({ queryKey: wsKey(workspace.id, 'service', id), queryFn: ({ signal }) => api.get<ServiceDTO>(`/workspaces/${workspace.id}/services/${id}`, signal) });
  const all = useQuery({ queryKey: wsKey(workspace.id, 'services'), queryFn: ({ signal }) => api.get<Page<ServiceDTO>>(`/workspaces/${workspace.id}/services?limit=100`, signal) });
  const incidents = useQuery({
    queryKey: wsKey(workspace.id, 'incidents', { serviceId: id }),
    queryFn: ({ signal }) => api.get<Page<IncidentDTO>>(`/workspaces/${workspace.id}/incidents${qs({ serviceId: id, limit: 25 })}`, signal),
  });
  const runbooks = useQuery({
    queryKey: wsKey(workspace.id, 'runbooks', { serviceId: id }),
    queryFn: ({ signal }) => api.get<Page<RunbookDTO>>(`/workspaces/${workspace.id}/runbooks${qs({ serviceId: id, limit: 25 })}`, signal),
  });
  if (svc.isLoading) return <Skeleton lines={6} label="Loading service" />;
  if (!svc.data) return <ErrorState error={svc.error} onRetry={() => void svc.refetch()} />;
  const s = svc.data;
  const name = (d: string) => all.data?.items.find((x) => x.id === d)?.name ?? 'Service';
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm">
        <Link href={`${base}/services`} className="text-accent underline">
          Services
        </Link>{' '}
        / {s.slug}
      </nav>
      <PageHeader title={<span className="break-anywhere">{s.name}</span>} description={`${s.ownerTeam} · ${s.criticality} criticality`} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Health by environment" meta="Simulated health; sampling window 5 minutes">
          <ul className="flex flex-col gap-2">
            {s.health.map((h) => (
              <li key={h.environment} className="flex flex-wrap items-center gap-2">
                <HealthBadge status={h.status} />
                <span>
                  {h.environment} · {h.sampledAt ? `last sample ${whenText(h.sampledAt)}` : h.source}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Dependencies">
          {s.dependencyIds.length ? (
            <ul className="list-disc pl-5">
              {s.dependencyIds.map((d) => (
                <li key={d}>
                  <Link href={`${base}/services/${d}`} className="text-accent underline">
                    {name(d)}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>No dependencies recorded</p>
          )}
        </Card>
        <Card title="Active incidents" className="lg:col-span-2">
          {incidents.isLoading && <Skeleton label="Loading incidents" />}
          {incidents.error ? <ErrorState error={incidents.error} onRetry={() => void incidents.refetch()} /> : null}
          {incidents.data && (incidents.data.items.length ? <IncidentCollection incidents={incidents.data.items} caption={`Active incidents for ${s.name}`} /> : <Empty title="No active incidents for this service." />)}
        </Card>
        <Card title="Linked runbooks" className="lg:col-span-2">
          {runbooks.data?.items.length ? (
            <ul className="list-disc pl-5">
              {runbooks.data.items.map((r) => (
                <li key={r.id}>
                  <Link href={`${base}/runbooks#runbook-${r.id}`} className="text-accent underline">
                    {r.title}
                  </Link>
                  {r.activeVersionId ? '' : ' (not published)'}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-fg-secondary">No runbooks are scoped to this service. Workspace-wide runbooks still apply.</p>
          )}
        </Card>
      </div>
    </>
  );
}
