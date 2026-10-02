import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'AI Incident Commander', template: '%s · AI Incident Commander' },
  description: 'Coordinate incident response with cited evidence and reviewed actions.',
  applicationName: 'AI Incident Commander',
};

// Normal device-width viewport; user scaling stays enabled.
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

// Apply the stored or OS theme before first paint to avoid a flash.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('aic-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
