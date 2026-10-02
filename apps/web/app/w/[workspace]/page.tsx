import { redirect } from 'next/navigation';

export default async function WorkspaceIndex({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  redirect(`/w/${workspace}/overview`);
}
