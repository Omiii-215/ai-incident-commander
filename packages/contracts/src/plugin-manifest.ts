import { z } from 'zod';
import { EVENT_TYPES, PLUGIN_SCOPES } from './enums';

// ic.plugin/v1 manifest validator (PLUGIN_SYSTEM.md §3).

const Semver = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/, 'Must be a semantic version');

export const CapabilitySchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    version: z.string().regex(/^[1-9][0-9]*$/),
    kind: z.enum(['ingest', 'read', 'simulate', 'write', 'notify']),
    inputSchemaRef: z.string().min(1).max(100),
    outputSchemaRef: z.string().min(1).max(100),
    maxDurationMs: z.number().int().min(100).max(30000),
    maxOutputBytes: z.number().int().min(256).max(1048576),
    idempotency: z.enum(['required', 'read-only']),
    approval: z.enum(['none', 'independent-commander']),
  })
  .strict();

export const PluginManifestSchema = z
  .object({
    schemaVersion: z.literal('ic.plugin/v1'),
    id: z
      .string()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9]+([.-][a-z0-9]+)+$/),
    version: Semver,
    displayName: z.string().min(1).max(80),
    publisher: z.string().min(1).max(80),
    minHostVersion: Semver,
    runtime: z.enum(['builtin-adapter', 'remote-mcp']),
    adapterId: z.string().min(1).max(80).optional(),
    mcpEndpointAlias: z.string().min(1).max(80).optional(),
    permissions: z.array(z.enum(PLUGIN_SCOPES)).max(16),
    secretSlots: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)).max(4),
    egressAliases: z.array(z.string().min(1).max(80)).max(8),
    capabilities: z.array(CapabilitySchema).min(1).max(20),
    subscriptions: z
      .array(z.object({ type: z.enum(EVENT_TYPES), schemaVersion: z.literal(1) }).strict())
      .max(8),
    widgets: z
      .array(
        z
          .object({
            slot: z.enum(['incident.context', 'service.context', 'overview']),
            type: z.enum(['status-card', 'key-value-list', 'evidence-table', 'time-series', 'action-link']),
            dataKey: z.string().min(1).max(64),
          })
          .strict(),
      )
      .max(4),
  })
  .strict();

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export const MAX_MANIFEST_BYTES = 64 * 1024;

/** Structural + semantic validation. Returns a list of problems; empty means valid. */
export function validateManifest(input: unknown): { manifest?: PluginManifest; problems: string[] } {
  const size = new TextEncoder().encode(JSON.stringify(input ?? null)).byteLength;
  if (size > MAX_MANIFEST_BYTES) return { problems: ['Manifest exceeds 64 KiB.'] };
  const parsed = PluginManifestSchema.safeParse(input);
  if (!parsed.success) {
    return { problems: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  const m = parsed.data;
  const problems: string[] = [];
  if (new Set(m.permissions).size !== m.permissions.length) problems.push('permissions must be unique.');
  if (m.runtime === 'builtin-adapter' && !m.adapterId) problems.push('builtin-adapter requires adapterId.');
  if (m.runtime === 'remote-mcp') {
    if (m.adapterId) problems.push('adapterId is forbidden for remote-mcp.');
    if (!m.mcpEndpointAlias) problems.push('remote-mcp requires mcpEndpointAlias.');
  }
  const seen = new Set<string>();
  for (const c of m.capabilities) {
    const key = `${c.name}@${c.version}`;
    if (seen.has(key)) problems.push(`duplicate capability ${key}.`);
    seen.add(key);
    if (['write', 'notify', 'simulate'].includes(c.kind)) {
      if (c.approval !== 'independent-commander')
        problems.push(`${key}: ${c.kind} requires independent-commander approval.`);
      if (c.idempotency !== 'required') problems.push(`${key}: ${c.kind} requires durable idempotency.`);
    }
    if (c.kind === 'read' && c.idempotency !== 'read-only') problems.push(`${key}: read uses read-only idempotency.`);
  }
  return problems.length ? { problems } : { manifest: m, problems };
}
