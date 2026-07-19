import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { requireOperatorEmail, resolveOperatorEmail } from './operator'
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth'
import { HttpError } from '@/lib/api/errors'

const ENV_KEYS = ['APP_AUTH_PASSWORD', 'APP_AUTH_SECRET'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  // Configure auth so the dev bypass is OFF and the guard actually guards.
  process.env.APP_AUTH_PASSWORD = 'test-password'
  process.env.APP_AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('requireOperatorEmail', () => {
  it('401s with no cookie, a garbage cookie, and a session without email', async () => {
    for (const headers of [
      new Headers(),
      new Headers({ cookie: `${AUTH_COOKIE_NAME}=garbage` }),
      new Headers({ cookie: `${AUTH_COOKIE_NAME}=${await createAuthCookieValue({ sub: 'x', email: null, hd: null, name: 'Break Glass' })}` }),
    ]) {
      const req = new Request('http://localhost/api/viewbooks', { headers })
      await expect(requireOperatorEmail(req)).rejects.toBeInstanceOf(HttpError)
      await expect(requireOperatorEmail(req)).rejects.toMatchObject({ status: 401, code: 'auth_required' })
    }
  })

  it('returns the verified session email', async () => {
    const cookie = await createAuthCookieValue({
      sub: 'google:1',
      email: 'kevin@enrollmentresources.com',
      hd: 'enrollmentresources.com',
      name: 'Kevin',
    })
    const req = new Request('http://localhost/api/viewbooks', {
      headers: new Headers({ cookie: `${AUTH_COOKIE_NAME}=${cookie}` }),
    })
    expect(await requireOperatorEmail(req)).toBe('kevin@enrollmentresources.com')
  })
})

describe('resolveOperatorEmail', () => {
  it('returns null for a request with no auth cookie (never throws)', async () => {
    const req = new Request('https://x/api', { headers: {} })
    await expect(resolveOperatorEmail(req)).resolves.toBeNull()
  })

  it('returns null for a garbage cookie or a session without email (never throws)', async () => {
    for (const headers of [
      new Headers({ cookie: `${AUTH_COOKIE_NAME}=garbage` }),
      new Headers({ cookie: `${AUTH_COOKIE_NAME}=${await createAuthCookieValue({ sub: 'x', email: null, hd: null, name: 'Break Glass' })}` }),
    ]) {
      const req = new Request('http://localhost/api/viewbooks', { headers })
      await expect(resolveOperatorEmail(req)).resolves.toBeNull()
    }
  })

  it('returns the verified session email', async () => {
    const cookie = await createAuthCookieValue({
      sub: 'google:1',
      email: 'kevin@enrollmentresources.com',
      hd: 'enrollmentresources.com',
      name: 'Kevin',
    })
    const req = new Request('http://localhost/api/viewbooks', {
      headers: new Headers({ cookie: `${AUTH_COOKIE_NAME}=${cookie}` }),
    })
    expect(await resolveOperatorEmail(req)).toBe('kevin@enrollmentresources.com')
  })
})
