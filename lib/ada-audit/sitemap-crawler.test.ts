import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

const safeFetchMock = vi.hoisted(() => vi.fn())

vi.mock('../security/safe-url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../security/safe-url')>()
  return {
    ...actual,
    safeFetch: (...args: unknown[]) => safeFetchMock(...args),
  }
})

vi.mock('./sitemap-crawler-browser-fetch', () => ({
  fetchSitemapViaBrowser: vi.fn(),
}))

import { discoverPages, discoverPagesWithDeps, resolveRawCrawlBounds } from './sitemap-crawler'
import { SafeUrlError } from '../security/safe-url'
import { fetchSitemapViaBrowser } from './sitemap-crawler-browser-fetch'
import { extractPageLocs, extractChildSitemapLocs, isSitemapIndex } from '@/lib/seo-fetch/sitemap-parse'

vi.mock('node:dns', () => ({
  promises: {
    lookup: vi.fn(async () => [{ address: '93.184.216.34' }]),
  },
}))

// ─── Copies of internal pure functions from sitemap-crawler.ts ──────────────
// These are not exported from the module, so we duplicate the logic here
// to unit-test them in isolation. Keep in sync with the source.

function normaliseDomain(domain: string): string {
  return domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
}

function isSameDomain(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === domain || host === `www.${domain}` || domain === `www.${host}`
  } catch {
    return false
  }
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const url of urls) {
    try {
      const u = new URL(url)
      u.hash = ''
      ;['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(
        (p) => u.searchParams.delete(p)
      )
      const key = u.toString()
      if (!seen.has(key)) {
        seen.add(key)
        result.push(url)
      }
    } catch {
      // malformed URL — skip
    }
  }
  return result
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('extractPageLocs / extractChildSitemapLocs (shared)', () => {
  it('extracts URLs from a basic sitemap XML', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/page1</loc></url>
  <url><loc>https://example.com/page2</loc></url>
  <url><loc>https://example.com/page3</loc></url>
</urlset>`
    const result = extractPageLocs(xml)
    expect(result).toEqual([
      'https://example.com/page1',
      'https://example.com/page2',
      'https://example.com/page3',
    ])
  })

  it('extracts URLs wrapped in CDATA sections', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset>
  <url><loc><![CDATA[https://example.com/cdata-page]]></loc></url>
  <url><loc><![CDATA[https://example.com/another]]></loc></url>
</urlset>`
    const result = extractPageLocs(xml)
    expect(result).toEqual([
      'https://example.com/cdata-page',
      'https://example.com/another',
    ])
  })

  it('returns empty array for empty XML', () => {
    expect(extractPageLocs('')).toEqual([])
  })

  it('returns empty array when there are no matches', () => {
    const xml = `<?xml version="1.0"?><urlset></urlset>`
    expect(extractPageLocs(xml)).toEqual([])
  })

  it('skips entries with empty loc content', () => {
    const xml = `<urlset>
  <url><loc>  </loc></url>
  <url><loc>https://example.com/valid</loc></url>
</urlset>`
    const result = extractPageLocs(xml)
    expect(result).toEqual(['https://example.com/valid'])
  })

  it('trims whitespace around URLs', () => {
    const xml = `<urlset>
  <url><loc>  https://example.com/trimmed  </loc></url>
</urlset>`
    const result = extractPageLocs(xml)
    expect(result).toEqual(['https://example.com/trimmed'])
  })

  it('extracts sitemap locs from a sitemap index', () => {
    const xml = `<sitemapindex>
  <sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`
    const result = extractChildSitemapLocs(xml)
    expect(result).toEqual([
      'https://example.com/sitemap-posts.xml',
      'https://example.com/sitemap-pages.xml',
    ])
  })

  it('handles CDATA with whitespace inside', () => {
    const xml = `<urlset>
  <url><loc><![CDATA[  https://example.com/spaced  ]]></loc></url>
</urlset>`
    const result = extractPageLocs(xml)
    expect(result).toEqual(['https://example.com/spaced'])
  })
})

