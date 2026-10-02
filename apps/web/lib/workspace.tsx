'use client';

import type { MeDTO } from '@aic/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { api, ApiError, setCsrfToken } from './api';

export type Workspace = MeDTO['workspaces'][number];

type Ctx = { me: MeDTO; workspace: Workspace; can: (op: string) => boolean; base: string };
const WorkspaceContext = createContext<Ctx | null>(null);

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const me = await api.get<MeDTO>('/me');
      setCsrfToken(me.csrfToken);
      return me;
    },
    retry: (n, e) => !(e instanceof ApiError && (e.status === 401 || e.status === 403)) && n < 2,
    refetchOnWindowFocus: true, // revalidate permissions when the tab returns
    staleTime: 30_000,
  });
}

export function WorkspaceProvider({ slug, children, fallback }: { slug: string; children: (ctx: Ctx) => ReactNode; fallback: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const unauth = me.error instanceof ApiError && me.error.status === 401;
  useEffect(() => {
    if (unauth) {
      qc.clear(); // clear restricted cached content
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
  }, [unauth, qc, router]);

  if (!me.data) return <>{fallback}</>;
  const workspace = me.data.workspaces.find((w) => w.slug === slug);
  if (!workspace) {
    return (
      <main id="main" className="mx-auto max-w-xl p-6">
        <h1 className="page-title">Workspace unavailable</h1>
        <p className="mt-2 text-fg-secondary">This workspace does not exist or you no longer have access to it.</p>
        {me.data.workspaces[0] && (
          <a className="mt-4 inline-block text-accent underline" href={`/w/${me.data.workspaces[0].slug}/overview`}>
            Go to {me.data.workspaces[0].name}
          </a>
        )}
      </main>
    );
  }
  const ctx: Ctx = { me: me.data, workspace, can: (op) => workspace.capabilities.includes(op), base: `/w/${workspace.slug}` };
  return <WorkspaceContext.Provider value={ctx}>{children(ctx)}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Ctx {
  const c = useContext(WorkspaceContext);
  if (!c) throw new Error('useWorkspace outside WorkspaceProvider');
  return c;
}

/** Query keys always begin with workspace identity (FRONTEND_ARCHITECTURE.md §3). */
export const wsKey = (workspaceId: string, ...parts: unknown[]) => ['ws', workspaceId, ...parts] as const;
