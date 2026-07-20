import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./browser-pool', () => ({
  acquirePage: vi.fn(),
  releasePage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../security/safe-url', () => ({
  assertSafeHttpUrl: vi.fn(),
}))

import { fetchSitemapViaBrowser } from './sitemap-crawler-browser-fetch'
import { acquirePage, releasePage } from './browser-pool'
import { assertSafeHttpUrl } from '../security/safe-url'

function makeFakePage(overrides: Partial<{ status: number; body: string; headers: Record<string,string>; }> = {}) {
  const status = overrides.status ?? 200
  const body = overrides.body ?? '<?xml version="1.0"?><urlset><url><loc>https://x.example/</loc></url></urlset>'
  const headers = overrides.headers ?? { 'content-type': 'application/xml' }
  const requestHandlers: Array<(req: unknown) => void> = []
  const fake = {
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
    setDefaultNavigationTimeout: vi.fn(),
    on: vi.fn((event: string, fn: (req: unknown) => void) => {
      if (event === 'request') requestHandlers.push(fn)
    }),
    goto: vi.fn().mockResolvedValue({
      ok: () => status >= 200 && status < 300,
      status: () => status,
      headers: () => headers,
      text: vi.fn().mockResolvedValue(body),
    }),
    _emitRequest: (req: unknown) => requestHandlers.forEach((fn) => fn(req)),
  }
  return fake
}

beforeEach(() => {
  vi.mocked(assertSafeHttpUrl).mockReset()
  vi.mocked(acquirePage).mockReset()
  vi.mocked(releasePage).mockReset().mockResolvedValue(undefined)
})

describe('fetchSitemapViaBrowser', () => {
  it('returns null when the URL fails the SSRF check (no page is acquired)', async () => {
    vi.mocked(assertSafeHttpUrl).mockRejectedValue(new Error('SSRF: private IP'))
    const result = await fetchSitemapViaBrowser('http://10.0.0.1/sitemap.xml')
    expect(result).toBeNull()
    expect(acquirePage).not.toHaveBeenCalled()
  })

  it('returns the XML body when the page returns a valid sitemap', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined as never)
    const page = makeFakePage()
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    const result = await fetchSitemapViaBrowser('https://beal.edu/sitemap_index.xml')
    expect(result).toMatch(/^<\?xml/)
    expect(releasePage).toHaveBeenCalledWith(page)
  })

  it('enables request interception on the page (defense in depth)', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined as never)
    const page = makeFakePage()
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    await fetchSitemapViaBrowser('https://beal.edu/sitemap.xml')
    expect(page.setRequestInterception).toHaveBeenCalledWith(true)
    expect(page.on).toHaveBeenCalledWith('request', expect.any(Function))
  })

  it('rejects responses whose root is not a sitemap (anchored regex prevents WAF-interstitial false-match)', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined as never)
    const page = makeFakePage({
      body: '<html><body>Access denied. Embedded <urlset> mention in error text.</body></html>',
      headers: { 'content-type': 'text/html' },
    })
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    const result = await fetchSitemapViaBrowser('https://blocked.example/sitemap.xml')
    expect(result).toBeNull()
  })

  it('accepts XML declared as text/html when the body root matches', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined as never)
    const page = makeFakePage({
      body: '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://x.example/sm.xml</loc></sitemap></sitemapindex>',
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    const result = await fetchSitemapViaBrowser('https://misdeclare.example/sitemap.xml')
    expect(result).not.toBeNull()
    expect(result).toMatch(/<sitemapindex/)
  })

  it('returns null when the response is non-OK (e.g., 403 from the WAF on browser too)', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined as never)
    const page = makeFakePage({ status: 403 })
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    const result = await fetchSitemapViaBrowser('https://still-blocked.example/sitemap.xml')
    expect(result).toBeNull()
  })

  it('rejects bodies larger than MAX_XML_BYTES', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined as never)
    const huge = '<?xml version="1.0"?><urlset>' + 'X'.repeat(6_000_000) + '</urlset>'
    const page = makeFakePage({ body: huge })
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    const result = await fetchSitemapViaBrowser('https://huge.example/sitemap.xml')
    expect(result).toBeNull()
  })

  it('releases the page even if goto throws', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined as never)
    const page = makeFakePage()
    page.goto = vi.fn().mockRejectedValue(new Error('Navigation timeout'))
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    const result = await fetchSitemapViaBrowser('https://times-out.example/sitemap.xml')
    expect(result).toBeNull()
    expect(releasePage).toHaveBeenCalled()
  })

  it('aborts an intercepted redirect/subrequest that fails SSRF revalidation', async () => {
    const safeUrl = 'https://beal.edu/sitemap_index.xml'
    const unsafeRedirect = 'http://169.254.169.254/latest/meta-data/'
    vi.mocked(assertSafeHttpUrl).mockImplementation(async (u) => {
      if (typeof u === 'string' && u.includes('169.254.169.254')) throw new Error('SSRF: private IP')
      return undefined as never
    })

    const page = makeFakePage()
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    await fetchSitemapViaBrowser(safeUrl)

    const fakeReq = {
      url: () => unsafeRedirect,
      resourceType: () => 'document',
      isNavigationRequest: () => true,
      isInterceptResolutionHandled: () => false,
      continue: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    }
    await page._emitRequest(fakeReq)
    await new Promise((r) => setImmediate(r))

    expect(fakeReq.abort).toHaveBeenCalledWith('blockedbyclient')
    expect(fakeReq.continue).not.toHaveBeenCalled()
  })
})
