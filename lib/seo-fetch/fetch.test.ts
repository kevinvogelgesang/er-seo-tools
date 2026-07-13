import { afterEach, describe, it, expect, vi } from 'vitest'
import { gzipSync } from 'node:zlib'

const safeFetchMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/security/safe-url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/safe-url')>()
  return {
    ...actual,
    safeFetch: (...args: unknown[]) => safeFetchMock(...args),
  }
})

import {
  fetchRobotsTxt,
  fetchSitemapXml,
  collectSitemapPageUrls,
  SEO_FETCH_USER_AGENT,
  MAX_ROBOTS_BYTES,
} from './fetch'
import { SafeUrlError } from '@/lib/security/safe-url'

afterEach(() => {
  safeFetchMock.mockReset()
})

function respond(body: BodyInit | null, init: ResponseInit & { url?: string } = {}) {
  const { url, ...responseInit } = init
  safeFetchMock.mockImplementation(async (input: string | URL) => ({
    response: new Response(body, responseInit),
    url: url ?? input.toString(),
    redirects: [],
  }))
}

describe('fetchRobotsTxt', () => {
  it('ok: returns the body with full metadata', async () => {
    respond('User-agent: *\nDisallow:', { status: 200 })
    const r = await fetchRobotsTxt('https://example.com')
    expect(r).toEqual({
      ok: true,
      status: 200,
      text: 'User-agent: *\nDisallow:',
      finalUrl: 'https://example.com/robots.txt',
      failure: null,
      truncated: false,
    })
  })

  it('input contract: trailing slash, path, port, http all resolve to /robots.txt (Codex #7)', async () => {
    const requested: string[] = []
    safeFetchMock.mockImplementation(async (input: string | URL) => {
      requested.push(input.toString())
      return { response: new Response('ok', { status: 200 }), url: input.toString(), redirects: [] }
    })
    await fetchRobotsTxt('https://example.com/')
    await fetchRobotsTxt('https://example.com/deep/path')
    await fetchRobotsTxt('https://example.com:8443')
    await fetchRobotsTxt('http://example.com')
    expect(requested).toEqual([
      'https://example.com/robots.txt',
      'https://example.com/robots.txt',
      'https://example.com:8443/robots.txt',
      'http://example.com/robots.txt',
    ])
  })

  it('sends the browser-shaped UA', async () => {
    respond('ok', { status: 200 })
    await fetchRobotsTxt('https://example.com')
    const [, init] = safeFetchMock.mock.calls[0] as [unknown, RequestInit]
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(SEO_FETCH_USER_AGENT)
  })

  it('http-error: carries status + finalUrl, cancels the body (Codex #3/#9)', async () => {
    let cancelled = false
    const stream = new ReadableStream({ cancel() { cancelled = true } })
    safeFetchMock.mockImplementation(async () => ({
      response: new Response(stream, { status: 404 }),
      url: 'https://example.com/robots.txt',
      redirects: [],
    }))
    const r = await fetchRobotsTxt('https://example.com')
    expect(r).toEqual({
      ok: false, status: 404, text: null,
      finalUrl: 'https://example.com/robots.txt',
      failure: 'http-error', truncated: false,
    })
    expect(cancelled).toBe(true)
  })

  it('too-large: truncated body is never returned (Codex #9)', async () => {
    respond('x'.repeat(MAX_ROBOTS_BYTES + 1), { status: 200 })
    const r = await fetchRobotsTxt('https://example.com')
    expect(r).toMatchObject({ ok: false, status: 200, text: null, failure: 'too-large', truncated: true })
  })

  it.each([
    ['policy', 'unsafe-url'],
    ['dns', 'dns'],
    ['redirect', 'redirect'],
    ['invalid-response', 'invalid-response'],
  ] as const)('SafeUrlError reason %s → failure %s with null metadata', async (reason, failure) => {
    safeFetchMock.mockImplementation(async () => { throw new SafeUrlError('boom', reason) })
    const r = await fetchRobotsTxt('https://example.com')
    expect(r).toEqual({ ok: false, status: null, text: null, finalUrl: null, failure, truncated: false })
  })

  it('timeout: TimeoutError → failure timeout', async () => {
    safeFetchMock.mockImplementation(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    const r = await fetchRobotsTxt('https://example.com')
    expect(r).toMatchObject({ ok: false, status: null, finalUrl: null, failure: 'timeout' })
  })

  it('network: anything else thrown → failure network', async () => {
    safeFetchMock.mockImplementation(async () => { throw new Error('ECONNRESET') })
    const r = await fetchRobotsTxt('https://example.com')
    expect(r).toMatchObject({ ok: false, status: null, finalUrl: null, failure: 'network' })
  })

  it('body-read failure AFTER acquisition retains status + finalUrl (Codex plan #2)', async () => {
    const stream = new ReadableStream({ pull() { throw new Error('stream reset') } })
    safeFetchMock.mockImplementation(async () => ({
      response: new Response(stream, { status: 200 }),
      url: 'https://example.com/robots.txt',
      redirects: [],
    }))
    const r = await fetchRobotsTxt('https://example.com')
    expect(r).toMatchObject({
      ok: false, status: 200, finalUrl: 'https://example.com/robots.txt', failure: 'network',
    })
  })

  it('invalid baseUrl → unsafe-url without a network call', async () => {
    const r = await fetchRobotsTxt('not a url')
    expect(r).toMatchObject({ ok: false, failure: 'unsafe-url' })
    expect(safeFetchMock).not.toHaveBeenCalled()
  })
})

describe('fetchSitemapXml', () => {
  it('ok: returns XML', async () => {
    respond('<urlset><url><loc>https://x.com/a</loc></url></urlset>', {
      status: 200, headers: { 'content-type': 'application/xml' },
    })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml')
    expect(r).toMatchObject({ ok: true, status: 200, text: expect.stringContaining('<urlset>') })
  })

  it('not-xml: HTML content-type is rejected with metadata, body cancelled (Codex #3/#9)', async () => {
    let cancelled = false
    const stream = new ReadableStream({ cancel() { cancelled = true } })
    safeFetchMock.mockImplementation(async () => ({
      response: new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } }),
      url: 'https://example.com/sitemap.xml',
      redirects: [],
    }))
    const r = await fetchSitemapXml('https://example.com/sitemap.xml')
    expect(r).toEqual({
      ok: false, status: 200, text: null,
      finalUrl: 'https://example.com/sitemap.xml',
      failure: 'not-xml', truncated: false,
    })
    expect(cancelled).toBe(true)
  })

  it('gz: gunzips a .gz URL', async () => {
    const gz = gzipSync('<urlset><url><loc>https://x.com/a</loc></url></urlset>')
    respond(new Uint8Array(gz), { status: 200, url: 'https://example.com/sitemap.xml.gz' })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml.gz')
    expect(r).toMatchObject({ ok: true, text: expect.stringContaining('https://x.com/a') })
  })

  it('gz: corrupt gzip → invalid-response with status/finalUrl retained', async () => {
    respond(new Uint8Array([1, 2, 3, 4]), { status: 200, url: 'https://example.com/sitemap.xml.gz' })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml.gz')
    expect(r).toMatchObject({ ok: false, status: 200, failure: 'invalid-response', truncated: false })
  })

  it('gz: decompressed output over the cap → too-large (real zlib size branch, Codex plan #4)', async () => {
    // Highly compressible: tiny wire size, >5 MB decompressed → gunzipSync
    // throws (maxOutputLength) → too-large. Pins the runtime error-code path.
    const big = '<urlset>' + '<url><loc>https://x.com/a</loc></url>'.repeat(160_000) + '</urlset>'
    expect(big.length).toBeGreaterThan(5_000_000)
    respond(new Uint8Array(gzipSync(big)), { status: 200, url: 'https://example.com/sitemap.xml.gz' })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml.gz')
    expect(r).toMatchObject({ ok: false, status: 200, failure: 'too-large', truncated: true })
  })

  it('gz: compressed payload over the read cap → too-large (Codex plan #4)', async () => {
    const { randomBytes } = await import('node:crypto')
    respond(new Uint8Array(gzipSync(randomBytes(6_000_000))), {
      status: 200, url: 'https://example.com/sitemap.xml.gz',
    })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml.gz')
    expect(r).toMatchObject({ ok: false, status: 200, failure: 'too-large', truncated: true })
  })

  it('http-error carries status + finalUrl', async () => {
    respond('gone', { status: 410 })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml')
    expect(r).toMatchObject({ ok: false, status: 410, failure: 'http-error' })
  })

  // Content-type edges inherited from the crawler — load-bearing for
  // "behavior-preserving" (Codex plan #5):
  it('accepts application/xhtml+xml (contains both html and xml)', async () => {
    respond('<urlset><url><loc>https://x.com/a</loc></url></urlset>', {
      status: 200, headers: { 'content-type': 'application/xhtml+xml' },
    })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml')
    expect(r).toMatchObject({ ok: true })
  })

  it('accepts a missing content-type', async () => {
    respond('<urlset><url><loc>https://x.com/a</loc></url></urlset>', { status: 200 })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml')
    expect(r).toMatchObject({ ok: true })
  })

  it('accepts text/plain', async () => {
    respond('<urlset><url><loc>https://x.com/a</loc></url></urlset>', {
      status: 200, headers: { 'content-type': 'text/plain' },
    })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml')
    expect(r).toMatchObject({ ok: true })
  })

  it('gzip content-type triggers decompression even without a .gz suffix', async () => {
    respond(new Uint8Array(gzipSync('<urlset><url><loc>https://x.com/a</loc></url></urlset>')), {
      status: 200, headers: { 'content-type': 'application/gzip' },
    })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml')
    expect(r).toMatchObject({ ok: true, text: expect.stringContaining('https://x.com/a') })
  })
})

