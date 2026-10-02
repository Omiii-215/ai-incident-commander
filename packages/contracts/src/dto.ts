// Public response shapes. Dates are ISO 8601 UTC strings; stream sequences are
// decimal strings. These types are consumed by the web client; never import
// server repositories into the UI.
import type {
  ActionStatus,
  EvidenceCompleteness,
  EvidenceSourceType,
  IncidentStatus,
  InstallationStatus,
  InvestigationState,
  PluginScope,
  Role,
  RunbookVersionState,
  ServiceHealth,
  Severity,
} from './enums';

export type ApiResponse<T> = { data: T; meta: { requestId: string } & Record<string, unknown> };
export type Page<T> = { items: T[]; nextCursor: string | null };

export type MeDTO = {
  user: { id: string; displayName: string };
  workspaces: Array<{ id: string; name: string; slug: string; roles: Role[]; capabilities: string[]; dispatchStopped: boolean }>;
  csrfToken: string;
};

export type IncidentDTO = {
  id: string;
  workspaceId: string;
  reference: string;
  serviceId: string;
  serviceName: string;
  environment: string;
  status: IncidentStatus;
  severity: Severity;
  title: string;
  ownerId: string | null;
  ownerName: string | null;
  occurrenceCount: number;
  generation: number;
  remediationRevision: number;
  latestDiagnosisId: string | null;
  openedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  lastAlertAt: string | null;
  updatedAt: string;
  version: number;
  /** Lifecycle targets the state machine allows from the current status (excludes acknowledge). */
  allowedTransitions: IncidentStatus[];
  /** Server-computed operations the current member may attempt; not an authorization boundary. */
  capabilities?: string[];
};

export type TimelineEntryDTO = {
  id: string;
  incidentId: string;
  streamSeq: string;
  eventType: string;
  actor: { type: 'user' | 'service'; id: string; name: string };
  summary: string;
  refs: Array<{ type: string; id: string }>;
  createdAt: string;
};

export type EvidenceDTO = {
  id: string;
  incidentId: string;
  runId: string | null;
  sourceType: EvidenceSourceType;
  sourceId: string;
  sourceVersion: string | null;
  title: string;
  collectedAt: string;
  observedFrom: string | null;
  observedTo: string | null;
  completeness: EvidenceCompleteness;
  redactedExcerpt: string;
  redactionCount: number;
  truncated: boolean;
  suspectedInjection: boolean;
  checksum: string;
  expired: boolean;
};

export type HypothesisDTO = {
  id: string;
  statement: string;
  support: string[];
  contradictions: string[];
  strength: 'tentative' | 'moderate' | 'strong';
  nextCheck: string;
};

export type SuggestedActionDTO = {
  toolId: string;
  arguments: Record<string, unknown>;
  target: { serviceId: string; environment: string };
  rationale: string;
  expectedEffect: string;
  support: string[];
};

export type DiagnosisDTO = {
  id: string;
  runId: string;
  incidentId: string;
  summary: string;
  facts: Array<{ statement: string; support: string[] }>;
  hypotheses: HypothesisDTO[];
  missingEvidence: string[];
  proposedChecks: string[];
  suggestedActions: SuggestedActionDTO[];
  evidenceIds: string[];
  validity: { citationsValid: boolean; unresolved: string[]; superseded: boolean };
  modelMetadata: { providerProfile: string; promptVersion: string; workflowVersion: string };
  remediationRevision: number;
  createdAt: string;
};

