import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['jsdom', 'axe-core'],
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
