import type { Metadata } from 'next';
import { ServicesList } from '@/features/services-list';

export const metadata: Metadata = { title: 'Services' };

export default function Page() {
  return <ServicesList />;
}
