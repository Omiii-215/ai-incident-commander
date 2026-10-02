import type { ReactNode } from 'react';
import { WorkspaceShell } from '@/components/shell';

export default async function WorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  return <WorkspaceShell slug={workspace}>{children}</WorkspaceShell>;
}
