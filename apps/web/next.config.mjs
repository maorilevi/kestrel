import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = process.env.KESTREL_SERVER_URL ?? 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const config = {
  // A self-contained server (node server.js) for the container image.
  output: 'standalone',
  outputFileTracingRoot: path.join(here, '..', '..'),
  // The workspace packages ship TypeScript source.
  transpilePackages: ['@kestrel/ui', '@kestrel/core', '@kestrel/protocol'],
  turbopack: { root: path.join(here, '..', '..') },
  // Types are checked by `npm run typecheck` with the repository's compiler.
  typescript: { ignoreBuildErrors: true },
  // Same origin for the browser: auth cookies and the project API go through here.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${server}/api/:path*` }];
  },
};

export default config;