describe('isSitemapIndex', () => {
  it('returns true for a sitemapindex element with attributes', () => {
    expect(isSitemapIndex('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true)
  })

  it('returns true for a bare sitemapindex tag', () => {
    expect(isSitemapIndex('<sitemapindex>')).toBe(true)
  })

  it('returns false for a regular urlset sitemap', () => {
    const xml = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
</urlset>`
    expect(isSitemapIndex(xml)).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isSitemapIndex('<SITEMAPINDEX>')).toBe(true)
    expect(isSitemapIndex('<SitemapIndex xmlns="...">')).toBe(true)
  })

  it('returns false for empty string', () => {
    expect(isSitemapIndex('')).toBe(false)
  })

  it('returns false when "sitemapindex" appears only in text content, not as a tag', () => {
    // The regex requires [\s>] after "sitemapindex", so bare text without < won't match
    expect(isSitemapIndex('this is about sitemapindex stuff')).toBe(false)
  })
})

describe('normaliseDomain', () => {
  it('strips https:// prefix', () => {
    expect(normaliseDomain('https://example.com')).toBe('example.com')
  })

  it('strips http:// prefix', () => {
    expect(normaliseDomain('http://example.com')).toBe('example.com')
  })

  it('strips path after domain', () => {
    expect(normaliseDomain('https://example.com/some/path')).toBe('example.com')
  })

  it('lowercases the domain', () => {
    expect(normaliseDomain('HTTPS://Example.COM')).toBe('example.com')
  })

  it('handles bare domain with no scheme', () => {
    expect(normaliseDomain('example.com')).toBe('example.com')
  })

  it('handles bare domain with trailing slash', () => {
    expect(normaliseDomain('example.com/')).toBe('example.com')
  })

  it('handles domain with port in path-like format', () => {
    // The regex strips everything after the first /
    expect(normaliseDomain('https://example.com:3000/path')).toBe('example.com:3000')
  })

  it('handles subdomain', () => {
    expect(normaliseDomain('https://www.example.com')).toBe('www.example.com')
  })
})

describe('isSameDomain', () => {
  it('returns true for exact domain match', () => {
    expect(isSameDomain('https://example.com/page', 'example.com')).toBe(true)
  })

  it('returns true when URL has www prefix and domain does not', () => {
    expect(isSameDomain('https://www.example.com/page', 'example.com')).toBe(true)
  })

  it('returns true when domain has www prefix and URL does not', () => {
    expect(isSameDomain('https://example.com/page', 'www.example.com')).toBe(true)
  })

  it('returns false for a different domain', () => {
    expect(isSameDomain('https://other.com/page', 'example.com')).toBe(false)
  })

  it('returns false for a subdomain that is not www', () => {
    expect(isSameDomain('https://blog.example.com/page', 'example.com')).toBe(false)
  })

  it('returns false for an invalid URL', () => {
    expect(isSameDomain('not-a-url', 'example.com')).toBe(false)
  })

  it('is case-insensitive on the hostname', () => {
    expect(isSameDomain('https://EXAMPLE.COM/page', 'example.com')).toBe(true)
  })

  it('handles URL with port', () => {
    // new URL('https://example.com:443/page').hostname === 'example.com'
    expect(isSameDomain('https://example.com:443/page', 'example.com')).toBe(true)
  })

  it('returns false for empty string URL', () => {
    expect(isSameDomain('', 'example.com')).toBe(false)
  })
})

describe('dedupeUrls', () => {
  it('removes exact duplicate URLs', () => {
    const urls = [
      'https://example.com/page1',
      'https://example.com/page2',
      'https://example.com/page1',
    ]
    expect(dedupeUrls(urls)).toEqual([
      'https://example.com/page1',
      'https://example.com/page2',
    ])
  })

  it('treats URLs differing only by UTM params as duplicates', () => {
    const urls = [
      'https://example.com/page',
      'https://example.com/page?utm_source=google&utm_medium=cpc',
    ]
    const result = dedupeUrls(urls)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('https://example.com/page')
  })

  it('keeps the first URL when UTM-stripped versions collide', () => {
    const urls = [
      'https://example.com/page?utm_campaign=spring',
      'https://example.com/page?utm_campaign=fall',
    ]
    const result = dedupeUrls(urls)
    expect(result).toHaveLength(1)
    // First occurrence wins
    expect(result[0]).toBe('https://example.com/page?utm_campaign=spring')
  })

  it('strips hash fragments for dedup but keeps original URL', () => {
    const urls = [
      'https://example.com/page#section1',
      'https://example.com/page#section2',
    ]
    const result = dedupeUrls(urls)
    expect(result).toHaveLength(1)
    // First occurrence is kept with its original form
    expect(result[0]).toBe('https://example.com/page#section1')
  })

  it('preserves non-UTM query params as distinct', () => {
    const urls = [
      'https://example.com/page?id=1',
      'https://example.com/page?id=2',
    ]
    expect(dedupeUrls(urls)).toHaveLength(2)
  })

  it('strips all five UTM params for dedup key', () => {
    const urls = [
      'https://example.com/page?utm_source=a&utm_medium=b&utm_campaign=c&utm_content=d&utm_term=e',
      'https://example.com/page',
    ]
    const result = dedupeUrls(urls)
    expect(result).toHaveLength(1)
  })

  it('silently skips malformed URLs', () => {
    const urls = [
      'https://example.com/valid',
      'not a url at all',
      '://broken',
      'https://example.com/also-valid',
    ]
    const result = dedupeUrls(urls)
    expect(result).toEqual([
      'https://example.com/valid',
      'https://example.com/also-valid',
    ])
  })

  it('returns empty array for empty input', () => {
    expect(dedupeUrls([])).toEqual([])
  })

  it('returns empty array when all URLs are malformed', () => {
    expect(dedupeUrls(['not-a-url', 'also-bad'])).toEqual([])
  })

  it('handles mixed UTM and non-UTM params correctly', () => {
    const urls = [
      'https://example.com/page?category=news&utm_source=twitter',
      'https://example.com/page?category=news',
    ]
    const result = dedupeUrls(urls)
    // After stripping utm_source, both normalise to ?category=news — so only first kept
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('https://example.com/page?category=news&utm_source=twitter')
  })
})

describe('discoverPages SSRF protections', () => {
  afterEach(() => {
    safeFetchMock.mockReset()
    vi.clearAllMocks()
  })

  it('rejects internal hostnames before fetching', async () => {
    await expect(discoverPages('localhost')).rejects.toThrow(/private\/internal/)
    expect(safeFetchMock).not.toHaveBeenCalled()
  })

  it('does not follow sitemap redirects to private addresses', async () => {
    const requestedUrls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      requestedUrls.push(url)

      if (url === 'https://example.com/robots.txt') {
        return new Response('Sitemap: https://example.com/private-sitemap.xml', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      }

      if (url === 'https://example.com/private-sitemap.xml') {
        return new Response(null, {
          status: 302,
          headers: { Location: 'http://127.0.0.1/sitemap.xml' },
        })
      }

      if (
        url === 'https://example.com/sitemap.xml' ||
        url === 'https://example.com/sitemap_index.xml' ||
        url === 'https://example.com/wp-sitemap.xml' ||
        url === 'https://example.com/sitemap.xml.gz'
      ) {
        return new Response('not found', { status: 404 })
      }

      if (url === 'https://example.com' || url === 'https://example.com/') {
        return new Response('<a href="/safe-page">Safe</a>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })
    safeFetchMock.mockImplementation(async (url: string | URL) => {
      const response = await fetchMock(url.toString())
      if (response.status === 302) {
        const location = response.headers.get('location')
        if (location?.includes('127.0.0.1')) {
          throw new SafeUrlError('Requests to private/internal addresses are not allowed')
        }
      }
      return { response, url: url.toString(), redirects: [] }
    })

    await expect(discoverPages('example.com')).resolves.toEqual({
      urls: ['https://example.com/safe-page'],
      mode: 'shallow-crawl',
      capped: false,
    })
    expect(requestedUrls).not.toContain('http://127.0.0.1/sitemap.xml')
  })

  it('does not fetch off-domain robots sitemap URLs', async () => {
    const requestedUrls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      requestedUrls.push(url)

      if (url === 'https://example.com/robots.txt') {
        return new Response('Sitemap: https://other.test/sitemap.xml', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      }

      if (url === 'https://example.com/sitemap.xml') {
        return new Response('<urlset><url><loc>https://example.com/page</loc></url></urlset>', {
          status: 200,
          headers: { 'content-type': 'application/xml' },
        })
      }

      return new Response('not found', { status: 404 })
    })
    safeFetchMock.mockImplementation(async (url: string | URL) => {
      const response = await fetchMock(url.toString())
      return { response, url: url.toString(), redirects: [] }
    })

    await expect(discoverPages('example.com')).resolves.toEqual({
      urls: ['https://example.com/page'],
      mode: 'sitemap',
      capped: false,
    })
    expect(requestedUrls).not.toContain('https://other.test/sitemap.xml')
  })

  it('filters cdn-cgi URLs from sitemap discovery', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://example.com/robots.txt') {
        return new Response('', { status: 404 })
      }
      if (url === 'https://example.com/sitemap.xml') {
        return new Response(`
          <urlset>
            <url><loc>https://example.com/page</loc></url>
            <url><loc>https://example.com/cdn-cgi/l/email-protection</loc></url>
          </urlset>
        `, {
          status: 200,
          headers: { 'content-type': 'application/xml' },
        })
      }
      return new Response('not found', { status: 404 })
    })
    safeFetchMock.mockImplementation(async (url: string | URL) => {
      const response = await fetchMock(url.toString())
      return { response, url: url.toString(), redirects: [] }
    })

    await expect(discoverPages('example.com')).resolves.toEqual({
      urls: ['https://example.com/page'],
      mode: 'sitemap',
      capped: false,
    })
  })

  it('does not fetch off-domain child sitemaps from sitemap indexes', async () => {
    const requestedUrls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      requestedUrls.push(url)

      if (url === 'https://example.com/robots.txt') {
        return new Response('', { status: 404 })
      }

      if (url === 'https://example.com/sitemap.xml') {
        return new Response(`
          <sitemapindex>
            <sitemap><loc>https://other.test/child.xml</loc></sitemap>
            <sitemap><loc>https://example.com/child.xml</loc></sitemap>
          </sitemapindex>
        `, {
          status: 200,
          headers: { 'content-type': 'application/xml' },
        })
      }

      if (url === 'https://example.com/child.xml') {
        return new Response('<urlset><url><loc>https://example.com/page</loc></url></urlset>', {
          status: 200,
          headers: { 'content-type': 'application/xml' },
        })
      }

      return new Response('not found', { status: 404 })
    })
    safeFetchMock.mockImplementation(async (url: string | URL) => {
      const response = await fetchMock(url.toString())
      return { response, url: url.toString(), redirects: [] }
    })

    await expect(discoverPages('example.com')).resolves.toEqual({
      urls: ['https://example.com/page'],
      mode: 'sitemap',
      capped: false,
    })
    expect(requestedUrls).not.toContain('https://other.test/child.xml')
  })
})

describe('discoverPages hard cap', () => {
  afterEach(() => {
    safeFetchMock.mockReset()
    vi.clearAllMocks()
  })

  it('sets capped=true when the sitemap yields more than HARD_CAP unique pages', async () => {
    const total = 1005
    const urlEntries = Array.from({ length: total }, (_, i) =>
      `<url><loc>https://example.com/page-${i}</loc></url>`
    ).join('')

    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://example.com/robots.txt') {
        return new Response('', { status: 404 })
      }
      if (url === 'https://example.com/sitemap.xml') {
        return new Response(`<urlset>${urlEntries}</urlset>`, {
          status: 200,
          headers: { 'content-type': 'application/xml' },
        })
      }
      return new Response('not found', { status: 404 })
    })
    safeFetchMock.mockImplementation(async (url: string | URL) => {
      const response = await fetchMock(url.toString())
      return { response, url: url.toString(), redirects: [] }
    })

    const result = await discoverPages('example.com')
    expect(result.mode).toBe('sitemap')
    expect(result.capped).toBe(true)
    expect(result.urls).toHaveLength(1000)
  })
})

