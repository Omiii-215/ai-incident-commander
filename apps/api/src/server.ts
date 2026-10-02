import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeps, loadConfig, migrationsCurrent } from '@aic/core';
import { pino } from 'pino';
import { createApp } from './app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const log = pino({
  name: 'api',
  redact: { paths: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.token', '*.secret'], censor: '[REDACTED]' },
});

async function main() {
  const config = loadConfig();
  const deps = await createDeps(config, ROOT);
  if (!(await migrationsCurrent(deps.db))) {
    log.warn('database migrations are not current; run `pnpm migrate` (readiness will report 503)');
  }
  const app = createApp(deps, config, log);
  const server = app.listen(config.API_PORT, () => log.info({ port: config.API_PORT, env: config.APP_ENV, auth: config.AUTH_MODE, ai: deps.provider.profile }, 'api listening'));
  // SSE connections are long-lived; keep proxies' >=60 s read timeout in mind.
  server.keepAliveTimeout = 65_000;

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down: draining HTTP and closing streams');
    server.close();
    server.closeAllConnections?.();
    await deps.db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  log.fatal({ err: (e as Error).message }, 'api failed to start');
  process.exit(1);
});
