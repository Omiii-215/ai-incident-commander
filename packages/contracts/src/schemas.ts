import { z } from 'zod';
import {
  ACTION_STATUSES,
  INCIDENT_STATUSES,
  INSTALLATION_STATUSES,
  PLUGIN_SCOPES,
  SEVERITIES,
} from './enums';

// Bounded primitives (API_CONTRACTS.md §8).
export const Uuid = z.uuid();
export const Reason = z.string().trim().min(1).max(1000);
export const Name = z.string().trim().min(1).max(120);
export const Slug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export const Environment = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9-]+$/);
export const IsoDate = z.iso.datetime({ offset: false });
export const SpecHash = z.string().regex(/^sha256:[0-9a-f]{64}$/);

// ---- Connector ingestion -------------------------------------------------

export const AlertIngestBody = z
  .object({
    externalEventId: z.string().min(1).max(200),
    serviceKey: z.string().min(1).max(64),
    environment: Environment,
    alertType: z.string().min(1).max(80).regex(/^[a-z0-9_.-]+$/),
    severity: z.enum(SEVERITIES),
    occurredAt: IsoDate,
    summary: z.string().min(1).max(500),
    labels: z.record(z.string().max(64), z.string().max(256)).default({}),
    measurements: z.record(z.string().max(64), z.number().finite()).default({}),
  })
  .strict()
  .refine((v) => Object.keys(v.labels).length <= 20 && Object.keys(v.measurements).length <= 20, {
    message: 'At most 20 labels and 20 measurements.',
  });
export type AlertIngestBody = z.infer<typeof AlertIngestBody>;

// ---- Incident commands -----------------------------------------------------

export const AcknowledgeBody = z.object({}).strict();
export const TransitionBody = z
  .object({ targetStatus: z.enum(INCIDENT_STATUSES), reason: Reason })
  .strict();
export type TransitionBody = z.infer<typeof TransitionBody>;

export const PatchIncidentBody = z
  .object({
    title: Name.optional(),
    severity: z.enum(SEVERITIES).optional(),
    ownerId: Uuid.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field.' });
export type PatchIncidentBody = z.infer<typeof PatchIncidentBody>;

export const CommentBody = z.object({ text: z.string().trim().min(1).max(4000) }).strict();
export const InvestigationBody = z.object({ reason: Reason }).strict();

// ---- Actions ----------------------------------------------------------------

export const ActionProposalBody = z
  .object({
    toolId: z.string().min(3).max(120),
    arguments: z.record(z.string().max(64), z.unknown()),
    target: z.object({ serviceId: Uuid, environment: Environment }).strict(),
    diagnosisId: Uuid.optional(),
  })
  .strict();
export type ActionProposalBody = z.infer<typeof ActionProposalBody>;

export const DecisionBody = z
  .object({ decision: z.enum(['approve', 'reject']), specHash: SpecHash, reason: Reason })
  .strict();
export type DecisionBody = z.infer<typeof DecisionBody>;

export const ReasonBody = z.object({ reason: Reason }).strict();

export const DispatchControlBody = z.object({ stopped: z.boolean(), reason: Reason }).strict();

// ---- Services ---------------------------------------------------------------

export const CreateServiceBody = z
  .object({
    name: Name,
    slug: Slug,
    environments: z.array(Environment).min(1).max(10),
    ownerTeam: Name,
    criticality: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
    dependencyIds: z.array(Uuid).max(50).default([]),
  })
  .strict();
export const PatchServiceBody = z
  .object({
    name: Name.optional(),
    environments: z.array(Environment).min(1).max(10).optional(),
    ownerTeam: Name.optional(),
    criticality: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    dependencyIds: z.array(Uuid).max(50).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field.' });

// ---- Runbooks ---------------------------------------------------------------

export const RUNBOOK_MAX_BYTES = 10 * 1024 * 1024;
export const RUNBOOK_CONTENT_TYPES = ['text/markdown', 'text/plain'] as const;

export const CreateRunbookBody = z
  .object({
    title: Name,
    serviceIds: z.array(Uuid).max(50).default([]),
    environments: z.array(Environment).max(10).default([]),
  })
  .strict();
export const CreateRunbookVersionBody = z
  .object({
    fileName: z.string().min(1).max(200),
    contentType: z.enum(RUNBOOK_CONTENT_TYPES),
    sizeBytes: z.number().int().min(1).max(RUNBOOK_MAX_BYTES),
    checksum: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  })
  .strict();
export const CompleteRunbookVersionBody = z
  .object({ checksum: z.string().regex(/^sha256:[0-9a-f]{64}$/) })
  .strict();
export const PublishRunbookBody = z.object({ readyVersionId: Uuid }).strict();

// ---- Plugins ----------------------------------------------------------------

export const InstallPluginBody = z
  .object({
    pluginId: z.string().min(3).max(80),
    pinnedVersion: z.string().min(5).max(40),
    grants: z.array(z.enum(PLUGIN_SCOPES)).max(16),
    allowedServiceIds: z.array(Uuid).max(200).default([]),
    allowedEnvironments: z.array(Environment).max(10).default([]),
  })
  .strict();
export const PatchInstallationBody = z
  .object({
    grants: z.array(z.enum(PLUGIN_SCOPES)).max(16).optional(),
    allowedServiceIds: z.array(Uuid).max(200).optional(),
    allowedEnvironments: z.array(Environment).max(10).optional(),
    status: z.enum(['enabled', 'disabled']).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field.' });

// ---- Lists ------------------------------------------------------------------

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.array(z.enum(values)), z.enum(values)])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]));

export const ListLimit = z.coerce.number().int().min(1).max(100).default(25);

export const IncidentListQuery = z
  .object({
    status: csv(INCIDENT_STATUSES),
    severity: csv(SEVERITIES),
    serviceId: Uuid.optional(),
    ownerId: Uuid.optional(),
    q: z.string().max(200).optional(),
    cursor: z.string().max(1000).optional(),
    limit: ListLimit,
  })
  .strict();

export const ActionListQuery = z
  .object({
    status: csv(ACTION_STATUSES),
    incidentId: Uuid.optional(),
    cursor: z.string().max(1000).optional(),
    limit: ListLimit,
  })
  .strict();

export const PageQuery = z
  .object({ cursor: z.string().max(1000).optional(), limit: ListLimit })
  .strict();

export const InstallationStatusEnum = z.enum(INSTALLATION_STATUSES);
