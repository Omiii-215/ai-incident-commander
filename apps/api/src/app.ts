import { AppError } from '@aic/contracts';
import {
  ActionListQuery,
  ActionProposalBody,
  CommentBody,
  CompleteRunbookVersionBody,
  CreateRunbookBody,
  CreateRunbookVersionBody,
  CreateServiceBody,
  DecisionBody,
  DispatchControlBody,
  IncidentListQuery,
  InstallPluginBody,
  InvestigationBody,
  PageQuery,
  PatchIncidentBody,
  PatchInstallationBody,
  PatchServiceBody,
  PublishRunbookBody,
  ReasonBody,
  RUNBOOK_MAX_BYTES,
  TransitionBody,
} from '@aic/contracts';
import {
  actions,
  audit,
  auth,
  catalog,
  dashboard,
  incidents,
  ingestion,
  investigations,
  migrationsCurrent,
  plugins,
  postmortems,
  runbooks,
  type AppConfig,
  type Deps,
} from '@aic/core';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import { actor, commandMeta, errorHandler, param, parse, RateLimiter, requestId, send, sendCommand } from './http.js';
import { streamHandler } from './sse.js';

export const SESSION_COOKIE = 'aic_session';
const JSON_LIMIT = '256kb';

export function createApp(deps: Deps, config: Pick<AppConfig, 'APP_ENV' | 'AUTH_MODE' | 'PUBLIC_APP_ORIGIN'>, log: Logger) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(requestId);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      // Structured access log: IDs and timings only, never bodies.
      log.info({ requestId: req.requestId, method: req.method, route: req.route?.path ?? req.path.replace(/[0-9a-f-]{36}/g, ':id'), status: res.statusCode, ms: Number(process.hrtime.bigint() - started) / 1e6 }, 'request');
    });
    next();
  });

  const devAuth = config.AUTH_MODE === 'dev' && (config.APP_ENV === 'local' || config.APP_ENV === 'ci');
  const secure = config.PUBLIC_APP_ORIGIN.startsWith('https://');
  const readLimiter = new RateLimiter(120, 60_000);
  const commandLimiter = new RateLimiter(60, 60_000);
  const connectorLimiter = new RateLimiter(1200, 60_000);

  // ---- Health (transport adapters, no domain data) ----
  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/health/ready', async (_req, res) => {
    try {
      await deps.db.db.command({ ping: 1 });
      const migrated = await migrationsCurrent(deps.db);
      res.status(migrated ? 200 : 503).json({ status: migrated ? 'ready' : 'migrations_pending', components: { mongo: 'ok', ai: deps.provider.profile } });
    } catch {
      res.status(503).json({ status: 'unavailable', components: { mongo: 'error' } });
    }
  });

  const api = express.Router();

  // ---- Connector ingestion: signature auth, raw body, no browser session ----
  api.post('/connectors/:connectorId/alerts', express.raw({ type: () => true, limit: JSON_LIMIT }), async (req, res) => {
    connectorLimiter.hit(`connector:${req.params.connectorId}`);
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const result = await ingestion.ingestAlert(deps, {
      connectorId: String(req.params.connectorId),
      rawBody: raw,
      timestamp: req.get('X-Connector-Timestamp'),
      signature: req.get('X-Connector-Signature'),
      requestId: req.requestId,
    });
    res.status(result.status).json({ data: result.body, meta: { requestId: req.requestId } });
  });

  api.use(express.json({ limit: JSON_LIMIT, strict: true }));
  api.use(cookieParser());

  // ---- Session resolution ----
  api.use(async (req, _res, next) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const session = await auth.resolveSession(deps, token);
    if (session) {
      req.session = session;
      req.sessionToken = token!;
    }
    next();
  });

  // ---- CSRF + origin checks for state-changing browser requests ----
  api.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.path === '/auth/dev-login') return next(); // no session yet; origin still checked below
    const origin = req.get('Origin');
    if (origin && origin !== config.PUBLIC_APP_ORIGIN) throw new AppError('CSRF_FAILED', 'Cross-origin request rejected.');
    if (!req.session) throw new AppError('SESSION_EXPIRED', 'Your session expired. Sign in again.');
    if (req.get('X-CSRF-Token') !== req.session.csrfToken) throw new AppError('CSRF_FAILED', 'Security token missing or stale. Refresh and retry.');
    next();
  });

  // ---- Authentication adapter (dev/test only; OIDC is a later milestone) ----
  if (devAuth) {
    api.get('/auth/dev-users', async (req, res) => send(res, req, 200, await auth.listDevUsers(deps)));
    api.post('/auth/dev-login', async (req, res) => {
      const origin = req.get('Origin');
      if (origin && origin !== config.PUBLIC_APP_ORIGIN) throw new AppError('CSRF_FAILED', 'Cross-origin request rejected.');
      const { userId } = parse(z.object({ userId: z.uuid() }).strict(), req.body);
      const user = await deps.db.c.users.findOne({ _id: userId, identityIssuer: 'dev-local' });
      if (!user) throw new AppError('UNAUTHENTICATED', 'Unknown development user.');
      await auth.deleteSession(deps, req.cookies?.[SESSION_COOKIE]); // rotate at sign-in
      const s = await auth.createSession(deps, user._id);
      res.cookie(SESSION_COOKIE, s.token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: auth.SESSION_ABSOLUTE_MS });
      const session = await auth.resolveSession(deps, s.token);
      send(res, req, 200, await auth.getMe(deps, session!));
    });
  }
  api.get('/auth/mode', (req, res) => send(res, req, 200, { mode: devAuth ? 'dev' : 'oidc' }));
  api.post('/auth/logout', async (req, res) => {
    await auth.deleteSession(deps, req.sessionToken);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    send(res, req, 200, { signedOut: true });
  });

  const requireSession = (req: Request, _res: Response, next: NextFunction) => {
    if (!req.session) throw new AppError('SESSION_EXPIRED', 'Your session expired. Sign in again.');
    if (req.method === 'GET') readLimiter.hit(`u:${req.session.userId}`);
    else commandLimiter.hit(`u:${req.session.userId}`);
    next();
  };

  api.get('/me', requireSession, async (req, res) => send(res, req, 200, await auth.getMe(deps, req.session!)));

  // ---- Workspace scope: membership validated before resolving any child record ----
  const ws = express.Router({ mergeParams: true });
  api.use('/workspaces/:workspaceId', requireSession, async (req, _res, next) => {
    const workspaceId = param(req, 'workspaceId');
    req.actor = await auth.resolveActor(deps, req.session!.userId, workspaceId, req.requestId, req.session!._id);
    next();
  }, ws);

  ws.get('/dashboard', async (req, res) => {
    const snap = await dashboard.getDashboard(deps, actor(req));
    send(res, req, 200, snap.data, { snapshotStreamSeq: snap.snapshotStreamSeq, snapshotCursor: snap.snapshotCursor });
  });
  ws.get('/events', streamHandler(deps, log));

  // Incidents
  ws.get('/incidents', async (req, res) => send(res, req, 200, await incidents.listIncidents(deps, actor(req), parse(IncidentListQuery, req.query))));
  ws.get('/incidents/:id', async (req, res) => send(res, req, 200, await incidents.getIncident(deps, actor(req), param(req, 'id'))));
  ws.post('/incidents/:id/acknowledge', async (req, res) => {
    parse(z.object({}).strict(), req.body ?? {});
    sendCommand(res, req, await incidents.acknowledgeIncident(deps, actor(req), param(req, 'id'), commandMeta(req)));
  });
  ws.post('/incidents/:id/transitions', async (req, res) =>
    sendCommand(res, req, await incidents.transitionIncident(deps, actor(req), param(req, 'id'), parse(TransitionBody, req.body), commandMeta(req))),
  );
  ws.patch('/incidents/:id', async (req, res) =>
    sendCommand(res, req, await incidents.patchIncident(deps, actor(req), param(req, 'id'), parse(PatchIncidentBody, req.body), commandMeta(req))),
  );
  ws.get('/incidents/:id/timeline', async (req, res) => {
    const q = parse(PageQuery.extend({ order: z.enum(['asc', 'desc']).default('desc') }), req.query);
    send(res, req, 200, await incidents.listTimeline(deps, actor(req), param(req, 'id'), q));
  });
  ws.post('/incidents/:id/comments', async (req, res) =>
    sendCommand(res, req, await incidents.commentOnIncident(deps, actor(req), param(req, 'id'), parse(CommentBody, req.body), commandMeta(req))),
  );
  ws.post('/incidents/:id/investigations', async (req, res) =>
    sendCommand(res, req, await investigations.requestInvestigation(deps, actor(req), param(req, 'id'), parse(InvestigationBody, req.body), commandMeta(req))),
  );
  ws.get('/incidents/:id/investigations/latest', async (req, res) => send(res, req, 200, await investigations.latestInvestigation(deps, actor(req), param(req, 'id'))));
  ws.get('/incidents/:id/diagnosis', async (req, res) => send(res, req, 200, await investigations.getDiagnosis(deps, actor(req), param(req, 'id'))));
  ws.get('/investigations/:id', async (req, res) => send(res, req, 200, await investigations.getInvestigation(deps, actor(req), param(req, 'id'))));
  ws.get('/incidents/:id/evidence', async (req, res) => send(res, req, 200, await incidents.listEvidence(deps, actor(req), param(req, 'id'), parse(incidents.EvidenceQuery, req.query))));
  ws.get('/evidence/:id', async (req, res) => send(res, req, 200, await incidents.getEvidence(deps, actor(req), param(req, 'id'))));
  ws.get('/evidence/:id/download', async (req, res) => {
    // Reauthorize, then stream the redacted excerpt with a clear filename.
    const ev = await incidents.getEvidence(deps, actor(req), param(req, 'id'));
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="evidence-${ev.id}.txt"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(`# ${ev.title}\n# source: ${ev.sourceId} version: ${ev.sourceVersion ?? 'n/a'}\n# collected: ${ev.collectedAt} (redacted excerpt)\n\n${ev.redactedExcerpt}\n`);
  });
  ws.post('/incidents/:id/actions', async (req, res) =>
    sendCommand(res, req, await actions.proposeAction(deps, actor(req), param(req, 'id'), parse(ActionProposalBody, req.body), commandMeta(req))),
  );
  ws.post('/incidents/:id/postmortem-drafts', async (req, res) =>
    sendCommand(res, req, await postmortems.requestPostmortem(deps, actor(req), param(req, 'id'), commandMeta(req))),
  );
  ws.get('/incidents/:id/postmortem-drafts/latest', async (req, res) => send(res, req, 200, await postmortems.latestPostmortem(deps, actor(req), param(req, 'id'))));

  // Actions and approvals
  ws.get('/actions', async (req, res) => send(res, req, 200, await actions.listActions(deps, actor(req), parse(ActionListQuery, req.query))));
  ws.get('/actions/:id', async (req, res) => send(res, req, 200, await actions.getAction(deps, actor(req), param(req, 'id'))));
  ws.post('/actions/:id/decisions', async (req, res) =>
    sendCommand(res, req, await actions.decideAction(deps, actor(req), param(req, 'id'), parse(DecisionBody, req.body), commandMeta(req))),
  );
  ws.post('/actions/:id/cancel', async (req, res) =>
    sendCommand(res, req, await actions.cancelAction(deps, actor(req), param(req, 'id'), parse(ReasonBody, req.body), commandMeta(req))),
  );
  ws.post('/actions/:id/renew', async (req, res) =>
    sendCommand(res, req, await actions.renewAction(deps, actor(req), param(req, 'id'), parse(ReasonBody, req.body), commandMeta(req))),
  );
  ws.post('/dispatch-controls', async (req, res) =>
    sendCommand(res, req, await actions.setDispatchStopped(deps, actor(req), parse(DispatchControlBody, req.body), commandMeta(req))),
  );

  // Services
  ws.get('/services', async (req, res) => send(res, req, 200, await catalog.listServices(deps, actor(req), parse(PageQuery, req.query))));
  ws.get('/services/:id', async (req, res) => send(res, req, 200, await catalog.getService(deps, actor(req), param(req, 'id'))));
  ws.post('/services', async (req, res) => sendCommand(res, req, await catalog.createService(deps, actor(req), parse(CreateServiceBody, req.body), commandMeta(req))));
  ws.patch('/services/:id', async (req, res) =>
    sendCommand(res, req, await catalog.patchService(deps, actor(req), param(req, 'id'), parse(PatchServiceBody, req.body), commandMeta(req))),
  );

  // Runbooks
  ws.get('/runbooks', async (req, res) => send(res, req, 200, await runbooks.listRunbooks(deps, actor(req), parse(PageQuery.extend({ serviceId: z.uuid().optional() }), req.query))));
  ws.get('/runbooks/search', async (req, res) =>
    send(res, req, 200, await runbooks.searchRunbooks(deps, actor(req), parse(z.object({ q: z.string().min(1).max(200), serviceId: z.uuid().optional() }).strict(), req.query))),
  );
  ws.get('/runbooks/:id', async (req, res) => send(res, req, 200, await runbooks.getRunbook(deps, actor(req), param(req, 'id'))));
  ws.post('/runbooks', async (req, res) => sendCommand(res, req, await runbooks.createRunbook(deps, actor(req), parse(CreateRunbookBody, req.body), commandMeta(req))));
  ws.post('/runbooks/:id/versions', async (req, res) =>
    sendCommand(res, req, await runbooks.createRunbookVersion(deps, actor(req), param(req, 'id'), parse(CreateRunbookVersionBody, req.body), commandMeta(req))),
  );
  ws.put(
    '/runbooks/:id/versions/:versionId/content',
    express.raw({ type: ['text/markdown', 'text/plain', 'application/octet-stream'], limit: RUNBOOK_MAX_BYTES }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body)) throw new AppError('UNSUPPORTED_FILE', 'Upload Markdown or plain text content.');
      send(res, req, 200, await runbooks.uploadRunbookContent(deps, actor(req), param(req, 'id'), param(req, 'versionId'), req.body));
    },
  );
  ws.post('/runbooks/:id/versions/:versionId/complete', async (req, res) =>
    sendCommand(res, req, await runbooks.completeRunbookVersion(deps, actor(req), param(req, 'id'), param(req, 'versionId'), parse(CompleteRunbookVersionBody, req.body), commandMeta(req))),
  );
  ws.post('/runbooks/:id/publish', async (req, res) =>
    sendCommand(res, req, await runbooks.publishRunbook(deps, actor(req), param(req, 'id'), parse(PublishRunbookBody, req.body), commandMeta(req))),
  );

  // Plugins
  ws.get('/plugins/catalog', async (req, res) => send(res, req, 200, await plugins.listCatalog(deps, actor(req))));
  ws.get('/plugins/installations', async (req, res) => send(res, req, 200, await plugins.listInstallations(deps, actor(req))));
  ws.post('/plugins/installations', async (req, res) => sendCommand(res, req, await plugins.installPlugin(deps, actor(req), parse(InstallPluginBody, req.body), commandMeta(req))));
  ws.patch('/plugins/installations/:id', async (req, res) =>
    sendCommand(res, req, await plugins.patchInstallation(deps, actor(req), param(req, 'id'), parse(PatchInstallationBody, req.body), commandMeta(req))),
  );
  ws.post('/plugins/installations/:id/test', async (req, res) => sendCommand(res, req, await plugins.testInstallation(deps, actor(req), param(req, 'id'), commandMeta(req))));
  ws.post('/plugins/installations/:id/revoke', async (req, res) =>
    sendCommand(res, req, await plugins.revokeInstallation(deps, actor(req), param(req, 'id'), parse(ReasonBody, req.body), commandMeta(req))),
  );

  // Audit
  ws.get('/audit', async (req, res) => send(res, req, 200, await audit.listAudit(deps, actor(req), parse(audit.AuditQuery, req.query))));

  api.use((_req, _res, next) => next(new AppError('NOT_FOUND', 'This item is unavailable.')));
  app.use('/api/v1', api);
  app.use(errorHandler(log));
  return app;
}
