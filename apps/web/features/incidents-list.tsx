'use client';

import { INCIDENT_STATUSES, SEVERITIES, type IncidentDTO, type Page } from '@aic/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Badge, Button, Empty, ErrorState, inputClass, Skeleton } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { label } from '@/lib/format';
import { useStream } from '@/lib/realtime';
import { useWorkspace, wsKey } from '@/lib/workspace';
import { IncidentCollection, PageHeader } from './shared';

const SEV_LABEL = { sev1: 'SEV1 Critical', sev2: 'SEV2 High', sev3: 'SEV3 Medium', sev4: 'SEV4 Low' } as const;

function IncidentsInner() {
  const { workspace } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { pendingListUpdates, applyListUpdates } = useStream();
  // URL is the source of truth for filters (shareable; Back restores them).
  const status = sp.getAll('status').filter((s) => (INCIDENT_STATUSES as readonly string[]).includes(s));
  const severity = sp.getAll('severity').filter((s) => (SEVERITIES as readonly string[]).includes(s));
  const q = sp.get('q') ?? '';
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);

  const filters = { status, severity, q };
  const query = useInfiniteQuery({
    queryKey: wsKey(workspace.id, 'incidents', filters),
    queryFn: ({ pageParam, signal }) =>
      api.get<Page<IncidentDTO>>(`/workspaces/${workspace.id}/incidents${qs({ status, severity, q: q || undefined, cursor: pageParam, limit: 25 })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: Infinity, // list reorder waits for "Apply updates"
  });

  const setParams = (next: { status?: string[]; severity?: string[]; q?: string }) => {
    const merged = { status, severity, q, ...next };
    router.replace(`${pathname}${qs({ status: merged.status, severity: merged.severity, q: merged.q || undefined })}`, { scroll: false });
  };
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const activeFilters = status.length + severity.length + (q ? 1 : 0);

  return (
    <>
      <PageHeader title="Incidents" description="Triage queue. Active incidents by default, most severe first; use the state filter to include resolved incidents." />
      <form
        role="search"
        aria-label="Incidents"
        className="mb-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setParams({ q: search.trim().slice(0, 200) });
        }}
      >
        <label htmlFor="incident-search" className="sr-only">
          Search incidents by title or service
        </label>
        <input id="incident-search" className={`${inputClass} sm:max-w-[480px]`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or service" maxLength={200} />
        <Button type="submit">Search</Button>
      </form>

      <details className="mb-3 rounded-[10px] border border-line bg-surface">
        <summary className="flex min-h-11 cursor-pointer items-center px-4 font-medium">Filters ({activeFilters})</summary>
        <div className="grid gap-4 border-t border-line p-4 sm:grid-cols-2">
          <fieldset>
            <legend className="mb-2 font-semibold">State</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {INCIDENT_STATUSES.map((s) => (
                <label key={s} className="flex min-h-11 items-center gap-2">
                  <input type="checkbox" className="size-5" checked={status.includes(s)} onChange={() => setParams({ status: toggle(status, s) })} />
                  {label(s)}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 font-semibold">Severity</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {SEVERITIES.map((s) => (
                <label key={s} className="flex min-h-11 items-center gap-2">
                  <input type="checkbox" className="size-5" checked={severity.includes(s)} onChange={() => setParams({ severity: toggle(severity, s) })} />
                  {SEV_LABEL[s]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </details>

      <div className="mb-3 flex flex-wrap items-center gap-2" aria-live="polite">
        {status.length === 0 && <Badge tone="neutral">Active only</Badge>}
        {status.map((s) => (
          <Badge key={s} tone="info">State: {label(s)}</Badge>
        ))}
        {severity.map((s) => (
          <Badge key={s} tone="info">{SEV_LABEL[s as keyof typeof SEV_LABEL]}</Badge>
        ))}
        {q && <Badge tone="info">Search: “{q}”</Badge>}
        {activeFilters > 0 && (
          <button type="button" className="min-h-11 px-2 text-accent underline" onClick={() => setParams({ status: [], severity: [], q: '' })}>
            Clear filters
          </button>
        )}
      </div>

      {pendingListUpdates > 0 && (
        <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-info/40 bg-info-surface px-4 py-2 text-info">
          <span>
            {pendingListUpdates} new update{pendingListUpdates === 1 ? '' : 's'} since this list loaded.
          </span>
          <Button onClick={applyListUpdates}>Apply updates</Button>
        </div>
      )}

      {query.isLoading && <Skeleton lines={6} label="Loading incidents" />}
      {query.error && !query.data ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data && items.length === 0 &&
        (activeFilters ? (
          <Empty title="No incidents match these filters." action={<Button onClick={() => setParams({ status: [], severity: [], q: '' })}>Clear filters</Button>} />
        ) : (
          <Empty title="No incidents yet.">Send a sample alert to try the workflow.</Empty>
        ))}
      {items.length > 0 && (
        <section aria-label="Incident results" className="rounded-[10px] border border-line bg-surface p-2 md:p-0">
          <IncidentCollection incidents={items} caption="Incidents" />
        </section>
      )}
      {items.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-fg-secondary">
            {items.length} item{items.length === 1 ? '' : 's'} shown
          </p>
          {query.hasNextPage && (
            <Button onClick={() => void query.fetchNextPage()} pending={query.isFetchingNextPage} pendingLabel="Loading…">
              Load more
            </Button>
          )}
        </div>
      )}
    </>
  );
}

export function IncidentsList() {
  return (
    <Suspense fallback={<Skeleton lines={6} label="Loading incidents" />}>
      <IncidentsInner />
    </Suspense>
  );
}
