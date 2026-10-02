import { createHash } from 'node:crypto';

// Deterministic JSON canonicalization (DATA_MODEL.md §5): sorted object keys,
// arrays preserved, undefined/NaN/Infinity forbidden, dates normalized to ISO.

export class CanonicalizationError extends Error {}

export function canonicalJson(value: unknown): string {
  return serialize(value, '$');
}

function serialize(value: unknown, path: string): string {
  if (value === null) return 'null';
  if (value === undefined) throw new CanonicalizationError(`undefined at ${path}`);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new CanonicalizationError(`invalid date at ${path}`);
    return JSON.stringify(value.toISOString());
  }
  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalizationError(`non-finite number at ${path}`);
      return JSON.stringify(value);
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v, i) => serialize(v, `${path}[${i}]`)).join(',')}]`;
      const entries = Object.keys(value as object)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${serialize((value as Record<string, unknown>)[k], `${path}.${k}`)}`);
      return `{${entries.join(',')}}`;
    }
    default:
      throw new CanonicalizationError(`unsupported ${typeof value} at ${path}`);
  }
}

export const sha256Hex = (input: string | Uint8Array) => createHash('sha256').update(input).digest('hex');

export const hashCanonical = (value: unknown) => `sha256:${sha256Hex(canonicalJson(value))}`;
