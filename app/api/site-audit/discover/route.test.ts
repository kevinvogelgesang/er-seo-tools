// A3 Task 7 — characterization tests for POST /api/site-audit/discover.
// discoverPages MUST be mocked — never a live network crawl (change-control rule 3).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const discoverPagesMock = vi.fn()
vi.mock('@/lib/ada-audit/sitemap-crawler', () => ({
  discoverPages: (...a: unknown[]) => discoverPagesMock(...a),
}))
import { POST } from './route' // import AFTER the mock

beforeEach(() => {
  discoverPagesMock.mockReset()
})

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/site-audit/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/site-audit/discover', () => {
  it('400 "Invalid JSON body" on malformed body', async () => {
    const res = await POST(req('{not json'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid JSON body')
    expect(discoverPagesMock).not.toHaveBeenCalled()
  })

  it('400 when domain is missing', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('domain is required')
  })

  it('400 "Invalid domain..." for a malformed domain', async () => {
    const res = await POST(req({ domain: 'not a domain' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Invalid domain')
  })

  it('422 when the mocked discoverPages rejects', async () => {
    discoverPagesMock.mockRejectedValue(new Error('dns failure'))
    const res = await POST(req({ domain: 'example.edu' }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('dns failure')
  })

  it('200 { domain, pageCount, urls } for a valid domain', async () => {
    const urls = ['https://example.edu/a', 'https://example.edu/b']
    discoverPagesMock.mockResolvedValue({ urls, mode: 'sitemap', capped: false })
    const res = await POST(req({ domain: 'https://Example.EDU/' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ domain: 'example.edu', pageCount: 2, urls })
    expect(discoverPagesMock).toHaveBeenCalledWith('example.edu')
  })
})
