import { createHash, randomBytes } from 'node:crypto';
import { notFound, type MeDTO } from '@aic/contracts';
import { capabilitiesFor } from '@aic/domain';
import type { ActorContext } from '../context.js';
import type { Deps } from '../deps.js';
import type { SessionDoc } from '../db/types.js';

// Server-side sessions (SECURITY_AND_PERMISSIONS.md §3). The cookie holds an
// opaque random token; only its hash is stored. Membership is always derived
// on the server, never from request payloads.

export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 24 * 60 * 60 * 1000;

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export async function createSession(deps: Deps, userId: string): Promise<{ token: string; csrfToken: string }> {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const now = deps.clock.now();
  await deps.db.c.sessions.insertOne({
    _id: hashToken(token),
    userId,
    csrfToken,
    createdAt: now,
    lastSeenAt: now,
    idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
    absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
  });
  return { token, csrfToken };
}

export async function resolveSession(deps: Deps, token: string | undefined): Promise<SessionDoc | null> {
  if (!token || token.length > 200) return null;
  const now = deps.clock.now();
  const s = await deps.db.c.sessions.findOne({ _id: hashToken(token) });
  if (!s || s.idleExpiresAt <= now || s.absoluteExpiresAt <= now) return null;
  if (now.getTime() - s.lastSeenAt.getTime() > 60_000) {
    await deps.db.c.sessions.updateOne(
      { _id: s._id },
      { $set: { lastSeenAt: now, idleExpiresAt: new Date(Math.min(now.getTime() + SESSION_IDLE_MS, s.absoluteExpiresAt.getTime())) } },
    );
  }
  return s;
}

export async function deleteSession(deps: Deps, token: string | undefined) {
  if (token) await deps.db.c.sessions.deleteOne({ _id: hashToken(token) });
}

export async function getMe(deps: Deps, session: SessionDoc): Promise<MeDTO> {
  const user = await deps.db.c.users.findOne({ _id: session.userId });
  if (!user) throw notFound();
  const memberships = await deps.db.c.memberships.find({ userId: user._id, status: 'active' }).toArray();
  const workspaces = await deps.db.c.workspaces.find({ _id: { $in: memberships.map((m) => m.workspaceId) }, status: 'active' }).toArray();
  return {
    user: { id: user._id, displayName: user.displayName },
    workspaces: workspaces.map((w) => {
      const roles = memberships.find((m) => m.workspaceId === w._id)!.roles;
      return { id: w._id, name: w.name, slug: w.slug, roles, capabilities: capabilitiesFor(roles), dispatchStopped: w.dispatchStopped };
    }),
    csrfToken: session.csrfToken,
  };
}

/** Resolve an active membership; inaccessible workspaces are indistinguishable from missing ones. */
export async function resolveActor(deps: Deps, userId: string, workspaceId: string, requestId: string, sessionId?: string): Promise<ActorContext> {
  const [membership, workspace] = await Promise.all([
    deps.db.c.memberships.findOne({ workspaceId, userId, status: 'active' }),
    deps.db.c.workspaces.findOne({ _id: workspaceId, status: 'active' }),
  ]);
  if (!membership || !workspace) throw notFound();
  return {
    subjectId: userId,
    workspaceId,
    roles: membership.roles,
    membershipVersion: membership.grantVersion,
    requestId,
    ...(sessionId ? { sessionId } : {}),
  };
}

/** Local/CI only: seeded identities for the test authentication adapter. */
export async function listDevUsers(deps: Deps) {
  const users = await deps.db.c.users.find({ identityIssuer: 'dev-local' }).sort({ displayName: 1 }).toArray();
  const memberships = await deps.db.c.memberships.find({ userId: { $in: users.map((u) => u._id) }, status: 'active' }).toArray();
  const workspaces = await deps.db.c.workspaces.find({}).toArray();
  return users.map((u) => ({
    id: u._id,
    displayName: u.displayName,
    memberships: memberships
      .filter((m) => m.userId === u._id)
      .map((m) => ({ workspace: workspaces.find((w) => w._id === m.workspaceId)?.name ?? '', roles: m.roles })),
  }));
}
