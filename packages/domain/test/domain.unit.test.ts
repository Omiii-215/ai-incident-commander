import type { ActionSpec } from '@aic/contracts';
import { describe, expect, it } from 'vitest';
import {
  alertFingerprint,
  applyAcknowledge,
  applyTransition,
  can,
  canonicalJson,
  checkApprovable,
  computeSpecHash,
  dispatchDenial,
  hashCanonical,
  type IncidentState,
} from '../src/index.js';

const base: IncidentState = {
  status: 'declared',
  active: true,
  generation: 1,
  remediationRevision: 1,
  ownerId: null,
  acknowledgedAt: null,
  resolvedAt: null,
};
const now = new Date('2026-10-02T14:30:00.000Z');

describe('canonical JSON', () => {
  it('sorts keys, keeps array order and normalizes dates', () => {
    expect(canonicalJson({ b: 1, a: [3, 1], c: { z: true, y: null }, d: new Date(0) })).toBe(
      '{"a":[3,1],"b":1,"c":{"y":null,"z":true},"d":"1970-01-01T00:00:00.000Z"}',
    );
    expect(hashCanonical({ x: 1, y: 2 })).toBe(hashCanonical({ y: 2, x: 1 }));
  });
  it('rejects undefined, NaN and infinite numbers', () => {
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson({ a: NaN })).toThrow();
    expect(() => canonicalJson([Infinity])).toThrow();
  });
});

describe('incident lifecycle', () => {
  it('acknowledge moves declared → investigating and assigns the actor', () => {
    const s = applyAcknowledge(base, 'u1', now);
    expect(s.status).toBe('investigating');
    expect(s.ownerId).toBe('u1');
  });
  it('rejects acknowledging twice and transitions outside the state machine', () => {
    const s = applyAcknowledge(base, 'u1', now);
    expect(() => applyAcknowledge(s, 'u2', now)).toThrow(/declared/);
    expect(() => applyTransition(s, 'resolved', now)).toThrow(/Cannot move/);
    expect(() => applyTransition(base, 'investigating', now)).toThrow(/acknowledge/);
  });
  it('allows investigating → monitoring without mitigation and resolves from monitoring', () => {
    const s = applyTransition({ ...base, status: 'investigating' }, 'monitoring', now);
    const r = applyTransition(s, 'resolved', now);
    expect(r.active).toBe(false);
    expect(r.resolvedAt).toEqual(now);
  });
  it('reopen creates a new generation and invalidates remediation revision', () => {
    const r = applyTransition({ ...base, status: 'resolved', active: false, resolvedAt: now }, 'investigating', now);
    expect(r.reopened).toBe(true);
    expect(r.generation).toBe(2);
    expect(r.remediationRevision).toBe(2);
    expect(r.active).toBe(true);
  });
});

describe('permissions', () => {
  it('admin does not imply commander; auditor is read-only', () => {
    expect(can(['admin'], 'action.decide')).toBe(false);
    expect(can(['admin'], 'incident.acknowledge')).toBe(false);
    expect(can(['admin'], 'plugin.manage')).toBe(true);
    expect(can(['auditor'], 'audit.read')).toBe(true);
    expect(can(['auditor'], 'incident.comment')).toBe(false);
    expect(can(['viewer'], 'read')).toBe(true);
  });
});

const spec = (over: Partial<ActionSpec> = {}): ActionSpec => ({
  workspaceId: 'w',
  incidentId: 'i',
  incidentGeneration: 1,
  toolId: 'simulator.rollback_deployment',
  toolVersion: '1',
  installationId: 'inst',
  arguments: { toVersion: 'v1.0.0' },
  target: { serviceId: 's', environment: 'demo', revision: 'rev-1' },
  remediationRevision: 3,
  expectedEffect: 'x',
  riskSummary: 'y',
  verification: { metric: 'error_rate', operator: 'lt', value: 0.01, windowSeconds: 300 },
  simulation: true,
  expiresAt: new Date(now.getTime() + 600_000).toISOString(),
  ...over,
});