describe('discoverPages browser fallback', () => {
  afterEach(() => {
    safeFetchMock.mockReset()
    vi.mocked(fetchSitemapViaBrowser).mockReset()
  })

  it('falls back to browser-fetch for both top-level AND child sitemaps when WAF 403s direct fetches', async () => {
    // All safeFetch calls return 403 (CDN/WAF blocks our IP)
    safeFetchMock.mockImplementation(async (url: string | URL) => ({
      response: new Response('Forbidden', {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'text/html' },
      }),
      url: url.toString(),
      redirects: [],
    }))

    // Browser fetch succeeds: index returns two child sitemaps, each child returns pages
    vi.mocked(fetchSitemapViaBrowser).mockImplementation(async (url: string) => {
      if (url.includes('sitemap_index.xml')) {
        return `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>https://example.edu/post-sitemap.xml</loc></sitemap>
          <sitemap><loc>https://example.edu/page-sitemap.xml</loc></sitemap>
        </sitemapindex>`
      }
      if (url.includes('post-sitemap.xml')) {
        return `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.edu/post-1/</loc></url>
          <url><loc>https://example.edu/post-2/</loc></url>
        </urlset>`
      }
      if (url.includes('page-sitemap.xml')) {
        return `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.edu/about/</loc></url>
        </urlset>`
      }
      return null
    })

    const result = await discoverPages('example.edu')
    expect(result.mode).toBe('sitemap')
    expect(result.capped).toBe(false)
    expect(result.urls.sort()).toEqual([
      'https://example.edu/about/',
      'https://example.edu/post-1/',
      'https://example.edu/post-2/',
    ].sort())

    // Browser fetch must have been called (at minimum for the index, plus both children)
    expect(vi.mocked(fetchSitemapViaBrowser)).toHaveBeenCalled()
    // Specifically the index and both child sitemaps should have gone through the browser
    const browserCalls = vi.mocked(fetchSitemapViaBrowser).mock.calls.map(([u]) => u)
    expect(browserCalls.some((u) => u.includes('sitemap_index.xml'))).toBe(true)
    expect(browserCalls.some((u) => u.includes('post-sitemap.xml'))).toBe(true)
    expect(browserCalls.some((u) => u.includes('page-sitemap.xml'))).toBe(true)
  })

  it('falls back to the browser fetch when direct sitemap fetch is 200 but EMPTY (Codex plan #1)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://example.com/robots.txt') {
        return new Response('Sitemap: https://example.com/sitemap.xml', {
          status: 200, headers: { 'content-type': 'text/plain' },
        })
      }
      if (url === 'https://example.com/sitemap.xml') {
        return new Response('', { status: 200, headers: { 'content-type': 'application/xml' } })
      }
      return new Response('not found', { status: 404 })
    })
    safeFetchMock.mockImplementation(async (url: string | URL) => {
      const response = await fetchMock(url.toString())
      return { response, url: url.toString(), redirects: [] }
    })
    vi.mocked(fetchSitemapViaBrowser).mockResolvedValue(
      '<urlset><url><loc>https://example.com/page</loc></url></urlset>'
    )

    await expect(discoverPages('example.com')).resolves.toEqual({
      urls: ['https://example.com/page'],
      mode: 'sitemap',
      capped: false,
    })
    expect(fetchSitemapViaBrowser).toHaveBeenCalledWith('https://example.com/sitemap.xml', expect.any(Number)) // + deadlineMs (L2)
  })

  it('mock-seam canary: delegated fetches still route through the safeFetch mock (Codex plan #7)', async () => {
    safeFetchMock.mockImplementation(async (url: string | URL) => ({
      response: new Response('not found', { status: 404 }),
      url: url.toString(),
      redirects: [],
    }))
    await discoverPages('example.com').catch(() => {})
    const requested = safeFetchMock.mock.calls.map((c) => String(c[0]))
    expect(requested).toContain('https://example.com/robots.txt')
  })
})

