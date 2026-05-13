import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // `lighthouse` and `pdfjs-dist` ship server-only ESM that webpack can't bundle
  // cleanly (transitive deps reference internal Chrome DevTools modules / Node
  // built-ins). They're loaded via dynamic `await import(...)` at runtime; marking
  // them external skips bundling and uses Node's native resolution.
  serverExternalPackages: ['jsdom', 'axe-core', 'lighthouse', 'pdfjs-dist'],
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  // Ensure Prisma's native query engine is bundled for deployment
  outputFileTracingIncludes: {
    '/api/**': ['./node_modules/.prisma/**', './node_modules/prisma/**'],
  },
}

export default nextConfig
