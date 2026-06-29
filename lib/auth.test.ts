import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAuthCookieValue,
  getAuthSession,
  isAuthBypassedInDev,
  isValidAuthCookie,
  requireAuthConfig,
  verifyPassword,
  normalizeAuthReturnPath,
} from './auth'

const ORIG_ENV = { ...process.env }

const TEST_IDENTITY = {
  sub: 'google:108',
  email: 'kevin@enrollmentresources.com',
  hd: 'enrollmentresources.com',
  name: 'Kevin V',
}

describe('auth helpers', () => {
  beforeEach(() => {
    process.env = {
      ...ORIG_ENV,
      NODE_ENV: 'test',
      APP_AUTH_PASSWORD: 'correct-password',
      APP_AUTH_SECRET: 'test-auth-secret',
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...ORIG_ENV }
  })

  it('verifies the configured password', () => {
    expect(verifyPassword('correct-password')).toBe(true)
    expect(verifyPassword('wrong-password')).toBe(false)
  })

  it('signs and verifies auth cookie values', async () => {
    const cookie = await createAuthCookieValue(TEST_IDENTITY)
    await expect(isValidAuthCookie(cookie)).resolves.toBe(true)
    await expect(isValidAuthCookie(cookie.replace(/.$/, 'x'))).resolves.toBe(false)
  })

  it('rejects signed auth cookies with expired payloads', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000)
    const cookie = await createAuthCookieValue(TEST_IDENTITY)

    nowSpy.mockReturnValue(1_000_000_000_000 + (13 * 60 * 60 * 1000))
    await expect(isValidAuthCookie(cookie)).resolves.toBe(false)
  })

  describe('getAuthSession — verified identity', () => {
    it('round-trips the signed identity', async () => {
      const cookie = await createAuthCookieValue(TEST_IDENTITY)
      const session = await getAuthSession(cookie)
      expect(session).toMatchObject(TEST_IDENTITY)
      expect(typeof session?.exp).toBe('number')
    })

    it('returns null for a tampered, garbage, or empty cookie', async () => {
      const cookie = await createAuthCookieValue(TEST_IDENTITY)
      expect(await getAuthSession(cookie.replace(/.$/, 'x'))).toBeNull()
      expect(await getAuthSession('not-a-cookie')).toBeNull()
      expect(await getAuthSession('')).toBeNull()
      expect(await getAuthSession(null)).toBeNull()
    })

    it('returns null once the payload has expired', async () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000)
      const cookie = await createAuthCookieValue(TEST_IDENTITY)
      nowSpy.mockReturnValue(1_000_000_000_000 + 13 * 60 * 60 * 1000)
      expect(await getAuthSession(cookie)).toBeNull()
    })

    it('rejects a legacy (pre-v2) cookie shape', async () => {
      // Old shape was `authenticated:<exp>.<sig>` — must not parse as a session.
      expect(await getAuthSession('authenticated:9999999999.deadbeef')).toBeNull()
    })

    it('supports a break-glass identity with null email/hd', async () => {
      const bg = { sub: 'password:break-glass', email: null, hd: null, name: 'Break-glass' }
      const cookie = await createAuthCookieValue(bg)
      expect(await getAuthSession(cookie)).toMatchObject(bg)
      await expect(isValidAuthCookie(cookie)).resolves.toBe(true)
    })
  })

  it('allows dev/test bypass only when no password is configured', async () => {
    delete process.env.APP_AUTH_PASSWORD
    process.env.NODE_ENV = 'development'

    expect(isAuthBypassedInDev()).toBe(true)
    await expect(isValidAuthCookie(null)).resolves.toBe(true)
    await expect(isValidAuthCookie(null, { allowDevBypass: false })).resolves.toBe(false)
    expect(verifyPassword('anything')).toBe(true)
  })

  it('requires auth config in production', () => {
    delete process.env.APP_AUTH_PASSWORD
    process.env.NODE_ENV = 'production'

    expect(() => requireAuthConfig()).toThrow(/APP_AUTH_PASSWORD/)
  })

  it('requires APP_AUTH_SECRET in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.APP_AUTH_PASSWORD = 'correct-password'
    delete process.env.APP_AUTH_SECRET

    expect(() => requireAuthConfig()).toThrow(/APP_AUTH_SECRET/)
  })

  it('succeeds when both APP_AUTH_PASSWORD and APP_AUTH_SECRET are set in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.APP_AUTH_PASSWORD = 'correct-password'
    process.env.APP_AUTH_SECRET = 'prod-signing-secret'

    expect(() => requireAuthConfig()).not.toThrow()
  })

  it('normalizes login return paths to same-origin paths only', () => {
    expect(normalizeAuthReturnPath('/clients?tab=active')).toBe('/clients?tab=active')
    expect(normalizeAuthReturnPath('https://evil.test')).toBe('/')
    expect(normalizeAuthReturnPath('//evil.test/path')).toBe('/')
  })
})
