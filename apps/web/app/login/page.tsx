'use client';

import type { MeDTO, Role } from '@aic/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Logo } from '@/components/logo';
import { Banner, Button, ErrorState, Skeleton } from '@/components/ui';
import { api, setCsrfToken } from '@/lib/api';

type DevUser = { id: string; displayName: string; memberships: Array<{ workspace: string; roles: Role[] }> };

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const mode = useQuery({ queryKey: ['auth-mode'], queryFn: () => api.get<{ mode: 'dev' | 'oidc' }>('/auth/mode') });
  const users = useQuery({ queryKey: ['dev-users'], queryFn: () => api.get<DevUser[]>('/auth/dev-users'), enabled: mode.data?.mode === 'dev' });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const signIn = async (u: DevUser) => {
    setPending(u.id);
    setError(null);
    try {
      const res = await api.post<MeDTO>('/auth/dev-login', { userId: u.id });
      setCsrfToken(res.data.csrfToken);
      qc.clear(); // never reuse another identity's cached data
      qc.setQueryData(['me'], res.data);
      const next = params.get('next');
      const ws = res.data.workspaces[0];
      router.replace(next && next.startsWith('/w/') ? next : ws ? `/w/${ws.slug}/overview` : '/');
    } catch (e) {
      setError(e);
      setPending(null);
    }
  };

  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <div className="mb-8 text-xl">
        <Logo size={44} />
      </div>
      <h1 className="page-title">Sign in</h1>
      <p className="prose-width mt-2 text-fg-secondary">AI Incident Commander helps on-call teams investigate incidents with cited evidence and independently reviewed recovery actions.</p>
      <div className="mt-6 space-y-4">
        <Banner tone="info" title="Local development sign-in">
          Synthetic identities for the local and CI environments only. Production uses your organization&apos;s identity provider; this adapter refuses to start there.
        </Banner>
        {mode.isLoading && <Skeleton label="Loading sign-in options" />}
        {mode.data?.mode === 'oidc' && <Banner tone="warning" title="Single sign-on is not configured for this deployment." />}
        {users.error ? <ErrorState error={users.error} onRetry={() => void users.refetch()} /> : null}
        {error ? <ErrorState error={error} title="Sign-in failed." /> : null}
        {users.data && (
          <ul className="grid gap-3 sm:grid-cols-2" aria-label="Development users">
            {users.data.map((u) => (
              <li key={u.id} className="card flex flex-col gap-3 rounded-[10px] border border-line bg-surface p-4">
                <div>
                  <p className="font-semibold">{u.displayName}</p>
                  <ul className="text-sm text-fg-secondary">
                    {u.memberships.map((m) => (
                      <li key={m.workspace}>
                        {m.workspace}: {m.roles.join(', ')}
                      </li>
                    ))}
                  </ul>
                </div>
                <Button variant="primary" onClick={() => void signIn(u)} pending={pending === u.id} pendingLabel="Signing in…" disabled={pending !== null}>
                  Sign in as {u.displayName.split(' ')[0]}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {users.data?.length === 0 && <Banner tone="warning" title="No development users found.">Run <code>pnpm seed</code> first.</Banner>}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<Skeleton label="Loading sign-in" />}>
      <LoginInner />
    </Suspense>
  );
}

