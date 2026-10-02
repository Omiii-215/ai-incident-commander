import type { Metadata } from 'next';
import { Overview } from '@/features/overview';

export const metadata: Metadata = { title: 'Overview' };

export default function Page() {
  return <Overview />;
}
