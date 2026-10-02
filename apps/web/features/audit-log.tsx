'use client';

import type { AuditEventDTO, Page } from '@aic/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Empty, ErrorState, inputClass, Skeleton, Time } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { useWorkspace, wsKey } from '@/lib/workspace';
import { PageHeader } from './shared';

export function AuditLog() {
  const { workspace } = useWorkspace();
  const [operation, setOperation] = useState('');
  const [applied, setApplied] = useState('');
  const q = useInfiniteQuery({
    queryKey: wsKey(workspace.id, 'audit', applied),
    queryFn: ({ pageParam, signal }) => api.get<Page<AuditEventDTO>>(`/workspaces/${workspace.id}/audit${qs({ operation: applied || undefined, cursor: pageParam, limit: 50 })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHeader title="Audit log" description="Read-only view of durable audit records: who did what, the policy outcome and correlation reference. No secrets or prompts are stored here." />
      <form
        className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(operation.trim().toLowerCase());
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-op" className="font-medium">
            Operation prefix
          </label>
          <input id="audit-op" className={`${inputClass} sm:w-72`} value={operation} onChange={(e) => setOperation(e.target.value)} placeholder="e.g. action. or incident.transition" pattern="[a-z0-9_.-]*" maxLength={80} />
        </div>
        <Button type="submit">Apply</Button>
      </form>
      {q.isLoading && <Skeleton lines={6} label="Loading audit log" />}
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data && items.length === 0 && <Empty title="No audit records match." />}
      {items.length > 0 && (
        <div className="overflow-x-auto rounded-[10px] border border-line bg-surface" role="region" aria-label="Audit records (scrolls horizontally on small screens)" tabIndex={0}>
          <table className="w-full min-w-[720px] text-left text-sm">
            <caption className="sr-only">Audit records, newest first</caption>
            <thead className="bg-surface-subtle text-fg-secondary">
              <tr>
                <th scope="col" className="px-3 py-2">Time</th>
                <th scope="col" className="px-3 py-2">Actor</th>
                <th scope="col" className="px-3 py-2">Operation</th>
                <th scope="col" className="px-3 py-2">Entity</th>
                <th scope="col" className="px-3 py-2">Outcome</th>
                <th scope="col" className="px-3 py-2">Reference</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-t border-line align-top">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Time iso={a.createdAt} withDate />
                  </td>
                  <td className="px-3 py-2">
                    {a.actor.name}
                    <span className="block text-xs text-fg-muted">{a.actor.type}</span>
                  </td>
                  <td className="px-3 py-2 font-mono">{a.operation}</td>
                  <td className="px-3 py-2">
                    {a.resource.type}
                    <span className="block font-mono text-xs text-fg-muted">{a.resource.id.slice(0, 8)}…</span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={a.decision === 'denied' ? 'warning' : 'neutral'}>{a.decision === 'denied' ? 'Denied by policy' : 'Allowed'}</Badge>
                    {a.reasonCode && <span className="block text-xs text-fg-muted break-anywhere">{a.reasonCode}</span>}
                    {a.beforeVersion !== null && a.afterVersion !== null && (
                      <span className="block text-xs text-fg-muted">
                        v{a.beforeVersion} → v{a.afterVersion}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs break-anywhere">
                    {a.requestId.slice(0, 13)}
                    {a.specHash && <span className="block">{a.specHash.slice(0, 19)}…</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.hasNextPage && (
        <div className="mt-3">
          <Button onClick={() => void q.fetchNextPage()} pending={q.isFetchingNextPage}>
            Load older records
          </Button>
        </div>
      )}
    </>
  );
}
