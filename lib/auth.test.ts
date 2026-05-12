import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAuthCookieValue,
  isAuthBypassedInDev,
  isValidAuthCookie,
  requireAuthConfig,
  verifyPassword,
  normalizeAuthReturnPath,
} from './auth'

const ORIG_ENV = { ...process.env }

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
    const cookie = await createAuthCookieValue()
    await expect(isValidAuthCookie(cookie)).resolves.toBe(true)
    await expect(isValidAuthCookie(cookie.replace(/.$/, 'x'))).resolves.toBe(false)
  })

  it('rejects signed auth cookies with expired payloads', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000)
    const cookie = await createAuthCookieValue()

    nowSpy.mockReturnValue(1_000_000_000_000 + (13 * 60 * 60 * 1000))
    await expect(isValidAuthCookie(cookie)).resolves.toBe(false)
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

  it('normalizes login return paths to same-origin paths only', () => {
    expect(normalizeAuthReturnPath('/clients?tab=active')).toBe('/clients?tab=active')
    expect(normalizeAuthReturnPath('https://evil.test')).toBe('/')
    expect(normalizeAuthReturnPath('//evil.test/path')).toBe('/')
  })
})
