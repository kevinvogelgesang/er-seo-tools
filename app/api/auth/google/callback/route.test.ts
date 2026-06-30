import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/google-oauth', () => {
  class GoogleOAuthError extends Error {}
  return {
    GoogleOAuthError,
    verifyGoogleCallback: vi.fn(async () => ({
      sub: '108',
      email: 'kevin@enrollmentresources.com',
      emailVerified: true,
      hd: 'enrollmentresources.com',
      name: 'Kevin V',
    })),
  }
})

vi.mock('@/lib/auth/identity', () => {
  class IdentityError extends Error {}
  return {
    IdentityError,
    resolveOperatorIdentity: vi.fn(async () => ({
      sub: 'google:108',
      email: 'kevin@enrollmentresources.com',
      hd: 'enrollmentresources.com',
      name: 'Kevin V',
    })),
  }
})

const identity = await import('@/lib/auth/identity')
const { createSignedToken, getAuthSession } = await import('@/lib/auth')
const { GET } = await import('./route')

const ORIG_ENV = { ...process.env }
beforeEach(() => {
  process.env = {
    ...ORIG_ENV,
    NODE_ENV: 'production',
    APP_AUTH_SECRET: 'test-secret',
    GOOGLE_ALLOWED_HD: 'enrollmentresources.com',
    NEXT_PUBLIC_APP_URL: 'https://seo.erstaging.site',
  }
})
afterEach(() => {
  process.env = { ...ORIG_ENV }
  vi.clearAllMocks()
})

const HANDSHAKE = { state: 'state-123', nonce: 'nonce-123', codeVerifier: 'verifier-123', next: '/clients' }

async function run(opts: { code?: string; state?: string; error?: string; handshake?: object | null }) {
  const base = 'https://seo.erstaging.site/api/auth/google/callback'
  const params = new URLSearchParams()
  if (opts.code) params.set('code', opts.code)
  if (opts.state) params.set('state', opts.state)
  if (opts.error) params.set('error', opts.error)
  const headers: Record<string, string> = {}
  if (opts.handshake !== null) {
    const token = await createSignedToken(opts.handshake ?? HANDSHAKE, 600)
    headers.cookie = `er_oauth=${token}`
  }
  return GET(new NextRequest(`${base}?${params.toString()}`, { headers }))
}

const location = (res: Response) => res.headers.get('location') ?? ''
const setCookie = (res: Response) => res.headers.get('set-cookie') ?? ''

describe('GET /api/auth/google/callback', () => {
  it('sets a verified session cookie and redirects to next on success', async () => {
    const res = await run({ code: 'auth-code', state: 'state-123' })
    expect(res.status).toBe(307)
    expect(location(res)).toContain('/clients')

    const cookie = setCookie(res)
    const match = /er_auth=([^;]+)/.exec(cookie)
    expect(match).toBeTruthy()
    const session = await getAuthSession(decodeURIComponent(match![1]))
    expect(session?.sub).toBe('google:108')
    expect(session?.email).toBe('kevin@enrollmentresources.com')
    // handshake cookie cleared
    expect(cookie).toMatch(/er_oauth=;|er_oauth=$|er_oauth=;.*Expires=Thu, 01 Jan 1970/i)
  })

  it('redirects to /login on a missing handshake cookie', async () => {
    const res = await run({ code: 'c', state: 'state-123', handshake: null })
    expect(location(res)).toContain('/login?error=')
    expect(setCookie(res)).not.toMatch(/er_auth=[^;]+[^;0]/)
  })

  it('redirects to /login on a state mismatch (CSRF guard)', async () => {
    const res = await run({ code: 'c', state: 'WRONG' })
    expect(location(res)).toContain('/login?error=')
  })

  it('redirects to /login when the user denies consent', async () => {
    const res = await run({ error: 'access_denied', state: 'state-123' })
    expect(location(res)).toContain('/login?error=')
  })

  it('redirects to /login (no session) when identity is rejected', async () => {
    vi.mocked(identity.resolveOperatorIdentity).mockRejectedValueOnce(new identity.IdentityError('domain_not_allowed'))
    const res = await run({ code: 'c', state: 'state-123' })
    expect(location(res)).toContain('/login?error=')
    expect(setCookie(res)).not.toMatch(/er_auth=[A-Za-z0-9]/)
  })
})
