import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * A folder of files, not a server.
   *
   * Every route is prerendered and every calculation happens in the visitor's browser,
   * so there is nothing for a Node runtime to do at request time. Exporting says so:
   * no server handler function is deployed, the output is portable to any static host,
   * and a deploy needs no build step on the host's side.
   */
  output: 'export',
  // The engine ships as TypeScript source so it stays a single source of truth
  // for both the tests and the browser.
  transpilePackages: ['@retirement/engine'],
};

export default nextConfig;
