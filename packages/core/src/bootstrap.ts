import path from 'node:path';
import { createProvider, type ModelProvider } from './ai/provider.js';
import type { AppConfig } from './config.js';
import { PolicyGateway } from './connectors/gateway.js';
import { Simulator } from './connectors/simulator.js';
import { systemClock, type Clock } from './context.js';
import { CursorCodec } from './cursor.js';
import { Database } from './db/mongo.js';
import type { Deps } from './deps.js';
import { EnvSecretStore, LocalObjectStore, type ObjectStore, type SecretStore } from './object-store.js';

export function buildDeps(parts: {
  db: Database;
  cursorKey: string;
  clock?: Clock;
  objects: ObjectStore;
  secrets: SecretStore;
  provider: ModelProvider;
}): Deps {
  const clock = parts.clock ?? systemClock;
  const simulator = new Simulator(parts.db, clock);
  return {
    db: parts.db,
    clock,
    cursors: new CursorCodec(parts.cursorKey),
    simulator,
    gateway: new PolicyGateway(parts.db, simulator, clock),
    objects: parts.objects,
    secrets: parts.secrets,
    provider: parts.provider,
  };
}

export async function createDeps(config: AppConfig, rootDir = process.cwd()): Promise<Deps> {
  const db = await Database.connect(config.MONGODB_URI);
  return buildDeps({
    db,
    cursorKey: config.CURSOR_SIGNING_KEY,
    objects: new LocalObjectStore(path.resolve(rootDir, config.OBJECT_STORAGE_DIR)),
    secrets: new EnvSecretStore(),
    provider: createProvider(config.MODEL_PROVIDER_PROFILE),
  });
}