export type InvestigationDTO = {
  id: string;
  incidentId: string;
  state: InvestigationState;
  phase: string | null;
  rerunRequested: boolean;
  reason: string;
  degradedReason: string | null;
  diagnosis: DiagnosisDTO | null;
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ActionSpec = {
  workspaceId: string;
  incidentId: string;
  incidentGeneration: number;
  toolId: string;
  toolVersion: string;
  installationId: string;
  arguments: Record<string, unknown>;
  target: { serviceId: string; environment: string; revision: string };
  remediationRevision: number;
  expectedEffect: string;
  riskSummary: string;
  verification: { metric: string; operator: 'lt' | 'gt' | 'eq'; value: number; windowSeconds: number };
  simulation: boolean;
  expiresAt: string;
};

export type ActionDTO = {
  id: string;
  incidentId: string;
  incidentTitle: string;
  spec: ActionSpec;
  specHash: string;
  status: ActionStatus;
  requestedBy: { id: string; name: string };
  renewedBy: { id: string; name: string } | null;
  supersedesActionId: string | null;
  supersededByActionId: string | null;
  diagnosisId: string | null;
  decision: {
    decision: 'approve' | 'reject';
    decidedBy: { id: string; name: string };
    reason: string;
    decidedAt: string;
  } | null;
  execution: {
    executionKey: string;
    status: string;
    dispatchAt: string | null;
    receipt: Record<string, unknown> | null;
    reconciliationState: string | null;
  } | null;
  statusReason: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  capabilities?: string[];
};

export type ServiceDTO = {
  id: string;
  slug: string;
  name: string;
  environments: string[];
  ownerTeam: string;
  criticality: string;
  dependencyIds: string[];
  health: Array<{ environment: string; status: ServiceHealth; sampledAt: string | null; source: string }>;
  activeIncidentCount: number;
  version: number;
};

export type RunbookDTO = {
  id: string;
  title: string;
  serviceIds: string[];
  environments: string[];
  activeVersionId: string | null;
  versions: Array<{
    id: string;
    revision: number;
    state: RunbookVersionState;
    fileName: string;
    checksum: string;
    error: string | null;
    createdAt: string;
  }>;
  version: number;
  updatedAt: string;
};

export type RunbookSearchHit = {
  runbookId: string;
  runbookTitle: string;
  versionId: string;
  revision: number;
  chunkId: string;
  heading: string;
  excerpt: string;
  score: number;
  retrievalMode: 'lexical';
};

export type PluginCatalogDTO = {
  pluginId: string;
  version: string;
  displayName: string;
  publisher: string;
  reviewStatus: 'reviewed' | 'pending' | 'rejected';
  permissions: PluginScope[];
  capabilities: Array<{ name: string; version: string; kind: string; approval: string }>;
  manifestHash: string;
};

export type InstallationDTO = {
  id: string;
  pluginId: string;
  pinnedVersion: string;
  displayName: string;
  grants: PluginScope[];
  allowedServiceIds: string[];
  allowedEnvironments: string[];
  status: InstallationStatus;
  health: { status: 'ok' | 'error' | 'unknown'; checkedAt: string | null; lastError: string | null };
  configuredBy: string;
  version: number;
  updatedAt: string;
};

export type AuditEventDTO = {
  id: string;
  createdAt: string;
  actor: { type: 'user' | 'service'; id: string; name: string };
  operation: string;
  resource: { type: string; id: string };
  decision: 'allowed' | 'denied';
  reasonCode: string | null;
  requestId: string;
  specHash: string | null;
  beforeVersion: number | null;
  afterVersion: number | null;
};

export type DashboardDTO = {
  metrics: {
    openSev1: number;
    openIncidents: number;
    pendingApprovals: number | null;
    unknownServices: number;
  };
  activeIncidents: IncidentDTO[];
  pendingApprovals: ActionDTO[] | null;
  services: ServiceDTO[];
  recentActivity: TimelineEntryDTO[];
  dispatchStopped: boolean;
  generatedAt: string;
};

export type PostmortemDTO = {
  id: string;
  incidentId: string;
  state: 'generating' | 'ready' | 'failed';
  markdown: string | null;
  createdAt: string;
};

/** Minimal SSE invalidation (API_CONTRACTS.md §6). Never contains evidence or reasoning. */
export type StreamInvalidation = {
  entityType: string;
  entityId: string;
  entityVersion: number;
  reason: string;
  streamSeq: string;
};
