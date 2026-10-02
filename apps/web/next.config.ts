import type { NextConfig } from 'next';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000';
const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

// Showcase build: a fully static copy of the dashboard served under /demo on the
// public site. The API runs in the browser on recorded sample data (lib/demo).
const demo: NextConfig = {
  output: 'export',
  basePath: '/demo',
  trailingSlash: true,
  distDir: 'out-demo', // static export lands here (Next 16 writes the export into distDir)
  images: { unoptimized: true },
  transpilePackages: ['@aic/contracts', '@aic/domain'],
  poweredByHeader: false,
  agentRules: false,
};

// Normal build: same-origin API proxy; the browser only talks to /api/v1 on this origin.
const app: NextConfig = {
  transpilePackages: ['@aic/contracts', '@aic/domain'],
  poweredByHeader: false,
  // Canonical agent rules live in the repository root AGENTS.md.
  agentRules: false,
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_ORIGIN}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default DEMO ? demo : app;
