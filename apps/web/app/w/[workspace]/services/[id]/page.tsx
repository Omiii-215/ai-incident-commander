import type { Metadata } from 'next';
import { ServiceDetail } from '@/features/service-detail';

export const metadata: Metadata = { title: 'Service' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ServiceDetail id={id} />;
}
