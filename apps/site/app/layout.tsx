import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

const TITLE = 'AI Incident Commander: find what broke, fix it safely';
const DESCRIPTION =
  'An open-source incident response workspace. AI gathers the evidence and suggests a fix with proof; a second person approves; every step is on the record.';

const SITE_URL = process.env.SITE_URL ?? 'https://ai-incident-commander-app.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'AI Incident Commander',
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', images: [{ url: '/media/poster.jpg', width: 1920, height: 1080 }] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: ['/media/poster.jpg'] },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#050816' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
