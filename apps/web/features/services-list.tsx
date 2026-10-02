'use client';

import type { Page, ServiceDTO } from '@aic/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge, Empty, ErrorState, HealthBadge, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { useWorkspace, wsKey } from '@/lib/workspace';
import { PageHeader } from './shared';

export function ServicesList() {
  const { workspace, base } = useWorkspace();
  const q = useQuery({
    queryKey: wsKey(workspace.id, 'services'),
    queryFn: ({ signal }) => api.get<Page<ServiceDTO>>(`/workspaces/${workspace.id}/services?limit=100`, signal),
  });
  return (
    <>
      <PageHeader title="Services" description="Service inventory and simulated health. A service without a fresh sample is shown as Unknown, never healthy." />
      {q.isLoading && <Skeleton lines={6} label="Loading services" />}
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data?.items.length === 0 && <Empty title="No services in this workspace." />}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {q.data?.items.map((s) => (
          <li key={s.id} className="card flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-4">
            <h2 className="text-base font-semibold">
              <Link href={`${base}/services/${s.id}`} className="break-anywhere line-clamp-3 text-accent underline">
                {s.name}
              </Link>
            </h2>
            <p className="text-sm text-fg-secondary">
              {s.ownerTeam} · <Badge tone="neutral">{s.criticality} criticality</Badge>
            </p>
            {s.health.map((h) => (
              <div key={h.environment} className="flex flex-wrap items-center gap-2 text-sm">
                <HealthBadge status={h.status} />
                <span className="text-fg-muted">
                  {h.environment} · {h.sampledAt ? `${h.source}, sampled ${relative(h.sampledAt)}` : h.source}
                </span>
              </div>
            ))}
            <p className="text-sm">
              {s.activeIncidentCount} active incident{s.activeIncidentCount === 1 ? '' : 's'}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
