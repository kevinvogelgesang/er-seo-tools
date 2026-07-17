import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth'
import { getOperatorEmailForPublicPage } from './public-session'

const cookieGet = vi.fn()
vi.mock('next/headers', () => ({ cookies: async () => ({ get: cookieGet }) }))

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved.APP_AUTH_PASSWORD = process.env.APP_AUTH_PASSWORD
  saved.APP_AUTH_SECRET = process.env.APP_AUTH_SECRET
  process.env.APP_AUTH_PASSWORD = 'test-password'
  process.env.APP_AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
  cookieGet.mockReset()
})

afterEach(() => {
  for (const key of ['APP_AUTH_PASSWORD', 'APP_AUTH_SECRET']) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('getOperatorEmailForPublicPage', () => {
  it('returns a verified session email', async () => {
    const value = await createAuthCookieValue({
      sub: 'google:public', email: 'operator@example.com', hd: 'example.com', name: 'Operator',
    })
    cookieGet.mockImplementation((name: string) => name === AUTH_COOKIE_NAME ? { value } : undefined)
    expect(await getOperatorEmailForPublicPage()).toBe('operator@example.com')
  })

  it('returns null without a cookie or for a break-glass/non-email session', async () => {
    cookieGet.mockReturnValue(undefined)
    expect(await getOperatorEmailForPublicPage()).toBeNull()
    const value = await createAuthCookieValue({ sub: 'password:break-glass', email: null, hd: null, name: 'Break Glass' })
    cookieGet.mockReturnValue({ value })
    expect(await getOperatorEmailForPublicPage()).toBeNull()
  })

  it('returns the same dev-bypass email as requireOperatorEmail', async () => {
    delete process.env.APP_AUTH_PASSWORD
    expect(await getOperatorEmailForPublicPage()).toBe('dev@localhost')
  })
})
