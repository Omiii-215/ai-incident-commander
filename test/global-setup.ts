import { MongoMemoryReplSet } from 'mongodb-memory-server';

// One single-node replica set for the integration run; each test file uses its own database.
let replSet: MongoMemoryReplSet | undefined;

export async function setup({ provide }: { provide: (key: string, value: unknown) => void }) {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  provide('mongoUri', replSet.getUri());
}

export async function teardown() {
  await replSet?.stop();
}