describe('collectSitemapPageUrls', () => {
  const same = () => true
  it('plain urlset: page locs, zero children', async () => {
    const r = await collectSitemapPageUrls(
      '<urlset><url><loc>https://x.com/a</loc></url></urlset>', same, async () => null,
    )
    expect(r).toEqual({ urls: ['https://x.com/a'], childrenTotal: 0, childrenFailed: 0 })
  })

  it('index: fetches same-domain children and collects their pages', async () => {
    const xml = '<sitemapindex><sitemap><loc>https://x.com/a.xml</loc></sitemap><sitemap><loc>https://other.com/b.xml</loc></sitemap></sitemapindex>'
    const fetched: string[] = []
    const r = await collectSitemapPageUrls(
      xml,
      (u) => u.startsWith('https://x.com'),
      async (u) => { fetched.push(u); return '<urlset><url><loc>https://x.com/p1</loc></url></urlset>' },
    )
    expect(fetched).toEqual(['https://x.com/a.xml'])   // cross-domain child filtered BEFORE fetch
    expect(r).toEqual({ urls: ['https://x.com/p1'], childrenTotal: 1, childrenFailed: 0 })
  })

  it('failed children are counted, not silent (Codex #4)', async () => {
    const xml = '<sitemapindex><sitemap><loc>https://x.com/a.xml</loc></sitemap><sitemap><loc>https://x.com/b.xml</loc></sitemap></sitemapindex>'
    const r = await collectSitemapPageUrls(xml, same, async (u) =>
      u.endsWith('a.xml') ? '<urlset><url><loc>https://x.com/p1</loc></url></urlset>' : null,
    )
    expect(r).toEqual({ urls: ['https://x.com/p1'], childrenTotal: 2, childrenFailed: 1 })
  })

  it('an empty-string child body counts as failed, matching the crawler falsy check (Codex plan #3)', async () => {
    const xml = '<sitemapindex><sitemap><loc>https://x.com/a.xml</loc></sitemap></sitemapindex>'
    const r = await collectSitemapPageUrls(xml, same, async () => '')
    expect(r).toEqual({ urls: [], childrenTotal: 1, childrenFailed: 1 })
  })

  it('nested index child yields no pages — one level only, frozen (Codex #5)', async () => {
    const xml = '<sitemapindex><sitemap><loc>https://x.com/nested.xml</loc></sitemap></sitemapindex>'
    const r = await collectSitemapPageUrls(xml, same, async () =>
      '<sitemapindex><sitemap><loc>https://x.com/deeper.xml</loc></sitemap></sitemapindex>',
    )
    expect(r).toEqual({ urls: [], childrenTotal: 1, childrenFailed: 0 })
  })
})
