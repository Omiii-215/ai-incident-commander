'use client';

import type { IncidentDTO } from '@aic/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, Button, CommandError, SeverityBadge, StatusBadge, Time } from '@/components/ui';
import { api } from '@/lib/api';
import { useCommand } from '@/lib/commands';
import { relative } from '@/lib/format';
import { useWorkspace, wsKey } from '@/lib/workspace';

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-sm text-fg-muted">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {description && <p className="prose-width mt-1 text-fg-secondary">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

function AckButton({ incident }: { incident: IncidentDTO }) {
  const { workspace } = useWorkspace();
  const cmd = useCommand(
    (key: string) => api.command<IncidentDTO>('POST', `/workspaces/${workspace.id}/incidents/${incident.id}/acknowledge`, { key, version: incident.version }),
    { invalidate: [wsKey(workspace.id, 'incidents'), wsKey(workspace.id, 'incident', incident.id), wsKey(workspace.id, 'dashboard')] },
  );
  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" onClick={() => void cmd.run()} pending={cmd.pending} pendingLabel="Acknowledging…">
        Acknowledge incident
      </Button>
      <CommandError error={cmd.error} />
    </div>
  );
}

/** Desktop table (>=768) or narrow cards — exactly one is exposed at a time. */
export function IncidentCollection({ incidents, caption }: { incidents: IncidentDTO[]; caption: string }) {
  const { base, can } = useWorkspace();
  const canAck = can('incident.acknowledge');
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-subtle text-sm text-fg-secondary">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Severity</th>
              <th scope="col" className="px-3 py-2 font-semibold">Incident</th>
              <th scope="col" className="px-3 py-2 font-semibold">Service · environment</th>
              <th scope="col" className="px-3 py-2 font-semibold">State</th>
              <th scope="col" className="hidden px-3 py-2 font-semibold lg:table-cell">Owner</th>
              <th scope="col" className="px-3 py-2 font-semibold">Updated</th>
            </tr>
          </thead>
          <tbody>
            {incidents.map((i) => (
              <tr key={i.id} className="border-t border-line align-top">
                <td className="px-3 py-3">
                  <SeverityBadge severity={i.severity} />
                </td>
                <td className="min-w-64 px-3 py-3">
                  <Link href={`${base}/incidents/${i.id}`} className="font-semibold text-accent underline-offset-2 hover:underline">
                    <span className="break-anywhere line-clamp-2">{i.title}</span>
                  </Link>
                  <span className="block font-mono text-xs text-fg-muted">{i.reference}</span>
                </td>
                <td className="px-3 py-3">
                  <span className="break-anywhere line-clamp-2">{i.serviceName}</span>
                  <span className="text-sm text-fg-muted">{i.environment}</span>
                </td>
                <td className="px-3 py-3">
                  <StatusBadge status={i.status} />
                </td>
                <td className="hidden px-3 py-3 lg:table-cell">{i.ownerName ?? <span className="text-fg-muted">Unassigned</span>}</td>
                <td className="px-3 py-3 text-sm">
                  <span className="block">{relative(i.updatedAt)}</span>
                  <span className="text-fg-muted">
                    <Time iso={i.updatedAt} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-3 md:hidden" aria-label={caption}>
        {incidents.map((i) => (
          <li key={i.id} className="card rounded-[10px] border border-line bg-surface p-4">
            <article className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <SeverityBadge severity={i.severity} />
                <StatusBadge status={i.status} />
              </div>
              <h3 className="text-base font-semibold">
                <Link href={`${base}/incidents/${i.id}`} className="break-anywhere text-accent underline underline-offset-2">
                  {i.title}
                </Link>
              </h3>
              <p className="break-anywhere text-sm">
                {i.serviceName} · <Badge tone="neutral">{i.environment}</Badge>
              </p>
              <p className="text-sm text-fg-secondary">
                {i.ownerName ?? 'Unassigned'} · updated {relative(i.updatedAt)} (<Time iso={i.updatedAt} />)
              </p>
              {canAck && i.status === 'declared' ? (
                <AckButton incident={i} />
              ) : (
                <Link href={`${base}/incidents/${i.id}`} className="inline-flex min-h-11 items-center justify-center rounded-[6px] border border-line-control px-4">
                  View incident
                </Link>
              )}
            </article>
          </li>
        ))}
      </ul>
    </>
  );
}
