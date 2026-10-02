import type { Role } from '@aic/contracts';

// Role matrix (SECURITY_AND_PERMISSIONS.md §2). Admin does not imply commander;
// every operation is evaluated explicitly.

export const OPERATIONS = {
  read: ['viewer', 'responder', 'commander', 'admin', 'auditor'],
  'incident.acknowledge': ['responder', 'commander'],
  'incident.update': ['responder', 'commander'],
  'incident.transition': ['responder', 'commander'],
  'incident.comment': ['responder', 'commander'],
  'investigation.request': ['responder', 'commander'],
  'action.propose': ['responder', 'commander'],
  'action.renew': ['responder', 'commander'],
  'action.cancel': ['responder', 'commander'],
  'action.decide': ['commander'],
  'action.queue.read': ['commander', 'auditor'],
  'dispatch.stop': ['commander', 'admin'],
  'runbook.create': ['responder', 'commander'],
  'runbook.publish': ['commander'],
  'service.manage': ['admin'],
  'plugin.manage': ['admin'],
  'audit.read': ['commander', 'auditor'],
  'postmortem.request': ['responder', 'commander'],
} as const satisfies Record<string, readonly Role[]>;

export type Operation = keyof typeof OPERATIONS;

export function can(roles: readonly Role[], op: Operation): boolean {
  const allowed: readonly Role[] = OPERATIONS[op];
  return roles.some((r) => allowed.includes(r));
}

export function capabilitiesFor(roles: readonly Role[]): Operation[] {
  return (Object.keys(OPERATIONS) as Operation[]).filter((op) => can(roles, op));
}
