import type { NextConfig } from 'next';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000';

// Same-origin API proxy: the browser only talks to /api/v1 on this origin.
const config: NextConfig = {
  transpilePackages: ['@aic/contracts'],
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

export default config;
