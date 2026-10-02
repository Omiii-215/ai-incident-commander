import type { ActionSpec, ActionStatus } from '@aic/contracts';
import { AppError } from '@aic/contracts';
import { hashCanonical } from './canonical.js';

// Action lifecycle (EVENT_FLOWS.md §5) and approval binding rules
// (SECURITY_AND_PERMISSIONS.md §5).

export const APPROVAL_WINDOW_MS = 10 * 60 * 1000;

const TRANSITIONS: Record<ActionStatus, readonly ActionStatus[]> = {
  proposed: ['awaiting_approval', 'rejected'],
  awaiting_approval: ['approved', 'rejected', 'expired', 'cancelled'],
  approved: ['queued', 'expired', 'cancelled'],
  queued: ['executing', 'expired', 'cancelled'],
  executing: ['succeeded', 'failed', 'outcome_unknown'],
  outcome_unknown: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
  rejected: [],
  expired: [],
  cancelled: [],
};

export const TERMINAL_ACTION_STATUSES: readonly ActionStatus[] = [
  'succeeded',
  'failed',
  'rejected',
  'expired',
  'cancelled',
];

export const PRE_DISPATCH_STATUSES: readonly ActionStatus[] = ['proposed', 'awaiting_approval', 'approved', 'queued'];

export function assertActionTransition(from: ActionStatus, to: ActionStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new AppError('INVALID_TRANSITION', `Action cannot move from ${from} to ${to}.`, { currentStatus: from });
  }
}

export const computeSpecHash = (spec: ActionSpec) => hashCanonical(spec);

export type ApprovalContext = {
  action: {
    status: ActionStatus;
    spec: ActionSpec;
    specHash: string;
    requestedBy: string;
    renewedBy: string | null;
    lineageRequesters: string[];
  };
  incident: { generation: number; remediationRevision: number; active: boolean };
  deciderId: string;
  submittedSpecHash: string;
  now: Date;
};

/**
 * Pure checks applied inside the approval transaction. Role membership and
 * installation grants are checked by the application layer.
 */
export function checkApprovable(c: ApprovalContext): void {
  const { action } = c;
  // Independence: requester, renewer and anyone earlier in the renewal lineage cannot approve.
  const excluded = new Set([action.requestedBy, ...(action.renewedBy ? [action.renewedBy] : []), ...action.lineageRequesters]);
  if (excluded.has(c.deciderId)) {
    throw new AppError('SELF_APPROVAL_DENIED', 'Another commander must review this request.');
  }
  if (action.status !== 'awaiting_approval') {
    throw new AppError('INVALID_TRANSITION', `This request is ${action.status.replace('_', ' ')} and cannot be decided.`, {
      currentStatus: action.status,
    });
  }
  if (computeSpecHash(action.spec) !== action.specHash) {
    // Stored spec no longer matches its hash: fail closed.
    throw new AppError('ACTION_STALE', 'The stored request failed its integrity check.');
  }
  if (c.submittedSpecHash !== action.specHash) {
    throw new AppError('ACTION_STALE', 'The plan changed during review. Read the updated request before approving.');
  }
  if (c.now.getTime() >= new Date(action.spec.expiresAt).getTime()) {
    throw new AppError('ACTION_EXPIRED', 'This request expired. Renew the review to create a fresh request.');
  }
  if (
    !c.incident.active ||
    c.incident.generation !== action.spec.incidentGeneration ||
    c.incident.remediationRevision !== action.spec.remediationRevision
  ) {
    throw new AppError('ACTION_STALE', 'The incident plan changed after this request was created. Renew the review.', {
      currentRemediationRevision: c.incident.remediationRevision,
    });
  }
}

export type DispatchCheckInput = {
  spec: ActionSpec;
  specHash: string;
  now: Date;
  incident: { generation: number; remediationRevision: number; active: boolean } | null;
  approverIsActiveCommander: boolean;
  requesterIsActiveMember: boolean;
  installationPermits: boolean;
  dispatchStopped: boolean;
  currentTargetRevision: string | null;
};

/** Returns a denial reason code, or null if dispatch may proceed. Fails closed. */
export function dispatchDenial(i: DispatchCheckInput): string | null {
  if (i.dispatchStopped) return 'DISPATCH_STOPPED';
  if (computeSpecHash(i.spec) !== i.specHash) return 'SPEC_HASH_MISMATCH';
  if (i.now.getTime() >= new Date(i.spec.expiresAt).getTime()) return 'EXPIRED';
  if (!i.incident || !i.incident.active) return 'INCIDENT_INACTIVE';
  if (i.incident.generation !== i.spec.incidentGeneration) return 'INCIDENT_GENERATION_CHANGED';
  if (i.incident.remediationRevision !== i.spec.remediationRevision) return 'REMEDIATION_REVISION_CHANGED';
  if (!i.approverIsActiveCommander) return 'APPROVER_MEMBERSHIP_REVOKED';
  if (!i.requesterIsActiveMember) return 'REQUESTER_MEMBERSHIP_REVOKED';
  if (!i.installationPermits) return 'GRANT_REVOKED';
  if (i.currentTargetRevision === null) return 'TARGET_UNAVAILABLE';
  if (i.currentTargetRevision !== i.spec.target.revision) return 'TARGET_REVISION_CHANGED';
  return null;
}
