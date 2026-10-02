'use client';

import type { ActionDTO, ActionStatus, Page } from '@aic/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ActionStatusBadge, Button, Card, CommandError, Empty, ErrorState, Field, inputClass, SimulationBadge, Skeleton, Time } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { useCommand } from '@/lib/commands';
import { relative } from '@/lib/format';
import { useWorkspace, wsKey } from '@/lib/workspace';
import { PageHeader } from './shared';

const VIEWS: Array<{ id: string; label: string; status: ActionStatus[] }> = [
  { id: 'pending', label: 'Awaiting approval', status: ['awaiting_approval'] },
  { id: 'inflight', label: 'Queued and running', status: ['approved', 'queued', 'executing', 'outcome_unknown'] },
  { id: 'done', label: 'Completed', status: ['succeeded', 'failed', 'rejected', 'expired', 'cancelled'] },
  { id: 'all', label: 'All', status: [] },
];

function DispatchControl() {
  const { workspace, can } = useWorkspace();
  const [reason, setReason] = useState('');
  const cmd = useCommand(
    (key: string, stopped: boolean) => api.command('POST', `/workspaces/${workspace.id}/dispatch-controls`, { key, body: { stopped, reason: reason.trim() } }),
    { invalidate: [['me']], onSuccess: () => setReason('') },
  );
  if (!can('dispatch.stop')) return null;
  const stopped = workspace.dispatchStopped;
  return (
    <Card title="Dispatch control" meta="Stops new dispatch immediately. An external call already in flight may still finish and is reconciled.">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) void cmd.run(!stopped);
        }}
      >
        <Field id="dispatch-reason" label="Reason (recorded in the audit log)">
          <input id="dispatch-reason" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        </Field>
        <div>
          <Button type="submit" variant={stopped ? 'secondary' : 'danger'} disabled={!reason.trim()} pending={cmd.pending}>
            {stopped ? 'Resume action dispatch' : 'Stop action dispatch'}
          </Button>
        </div>
        <CommandError error={cmd.error} />
      </form>
    </Card>
  );
}

export function ApprovalsQueue() {
  const { workspace, base } = useWorkspace();
  const [view, setView] = useState('pending');
  const v = VIEWS.find((x) => x.id === view)!;
  const q = useInfiniteQuery({
    queryKey: wsKey(workspace.id, 'actions', view),
    queryFn: ({ pageParam, signal }) => api.get<Page<ActionDTO>>(`/workspaces/${workspace.id}/actions${qs({ status: v.status, cursor: pageParam, limit: 25 })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHeader title="Approvals" description="Action requests and their review history. Approval applies to one immutable request and expires ten minutes after it was issued." actions={<SimulationBadge />} />
      <div role="group" aria-label="Filter requests" className="mb-4 flex flex-wrap gap-2">
        {VIEWS.map((x) => (
          <Button key={x.id} variant={view === x.id ? 'primary' : 'secondary'} aria-pressed={view === x.id} onClick={() => setView(x.id)}>
            {x.label}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-label={v.label} className="min-w-0">
          {q.isLoading && <Skeleton lines={5} label="Loading requests" />}
          {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
          {q.data && items.length === 0 && <Empty title="No requests in this view." />}
          <ul className="flex flex-col gap-3">
            {items.map((a) => (
              <li key={a.id} className="card rounded-[10px] border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold">
                      <Link href={`${base}/approvals/${a.id}`} className="break-anywhere text-accent underline">
                        {a.spec.toolId === 'simulator.rollback_deployment' ? 'Roll back' : 'Restart'} · {a.incidentTitle}
                      </Link>
                    </h2>
                    <p className="text-sm">
                      Target {a.spec.target.environment} · arguments {Object.entries(a.spec.arguments).map(([k, val]) => `${k}=${String(val)}`).join(', ')}
                    </p>
                    <p className="text-sm text-fg-secondary">
                      Requested by {a.requestedBy.name}
                      {a.renewedBy ? `, renewed by ${a.renewedBy.name}` : ''} · {relative(a.createdAt)}
                    </p>
                  </div>
                  <ActionStatusBadge status={a.status} />
                </div>
                {a.status === 'awaiting_approval' && (
                  <p className="mt-2 text-sm">
                    Expires {relative(a.expiresAt)} (<Time iso={a.expiresAt} />)
                  </p>
                )}
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <div className="mt-3">
              <Button onClick={() => void q.fetchNextPage()} pending={q.isFetchingNextPage}>
                Load more
              </Button>
            </div>
          )}
        </section>
        <div>
          <DispatchControl />
        </div>
      </div>
    </>
  );
}
