import type { Metadata } from 'next';
import { Runbooks } from '@/features/runbooks';

export const metadata: Metadata = { title: 'Runbooks' };

export default function Page() {
  return <Runbooks />;
}
