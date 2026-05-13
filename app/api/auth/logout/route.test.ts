import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const ORIG_ENV = { ...process.env }

function request(headers?: HeadersInit) {
  return new NextRequest('http://localhost:3000/api/auth/logout', {
    method: 'POST',
    headers,
  })
}

describe('POST /api/auth/logout', () => {
  afterEach(() => {
    process.env = { ...ORIG_ENV }
    vi.restoreAllMocks()
  })

  it('rejects cross-site logout requests', async () => {
    const res = await POST(request({
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
    }))

    expect(res.status).toBe(403)
  })

  it('allows same-origin logout requests and clears the auth cookie', async () => {
    const res = await POST(request({
      origin: 'http://localhost:3000',
      'sec-fetch-site': 'same-origin',
    }))

    expect(res.status).toBe(303)
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('trusts the configured public app origin behind a proxy', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'

    const res = await POST(request({
      origin: 'https://app.example.com',
      'sec-fetch-site': 'same-site',
    }))

    expect(res.status).toBe(303)
  })
})
