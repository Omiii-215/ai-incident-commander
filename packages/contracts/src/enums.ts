// Canonical enumerations shared by API, worker and web. Do not add lifecycle
// values in a component; change them here and in the contract documents.

export const ROLES = ['viewer', 'responder', 'commander', 'admin', 'auditor'] as const;
export type Role = (typeof ROLES)[number];

export const SEVERITIES = ['sev1', 'sev2', 'sev3', 'sev4'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const INCIDENT_STATUSES = [
  'declared',
  'investigating',
  'mitigating',
  'monitoring',
  'resolved',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const ACTION_STATUSES = [
  'proposed',
  'awaiting_approval',
  'approved',
  'queued',
  'executing',
  'succeeded',
  'failed',
  'rejected',
  'expired',
  'cancelled',
  'outcome_unknown',
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const INVESTIGATION_STATES = [
  'queued',
  'running',
  'completed',
  'degraded',
  'failed',
  'cancelled',
] as const;
export type InvestigationState = (typeof INVESTIGATION_STATES)[number];

export const RUNBOOK_VERSION_STATES = [
  'uploading',
  'indexing',
  'ready',
  'published',
  'failed',
  'withdrawn',
] as const;
export type RunbookVersionState = (typeof RUNBOOK_VERSION_STATES)[number];

export const PLUGIN_SCOPES = [
  'alerts:ingest',
  'runbooks:ingest',
  'runbooks:read',
  'logs:read',
  'metrics:read',
  'git:read',
  'notifications:draft',
  'notifications:send',
  'tickets:read',
  'tickets:write',
  'simulations:execute',
  'remediations:execute',
] as const;
export type PluginScope = (typeof PLUGIN_SCOPES)[number];

export const INSTALLATION_STATUSES = [
  'configured',
  'enabled',
  'degraded',
  'disabled',
  'quarantined',
  'removed',
] as const;
export type InstallationStatus = (typeof INSTALLATION_STATUSES)[number];

export const SERVICE_HEALTH = ['healthy', 'degraded', 'unhealthy', 'unknown'] as const;
export type ServiceHealth = (typeof SERVICE_HEALTH)[number];

export const EVIDENCE_SOURCE_TYPES = ['alert', 'log', 'metric', 'deployment', 'runbook', 'execution'] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

export const EVIDENCE_COMPLETENESS = ['complete', 'partial', 'unavailable'] as const;
export type EvidenceCompleteness = (typeof EVIDENCE_COMPLETENESS)[number];

/** Registered event types (EVENT_FLOWS.md §2). */
export const EVENT_TYPES = [
  'alert.accepted',
  'incident.created',
  'incident.acknowledged',
  'incident.transitioned',
  'incident.updated',
  'incident.commented',
  'investigation.requested',
  'investigation.completed',
  'investigation.degraded',
  'action.proposed',
  'action.decided',
  'action.dispatched',
  'action.completed',
  'action.outcome_unknown',
  'action.expired',
  'action.cancelled',
  'plugin.installed',
  'plugin.updated',
  'plugin.revoked',
  'runbook.created',
  'runbook.version_created',
  'runbook.indexed',
  'runbook.published',
  'service.created',
  'service.updated',
  'postmortem.requested',
  'postmortem.drafted',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ENTITY_TYPES = [
  'incident',
  'action',
  'investigation',
  'runbook',
  'service',
  'plugin_installation',
  'postmortem',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const OUTBOX_KINDS = [
  'investigation.run',
  'action.execute',
  'action.reconcile',
  'runbook.index',
  'plugin.test',
  'postmortem.generate',
] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

/** Queue names separate work classes so a slow provider cannot starve others (HLD §6). */
export const QUEUE_BY_KIND: Record<OutboxKind, string> = {
  'investigation.run': 'investigations',
  'action.execute': 'actions',
  'action.reconcile': 'reconciliation',
  'runbook.index': 'knowledge',
  'plugin.test': 'knowledge',
  'postmortem.generate': 'investigations',
};
