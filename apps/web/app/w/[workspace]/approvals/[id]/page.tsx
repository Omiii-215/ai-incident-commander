import type { Metadata } from 'next';
import { ApprovalReview } from '@/features/approval-review';

export const metadata: Metadata = { title: 'Approval review' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApprovalReview id={id} />;
}
