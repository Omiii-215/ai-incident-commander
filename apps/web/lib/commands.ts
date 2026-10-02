'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { ApiError, newKey } from './api';

/**
 * Runs one state-changing command. The idempotency key is created when the
 * user commits an intent and reused only to retry the same exact request after
 * an uncertain (lost) response. No optimistic UI: callers render server results.
 */
export function useCommand<A extends unknown[], T>(
  exec: (key: string, ...args: A) => Promise<T>,
  opts: { invalidate?: ReadonlyArray<readonly unknown[]>; onSuccess?: (result: T) => void; onConflict?: () => void } = {},
) {
  const qc = useQueryClient();
  const keyRef = useRef<string | null>(null);
  const lastArgs = useRef<A | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const invalidateAll = useCallback(() => {
    for (const k of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: k as unknown[] });
  }, [qc, opts.invalidate]);

  const run = useCallback(
    async (...args: A): Promise<T | undefined> => {
      if (pending) return undefined; // duplicate submit guard (in addition to the key)
      keyRef.current ??= newKey();
      lastArgs.current = args;
      setPending(true);
      setError(null);
      try {
        const result = await exec(keyRef.current, ...args);
        keyRef.current = null;
        invalidateAll();
        opts.onSuccess?.(result);
        return result;
      } catch (e) {
        setError(e);
        if (!(e instanceof ApiError && e.uncertain)) keyRef.current = null; // definitive answer: next intent gets a new key
        if (e instanceof ApiError && (e.status === 412 || e.status === 409)) {
          invalidateAll(); // refresh context; never auto-replay the command
          opts.onConflict?.();
        }
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [exec, invalidateAll, opts, pending],
  );

  const uncertain = error instanceof ApiError && error.uncertain;
  return {
    run,
    pending,
    error,
    uncertain,
    /** Retry the same request with the same key after a lost response. */
    retrySame: () => (lastArgs.current ? run(...lastArgs.current) : undefined),
    reset: () => {
      setError(null);
      keyRef.current = null;
    },
  };
}
