import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildGoogleAuthRequest,
  verifyGoogleCallback,
  GoogleOAuthError,
} from './google-oauth'

const ORIG_ENV = { ...process.env }
const REDIRECT = 'http://localhost:3000/api/auth/google/callback'

beforeEach(() => {
  process.env = {
    ...ORIG_ENV,
    GOOGLE_OAUTH_CLIENT_ID: 'client-123.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'secret-xyz',
  }
})
afterEach(() => {
  process.env = { ...ORIG_ENV }
})

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  let bin = ''
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

describe('buildGoogleAuthRequest', () => {
  it('builds an auth URL with PKCE, nonce, state, and basic scopes', async () => {
    const { url, handshake } = await buildGoogleAuthRequest({ redirectUri: REDIRECT, next: '/clients', hd: 'enrollmentresources.com' })
    const u = new URL(url)
    const q = u.searchParams

    expect(u.origin + u.pathname).toContain('accounts.google.com')
    expect(q.get('client_id')).toBe('client-123.apps.googleusercontent.com')
    expect(q.get('redirect_uri')).toBe(REDIRECT)
    expect(q.get('response_type')).toBe('code')
    expect(q.get('scope')).toContain('openid')
    expect(q.get('scope')).toContain('email')
    expect(q.get('scope')).toContain('profile')
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('state')).toBe(handshake.state)
    expect(q.get('nonce')).toBe(handshake.nonce)
    expect(q.get('hd')).toBe('enrollmentresources.com')
    // PKCE: the challenge in the URL is S256(verifier) held in the handshake.
    expect(q.get('code_challenge')).toBe(await s256(handshake.codeVerifier))
    expect(handshake.next).toBe('/clients')
    expect(handshake.codeVerifier.length).toBeGreaterThanOrEqual(43)
  })

  it('generates a fresh state/nonce/verifier each call', async () => {
    const a = await buildGoogleAuthRequest({ redirectUri: REDIRECT, next: '/' })
    const b = await buildGoogleAuthRequest({ redirectUri: REDIRECT, next: '/' })
    expect(a.handshake.state).not.toBe(b.handshake.state)
    expect(a.handshake.nonce).not.toBe(b.handshake.nonce)
    expect(a.handshake.codeVerifier).not.toBe(b.handshake.codeVerifier)
  })
})

describe('verifyGoogleCallback', () => {
  const fakePayload = {
    sub: '108',
    email: 'kevin@enrollmentresources.com',
    email_verified: true,
    hd: 'enrollmentresources.com',
    name: 'Kevin V',
    nonce: 'expected-nonce',
  }
  const deps = {
    exchangeCodeForIdToken: async () => 'fake.id.token',
    verifyIdToken: async () => fakePayload,
  }

  it('returns the verified identity when the nonce matches', async () => {
    const identity = await verifyGoogleCallback(
      { code: 'c', codeVerifier: 'v', redirectUri: REDIRECT, expectedNonce: 'expected-nonce' },
      deps,
    )
    expect(identity).toEqual({
      sub: '108',
      email: 'kevin@enrollmentresources.com',
      emailVerified: true,
      hd: 'enrollmentresources.com',
      name: 'Kevin V',
    })
  })

  it('throws on a nonce mismatch (replay/injection guard)', async () => {
    await expect(
      verifyGoogleCallback(
        { code: 'c', codeVerifier: 'v', redirectUri: REDIRECT, expectedNonce: 'WRONG' },
        deps,
      ),
    ).rejects.toBeInstanceOf(GoogleOAuthError)
  })

  it('throws when the ID token cannot be verified', async () => {
    await expect(
      verifyGoogleCallback(
        { code: 'c', codeVerifier: 'v', redirectUri: REDIRECT, expectedNonce: 'expected-nonce' },
        { exchangeCodeForIdToken: async () => 'x', verifyIdToken: async () => null },
      ),
    ).rejects.toBeInstanceOf(GoogleOAuthError)
  })
})
