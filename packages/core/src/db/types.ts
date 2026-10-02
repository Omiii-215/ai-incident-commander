import type {
  ActionSpec,
  ActionStatus,
  EvidenceCompleteness,
  EvidenceSourceType,
  IncidentStatus,
  InstallationStatus,
  InvestigationState,
  ModelDiagnosisOutput,
  OutboxKind,
  PluginManifest,
  PluginScope,
  Role,
  RunbookVersionState,
  ServiceHealth,
  Severity,
} from '@aic/contracts';

// Storage documents (DATA_MODEL.md §3). `_id` is the public UUID. Every tenant
// document carries workspaceId; plugin_catalog is the global exception.

export type Actor = { type: 'user' | 'service'; id: string };

type Mutable = { createdAt: Date; updatedAt: Date; version: number };

export type UserDoc = {
  _id: string;
  identityIssuer: string;
  identitySubject: string;
  displayName: string;
  createdAt: Date;
};

export type WorkspaceDoc = Mutable & {
  _id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'deleting';
  policyVersion: number;
  region: string;
  dispatchStopped: boolean;
  dispatchStoppedReason: string | null;
};

export type MembershipDoc = Mutable & {
  _id: string;
  workspaceId: string;
  userId: string;
  roles: Role[];
  status: 'active' | 'revoked';
  grantVersion: number;
};

export type SessionDoc = {
  _id: string; // sha256 of the opaque cookie token
  userId: string;
  csrfToken: string;
  createdAt: Date;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
  idleExpiresAt: Date;
};

export type ServiceDoc = Mutable & {
  _id: string;
  workspaceId: string;
  slug: string;
  name: string;
  environments: string[];
  ownerTeam: string;
  criticality: 'critical' | 'high' | 'medium' | 'low';
  dependencyIds: string[];
};

export type ConnectorInstanceDoc = Mutable & {
  _id: string;
  workspaceId: string;
  pluginInstallationId: string;
  externalMapping: { services: Record<string, string>; identityLabels?: string[] };
  secretRef: string;
  status: 'active' | 'disabled';
};

export type AlertDoc = {
  _id: string;
  workspaceId: string;
  connectorId: string;
  externalEventId: string;
  normalizedHash: string;
  serviceId: string;
  environment: string;
  alertType: string;
  fingerprint: string;
  severity: Severity;
  occurredAt: Date;
  receivedAt: Date;
  incidentId: string;
  summary: string;
  measurements: Record<string, number>;
  evidenceRefs: string[];
  expiresAt: Date;
  schemaVersion: 1;
  createdAt: Date;
};

export type IncidentDoc = Mutable & {
  _id: string;
  workspaceId: string;
  number: number;
  serviceId: string;
  environment: string;
  fingerprint: string;
  active: boolean;
  generation: number;
  status: IncidentStatus;
  severity: Severity;
  title: string;
  ownerId: string | null;
  occurrenceCount: number;
  openedAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  lastAlertAt: Date | null;
  remediationRevision: number;
  latestDiagnosisId: string | null;
  searchText: string;
};

export type TimelineDoc = {
  _id: string;
  workspaceId: string;
  incidentId: string;
  streamSeq: number;
  eventType: string;
  actor: Actor;
  summary: string;
  refs: Array<{ type: string; id: string }>;
  causationId: string;
  createdAt: Date;
  schemaVersion: 1;
};

export type InvestigationRunDoc = Mutable & {
  _id: string;
  workspaceId: string;
  incidentId: string;
  requesterId: string;
  reason: string;
  generation: number;
  inputRevision: number;
  state: InvestigationState;
  active: boolean;
  phase: 'authorizing' | 'retrieving' | 'collecting' | 'generating' | 'validating' | null;
  rerunRequested: boolean;
  budget: { modelCalls: number; toolCalls: number; nodeTransitions: number; inputTokens: number; outputTokens: number; deadlineAt: Date | null };
  providerProfile: string;
  promptVersion: string;
  workflowVersion: string;
  evidenceIds: string[];
  checkpointRef: string | null;
  resultRef: string | null;
  degradedReason: string | null;
  leaseToken: number;
};

export type DiagnosisDoc = {
  _id: string;
  workspaceId: string;
  incidentId: string;
  runId: string;
  output: ModelDiagnosisOutput;
  target: { serviceId: string; environment: string };
  evidenceIds: string[];
  validity: { citationsValid: boolean; unresolved: string[] };
  modelMetadata: { providerProfile: string; promptVersion: string; workflowVersion: string };
  remediationRevision: number;
  createdAt: Date;
  schemaVersion: 1;
};

export type EvidenceDoc = {
  _id: string;
  workspaceId: string;
  incidentId: string;
  runId: string | null;
  sourceType: EvidenceSourceType;
  sourceId: string;
  sourceVersion: string | null;
  title: string;
  collectedAt: Date;
  observedFrom: Date | null;
  observedTo: Date | null;
  completeness: EvidenceCompleteness;
  checksum: string;
  objectKey: string | null;
  redactedExcerpt: string;
  redactionCount: number;
  truncated: boolean;
  suspectedInjection: boolean;
  expiresAt: Date;
  createdAt: Date;
  schemaVersion: 1;
};

export type ActionDoc = Mutable & {
  _id: string;
  workspaceId: string;
  incidentId: string;
  spec: ActionSpec;
  specHash: string;
  status: ActionStatus;
  statusReason: string | null;
  requestedBy: string;
  renewedBy: string | null;
  lineageRequesters: string[];
  supersedesActionId: string | null;
  supersededByActionId: string | null;
  diagnosisId: string | null;
  approvalId: string | null;
  executionKey: string;
  expiresAt: Date;
  remediationRevision: number;
};

