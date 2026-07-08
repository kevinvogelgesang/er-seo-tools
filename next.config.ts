import type { NextConfig } from 'next'

// Content-Security-Policy is shipped in Report-Only mode first: it never blocks,
// only reports violations to the browser console, so we can confirm the app
// (anti-FOUC theme script, inline styles, Recharts, Google connections) stays
// clean before flipping to an enforcing `Content-Security-Policy` header.
// HSTS is intentionally NOT set here — the sibling security headers
// (X-Frame-Options, Referrer-Policy, Permissions-Policy, X-Content-Type-Options)
// are managed at Cloudflare, and `Strict-Transport-Security` with
// `includeSubDomains; preload` needs an edge-level subdomain-safety review.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://www.googleapis.com https://oauth2.googleapis.com",
  "font-src 'self' data:",
].join('; ')

const nextConfig: NextConfig = {
  // Don't advertise the framework to every visitor (removes `X-Powered-By`).
  poweredByHeader: false,
  async redirects() {
    // C11 PR3: /seo-parser renamed to /seo-audits. Permanent 308s so old
    // bookmarks and already-shipped srt_ handoff "Webapp:" links survive.
    // redirects() runs BEFORE middleware, so the old path 308s first and the
    // new path is then auth-gated exactly as the old one was.
    return [
      { source: '/seo-parser', destination: '/seo-audits', permanent: true },
      { source: '/seo-parser/:path*', destination: '/seo-audits/:path*', permanent: true },
    ]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy-Report-Only',
            value: contentSecurityPolicy,
          },
        ],
      },
    ]
  },
  // `lighthouse` and `pdfjs-dist` ship server-only ESM that webpack can't bundle
  // cleanly (transitive deps reference internal Chrome DevTools modules / Node
  // built-ins). They're loaded via dynamic `await import(...)` at runtime; marking
  // them external skips bundling and uses Node's native resolution.
  serverExternalPackages: ['jsdom', 'axe-core', 'lighthouse', 'pdfjs-dist'],
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
    // /api/upload is matched by the middleware matcher ('/api/:path*'), and Next.js
    // caps middleware-matched request bodies at 10MB by default, TRUNCATING beyond
    // it. A truncated multipart body severs its boundary, so `request.formData()`
    // throws and the upload route 500s with "Failed to upload files" (prod incident
    // 2026-07-03). Match the upload route's own 100MB ceiling
    // (DEFAULT_MAX_UPLOAD_BODY_BYTES in app/api/upload/route.ts) so that route's
    // Content-Length check — not this silent truncation — is the single gate.
    middlewareClientMaxBodySize: '100mb',
  },
  // Ensure Prisma's native query engine is bundled for deployment
  outputFileTracingIncludes: {
    '/api/**': ['./node_modules/.prisma/**', './node_modules/prisma/**'],
  },
}

export default nextConfig
