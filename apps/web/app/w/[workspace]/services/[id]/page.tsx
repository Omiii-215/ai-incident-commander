import type { Metadata } from 'next';
import { idParams } from '@/lib/demo/static-params';
import { ServiceDetail } from '@/features/service-detail';

export async function generateStaticParams({ params }: { params: { workspace: string } }) {
  return idParams('services', params.workspace);
}

export const metadata: Metadata = { title: 'Service' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ServiceDetail id={id} />;
}
