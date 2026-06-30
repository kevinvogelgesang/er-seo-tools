import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/google-oauth', () => ({
  isGoogleOAuthConfigured: vi.fn(() => true),
  buildGoogleAuthRequest: vi.fn(async () => ({
    url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=s',
    handshake: { state: 's', nonce: 'n', codeVerifier: 'v', next: '/clients' },
  })),
  GOOGLE_HANDSHAKE_TTL_SECONDS: 600,
}))

const oauth = await import('@/lib/auth/google-oauth')
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
  vi.mocked(oauth.isGoogleOAuthConfigured).mockReturnValue(true)
})
afterEach(() => {
  process.env = { ...ORIG_ENV }
  vi.clearAllMocks()
})

function req(url = 'https://seo.erstaging.site/api/auth/google/start?next=%2Fclients') {
  return new NextRequest(url)
}

describe('GET /api/auth/google/start', () => {
  it('redirects to Google and sets a signed handshake cookie', async () => {
    const res = await GET(req())
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('accounts.google.com')

    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/er_oauth=/)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/Path=\/api\/auth\/google/)
    expect(setCookie).toMatch(/SameSite=lax/i)
    expect(setCookie).toMatch(/Secure/i)
  })

  it('passes the configured allowed hosted-domain to the URL builder', async () => {
    await GET(req())
    expect(oauth.buildGoogleAuthRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        hd: 'enrollmentresources.com',
        redirectUri: 'https://seo.erstaging.site/api/auth/google/callback',
        next: '/clients',
      }),
    )
  })

  it('redirects to /login with an error when OAuth is not configured', async () => {
    vi.mocked(oauth.isGoogleOAuthConfigured).mockReturnValue(false)
    const res = await GET(req())
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login?error=oauth_unavailable')
  })
})