describe('approval binding', () => {
  const s = spec();
  const action = { status: 'awaiting_approval' as const, spec: s, specHash: computeSpecHash(s), requestedBy: 'req', renewedBy: null, lineageRequesters: [] };
  const incident = { generation: 1, remediationRevision: 3, active: true };
  const ok = { action, incident, deciderId: 'cmd', submittedSpecHash: action.specHash, now };

  it('accepts an independent commander with matching hash before expiry', () => {
    expect(() => checkApprovable(ok)).not.toThrow();
  });
  it('blocks the requester, the renewer and earlier lineage requesters', () => {
    expect(() => checkApprovable({ ...ok, deciderId: 'req' })).toThrow(expect.objectContaining({ code: 'SELF_APPROVAL_DENIED' }));
    expect(() => checkApprovable({ ...ok, action: { ...action, renewedBy: 'ren' }, deciderId: 'ren' })).toThrow(expect.objectContaining({ code: 'SELF_APPROVAL_DENIED' }));
    expect(() => checkApprovable({ ...ok, action: { ...action, lineageRequesters: ['old'] }, deciderId: 'old' })).toThrow(expect.objectContaining({ code: 'SELF_APPROVAL_DENIED' }));
  });
  it('rejects a changed hash, an expired spec and a changed remediation revision', () => {
    expect(() => checkApprovable({ ...ok, submittedSpecHash: `sha256:${'0'.repeat(64)}` })).toThrow(expect.objectContaining({ code: 'ACTION_STALE' }));
    expect(() => checkApprovable({ ...ok, now: new Date(now.getTime() + 600_000) })).toThrow(expect.objectContaining({ code: 'ACTION_EXPIRED' }));
    expect(() => checkApprovable({ ...ok, incident: { ...incident, remediationRevision: 4 } })).toThrow(expect.objectContaining({ code: 'ACTION_STALE' }));
    expect(() => checkApprovable({ ...ok, incident: { ...incident, generation: 2 } })).toThrow(expect.objectContaining({ code: 'ACTION_STALE' }));
  });
  it('detects a stored spec that no longer matches its hash', () => {
    const tampered = { ...action, spec: { ...s, arguments: { toVersion: 'v9.9.9' } } };
    expect(() => checkApprovable({ ...ok, action: tampered })).toThrow(expect.objectContaining({ code: 'ACTION_STALE' }));
  });
});

describe('dispatch preflight', () => {
  const s = spec();
  const good = {
    spec: s,
    specHash: computeSpecHash(s),
    now,
    incident: { generation: 1, remediationRevision: 3, active: true },
    approverIsActiveCommander: true,
    requesterIsActiveMember: true,
    installationPermits: true,
    dispatchStopped: false,
    currentTargetRevision: 'rev-1',
  };
  it('allows a fully valid dispatch', () => expect(dispatchDenial(good)).toBeNull());
  it.each([
    [{ dispatchStopped: true }, 'DISPATCH_STOPPED'],
    [{ now: new Date(now.getTime() + 601_000) }, 'EXPIRED'],
    [{ approverIsActiveCommander: false }, 'APPROVER_MEMBERSHIP_REVOKED'],
    [{ requesterIsActiveMember: false }, 'REQUESTER_MEMBERSHIP_REVOKED'],
    [{ installationPermits: false }, 'GRANT_REVOKED'],
    [{ currentTargetRevision: 'rev-2' }, 'TARGET_REVISION_CHANGED'],
    [{ incident: { generation: 1, remediationRevision: 4, active: true } }, 'REMEDIATION_REVISION_CHANGED'],
    [{ incident: null }, 'INCIDENT_INACTIVE'],
  ])('denies %o with %s', (over, code) => {
    expect(dispatchDenial({ ...good, ...over })).toBe(code);
  });
});

describe('fingerprint', () => {
  it('ignores volatile labels and measurement values', () => {
    const a = alertFingerprint({ alertType: 'http_error_rate', labels: { route: '/checkout', pod: 'a-1' } });
    const b = alertFingerprint({ alertType: 'http_error_rate', labels: { route: '/checkout', pod: 'b-7' } });
    const c = alertFingerprint({ alertType: 'http_error_rate', labels: { route: '/cart' } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('pure sha256', () => {
  it('matches node:crypto for text, unicode and block-boundary lengths', async () => {
    const { createHash } = await import('node:crypto');
    const { sha256Hex } = await import('../src/sha256.js');
    for (const input of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'résumé ✓ 日本', JSON.stringify({ x: [1, 2], y: 'z' })]) {
      expect(sha256Hex(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
    }
  });
});
