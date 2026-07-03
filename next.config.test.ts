import { describe, it, expect } from 'vitest'
import nextConfig from './next.config'

// Parse Next.js body-size values ('100mb', '50mb', or a raw byte number) to bytes.
// Next resolves string sizes with the `bytes` package (1024-based), so mirror that.
function parseSize(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return NaN
  const m = v.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/)
  if (!m) return NaN
  const n = parseFloat(m[1])
  const mult = m[2] === 'gb' ? 1024 ** 3 : m[2] === 'mb' ? 1024 ** 2 : m[2] === 'kb' ? 1024 : 1
  return n * mult
}

describe('next.config request-body caps', () => {
  // /api/upload is matched by the middleware matcher ('/api/:path*'). Next.js 15
  // caps middleware-matched request bodies at 10MB by DEFAULT and TRUNCATES beyond
  // it — which severs the multipart boundary so `request.formData()` throws
  // ("expected boundary after body") and the upload route 500s with
  // "Failed to upload files". The upload route itself allows 100MB
  // (DEFAULT_MAX_UPLOAD_BODY_BYTES in app/api/upload/route.ts), so the middleware
  // cap must be at least as large or large Screaming Frog CSV uploads break.
  // Prod incident 2026-07-03.
  it('allows middleware-matched uploads up to at least 100MB', () => {
    const cap = parseSize(
      (nextConfig.experimental as Record<string, unknown> | undefined)?.middlewareClientMaxBodySize,
    )
    expect(cap).toBeGreaterThanOrEqual(100 * 1024 * 1024)
  })

  it('keeps the Server Actions body limit at least as large as legacy (50MB)', () => {
    const sa = parseSize(nextConfig.experimental?.serverActions?.bodySizeLimit)
    expect(sa).toBeGreaterThanOrEqual(50 * 1024 * 1024)
  })
})
