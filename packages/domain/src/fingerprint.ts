import { hashCanonical } from './canonical';

// Stable correlation fingerprint (LLD.md §5). Volatile values (measurements,
// receipt time, instance identifiers) are excluded unless the source mapping
// explicitly names a label as part of identity.

const VOLATILE_LABELS = new Set(['pod', 'instance', 'host', 'container', 'node', 'replica']);

export function alertFingerprint(input: {
  alertType: string;
  labels: Record<string, string>;
  identityLabels?: string[];
}): string {
  const selected: Record<string, string> = {};
  const identity = input.identityLabels ?? Object.keys(input.labels).filter((k) => !VOLATILE_LABELS.has(k));
  for (const key of identity) {
    const v = input.labels[key];
    if (v !== undefined) selected[key] = v;
  }
  return hashCanonical({ alertType: input.alertType, labels: selected });
}

/** Hash of the normalized alert content used to detect a reused source ID. */
export function normalizedAlertHash(input: {
  serviceKey: string;
  environment: string;
  alertType: string;
  severity: string;
  occurredAt: string;
  summary: string;
  labels: Record<string, string>;
  measurements: Record<string, number>;
}): string {
  return hashCanonical({ ...input, occurredAt: new Date(input.occurredAt).toISOString() });
}
