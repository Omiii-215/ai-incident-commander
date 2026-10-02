'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function WorkspaceIndex() {
  const { workspace } = useParams<{ workspace: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/w/${workspace}/overview`);
  }, [router, workspace]);
  return null;
}
