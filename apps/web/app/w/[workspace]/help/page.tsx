import type { Metadata } from 'next';
import { Help } from '@/features/help';

export const metadata: Metadata = { title: 'Help' };

export default function Page() {
  return <Help />;
}
