import { Database, loadConfig, migrate } from '@aic/core';

const config = loadConfig();
const db = await Database.connect(config.MONGODB_URI);
await migrate(db, console.log);
await db.close();
