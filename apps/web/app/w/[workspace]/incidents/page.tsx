import type { Metadata } from 'next';
import { IncidentsList } from '@/features/incidents-list';

export const metadata: Metadata = { title: 'Incidents' };

export default function Page() {
  return <IncidentsList />;
}