describe('discoverPages robots.txt Sitemap extraction', () => {
  afterEach(() => {
    safeFetchMock.mockReset()
    vi.clearAllMocks()
  })

  it('D6: strips a trailing #-comment from a robots.txt Sitemap directive', async () => {
    const requestedUrls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      requestedUrls.push(url)
      if (url === 'https://example.com/robots.txt') {
        return new Response('Sitemap: https://example.com/from-robots.xml # primary sitemap', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      }
      if (url === 'https://example.com/from-robots.xml') {
        return new Response('<urlset><url><loc>https://example.com/page</loc></url></urlset>', {
          status: 200,
          headers: { 'content-type': 'application/xml' },
        })
      }
      return new Response('not found', { status: 404 })
    })
    safeFetchMock.mockImplementation(async (url: string | URL) => {
      const response = await fetchMock(url.toString())
      return { response, url: url.toString(), redirects: [] }
    })

    await expect(discoverPages('example.com')).resolves.toEqual({
      urls: ['https://example.com/page'],
      mode: 'sitemap',
      capped: false,
    })
    // The comment-polluted URL must never be requested
    expect(requestedUrls).toContain('https://example.com/from-robots.xml')
    expect(requestedUrls.every((u) => !u.includes('#') && !u.includes('%20primary'))).toBe(true)
  })
})

