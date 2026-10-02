import type { NextConfig } from 'next';

// Fully static site: no server, no database. Deployed to Vercel as static files.
const config: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  poweredByHeader: false,
  agentRules: false,
};

export default config;
