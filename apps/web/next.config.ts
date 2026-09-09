import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The engine ships as TypeScript source so it stays a single source of truth
  // for both the tests and the browser.
  transpilePackages: ['@retirement/engine'],
};

export default nextConfig;
