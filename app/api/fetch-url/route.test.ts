import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const safeFetchMock = vi.hoisted(() => vi.fn())

vi.mock('node:dns', () => ({
  promises: {
    lookup: vi.fn(async () => [{ address: '93.184.216.34' }]),
  },
}))

vi.mock('@/lib/security/safe-url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/safe-url')>()
  return {
    ...actual,
    safeFetch: (...args: unknown[]) => safeFetchMock(...args),
  }
})

import { GET } from './route'
import { SafeUrlError } from '@/lib/security/safe-url'

function requestFor(url: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/fetch-url?url=${encodeURIComponent(url)}`)
}

describe('GET /api/fetch-url', () => {
  afterEach(() => {
    safeFetchMock.mockReset()
    vi.clearAllMocks()
  })

  it('rejects localhost URLs before fetching', async () => {
    const response = await GET(requestFor('http://localhost/robots.txt'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toMatch(/private\/internal/)
    expect(safeFetchMock).not.toHaveBeenCalled()
  })

  it('rejects redirects to private addresses', async () => {
    safeFetchMock.mockRejectedValue(new SafeUrlError('Requests to private/internal addresses are not allowed'))

    const response = await GET(requestFor('https://example.com/robots.txt'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toMatch(/private\/internal/)
    expect(safeFetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns bounded response metadata for successful public fetches', async () => {
    safeFetchMock.mockResolvedValue({
      response: new Response('User-agent: *', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
      url: 'https://example.com/robots.txt',
      redirects: [],
    })

    const response = await GET(requestFor('https://example.com/robots.txt'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      content: 'User-agent: *',
      truncated: false,
      status: 200,
      url: 'https://example.com/robots.txt',
      contentType: 'text/plain',
    })
  })
})
