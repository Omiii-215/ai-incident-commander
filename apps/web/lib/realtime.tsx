'use client';

import type { DashboardDTO, StreamInvalidation } from '@aic/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type ApiResult } from './api';
import { wsKey } from './workspace';

// One workspace stream per tab (FRONTEND_ARCHITECTURE.md §5–6). The stream is
// invalidation transport only: events carry IDs/versions and trigger refetches
// of authorized API resources. Never parse or increment cursors.

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'delayed' | 'offline' | 'polling' | 'signed_out';

type StreamCtx = {
  state: ConnectionState;
  lastSnapshotAt: string | null;
  lastHeartbeatAt: number | null;
  pendingListUpdates: number;
  applyListUpdates: () => void;
  reconnect: () => void;
  announce: (msg: string) => void;
};

const Ctx = createContext<StreamCtx | null>(null);

const HEARTBEAT_STALE_MS = 45_000;

// Showcase build only: an in-browser stream that mirrors the server's SSE events.
let demoStream: (new (workspaceId: string) => EventTarget) | null = null;
if (process.env.NEXT_PUBLIC_DEMO === '1' && typeof window !== 'undefined') {
  void import('./demo/server').then((m) => {
    demoStream = m.DemoEventSource;
  });
}
const SEEN_LIMIT = 500;

export function useDashboard(workspaceId: string) {
  return useQuery({
    queryKey: wsKey(workspaceId, 'dashboard'),
    queryFn: ({ signal }) => api.getFull<DashboardDTO>(`/workspaces/${workspaceId}/dashboard`, signal),
    staleTime: 10_000,
  });
}