describe('discoverPages hybrid', () => {
  it('hybrid:false is unchanged (no coverage, never mode hybrid)', async () => {
    const r = await discoverPagesWithDeps('x.com', { hybrid: false }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/a'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async () => null, now: () => 0,
    })
    expect(r).toEqual({ urls: ['https://x.com/a'], mode: 'sitemap', capped: false })
    expect('coverage' in r).toBe(false)
  })

  it('hybrid:true expands the seed set and returns provenance', async () => {
    const graph: Record<string, string[]> = {
      'https://x.com/a': ['https://x.com/b'], 'https://x.com/b': [],
    }
    const r = await discoverPagesWithDeps('x.com', { hybrid: true }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/a'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async (u) => (u in graph ? { links: graph[u], finalUrl: u } : null),
      now: () => 0,
      robots: { disallow: [], allow: [] },
    })
    expect(r.mode).toBe('hybrid')
    expect(r.urls).toContain('https://x.com/b')
    expect(r.coverage!.sources['https://x.com/a']).toBe('sitemap')
    expect(r.coverage!.sources['https://x.com/b']).toBe('linked')
    expect(r.coverage!.sitemapCount).toBe(1)
  })

  it('hybrid:true with provided seeds tags them seed', async () => {
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, seeds: ['https://x.com/p'] }, {
      resolveSeeds: async () => { throw new Error('should not resolve when seeds provided') },
      fetchPageLinks: async () => null, now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.mode).toBe('hybrid')
    expect(r.coverage!.sources['https://x.com/p']).toBe('seed')
  })

  it('applies the env time-budget ceiling even when opts.timeBudgetMs is larger', async () => {
    const orig = process.env.HYBRID_CRAWL_TIME_BUDGET_MS
    process.env.HYBRID_CRAWL_TIME_BUDGET_MS = '5'  // 5ms ceiling
    try {
      let clock = 0
      const r = await discoverPagesWithDeps('x.com', { hybrid: true, seeds: ['https://x.com/', 'https://x.com/a'], timeBudgetMs: 999999 }, {
        resolveSeeds: async () => { throw new Error('seeds provided; resolveSeeds must not be called') },
        fetchPageLinks: async (u) => ({ links: [], finalUrl: u }),
        now: () => (clock += 10),  // advances 10ms/call → exceeds the 5ms ceiling on the first wave check
        robots: { disallow: [], allow: [] },
      })
      // Without the Math.min fix, timeBudgetMs would be 999999 and the crawl would NOT stop by time.
      expect(r.coverage!.stoppedBy).toBe('timeBudget')
    } finally {
      if (orig === undefined) delete process.env.HYBRID_CRAWL_TIME_BUDGET_MS
      else process.env.HYBRID_CRAWL_TIME_BUDGET_MS = orig
    }
  })
})

