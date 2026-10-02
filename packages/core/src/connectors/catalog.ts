import type { PluginManifest, PluginScope } from '@aic/contracts';
import { z } from 'zod';

// Reviewed built-in plugin manifests (PLUGIN_SYSTEM.md §8, MVP rows). These
// are application connectors, not coding-host plugins.

const cap = (
  name: string,
  kind: 'ingest' | 'read' | 'simulate',
  inputSchemaRef: string,
  outputSchemaRef: string,
): PluginManifest['capabilities'][number] => ({
  name,
  version: '1',
  kind,
  inputSchemaRef,
  outputSchemaRef,
  maxDurationMs: 5000,
  maxOutputBytes: 65536,
  idempotency: kind === 'read' ? 'read-only' : 'required',
  approval: kind === 'simulate' ? 'independent-commander' : 'none',
});

export const BUILTIN_MANIFESTS: PluginManifest[] = [
  {
    schemaVersion: 'ic.plugin/v1',
    id: 'core.synthetic-alerts',
    version: '1.0.0',
    displayName: 'Synthetic Alerts',
    publisher: 'incident-commander-core',
    minHostVersion: '0.1.0',
    runtime: 'builtin-adapter',
    adapterId: 'synthetic-alerts-v1',
    permissions: ['alerts:ingest'],
    secretSlots: ['webhook_secret'],
    egressAliases: [],
    capabilities: [cap('emit_alert', 'ingest', 'synthetic-alert-input-v1', 'alert-receipt-v1')],
    subscriptions: [],
    widgets: [],
  },
  {
    schemaVersion: 'ic.plugin/v1',
    id: 'core.simulator',
    version: '1.0.0',
    displayName: 'Recovery Simulator',
    publisher: 'incident-commander-core',
    minHostVersion: '0.1.0',
    runtime: 'builtin-adapter',
    adapterId: 'simulator-v1',
    permissions: ['logs:read', 'metrics:read', 'git:read', 'simulations:execute'],
    secretSlots: [],
    egressAliases: [],
    capabilities: [
      cap('read_recent_errors', 'read', 'sim-target-window-v1', 'log-excerpt-v1'),
      cap('read_metrics', 'read', 'sim-target-window-v1', 'metric-sample-v1'),
      cap('read_deployments', 'read', 'sim-target-v1', 'deployment-list-v1'),
      cap('simulate_restart', 'simulate', 'simulation-restart-input-v1', 'simulation-result-v1'),
      cap('simulate_rollback', 'simulate', 'simulation-rollback-input-v1', 'simulation-result-v1'),
    ],
    subscriptions: [{ type: 'incident.created', schemaVersion: 1 }],
    widgets: [{ slot: 'incident.context', type: 'status-card', dataKey: 'scenario' }],
  },
  {
    schemaVersion: 'ic.plugin/v1',
    id: 'core.runbook-library',
    version: '1.0.0',
    displayName: 'Runbook Library',
    publisher: 'incident-commander-core',
    minHostVersion: '0.1.0',
    runtime: 'builtin-adapter',
    adapterId: 'runbook-library-v1',
    permissions: ['runbooks:ingest', 'runbooks:read'],
    secretSlots: [],
    egressAliases: [],
    capabilities: [
      cap('ingest_document', 'ingest', 'runbook-upload-v1', 'runbook-version-v1'),
      cap('search_passages', 'read', 'runbook-query-v1', 'runbook-passages-v1'),
    ],
    subscriptions: [],
    widgets: [],
  },
];

/** Read capabilities usable by the investigation workflow, each with its required scope. */
export const READ_TOOLS = {
  'simulator.read_recent_errors': { pluginId: 'core.simulator', capability: 'read_recent_errors', scope: 'logs:read' },
  'simulator.read_metrics': { pluginId: 'core.simulator', capability: 'read_metrics', scope: 'metrics:read' },
  'simulator.read_deployments': { pluginId: 'core.simulator', capability: 'read_deployments', scope: 'git:read' },
} as const satisfies Record<string, { pluginId: string; capability: string; scope: PluginScope }>;
export type ReadToolId = keyof typeof READ_TOOLS;

const VersionString = z.string().regex(/^v?\d+\.\d+\.\d+$/);

/** Action tools that can be proposed. Unknown or invented tools fail closed. */
export const ACTION_TOOLS = {
  'simulator.rollback_deployment': {
    pluginId: 'core.simulator',
    capability: 'simulate_rollback',
    toolVersion: '1',
    scope: 'simulations:execute' as PluginScope,
    label: 'Roll back deployment',
    args: z.object({ toVersion: VersionString }).strict(),
    describe: (args: Record<string, unknown>, serviceName: string, env: string) => ({
      expectedEffect: `Simulated deployment of ${serviceName} in ${env} returns to ${String(args.toVersion)}; error rate should fall below 1% within 5 minutes.`,
      riskSummary: 'Simulation only. Rollback reverts the latest release; features shipped in that release become unavailable.',
      verification: { metric: 'error_rate', operator: 'lt' as const, value: 0.01, windowSeconds: 300 },
    }),
  },
  'simulator.restart_service': {
    pluginId: 'core.simulator',
    capability: 'simulate_restart',
    toolVersion: '1',
    scope: 'simulations:execute' as PluginScope,
    label: 'Restart service',
    args: z.object({ strategy: z.enum(['rolling', 'all-at-once']) }).strict(),
    describe: (args: Record<string, unknown>, serviceName: string, env: string) => ({
      expectedEffect: `Simulated ${String(args.strategy)} restart of ${serviceName} in ${env}; transient errors should clear if caused by process state.`,
      riskSummary:
        args.strategy === 'all-at-once'
          ? 'Simulation only. All-at-once restart briefly drops all capacity.'
          : 'Simulation only. Rolling restart briefly reduces capacity.',
      verification: { metric: 'error_rate', operator: 'lt' as const, value: 0.01, windowSeconds: 300 },
    }),
  },
} as const;
export type ActionToolId = keyof typeof ACTION_TOOLS;

export const isActionTool = (id: string): id is ActionToolId => Object.hasOwn(ACTION_TOOLS, id);
