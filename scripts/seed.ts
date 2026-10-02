// Local/CI only: resets the database and loads synthetic tenants.
import path from 'node:path';
import { buildDeps, createProvider, Database, EnvSecretStore, LocalObjectStore, loadConfig, migrate, SeedClock, seedDemo } from '@aic/core';

const config = loadConfig();
if (config.APP_ENV !== 'local' && config.APP_ENV !== 'ci') {
  console.error('Refusing to seed outside local/ci.');
  process.exit(1);
}
const db = await Database.connect(config.MONGODB_URI);
await db.db.dropDatabase();
await migrate(db, console.log);
const deps = buildDeps({
  db,
  cursorKey: config.CURSOR_SIGNING_KEY,
  clock: new SeedClock(new Date()),
  objects: new LocalObjectStore(path.resolve(config.OBJECT_STORAGE_DIR)),
  secrets: new EnvSecretStore(),
  provider: createProvider(config.MODEL_PROVIDER_PROFILE),
});
const result = await seedDemo(deps, { log: (m) => console.log(`seed: ${m}`) });
console.log(`seed: done (${result.incidentIds.length} alerts → incidents). Sign in at ${config.PUBLIC_APP_ORIGIN}`);
await db.close();
