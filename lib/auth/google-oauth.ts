// Hand-rolled Google OAuth 2.0 authorization-code flow (login only).
// Uses google-auth-library's OAuth2Client for URL building + ID-token
// verification; PKCE (S256) + nonce + state guard the handshake. No refresh
// tokens / offline access — this is login, not delegated API access.

import { OAuth2Client, CodeChallengeMethod, type TokenPayload } from 'google-auth-library'

export class GoogleOAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoogleOAuthError'
  }
}

const SCOPES = ['openid', 'email', 'profile']
const HANDSHAKE_TTL_SECONDS = 10 * 60

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET)
}

function getConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new GoogleOAuthError('google_oauth_not_configured')
  return { clientId, clientSecret }
}

export const GOOGLE_HANDSHAKE_TTL_SECONDS = HANDSHAKE_TTL_SECONDS

function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  let binary = ''
  for (const b of arr) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  let binary = ''
  for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export interface GoogleHandshake {
  state: string
  nonce: string
  codeVerifier: string
  next: string
}

/** Build the Google authorization URL + the transient handshake to bind to it. */
export async function buildGoogleAuthRequest(args: {
  redirectUri: string
  next: string
}): Promise<{ url: string; handshake: GoogleHandshake }> {
  const { clientId, clientSecret } = getConfig()
  const state = randomToken()
  const nonce = randomToken()
  const codeVerifier = randomToken(48) // ~64 base64url chars (43–128 per RFC 7636)
  const codeChallenge = await s256(codeVerifier)

  const client = new OAuth2Client({ clientId, clientSecret, redirectUri: args.redirectUri })
  const url = new URL(
    client.generateAuthUrl({
      access_type: 'online', // no refresh token — login only
      scope: SCOPES,
      state,
      code_challenge_method: CodeChallengeMethod.S256,
      code_challenge: codeChallenge,
      prompt: 'select_account',
    }),
  )
  // `nonce` is a replay hint echoed back in the ID token; we verify it at the
  // callback. No `hd` hint — domain restriction is enforced there too.
  url.searchParams.set('nonce', nonce)

  return { url: url.toString(), handshake: { state, nonce, codeVerifier, next: args.next } }
}

export interface GoogleVerifiedIdentity {
  sub: string
  email: string | null
  emailVerified: boolean
  hd: string | null
  name: string | null
}

export interface GoogleOAuthDeps {
  exchangeCodeForIdToken(args: {
    code: string
    codeVerifier: string
    redirectUri: string
  }): Promise<string | null>
  verifyIdToken(idToken: string): Promise<TokenPayload | null>
}

function defaultDeps(): GoogleOAuthDeps {
  const { clientId, clientSecret } = getConfig()
  return {
    async exchangeCodeForIdToken({ code, codeVerifier, redirectUri }) {
      const client = new OAuth2Client({ clientId, clientSecret, redirectUri })
      const { tokens } = await client.getToken({ code, codeVerifier })
      return tokens.id_token ?? null
    },
    async verifyIdToken(idToken) {
      const client = new OAuth2Client({ clientId, clientSecret })
      const ticket = await client.verifyIdToken({ idToken, audience: clientId })
      return ticket.getPayload() ?? null
    },
  }
}

/**
 * Exchange the auth code, verify the ID token (signature/issuer/audience via the
 * library), confirm the nonce, and return the verified identity. Domain/allowlist
 * enforcement happens in the caller (see lib/auth/identity).
 */
export async function verifyGoogleCallback(
  args: { code: string; codeVerifier: string; redirectUri: string; expectedNonce: string },
  deps: GoogleOAuthDeps = defaultDeps(),
): Promise<GoogleVerifiedIdentity> {
  const idToken = await deps.exchangeCodeForIdToken({
    code: args.code,
    codeVerifier: args.codeVerifier,
    redirectUri: args.redirectUri,
  })
  if (!idToken) throw new GoogleOAuthError('token_exchange_failed')

  const payload = await deps.verifyIdToken(idToken)
  if (!payload || !payload.sub) throw new GoogleOAuthError('id_token_invalid')
  if (payload.nonce !== args.expectedNonce) throw new GoogleOAuthError('nonce_mismatch')

  return {
    sub: payload.sub,
    email: payload.email ?? null,
    emailVerified: payload.email_verified === true,
    hd: (payload as { hd?: string }).hd ?? null,
    name: payload.name ?? null,
  }
}
