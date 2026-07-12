import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { __resetLoginLimiter } from '@/lib/login-rate-limiter'

// Force a stable password for the test environment so verifyPassword passes.
process.env.APP_AUTH_PASSWORD = 'pw'
process.env.APP_AUTH_SECRET = 'test-secret'
process.env.LOGIN_RATE_LIMIT_MAX = '3'
process.env.LOGIN_RATE_LIMIT_WINDOW_MS = '60000'

const { POST } = await import('./route')

function formRequest(body: Record<string, string>): NextRequest {
  const fd = new URLSearchParams()
  for (const [k, v] of Object.entries(body)) fd.set(k, v)
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    body: fd,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
}

function formRequestFromIp(body: Record<string, string>, ip: string): NextRequest {
  const fd = new URLSearchParams()
  for (const [k, v] of Object.entries(body)) fd.set(k, v)
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    body: fd,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'cf-connecting-ip': ip,
    },
  })
}

function setCookieHeader(res: Response): string {
  return res.headers.get('set-cookie') ?? ''
}

describe('POST /api/auth/login — er-operator-name cookie', () => {
  beforeEach(() => { vi.clearAllMocks(); __resetLoginLimiter() })

  it('does NOT set er_auth or operator-name cookies on wrong password', async () => {
    const res = await POST(formRequest({ password: 'wrong', operatorName: 'Kevin' }))
    const cookie = setCookieHeader(res)
    expect(cookie).not.toMatch(/er-operator-name=/)
    expect(cookie).not.toMatch(/er_auth=/)
  })

  it('sets er-operator-name cookie when operatorName is non-empty', async () => {
    const res = await POST(formRequest({ password: 'pw', operatorName: 'Kevin' }))
    const cookie = setCookieHeader(res)
    expect(cookie).toMatch(/er-operator-name=Kevin/)
    expect(cookie).toMatch(/Max-Age=31536000/)
    expect(cookie).toMatch(/Path=\//)
    expect(cookie).toMatch(/SameSite=lax/i)
  })

  it('deletes er-operator-name cookie when operatorName is empty string', async () => {
    const res = await POST(formRequest({ password: 'pw', operatorName: '' }))
    const cookie = setCookieHeader(res)
    // Next.js delete-cookie emits an expiring cookie (Expires=Thu, 01 Jan 1970 …)
    expect(cookie).toMatch(/er-operator-name=;.*Expires=Thu, 01 Jan 1970/i)
  })

  it('deletes er-operator-name cookie when operatorName is absent', async () => {
    const res = await POST(formRequest({ password: 'pw' }))
    const cookie = setCookieHeader(res)
    expect(cookie).toMatch(/er-operator-name=;.*Expires=Thu, 01 Jan 1970/i)
  })

  it('treats whitespace-only operatorName as empty (deletes cookie)', async () => {
    const res = await POST(formRequest({ password: 'pw', operatorName: '     ' }))
    const cookie = setCookieHeader(res)
    expect(cookie).toMatch(/er-operator-name=;.*Expires=Thu, 01 Jan 1970/i)
  })

  it('trims whitespace and caps name at 64 chars', async () => {
    const long = '   ' + 'a'.repeat(80) + '   '
    const res = await POST(formRequest({ password: 'pw', operatorName: long }))
    const cookie = setCookieHeader(res)
    // Cookie value is the trimmed + sliced result: 64 'a's
    expect(cookie).toMatch(new RegExp(`er-operator-name=${'a'.repeat(64)}(?!a)`))
  })

  it('refuses password login (no session) when ALLOW_PASSWORD_LOGIN=false', async () => {
    process.env.ALLOW_PASSWORD_LOGIN = 'false'
    try {
      const res = await POST(formRequest({ password: 'pw', operatorName: 'Kevin' }))
      expect(setCookieHeader(res)).not.toMatch(/er_auth=[^;]/)
      expect(res.headers.get('location') ?? '').toContain('/login')
    } finally {
      delete process.env.ALLOW_PASSWORD_LOGIN
    }
  })
})

describe('POST /api/auth/login — rate limiting', () => {
  beforeEach(() => { __resetLoginLimiter() })

  it('blocks with too_many_attempts after max failures from one IP', async () => {
    const ip = '203.0.113.7'
    for (let i = 0; i < 3; i++) await POST(formRequestFromIp({ password: 'wrong' }, ip))
    const res = await POST(formRequestFromIp({ password: 'wrong' }, ip))
    expect(res.headers.get('location') ?? '').toContain('error=too_many_attempts')
    expect(res.headers.get('retry-after')).toBeTruthy()
  })

  it('does not block a different IP', async () => {
    for (let i = 0; i < 5; i++) await POST(formRequestFromIp({ password: 'wrong' }, '203.0.113.7'))
    const res = await POST(formRequestFromIp({ password: 'wrong' }, '198.51.100.9'))
    expect(res.headers.get('location') ?? '').toContain('error=invalid')
    expect(res.headers.get('location') ?? '').not.toContain('too_many_attempts')
  })

  it('successful login resets the IP counter', async () => {
    const ip = '203.0.113.7'
    await POST(formRequestFromIp({ password: 'wrong' }, ip))
    await POST(formRequestFromIp({ password: 'wrong' }, ip))
    await POST(formRequestFromIp({ password: 'pw' }, ip))
    await POST(formRequestFromIp({ password: 'wrong' }, ip))
    await POST(formRequestFromIp({ password: 'wrong' }, ip))
    const res = await POST(formRequestFromIp({ password: 'wrong' }, ip))
    expect(res.headers.get('location') ?? '').toContain('error=invalid')
  })

  it('ALLOW_PASSWORD_LOGIN=false short-circuits WITHOUT consuming limiter budget', async () => {
    const ip = '203.0.113.7'
    process.env.ALLOW_PASSWORD_LOGIN = 'false'
    try {
      for (let i = 0; i < 5; i++) await POST(formRequestFromIp({ password: 'pw' }, ip))
    } finally { delete process.env.ALLOW_PASSWORD_LOGIN }
    const res = await POST(formRequestFromIp({ password: 'wrong' }, ip))
    expect(res.headers.get('location') ?? '').toContain('error=invalid')
  })
})