describe('discoverPages rendered pass (L2)', () => {
  const rawGraph: Record<string, { links: string[]; finalUrl: string } | null> = {
    'https://x.com/': { links: [], finalUrl: 'https://x.com/' },
  }
  const renderedGraph: Record<string, { links: string[]; finalUrl: string }> = {
    'https://x.com/': { links: ['https://x.com/education', 'https://x.com/healthcare'], finalUrl: 'https://x.com/' },
    'https://x.com/education': { links: [], finalUrl: 'https://x.com/education' },
    'https://x.com/healthcare': { links: [], finalUrl: 'https://x.com/healthcare' },
  }

  it('triggers on ≥ N novel admissible rendered URLs and merges them in', async () => {
    process.env.HYBRID_RENDER_PROBE_MIN_NOVEL = '2'
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async (u) => rawGraph[u] ?? null,
      fetchPageLinksRendered: async (u) => renderedGraph[u] ?? null,
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.coverage?.renderProbe).toBe('triggered')
    expect(r.urls).toEqual(expect.arrayContaining(['https://x.com/education', 'https://x.com/healthcare']))
    expect(r.coverage?.renderedAdded).toBeGreaterThanOrEqual(2)
    delete process.env.HYBRID_RENDER_PROBE_MIN_NOVEL
  })

  it('records no-delta (and does not merge) when the probe finds too few novel URLs', async () => {
    process.env.HYBRID_RENDER_PROBE_MIN_NOVEL = '5'
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async (u) => rawGraph[u] ?? null,
      fetchPageLinksRendered: async (u) => renderedGraph[u] ?? null,
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.coverage?.renderProbe).toBe('no-delta')
    expect(r.urls).not.toContain('https://x.com/education')
    delete process.env.HYBRID_RENDER_PROBE_MIN_NOVEL
  })

  it('records probe failure distinctly from no-delta when every probe render fails', async () => {
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async (u) => rawGraph[u] ?? null,
      fetchPageLinksRendered: async () => null,
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.coverage?.renderProbe).toBe('failed')
  })

  it('drops a Disallow-ed rendered candidate (candidates go through robots)', async () => {
    process.env.HYBRID_RENDER_PROBE_MIN_NOVEL = '1'
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async (u) => rawGraph[u] ?? null,
      fetchPageLinksRendered: async (u) => (u === 'https://x.com/'
        ? { links: ['https://x.com/ok', 'https://x.com/admin/x'], finalUrl: 'https://x.com/' }
        : { links: [], finalUrl: u }),
      now: () => 0, robots: { disallow: ['/admin/'], allow: [] },
    })
    expect(r.urls).toContain('https://x.com/ok')
    expect(r.urls).not.toContain('https://x.com/admin/x')
    delete process.env.HYBRID_RENDER_PROBE_MIN_NOVEL
  })

  it('skips the rendered pass and records hardCapPrefull when raw already fills HARD_CAP', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => `https://x.com/p${i}`)
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: full, mode: 'sitemap', capped: false }),
      fetchPageLinks: async () => null,
      fetchPageLinksRendered: async () => { throw new Error('rendered pass must not run when hardCap-prefull') },
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.coverage?.renderStoppedBy).toBe('hardCapPrefull')
  })

  it('rendered pass is inert when no renderer dep is provided (regression: existing raw-only hybrid)', async () => {
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async (u) => rawGraph[u] ?? null,
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.coverage?.renderProbe).toBe('skipped')
  })

  it('triggers via a shallow-hub probe when the homepage is SSR-empty (SSR-home/CSR-deep, Codex fix 5)', async () => {
    process.env.HYBRID_RENDER_PROBE_MIN_NOVEL = '2'
    const raw: Record<string, { links: string[]; finalUrl: string } | null> = {
      'https://x.com/': { links: [], finalUrl: 'https://x.com/' },
      'https://x.com/programs': { links: [], finalUrl: 'https://x.com/programs' },
    }
    const rendered: Record<string, { links: string[]; finalUrl: string }> = {
      'https://x.com/': { links: [], finalUrl: 'https://x.com/' },
      'https://x.com/programs': { links: ['https://x.com/nursing', 'https://x.com/welding'], finalUrl: 'https://x.com/programs' },
      'https://x.com/nursing': { links: [], finalUrl: 'https://x.com/nursing' },
      'https://x.com/welding': { links: [], finalUrl: 'https://x.com/welding' },
    }
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/', 'https://x.com/programs'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async (u) => raw[u] ?? null,
      fetchPageLinksRendered: async (u) => rendered[u] ?? null,
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.coverage?.renderProbe).toBe('triggered')
    expect(r.urls).toEqual(expect.arrayContaining(['https://x.com/nursing', 'https://x.com/welding']))
    delete process.env.HYBRID_RENDER_PROBE_MIN_NOVEL
  })

  it('never passes the full raw known set to the rendered fetcher — only home + ≤maxHubs (Codex fix 5 spy)', async () => {
    process.env.HYBRID_RENDER_PROBE_MAX_HUBS = '1'
    process.env.HYBRID_RENDER_PROBE_MIN_NOVEL = '99'
    const known = ['https://x.com/', ...Array.from({ length: 20 }, (_, i) => `https://x.com/p${i}`)]
    const rendered = vi.fn(async (u: string) => ({ links: [], finalUrl: u }))
    await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: known, mode: 'sitemap', capped: false }),
      fetchPageLinks: async () => ({ links: [], finalUrl: 'https://x.com/' }),
      fetchPageLinksRendered: rendered,
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(rendered.mock.calls.length).toBeLessThanOrEqual(2)
    delete process.env.HYBRID_RENDER_PROBE_MAX_HUBS
    delete process.env.HYBRID_RENDER_PROBE_MIN_NOVEL
  })

  it('does no probe/render work when the deadline is already spent at seed resolution (Codex fix 1)', async () => {
    const rendered = vi.fn(async () => null)
    await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 0 }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async () => null,
      fetchPageLinksRendered: rendered,
      now: () => 1000, robots: { disallow: [], allow: [] },
    })
    expect(rendered).not.toHaveBeenCalled()
  })

  it('renderedFetches counts ACTUAL renders — the probed homepage reused as a BFS seed is not double-counted (Codex fix 4)', async () => {
    process.env.HYBRID_RENDER_PROBE_MIN_NOVEL = '1'
    const rendered = vi.fn(async (u: string) => (u === 'https://x.com/'
      ? { links: ['https://x.com/a'], finalUrl: 'https://x.com/' }
      : { links: [], finalUrl: u }))
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async () => ({ links: [], finalUrl: 'https://x.com/' }),
      fetchPageLinksRendered: rendered,
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.coverage?.renderProbe).toBe('triggered')
    expect(rendered.mock.calls.length).toBe(2)
    expect(r.coverage?.renderedFetches).toBe(2)
    delete process.env.HYBRID_RENDER_PROBE_MIN_NOVEL
  })
})

