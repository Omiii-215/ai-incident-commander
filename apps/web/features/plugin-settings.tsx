'use client';

import type { InstallationDTO, Page, PluginCatalogDTO, PluginScope, ServiceDTO } from '@aic/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Banner, Button, Card, CommandError, ErrorState, Field, inputClass, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useCommand } from '@/lib/commands';
import { label, whenText } from '@/lib/format';
import { useWorkspace, wsKey } from '@/lib/workspace';
import { PageHeader } from './shared';

const SCOPE_LABEL: Partial<Record<PluginScope, { text: string; tone: 'neutral' | 'info' | 'warning' | 'danger' }>> = {
  'alerts:ingest': { text: 'Ingest alerts', tone: 'neutral' },
  'logs:read': { text: 'Read evidence: logs', tone: 'info' },
  'metrics:read': { text: 'Read evidence: metrics', tone: 'info' },
  'git:read': { text: 'Read evidence: deployments', tone: 'info' },
  'runbooks:ingest': { text: 'Ingest runbooks', tone: 'neutral' },
  'runbooks:read': { text: 'Read evidence: runbooks', tone: 'info' },
  'simulations:execute': { text: 'Run approved simulations', tone: 'warning' },
  'remediations:execute': { text: 'Production write', tone: 'danger' },
};

function InstallationCard({ inst, catalog, services }: { inst: InstallationDTO; catalog: PluginCatalogDTO | undefined; services: ServiceDTO[] }) {
  const { workspace } = useWorkspace();
  const keys = [wsKey(workspace.id, 'plugins')];
  const [reason, setReason] = useState('');
  const test = useCommand((key: string) => api.command('POST', `/workspaces/${workspace.id}/plugins/installations/${inst.id}/test`, { key, version: inst.version }), { invalidate: keys });
  const enable = useCommand((key: string) => api.command('PATCH', `/workspaces/${workspace.id}/plugins/installations/${inst.id}`, { key, version: inst.version, body: { status: 'enabled' } }), { invalidate: keys });
  const revoke = useCommand((key: string) => api.command('POST', `/workspaces/${workspace.id}/plugins/installations/${inst.id}/revoke`, { key, version: inst.version, body: { reason: reason.trim() } }), {
    invalidate: keys,
    onSuccess: () => setReason(''),
  });
  const [grants, setGrants] = useState<PluginScope[]>(inst.grants);
  const saveGrants = useCommand((key: string) => api.command('PATCH', `/workspaces/${workspace.id}/plugins/installations/${inst.id}`, { key, version: inst.version, body: { grants } }), { invalidate: keys });
  const dirty = grants.slice().sort().join() !== inst.grants.slice().sort().join();

  return (
    <li className="card flex flex-col gap-3 rounded-[10px] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{inst.displayName}</h2>
          <p className="text-sm text-fg-secondary">
            {catalog?.publisher ?? 'Unknown publisher'} · version {inst.pinnedVersion} · {catalog?.reviewStatus === 'reviewed' ? 'Reviewed' : 'Not reviewed'}
          </p>
        </div>
        <Badge tone={inst.status === 'enabled' ? 'success' : inst.status === 'disabled' ? 'neutral' : 'warning'}>{label(inst.status)}</Badge>
      </div>
      <p className="text-sm">
        Health: <strong>{label(inst.health.status)}</strong>
        {inst.health.checkedAt ? ` · last check ${whenText(inst.health.checkedAt)}` : ' · never checked'}
        {inst.health.lastError && <span className="block text-danger">{inst.health.lastError}</span>}
      </p>
      <p className="text-sm">
        Scope: environments {inst.allowedEnvironments.join(', ') || 'none'} · {inst.allowedServiceIds.length} of {services.length} services
      </p>
      <fieldset>
        <legend className="font-medium">Granted capabilities</legend>
        <p className="text-sm text-fg-muted">Write scopes are separate and never granted by installation alone.</p>
        <div className="mt-1 flex flex-col">
          {(catalog?.permissions ?? inst.grants).map((p) => (
            <label key={p} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="size-5" checked={grants.includes(p)} disabled={p === 'remediations:execute'} onChange={() => setGrants(grants.includes(p) ? grants.filter((g) => g !== p) : [...grants, p])} />
              <Badge tone={SCOPE_LABEL[p]?.tone ?? 'neutral'}>{SCOPE_LABEL[p]?.text ?? p}</Badge>
            </label>
          ))}
        </div>
        {dirty && (
          <div className="mt-2 flex flex-col gap-2">
            <Button onClick={() => void saveGrants.run()} pending={saveGrants.pending}>
              Save grants
            </Button>
            <CommandError error={saveGrants.error} />
          </div>
        )}
      </fieldset>
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <Button onClick={() => void test.run()} pending={test.pending} pendingLabel="Queuing test…">
          Run read-only connection test
        </Button>
        {inst.status !== 'enabled' && (
          <Button variant="primary" onClick={() => void enable.run()} pending={enable.pending} disabled={inst.health.status !== 'ok'}>
            Enable
          </Button>
        )}
      </div>
      {inst.status !== 'enabled' && inst.health.status !== 'ok' && <p className="text-sm text-fg-muted">Enabling requires a passing connection test.</p>}
      <CommandError error={test.error ?? enable.error} />
      {inst.status === 'enabled' && (
        <form
          className="flex flex-col gap-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) void revoke.run();
          }}
        >
          <Field id={`revoke-${inst.id}`} label="Disable and revoke future dispatch" hint="Future dispatch stops immediately; an external operation already running may still finish and will be reconciled.">
            <input id={`revoke-${inst.id}`} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" maxLength={1000} aria-describedby={`revoke-${inst.id}-hint`} />
          </Field>
          <div>
            <Button type="submit" variant="danger" disabled={!reason.trim()} pending={revoke.pending}>
              Disable plugin
            </Button>
          </div>
          <CommandError error={revoke.error} />
        </form>
      )}
    </li>
  );
}

