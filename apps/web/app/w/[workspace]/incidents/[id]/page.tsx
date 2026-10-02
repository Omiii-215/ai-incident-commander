import type { Metadata } from 'next';
import { IncidentDetail } from '@/features/incident-detail';

export const metadata: Metadata = { title: 'Incident' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IncidentDetail id={id} />;
}
