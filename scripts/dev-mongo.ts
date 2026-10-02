// Local single-node MongoDB replica set (transactions require a replica set).
// Use this when Docker is unavailable; `infra/docker-compose.yml` is the
// container alternative. Data persists under .data/mongo. No high availability.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const port = Number(new URL((process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018').replace(/^mongodb:/, 'http:')).port || 27018);
// If something already listens on the port, report what it is instead of crashing.
try {
  const probe = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 1500 });
  await probe.connect();
  const hello = await probe.db('admin').command({ hello: 1 });
  await probe.close();
  if (hello.setName) {
    console.log(`MongoDB replica set "${hello.setName}" is already running on port ${port}. Nothing to do.`);
    process.exit(0);
  }
  console.error(`Port ${port} is used by a standalone mongod (no replica set). Stop it or set a different port in MONGODB_URI.`);
  process.exit(1);
} catch {
  // Nothing listening: start a new replica set below.
}

const dbPath = path.resolve('.data/mongo');
mkdirSync(dbPath, { recursive: true });

const replSet = await MongoMemoryReplSet.create({
  replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
  instanceOpts: [{ port, dbPath, ip: '127.0.0.1' }],
});
console.log(`MongoDB replica set ready: ${replSet.getUri('aic')}`);
console.log('Press Ctrl+C to stop.');
const stop = async () => {
  await replSet.stop({ doCleanup: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