export function PluginSettings() {
  const { workspace, can } = useWorkspace();
  const installs = useQuery({ enabled: can('plugin.manage'), queryKey: wsKey(workspace.id, 'plugins'), queryFn: ({ signal }) => api.get<InstallationDTO[]>(`/workspaces/${workspace.id}/plugins/installations`, signal) });
  const catalog = useQuery({ enabled: can('plugin.manage'), queryKey: wsKey(workspace.id, 'plugin-catalog'), queryFn: ({ signal }) => api.get<PluginCatalogDTO[]>(`/workspaces/${workspace.id}/plugins/catalog`, signal) });
  const services = useQuery({ queryKey: wsKey(workspace.id, 'services'), queryFn: ({ signal }) => api.get<Page<ServiceDTO>>(`/workspaces/${workspace.id}/services?limit=100`, signal) });

  if (!can('plugin.manage')) {
    return (
      <>
        <PageHeader title="Plugins and connectors" />
        <Banner tone="warning" title="You need the admin role to manage plugins." />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Plugins and connectors"
        description="Application connectors from the reviewed catalog. Installing a connector does not authorize actions; each capability is granted per workspace and checked again at dispatch."
      />
      {installs.isLoading && <Skeleton lines={6} label="Loading plugins" />}
      {installs.error ? <ErrorState error={installs.error} onRetry={() => void installs.refetch()} /> : null}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {installs.data?.map((i) => (
          <InstallationCard key={`${i.id}:${i.version}`} inst={i} catalog={catalog.data?.find((c) => c.pluginId === i.pluginId && c.version === i.pinnedVersion)} services={services.data?.items ?? []} />
        ))}
      </ul>
      <Card title="Reviewed catalog" className="mt-6" meta="Immutable manifest versions; publisher identity and review are separate facts.">
        <ul className="flex flex-col divide-y divide-line">
          {catalog.data?.map((c) => (
            <li key={`${c.pluginId}@${c.version}`} className="py-3">
              <p className="font-medium">
                {c.displayName} <span className="font-mono text-sm text-fg-muted">{c.pluginId}@{c.version}</span>
              </p>
              <p className="text-sm text-fg-secondary">Capabilities: {c.capabilities.map((k) => `${k.name} (${k.kind}${k.approval !== 'none' ? ', needs independent approval' : ''})`).join(', ')}</p>
              <p className="font-mono text-xs break-anywhere text-fg-muted">{c.manifestHash}</p>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