describe('resolveRawCrawlBounds', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    delete process.env.HYBRID_CRAWL_MAX_ADDED
    delete process.env.HYBRID_CRAWL_MAX_FETCHES
    delete process.env.HYBRID_CRAWL_TIME_BUDGET_MS
  })
  afterEach(() => { process.env = { ...saved } })

  it('defaults to the L3 raised count caps (800 fetches / 600 added)', () => {
    const b = resolveRawCrawlBounds(100_000, 0)
    expect(b.maxFetches).toBe(800)
    expect(b.maxAdded).toBe(600)
  })

  it('keeps the raw time sub-budget capped at HY_TIME_BUDGET (120s), not the overall deadline', () => {
    // overall deadline is 240s out; raw crawl must still self-cap at 120s
    const b = resolveRawCrawlBounds(240_000, 0)
    expect(b.timeBudgetMs).toBe(120_000)
  })

  it('clamps the raw sub-budget to the remaining deadline when it is under 120s', () => {
    const b = resolveRawCrawlBounds(30_000, 0)
    expect(b.timeBudgetMs).toBe(30_000)
  })

  it('respects env overrides for the count caps', () => {
    process.env.HYBRID_CRAWL_MAX_FETCHES = '1200'
    process.env.HYBRID_CRAWL_MAX_ADDED = '900'
    const b = resolveRawCrawlBounds(100_000, 0)
    expect(b.maxFetches).toBe(1200)
    expect(b.maxAdded).toBe(900)
  })
})

