import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Object storage port. Local development uses a filesystem directory with
// workspace-scoped keys; hosted environments supply an S3-compatible adapter.

export interface ObjectStore {
  put(key: string, data: Buffer): Promise<{ checksum: string; size: number }>;
  get(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
}

const SAFE_KEY = /^[A-Za-z0-9/_.-]{1,400}$/;

export class LocalObjectStore implements ObjectStore {
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error('Invalid object key');
    return path.join(this.root, key);
  }

  async put(key: string, data: Buffer) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, { flag: 'w' });
    return { checksum: `sha256:${createHash('sha256').update(data).digest('hex')}`, size: data.length };
  }

  async get(key: string) {
    try {
      return await readFile(this.resolve(key));
    } catch {
      return null;
    }
  }

  async exists(key: string) {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

export class MemoryObjectStore implements ObjectStore {
  private readonly data = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.data.set(key, data);
    return { checksum: `sha256:${createHash('sha256').update(data).digest('hex')}`, size: data.length };
  }
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async exists(key: string) {
    return this.data.has(key);
  }
}

/** Secret references resolve from a server-side store; values never enter Mongo, logs or the browser. */
export interface SecretStore {
  resolve(ref: string): string | null;
}

/** Local/CI adapter: ref "synthetic-alerts-dev" → env SECRET_SYNTHETIC_ALERTS_DEV. */
export class EnvSecretStore implements SecretStore {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}
  resolve(ref: string) {
    if (!/^[a-z0-9-]{1,80}$/.test(ref)) return null;
    return this.env[`SECRET_${ref.toUpperCase().replace(/-/g, '_')}`] ?? null;
  }
}

export class MapSecretStore implements SecretStore {
  constructor(private readonly values: Record<string, string>) {}
  resolve(ref: string) {
    return this.values[ref] ?? null;
  }
}