export type ApprovalDoc = {
  _id: string;
  workspaceId: string;
  actionId: string;
  specHash: string;
  decision: 'approve' | 'reject';
  decidedBy: string;
  decisionAt: Date;
  reason: string;
  membershipVersion: number;
  policyVersion: number;
  createdAt: Date;
  schemaVersion: 1;
};

export type ExecutionDoc = {
  _id: string;
  workspaceId: string;
  actionId: string;
  attempt: number;
  executionKey: string;
  connectorVersion: string;
  targetFence: number;
  dispatchAt: Date;
  status: 'dispatching' | 'succeeded' | 'failed' | 'outcome_unknown';
  receipt: Record<string, unknown> | null;
  reconciliationState: 'not_required' | 'pending' | 'confirmed_applied' | 'confirmed_no_effect' | 'manual_review_required';
  updatedAt: Date;
  createdAt: Date;
};

export type TargetLeaseDoc = {
  _id: string;
  workspaceId: string;
  serviceId: string;
  environment: string;
  holderActionId: string | null;
  fence: number;
  leaseUntil: Date;
};

export type RunbookDoc = Mutable & {
  _id: string;
  workspaceId: string;
  title: string;
  serviceIds: string[];
  environments: string[];
  activeVersionId: string | null;
  visibility: 'workspace';
  archivedAt: Date | null;
  nextRevision: number;
};

export type RunbookVersionDoc = Mutable & {
  _id: string;
  workspaceId: string;
  runbookId: string;
  revision: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  artifactKey: string;
  checksum: string;
  authorId: string;
  state: RunbookVersionState;
  error: string | null;
  extractorVersion: string;
  embeddingProfile: string;
};

export type RunbookChunkDoc = {
  _id: string;
  workspaceId: string;
  runbookId: string;
  versionId: string;
  ordinal: number;
  heading: string;
  text: string;
  offsets: { start: number; end: number };
  serviceIds: string[];
  environments: string[];
  published: boolean;
  embeddingProfile: string;
  createdAt: Date;
};

export type PluginCatalogDoc = {
  _id: string; // `${pluginId}@${version}`
  pluginId: string;
  version: string;
  publisher: string;
  manifest: PluginManifest;
  manifestHash: string;
  reviewStatus: 'reviewed' | 'pending' | 'rejected';
  createdAt: Date;
};

export type InstallationDoc = Mutable & {
  _id: string;
  workspaceId: string;
  pluginId: string;
  pinnedVersion: string;
  grants: PluginScope[];
  allowedServiceIds: string[];
  allowedEnvironments: string[];
  secretRefs: Record<string, string>;
  status: InstallationStatus;
  policyVersion: number;
  configuredBy: string;
  health: { status: 'ok' | 'error' | 'unknown'; checkedAt: Date | null; lastError: string | null };
};

export type IdempotencyDoc = {
  _id: string;
  workspaceId: string;
  subjectId: string;
  operation: string;
  key: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  expiresAt: Date;
  createdAt: Date;
};

export type CounterDoc = { _id: string; workspaceId: string; nextSeq: number; nextIncidentNumber: number };

export type WorkspaceEventDoc = {
  _id: string;
  workspaceId: string;
  streamSeq: number;
  eventType: string;
  entityType: string;
  entityId: string;
  entityVersion: number;
  reason: string;
  occurredAt: Date;
  causationId: string;
  expiresAt: Date;
};

export type AuditDoc = {
  _id: string;
  workspaceId: string;
  actor: Actor;
  operation: string;
  resource: { type: string; id: string };
  decision: 'allowed' | 'denied';
  reasonCode: string | null;
  requestId: string;
  specHash: string | null;
  beforeVersion: number | null;
  afterVersion: number | null;
  createdAt: Date;
  expiresAt: Date;
  schemaVersion: 1;
};

export type OutboxDoc = {
  _id: string;
  workspaceId: string;
  kind: OutboxKind;
  aggregateId: string;
  schemaVersion: 1;
  payloadRefs: Record<string, string | number>;
  requestId: string;
  state: 'pending' | 'dispatching' | 'dispatched' | 'completed' | 'failed' | 'cancelled';
  leaseUntil: Date | null;
  dispatchAttempt: number;
  nextAttemptAt: Date;
  completedAt: Date | null;
  lastError: string | null;
  expiresAt: Date | null;
  createdAt: Date;
};

export type JobRunDoc = {
  _id: string;
  workspaceId: string;
  outboxId: string;
  state: 'running' | 'completed' | 'failed';
  leaseToken: number;
  leaseUntil: Date;
  attempt: number;
  resultRef: string | null;
  lastError: string | null;
  completedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
};

export type PostmortemDoc = {
  _id: string;
  workspaceId: string;
  incidentId: string;
  requestedBy: string;
  state: 'generating' | 'ready' | 'failed';
  markdown: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SimulatorTargetDoc = {
  _id: string;
  workspaceId: string;
  serviceId: string;
  environment: string;
  revision: number;
  deployedVersion: string;
  previousVersion: string | null;
  errorRate: number;
  latencyP95Ms: number;
  healthy: boolean;
  faultMode: 'none' | 'fail' | 'timeout_after_apply' | 'timeout_before_apply';
  deployments: Array<{ version: string; deployedAt: Date; commit: string; author: string; notes: string }>;
  logLines: string[];
  appliedOps: Array<{ executionKey: string; op: string; receipt: Record<string, unknown>; appliedAt: Date }>;
  sampledAt: Date;
};

export type ServiceHealthSample = { status: ServiceHealth; sampledAt: Date | null; source: string };
