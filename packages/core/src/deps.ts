import type { ModelProvider } from './ai/provider.js';
import type { PolicyGateway } from './connectors/gateway.js';
import type { Simulator } from './connectors/simulator.js';
import type { Clock } from './context.js';
import type { CursorCodec } from './cursor.js';
import type { Database } from './db/mongo.js';
import type { ObjectStore, SecretStore } from './object-store.js';

/** Dependency container passed to application services and job handlers. */
export type Deps = {
  db: Database;
  clock: Clock;
  cursors: CursorCodec;
  simulator: Simulator;
  gateway: PolicyGateway;
  objects: ObjectStore;
  secrets: SecretStore;
  provider: ModelProvider;
};