export function StreamProvider({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const qc = useQueryClient();
  const dashboard = useDashboard(workspaceId);
  const [state, setState] = useState<ConnectionState>('connecting');
  const [lastHeartbeatAt, setLastHeartbeat] = useState<number | null>(null);
  const [pendingListUpdates, setPending] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const source = useRef<EventSource | null>(null);
  const generation = useRef(0);
  const seen = useRef<string[]>([]);
  const errors = useRef(0);
  const coalesce = useRef<NodeJS.Timeout | null>(null);
  const opened = useRef(false);
  const heartbeatRef = useRef<number | null>(null);
  const openRef = useRef<((cursor: string) => void) | null>(null);

  const invalidate = useCallback(
    (e: StreamInvalidation) => {
      const k = (...p: unknown[]) => qc.invalidateQueries({ queryKey: wsKey(workspaceId, ...p) });
      switch (e.entityType) {
        case 'incident':
          k('incident', e.entityId);
          k('timeline', e.entityId);
          k('evidence', e.entityId);
          k('diagnosis', e.entityId);
          k('investigation', e.entityId);
          k('postmortem', e.entityId);
          k('incident-actions', e.entityId);
          setPending((n) => n + 1); // list reorder waits for the operator ("Apply updates")
          break;
        case 'action':
          // Action/approval changes invalidate immediately.
          k('action', e.entityId);
          k('actions');
          k('incident-actions');
          k('timeline');
          void qc.invalidateQueries({ queryKey: wsKey(workspaceId, 'dashboard') });
          return;
        case 'investigation':
          k('investigation');
          k('diagnosis');
          break;
        case 'runbook':
          k('runbooks');
          break;
        case 'service':
          k('services');
          k('service', e.entityId);
          break;
        case 'plugin_installation':
          k('plugins');
          break;
        case 'postmortem':
          k('postmortem');
          k('timeline');
          break;
      }
      // Coalesce overview refreshes for up to 250 ms.
      if (coalesce.current) return;
      coalesce.current = setTimeout(() => {
        coalesce.current = null;
        void qc.invalidateQueries({ queryKey: wsKey(workspaceId, 'dashboard') });
      }, 250);
    },
    [qc, workspaceId],
  );

  const close = useCallback(() => {
    source.current?.close();
    source.current = null;
  }, []);

  const open = useCallback(
    (cursor: string) => {
      if (process.env.NEXT_PUBLIC_DEMO === '1' && !demoStream) {
        // Showcase build: load the in-browser stream first, then connect.
        void import('./demo/server').then((m) => {
          demoStream = m.DemoEventSource;
          openRef.current?.(cursor);
        });
        return;
      }
      close();
      const gen = ++generation.current;
      const es: EventSource =
        process.env.NEXT_PUBLIC_DEMO === '1' && demoStream
          ? (new demoStream(workspaceId) as unknown as EventSource)
          : new EventSource(`/api/v1/workspaces/${workspaceId}/events?after=${encodeURIComponent(cursor)}`);
      source.current = es;
      setState('connecting');
      heartbeatRef.current = Date.now();
      setLastHeartbeat(Date.now());

      es.onopen = () => {
        if (gen !== generation.current) return;
        errors.current = 0;
        setState('live');
      };
      es.addEventListener('entity_changed', (ev) => {
        if (gen !== generation.current) return; // callback from a superseded connection
        const id = (ev as MessageEvent).lastEventId;
        if (id && seen.current.includes(id)) return;
        if (id) {
          seen.current.push(id);
          if (seen.current.length > SEEN_LIMIT) seen.current.shift();
        }
        try {
          invalidate(JSON.parse((ev as MessageEvent).data) as StreamInvalidation);
        } catch {
          /* ignore malformed event */
        }
      });
      es.addEventListener('heartbeat', () => {
        if (gen !== generation.current) return;
        heartbeatRef.current = Date.now();
        setLastHeartbeat(Date.now());
        setState((s) => (s === 'delayed' || s === 'reconnecting' ? 'live' : s));
      });
      es.addEventListener('resync_required', () => {
        if (gen !== generation.current) return;
        close();
        setAnnouncement('Live updates resynchronizing.');
        // Fresh authorized snapshot, then reopen after its cursor.
        qc.removeQueries({ queryKey: wsKey(workspaceId, 'incidents') });
        opened.current = false;
        void qc.invalidateQueries({ queryKey: wsKey(workspaceId) });
      });
      es.addEventListener('access_revoked', () => {
        close();
        setState('signed_out');
        qc.clear();
        void qc.invalidateQueries({ queryKey: ['me'] });
      });
      es.onerror = async () => {
        if (gen !== generation.current) return;
        errors.current++;
        setState(navigator.onLine ? 'reconnecting' : 'offline');
        if (errors.current === 3 || errors.current % 10 === 0) {
          // EventSource hides status codes: distinguish session loss from transient failure.
          try {
            await api.get('/me');
          } catch (err) {
            if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
              close();
              setState('signed_out');
              qc.clear();
              void qc.invalidateQueries({ queryKey: ['me'] });
              return;
            }
          }
        }
        if (errors.current >= 6) setState('polling');
        if (es.readyState === EventSource.CLOSED) {
          // Browser gave up (e.g. HTTP error). Restart from a fresh snapshot with jittered backoff.
          close();
          opened.current = false;
          setTimeout(() => void qc.invalidateQueries({ queryKey: wsKey(workspaceId, 'dashboard') }), Math.min(30_000, 1000 * 2 ** Math.min(errors.current, 5)) + Math.random() * 1000);
        }
      };
    },
    [close, invalidate, qc, workspaceId],
  );

  openRef.current = open;

  // Open once per snapshot generation using the transactional snapshot cursor.
  const cursor = (dashboard.data as ApiResult<DashboardDTO> | undefined)?.meta.snapshotCursor as string | undefined;
  const snapshotAt = dashboard.dataUpdatedAt;
  useEffect(() => {
    if (cursor && !opened.current) {
      opened.current = true;
      open(cursor);
    }
  }, [cursor, snapshotAt, open]);

  useEffect(() => {
    return () => {
      generation.current++;
      close();
      opened.current = false;
    };
  }, [close, workspaceId]);

  // Heartbeat staleness and network hints.
  useEffect(() => {
    const t = setInterval(() => {
      if (heartbeatRef.current && Date.now() - heartbeatRef.current > HEARTBEAT_STALE_MS) {
        setState((s) => (s === 'live' ? 'delayed' : s));
      }
    }, 5000);
    const offline = () => setState('offline');
    const online = () => {
      setState('reconnecting');
      void qc.invalidateQueries({ queryKey: ['me'] }); // revalidate permissions first
      void qc.invalidateQueries({ queryKey: wsKey(workspaceId) });
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      clearInterval(t);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, [qc, workspaceId]);

  // Bounded snapshot polling fallback while the stream is unavailable and the page is visible.
  useEffect(() => {
    if (state !== 'polling') return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void qc.invalidateQueries({ queryKey: wsKey(workspaceId) });
    }, 30_000);
    return () => clearInterval(t);
  }, [state, qc, workspaceId]);

  const value: StreamCtx = {
    state,
    lastSnapshotAt: dashboard.data ? new Date(dashboard.dataUpdatedAt).toISOString() : null,
    lastHeartbeatAt,
    pendingListUpdates,
    applyListUpdates: () => {
      setPending(0);
      void qc.invalidateQueries({ queryKey: wsKey(workspaceId, 'incidents') });
    },
    reconnect: () => {
      errors.current = 0;
      opened.current = false;
      close();
      void qc.invalidateQueries({ queryKey: wsKey(workspaceId, 'dashboard') });
    },
    announce: setAnnouncement,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
    </Ctx.Provider>
  );
}

export function useStream(): StreamCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useStream outside StreamProvider');
  return c;
}
