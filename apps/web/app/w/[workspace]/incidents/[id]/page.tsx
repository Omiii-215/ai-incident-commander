import type { Metadata } from 'next';
import { idParams } from '@/lib/demo/static-params';
import { IncidentDetail } from '@/features/incident-detail';

export async function generateStaticParams({ params }: { params: { workspace: string } }) {
  return idParams('incidents', params.workspace);
}

export const metadata: Metadata = { title: 'Incident' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IncidentDetail id={id} />;
}
