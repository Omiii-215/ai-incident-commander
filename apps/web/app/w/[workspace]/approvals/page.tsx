import type { Metadata } from 'next';
import { ApprovalsQueue } from '@/features/approvals-queue';

export const metadata: Metadata = { title: 'Approvals' };

export default function Page() {
  return <ApprovalsQueue />;
}
