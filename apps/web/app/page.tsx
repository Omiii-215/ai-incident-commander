'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useMe } from '@/lib/workspace';

export default function Home() {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me.data?.workspaces[0]) router.replace(`/w/${me.data.workspaces[0].slug}/overview`);
    else if (me.error instanceof ApiError && me.error.status === 401) router.replace('/login');
  }, [me.data, me.error, router]);
  return (
    <main id="main" className="mx-auto max-w-md p-6">
      <h1 className="sr-only">AI Incident Commander</h1>
      {me.data && me.data.workspaces.length === 0 ? <p>You are not a member of any workspace yet.</p> : <Skeleton label="Opening your workspace" />}
    </main>
  );
}
