import type { Metadata } from 'next';
import { idParams } from '@/lib/demo/static-params';
import { ApprovalReview } from '@/features/approval-review';

export async function generateStaticParams({ params }: { params: { workspace: string } }) {
  return idParams('actions', params.workspace);
}

export const metadata: Metadata = { title: 'Approval review' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApprovalReview id={id} />;
}
