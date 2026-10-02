'use client';

import type { Page, RunbookDTO, RunbookSearchHit, ServiceDTO } from '@aic/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Badge, Button, Card, CommandError, Empty, ErrorState, Field, inputClass, Skeleton } from '@/components/ui';
import { api, newKey, qs } from '@/lib/api';
import { useCommand } from '@/lib/commands';
import { label, whenText } from '@/lib/format';
import { useWorkspace, wsKey } from '@/lib/workspace';
import { PageHeader } from './shared';

const MAX_BYTES = 10 * 1024 * 1024;

const STATE_TONE = { uploading: 'neutral', indexing: 'info', ready: 'info', published: 'success', failed: 'danger', withdrawn: 'neutral' } as const;

async function sha256(file: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function Upload({ runbook }: { runbook: RunbookDTO }) {
  const { workspace } = useWorkspace();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const upload = async () => {
    const file = input.current?.files?.[0];
    setError(null);
    setFileError(null);
    if (!file) return setFileError('Choose a Markdown or text file.');
    if (file.size > MAX_BYTES) return setFileError('The file exceeds the 10 MiB limit.');
    const contentType = file.name.endsWith('.md') || file.name.endsWith('.markdown') ? 'text/markdown' : file.type === 'text/plain' || file.name.endsWith('.txt') ? 'text/plain' : null;
    if (!contentType) return setFileError('Only Markdown (.md) and plain text (.txt) are supported in this release.');
    try {
      setProgress('Validating file…');
      const checksum = await sha256(file);
      setProgress('Creating version…');
      const ticket = await api.command<{ versionId: string; runbookVersion: number; upload: { path: string } }>('POST', `/workspaces/${workspace.id}/runbooks/${runbook.id}/versions`, {
        key: newKey(),
        version: runbook.version,
        body: { fileName: file.name.slice(0, 200), contentType, sizeBytes: file.size, checksum },
      });
      setProgress('Uploading…');
      await api.put(`/workspaces/${workspace.id}/${ticket.upload.path}`, file, contentType);
      setProgress('Submitting for indexing…');
      await api.command('POST', `/workspaces/${workspace.id}/runbooks/${runbook.id}/versions/${ticket.versionId}/complete`, { key: newKey(), version: ticket.runbookVersion, body: { checksum } });
      setProgress(null);
      if (input.current) input.current.value = '';
    } catch (e) {
      setError(e);
      setProgress(null);
    } finally {
      void qc.invalidateQueries({ queryKey: wsKey(workspace.id, 'runbooks') });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Field id={`file-${runbook.id}`} label="Upload a new version" hint="Markdown or plain text, up to 10 MiB. PDF extraction is not enabled in this release." error={fileError}>
        <input ref={input} id={`file-${runbook.id}`} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" className={inputClass} aria-describedby={`file-${runbook.id}-hint`} aria-invalid={!!fileError} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void upload()} pending={!!progress} pendingLabel={progress ?? undefined}>
          Upload version
        </Button>
        {progress && <span role="status">{progress}</span>}
      </div>
      <CommandError error={error} />
    </div>
  );
}

function Publish({ runbook, versionId }: { runbook: RunbookDTO; versionId: string }) {
  const { workspace } = useWorkspace();
  const cmd = useCommand((key: string) => api.command('POST', `/workspaces/${workspace.id}/runbooks/${runbook.id}/publish`, { key, version: runbook.version, body: { readyVersionId: versionId } }), {
    invalidate: [wsKey(workspace.id, 'runbooks')],
  });
  return (
    <span className="inline-flex flex-col gap-1">
      <Button variant="primary" onClick={() => void cmd.run()} pending={cmd.pending} pendingLabel="Publishing…">
        Publish this version
      </Button>
      <CommandError error={cmd.error} />
    </span>
  );
}

function CreateRunbook({ services }: { services: ServiceDTO[] }) {
  const { workspace } = useWorkspace();
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const cmd = useCommand((key: string) => api.command('POST', `/workspaces/${workspace.id}/runbooks`, { key, body: { title: title.trim(), serviceIds: selected, environments: ['demo'] } }), {
    invalidate: [wsKey(workspace.id, 'runbooks')],
    onSuccess: () => {
      setTitle('');
      setSelected([]);
    },
  });
  return (
    <Card title="Create a runbook">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) void cmd.run();
        }}
      >
        <Field id="rb-title" label="Title">
          <input id="rb-title" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
        </Field>
        <fieldset>
          <legend className="font-medium">Scoped services</legend>
          <p className="text-sm text-fg-muted">Leave empty for a workspace-wide runbook.</p>
          <div className="mt-1 flex max-h-48 flex-col overflow-auto">
            {services.map((s) => (
              <label key={s.id} className="flex min-h-11 items-center gap-2">
                <input type="checkbox" className="size-5" checked={selected.includes(s.id)} onChange={() => setSelected(selected.includes(s.id) ? selected.filter((x) => x !== s.id) : [...selected, s.id])} />
                <span className="break-anywhere">{s.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <Button type="submit" disabled={!title.trim()} pending={cmd.pending}>
            Create draft runbook
          </Button>
        </div>
        <CommandError error={cmd.error} />
      </form>
    </Card>
  );
}

export function Runbooks() {
  const { workspace, can } = useWorkspace();
  const list = useQuery({
    queryKey: wsKey(workspace.id, 'runbooks'),
    queryFn: ({ signal }) => api.get<Page<RunbookDTO>>(`/workspaces/${workspace.id}/runbooks?limit=100`, signal),
    refetchInterval: (q) => (q.state.data?.items.some((r) => r.versions.some((v) => v.state === 'indexing')) ? 3000 : false),
  });
  const services = useQuery({ queryKey: wsKey(workspace.id, 'services'), queryFn: ({ signal }) => api.get<Page<ServiceDTO>>(`/workspaces/${workspace.id}/services?limit=100`, signal) });
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');
  const search = useQuery({
    enabled: submitted.length > 0,
    queryKey: wsKey(workspace.id, 'runbook-search', submitted),
    queryFn: ({ signal }) => api.get<RunbookSearchHit[]>(`/workspaces/${workspace.id}/runbooks/search${qs({ q: submitted })}`, signal),
  });
  const svcName = (id: string) => services.data?.items.find((s) => s.id === id)?.name ?? 'Service';

  return (
    <>
      <PageHeader title="Runbooks" description="Versioned knowledge used as cited evidence. Only the published active version is searchable; a commander publishes ready versions." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Search published passages" meta="Retrieval mode: lexical (local). Scores rank passages; they are not probabilities.">
            <form
              role="search"
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                setSubmitted(term.trim().slice(0, 200));
              }}
            >
              <label htmlFor="rb-search" className="sr-only">
                Search runbooks
              </label>
              <input id="rb-search" className={inputClass} value={term} onChange={(e) => setTerm(e.target.value)} maxLength={200} placeholder="e.g. rollback checkout" />
              <Button type="submit">Search</Button>
            </form>
            {search.isFetching && <Skeleton label="Searching" />}
            {search.error ? <ErrorState error={search.error} /> : null}
            {search.data && (
              <ul className="mt-3 flex flex-col gap-2" aria-label="Search results">
                {search.data.length === 0 && <li className="text-fg-secondary">No published passages match.</li>}
                {search.data.map((h) => (
                  <li key={h.chunkId} className="rounded-[6px] border border-line p-3">
                    <p className="font-medium">
                      {h.runbookTitle} › {h.heading}
                    </p>
                    <p className="text-sm text-fg-muted">
                      Revision {h.revision} · score {h.score}
                    </p>
                    <pre className="mt-1 font-sans text-sm whitespace-pre-wrap">{h.excerpt}</pre>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {list.isLoading && <Skeleton lines={5} label="Loading runbooks" />}
          {list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
          {list.data?.items.length === 0 && <Empty title="No runbooks yet." />}
          {list.data?.items.map((r) => (
            <section key={r.id} id={`runbook-${r.id}`} aria-labelledby={`rb-${r.id}`} className="card scroll-mt-24 rounded-[10px] border border-line bg-surface p-4">
              <h2 id={`rb-${r.id}`} className="text-lg font-semibold">
                {r.title}
              </h2>
              <p className="text-sm text-fg-secondary">
                {r.serviceIds.length ? `Scoped to ${r.serviceIds.map(svcName).join(', ')}` : 'Workspace-wide'} · updated {whenText(r.updatedAt)}
              </p>
              <table className="mt-3 w-full text-left text-sm">
                <caption className="sr-only">Versions of {r.title}</caption>
                <thead className="text-fg-secondary">
                  <tr>
                    <th scope="col" className="py-1 pr-2">Revision</th>
                    <th scope="col" className="py-1 pr-2">State</th>
                    <th scope="col" className="hidden py-1 pr-2 sm:table-cell">File</th>
                    <th scope="col" className="py-1">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {r.versions.map((v) => (
                    <tr key={v.id} className="border-t border-line align-top">
                      <td className="py-2 pr-2">
                        {v.revision}
                        {r.activeVersionId === v.id && <span className="block text-xs text-success">Active</span>}
                      </td>
                      <td className="py-2 pr-2">
                        <Badge tone={STATE_TONE[v.state]}>{label(v.state)}</Badge>
                        {v.error && <span className="block text-danger">{v.error}</span>}
                      </td>
                      <td className="hidden py-2 pr-2 break-anywhere sm:table-cell">{v.fileName}</td>
                      <td className="py-2">{v.state === 'ready' && can('runbook.publish') ? <Publish runbook={r} versionId={v.id} /> : v.state === 'ready' ? 'Awaiting commander' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {can('runbook.create') && (
                <div className="mt-3 border-t border-line pt-3">
                  <Upload runbook={r} />
                </div>
              )}
            </section>
          ))}
        </div>
        {can('runbook.create') && services.data && (
          <div>
            <CreateRunbook services={services.data.items} />
          </div>
        )}
      </div>
    </>
  );
}
