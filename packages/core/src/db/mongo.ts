import { MongoClient, MongoServerError, type ClientSession, type Collection, type Db } from 'mongodb';
import type * as T from './types.js';

export type Collections = {
  users: Collection<T.UserDoc>;
  workspaces: Collection<T.WorkspaceDoc>;
  memberships: Collection<T.MembershipDoc>;
  sessions: Collection<T.SessionDoc>;
  services: Collection<T.ServiceDoc>;
  connectorInstances: Collection<T.ConnectorInstanceDoc>;
  alerts: Collection<T.AlertDoc>;
  incidents: Collection<T.IncidentDoc>;
  timeline: Collection<T.TimelineDoc>;
  investigationRuns: Collection<T.InvestigationRunDoc>;
  diagnoses: Collection<T.DiagnosisDoc>;
  evidence: Collection<T.EvidenceDoc>;
  actions: Collection<T.ActionDoc>;
  approvals: Collection<T.ApprovalDoc>;
  executions: Collection<T.ExecutionDoc>;
  targetLeases: Collection<T.TargetLeaseDoc>;
  runbooks: Collection<T.RunbookDoc>;
  runbookVersions: Collection<T.RunbookVersionDoc>;
  runbookChunks: Collection<T.RunbookChunkDoc>;
  pluginCatalog: Collection<T.PluginCatalogDoc>;
  installations: Collection<T.InstallationDoc>;
  idempotency: Collection<T.IdempotencyDoc>;
  counters: Collection<T.CounterDoc>;
  workspaceEvents: Collection<T.WorkspaceEventDoc>;
  audit: Collection<T.AuditDoc>;
  outbox: Collection<T.OutboxDoc>;
  jobRuns: Collection<T.JobRunDoc>;
  postmortems: Collection<T.PostmortemDoc>;
  simulatorTargets: Collection<T.SimulatorTargetDoc>;
};

export const COLLECTION_NAMES: Record<keyof Collections, string> = {
  users: 'users',
  workspaces: 'workspaces',
  memberships: 'memberships',
  sessions: 'sessions',
  services: 'services',
  connectorInstances: 'connector_instances',
  alerts: 'alerts',
  incidents: 'incidents',
  timeline: 'incident_timeline',
  investigationRuns: 'investigation_runs',
  diagnoses: 'diagnoses',
  evidence: 'evidence',
  actions: 'actions',
  approvals: 'approvals',
  executions: 'executions',
  targetLeases: 'target_leases',
  runbooks: 'runbooks',
  runbookVersions: 'runbook_versions',
  runbookChunks: 'runbook_chunks',
  pluginCatalog: 'plugin_catalog',
  installations: 'plugin_installations',
  idempotency: 'idempotency_keys',
  counters: 'workspace_counters',
  workspaceEvents: 'workspace_events',
  audit: 'audit_events',
  outbox: 'outbox',
  jobRuns: 'job_runs',
  postmortems: 'postmortem_drafts',
  simulatorTargets: 'simulator_targets',
};

export class Database {
  readonly c: Collections;
  constructor(
    readonly client: MongoClient,
    readonly db: Db,
  ) {
    this.c = Object.fromEntries(
      Object.entries(COLLECTION_NAMES).map(([k, name]) => [k, db.collection(name)]),
    ) as unknown as Collections;
  }

  static async connect(uri: string, dbName?: string): Promise<Database> {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      retryWrites: true,
      maxPoolSize: 50,
    });
    await client.connect();
    return new Database(client, client.db(dbName));
  }

  async close() {
    await this.client.close();
  }

  /**
   * Run `fn` in one transaction. The driver retries transient errors and
   * unknown commit results; we additionally retry a bounded number of times on
   * duplicate-key races (e.g. two creators of the same active incident) so the
   * retry re-reads the committed winner. Never call a model, connector or object
   * store inside `fn`.
   */
  async transact<R>(fn: (session: ClientSession) => Promise<R>, opts: { retryOnDuplicate?: number } = {}): Promise<R> {
    const maxDup = opts.retryOnDuplicate ?? 2;
    for (let attempt = 0; ; attempt++) {
      const session = this.client.startSession();
      try {
        let result!: R;
        await session.withTransaction(
          async (s) => {
            result = await fn(s);
          },
          { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' },
        );
        return result;
      } catch (e) {
        if (isDuplicateKey(e) && attempt < maxDup) continue;
        throw e;
      } finally {
        await session.endSession();
      }
    }
  }
}

export const isDuplicateKey = (e: unknown): boolean =>
  e instanceof MongoServerError && (e.code === 11000 || e.code === 11001);

export type Tx = ClientSession;
