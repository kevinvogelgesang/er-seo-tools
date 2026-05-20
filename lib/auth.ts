export const AUTH_COOKIE_NAME = 'er_auth'
const AUTH_COOKIE_VALUE = 'authenticated'
const SIGNATURE_SEPARATOR = '.'
const PAYLOAD_SEPARATOR = ':'
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12

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

export async function createAuthCookieValue(): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + AUTH_COOKIE_MAX_AGE_SECONDS
  const payload = `${AUTH_COOKIE_VALUE}${PAYLOAD_SEPARATOR}${expiresAt}`
  return `${payload}${SIGNATURE_SEPARATOR}${await sign(payload)}`
}

export async function isValidAuthCookie(
  value: string | undefined | null,
  options: { allowDevBypass?: boolean } = {},
): Promise<boolean> {
  const allowDevBypass = options.allowDevBypass ?? true
  if (allowDevBypass && isAuthBypassedInDev()) return true
  if (!value) return false

  const [payload, signature, ...extra] = value.split(SIGNATURE_SEPARATOR)
  if (extra.length > 0 || !signature) return false

  const [kind, expiresAtRaw, ...payloadExtra] = payload.split(PAYLOAD_SEPARATOR)
  if (payloadExtra.length > 0 || kind !== AUTH_COOKIE_VALUE) return false

  const expiresAt = Number(expiresAtRaw)
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false

  return constantTimeEqual(signature, await sign(payload))
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