// L3 (2026-07-20): a count-cap stop must be reported via coverage.stoppedBy, NOT
// the coarse `capped` flag (which is only seedCapped || hardCap || hardCapPrefull).
// This also proves resolveRawCrawlBounds is wired into discovery (the env cap
// actually bounds the crawl).
describe('discoverPagesWithDeps honest cap reporting (L3)', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })

  it('a maxAdded stop is reported via coverage.stoppedBy, not the coarse capped flag', async () => {
    process.env.HYBRID_CRAWL_MAX_ADDED = '2' // force the count cap through resolveRawCrawlBounds
    const g: Record<string, string[]> = {
      'https://x.com/': ['https://x.com/a', 'https://x.com/b', 'https://x.com/c', 'https://x.com/d'],
      'https://x.com/a': [], 'https://x.com/b': [], 'https://x.com/c': [], 'https://x.com/d': [],
    }
    const r = await discoverPagesWithDeps('x.com', { hybrid: true }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async (u) => (u in g ? { links: g[u], finalUrl: u } : null),
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.coverage!.stoppedBy).toBe('maxAdded')
    expect(r.capped).toBe(false) // a count-cap stop is NOT a coarse-capped run
  })

  it('a maxFetches stop is reported via coverage.stoppedBy, not the coarse capped flag', async () => {
    process.env.HYBRID_CRAWL_MAX_FETCHES = '2'
    const g: Record<string, string[]> = {
      'https://x.com/': ['https://x.com/a', 'https://x.com/b', 'https://x.com/c'],
      'https://x.com/a': [], 'https://x.com/b': [], 'https://x.com/c': [],
    }
    const r = await discoverPagesWithDeps('x.com', { hybrid: true }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async (u) => (u in g ? { links: g[u], finalUrl: u } : null),
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.coverage!.stoppedBy).toBe('maxFetches')
    expect(r.capped).toBe(false)
  })
})
