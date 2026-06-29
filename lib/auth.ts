export const AUTH_COOKIE_NAME = 'er_auth'
const SIGNATURE_SEPARATOR = '.'
const SESSION_VERSION = 2
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12

// Verified session identity carried in the signed auth cookie. For Google
// logins these come from the verified ID token; for break-glass password login
// they're synthetic (sub: 'password:break-glass', email/hd null).
export interface AuthIdentity {
  sub: string
  email: string | null
  hd: string | null
  name: string | null
}

export interface AuthSession extends AuthIdentity {
  exp: number // unix seconds
}

// Operator-name cookie: captured on login, used to attribute requested audits.
// Not a credential — no signing, JS-readable. 1-year max-age so operators
// only enter their name once per machine even though the auth cookie expires
// every 12 hours.
export const OPERATOR_NAME_COOKIE_NAME = 'er-operator-name'
export const OPERATOR_NAME_MAX_AGE_SECONDS = 60 * 60 * 24 * 365
export const OPERATOR_NAME_MAX_LENGTH = 64

export function sanitizeOperatorName(raw: FormDataEntryValue | string | null | undefined): string | null {
  if (raw == null) return null
  const value = typeof raw === 'string' ? raw : ''
  const trimmed = value.trim().slice(0, OPERATOR_NAME_MAX_LENGTH)
  return trimmed.length > 0 ? trimmed : null
}

export function isAuthConfigured(): boolean {
  return Boolean(process.env.APP_AUTH_PASSWORD)
}

export function isAuthBypassedInDev(): boolean {
  return process.env.NODE_ENV !== 'production' && !isAuthConfigured()
}

export function requireAuthConfig(): void {
  if (process.env.NODE_ENV === 'production') {
    if (!isAuthConfigured()) {
      throw new Error('APP_AUTH_PASSWORD is required in production')
    }
    if (!process.env.APP_AUTH_SECRET) {
      throw new Error('APP_AUTH_SECRET is required in production')
    }
  }
}

function getSigningSecret(): string {
  const explicit = process.env.APP_AUTH_SECRET
  if (explicit) return explicit
  if (process.env.NODE_ENV === 'production') {
    // Refuse to silently fall back to APP_AUTH_PASSWORD in production: a
    // leaked password would then also let an attacker forge cookies.
    throw new Error('APP_AUTH_SECRET is required in production')
  }
  return process.env.APP_AUTH_PASSWORD || 'dev-auth-secret'
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function stringToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value))
}

function base64UrlToString(value: string): string {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

async function sign(value: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getSigningSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return bytesToBase64Url(new Uint8Array(signature))
}

export function verifyPassword(password: string): boolean {
  const expected = process.env.APP_AUTH_PASSWORD
  if (!expected) return isAuthBypassedInDev()
  return constantTimeEqual(password, expected)
}

export async function createAuthCookieValue(identity: AuthIdentity): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + AUTH_COOKIE_MAX_AGE_SECONDS
  const payload = stringToBase64Url(
    JSON.stringify({
      v: SESSION_VERSION,
      sub: identity.sub,
      email: identity.email ?? null,
      hd: identity.hd ?? null,
      name: identity.name ?? null,
      exp,
    }),
  )
  return `${payload}${SIGNATURE_SEPARATOR}${await sign(payload)}`
}

/**
 * Verify the signed auth cookie and return the carried identity, or null if the
 * cookie is missing, tampered, expired, or not a current-version session.
 */
export async function getAuthSession(
  value: string | undefined | null,
): Promise<AuthSession | null> {
  if (!value) return null

  const [payload, signature, ...extra] = value.split(SIGNATURE_SEPARATOR)
  if (extra.length > 0 || !payload || !signature) return null

  if (!constantTimeEqual(signature, await sign(payload))) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(base64UrlToString(payload))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const p = parsed as Record<string, unknown>
  if (p.v !== SESSION_VERSION || typeof p.sub !== 'string') return null

  const exp = typeof p.exp === 'number' ? p.exp : Number.NaN
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null

  return {
    sub: p.sub,
    email: typeof p.email === 'string' ? p.email : null,
    hd: typeof p.hd === 'string' ? p.hd : null,
    name: typeof p.name === 'string' ? p.name : null,
    exp,
  }
}

export async function isValidAuthCookie(
  value: string | undefined | null,
  options: { allowDevBypass?: boolean } = {},
): Promise<boolean> {
  const allowDevBypass = options.allowDevBypass ?? true
  if (allowDevBypass && isAuthBypassedInDev()) return true
  return (await getAuthSession(value)) !== null
}

/**
 * Generic short-lived signed token for transient server state (e.g. the OAuth
 * handshake cookie binding state/nonce/code_verifier). Signs
 * base64url(JSON{...payload, __exp}) with the app HMAC secret.
 */
export async function createSignedToken(
  payload: object,
  ttlSeconds: number,
): Promise<string> {
  const __exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const body = stringToBase64Url(JSON.stringify({ ...payload, __exp }))
  return `${body}${SIGNATURE_SEPARATOR}${await sign(body)}`
}

/** Verify a createSignedToken value (signature + expiry) and return its payload. */
export async function readSignedToken(
  value: string | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (!value) return null

  const [body, signature, ...extra] = value.split(SIGNATURE_SEPARATOR)
  if (extra.length > 0 || !body || !signature) return null
  if (!constantTimeEqual(signature, await sign(body))) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(base64UrlToString(body))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const p = parsed as Record<string, unknown>
  const exp = typeof p.__exp === 'number' ? p.__exp : Number.NaN
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null

  const { __exp: _drop, ...rest } = p
  void _drop
  return rest
}

/**
 * Returns the canonical base URL for building auth redirects. Behind a reverse
 * proxy (RunCloud → Apache → Node on localhost:3000), `request.url` reflects
 * the internal upstream URL, not the public origin — so naive
 * `new URL('/login', request.url)` redirects send the browser to
 * http://localhost:3000/login. Prefer `NEXT_PUBLIC_APP_URL` when configured;
 * fall back to `request.url` for dev / unproxied setups.
 */
export function getAuthRedirectBase(request: { url: string }): string {
  return process.env.NEXT_PUBLIC_APP_URL || request.url
}

export function normalizeAuthReturnPath(value: FormDataEntryValue | string | null): string {
  const raw = typeof value === 'string' ? value : ''
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'

  try {
    const parsed = new URL(raw, 'https://er-seo-tools.local')
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return '/'
  }
}
