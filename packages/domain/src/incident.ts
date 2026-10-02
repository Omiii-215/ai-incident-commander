import type { IncidentStatus } from '@aic/contracts';
import { AppError } from '@aic/contracts';

// Incident lifecycle (EVENT_FLOWS.md §4). Acknowledgment is the
// declared → investigating command plus owner assignment, not a status.

const TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  declared: ['investigating'],
  investigating: ['mitigating', 'monitoring'],
  mitigating: ['investigating', 'monitoring'],
  monitoring: ['investigating', 'mitigating', 'resolved'],
  resolved: ['investigating'],
};

export const allowedTransitions = (from: IncidentStatus) => TRANSITIONS[from];

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type IncidentState = {
  status: IncidentStatus;
  active: boolean;
  generation: number;
  remediationRevision: number;
  ownerId: string | null;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
};

export type TransitionResult = IncidentState & { reopened: boolean; remediationChanged: boolean };

/** Pure transition. Callers enforce role, version and active-fingerprint uniqueness. */
export function applyTransition(state: IncidentState, to: IncidentStatus, now: Date): TransitionResult {
  if (state.status === 'declared' && to === 'investigating') {
    throw new AppError('INVALID_TRANSITION', 'Use acknowledge to start investigating a declared incident.');
  }
  if (!canTransition(state.status, to)) {
    throw new AppError('INVALID_TRANSITION', `Cannot move an incident from ${state.status} to ${to}.`, {
      currentStatus: state.status,
      allowed: TRANSITIONS[state.status],
    });
  }
  const reopened = state.status === 'resolved' && to === 'investigating';
  // A return to investigating means the diagnosis/plan was invalidated: material change.
  const remediationChanged = to === 'investigating';
  return {
    ...state,
    status: to,
    active: to !== 'resolved',
    generation: reopened ? state.generation + 1 : state.generation,
    remediationRevision: remediationChanged ? state.remediationRevision + 1 : state.remediationRevision,
    resolvedAt: to === 'resolved' ? now : reopened ? null : state.resolvedAt,
    reopened,
    remediationChanged,
  };
}

export function applyAcknowledge(state: IncidentState, actorId: string, now: Date): IncidentState {
  if (state.status !== 'declared') {
    throw new AppError('INVALID_TRANSITION', 'Only a declared incident can be acknowledged.', {
      currentStatus: state.status,
    });
  }
  return { ...state, status: 'investigating', ownerId: actorId, acknowledgedAt: now };
}

const SEVERITY_RANK = { sev1: 1, sev2: 2, sev3: 3, sev4: 4 } as const;
export const severityRank = (s: keyof typeof SEVERITY_RANK) => SEVERITY_RANK[s];
