import type { Metadata } from 'next';
import { PluginSettings } from '@/features/plugin-settings';

export const metadata: Metadata = { title: 'Plugins and connectors' };

export default function Page() {
  return <PluginSettings />;
}
