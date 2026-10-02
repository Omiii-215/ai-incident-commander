import { randomUUID } from 'node:crypto';
import type { Role } from '@aic/contracts';
import type { Actor } from './db/types.js';

// Injectable seams (LLD.md §10).
export type Clock = { now(): Date };
export const systemClock: Clock = { now: () => new Date() };
export type IdGen = () => string;
export const uuid: IdGen = () => randomUUID();

/** Authenticated human acting inside one workspace. Never built from request payloads. */
export type ActorContext = {
  subjectId: string;
  workspaceId: string;
  roles: Role[];
  membershipVersion: number;
  requestId: string;
  sessionId?: string;
};

export const userActor = (ctx: ActorContext): Actor => ({ type: 'user', id: ctx.subjectId });

/** Named service principals with purpose-specific permissions (SECURITY §2). */
export const SERVICE_PRINCIPALS = {
  ingestion: { type: 'service', id: 'svc-ingestion' },
  investigator: { type: 'service', id: 'svc-investigator' },
  executor: { type: 'service', id: 'svc-executor' },
  reconciler: { type: 'service', id: 'svc-reconciler' },
  knowledge: { type: 'service', id: 'svc-knowledge' },
  scheduler: { type: 'service', id: 'svc-scheduler' },
  reporter: { type: 'service', id: 'svc-reporter' },
} as const satisfies Record<string, Actor>;
