// lib/ada-audit/seo/hybrid-crawl.test.ts
import { describe, it, expect } from 'vitest'
import { hybridCrawl, type CrawlBounds, type FetchedPage } from './hybrid-crawl'

const HOST = 'x.com'
const B = (over: Partial<CrawlBounds> = {}): CrawlBounds => ({
  maxDepth: 3, maxAdded: 100, maxFetches: 100, timeBudgetMs: 10_000, hardCap: 1000,
  maxQueryVariantsPerPath: 5, maxPathSegments: 12, concurrency: 4, ...over,
})
// deterministic fake graph fetcher
const graph = (g: Record<string, string[]>, finalMap: Record<string, string> = {}) => {
  let clock = 0
  return {
    now: () => (clock += 10),
    async fetchPageLinks(url: string): Promise<FetchedPage | null> {
      if (!(url in g)) return null
      return { links: g[url], finalUrl: finalMap[url] ?? url }
    },
  }
}

describe('hybridCrawl', () => {
  it('BFS-discovers linked pages beyond the seeds', async () => {
    const deps = graph({
      'https://x.com/': ['https://x.com/a', 'https://x.com/b'],
      'https://x.com/a': ['https://x.com/c'],
      'https://x.com/b': [], 'https://x.com/c': [],
    })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B(), deps, { disallow: [], allow: [] })
    expect(r.urls).toContain('https://x.com/c')
    expect(r.addedByCrawl).toBe(3) // a,b,c
    expect(r.sources['https://x.com/c']).toBe('linked')
    expect(r.sources['https://x.com']).toBe('sitemap') // seed keeps its source
  })

  it('respects maxDepth', async () => {
    const deps = graph({
      'https://x.com/': ['https://x.com/a'], 'https://x.com/a': ['https://x.com/b'], 'https://x.com/b': ['https://x.com/c'],
    })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B({ maxDepth: 1 }), deps, { disallow: [], allow: [] })
    expect(r.urls).toContain('https://x.com/a') // depth 1 accepted
    expect(r.urls).not.toContain('https://x.com/b') // depth 2 never fetched
    expect(r.stoppedBy).toBe('depth') // Codex #1: leaf accepted at the depth ceiling ⇒ stopped by depth
  })

  it('reports exhausted when the whole graph fits under the bounds', async () => {
    const deps = graph({ 'https://x.com/': ['https://x.com/a'], 'https://x.com/a': [] })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B(), deps, { disallow: [], allow: [] })
    expect(r.stoppedBy).toBe('exhausted')
  })

  it('never fetches more than maxFetches even when a wave would overshoot', async () => {
    const deps = graph({
      'https://x.com/': ['https://x.com/a', 'https://x.com/b'],
      'https://x.com/a': [], 'https://x.com/b': [],
    })
    // seed fetch (1) + at most 1 more ⇒ maxFetches:2 must not fetch both a and b
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B({ maxFetches: 2, concurrency: 4 }), deps, { disallow: [], allow: [] })
    expect(r.fetches).toBeLessThanOrEqual(2)
    expect(r.stoppedBy).toBe('maxFetches')
  })

  it('stops at maxAdded', async () => {
    const deps = graph({ 'https://x.com/': ['https://x.com/a', 'https://x.com/b', 'https://x.com/c'] })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B({ maxAdded: 2 }), deps, { disallow: [], allow: [] })
    expect(r.addedByCrawl).toBe(2)
    expect(r.stoppedBy).toBe('maxAdded')
  })

  it('drops links from an off-host final URL (redirect off-domain)', async () => {
    const deps = graph(
      { 'https://x.com/r': ['https://x.com/should-not-appear'] },
      { 'https://x.com/r': 'https://evil.com/r' }, // final URL left the host
    )
    const r = await hybridCrawl([{ url: 'https://x.com/r', source: 'sitemap' }], HOST, B(), deps, { disallow: [], allow: [] })
    expect(r.urls).not.toContain('https://x.com/should-not-appear')
  })

  it('applies robots Disallow to linked targets only, not seeds', async () => {
    const deps = graph({ 'https://x.com/admin': ['https://x.com/admin/x'], 'https://x.com/': ['https://x.com/admin'] })
    const r = await hybridCrawl(
      [{ url: 'https://x.com/admin', source: 'sitemap' }, { url: 'https://x.com/', source: 'sitemap' }],
      HOST, B(), deps, { disallow: ['/admin'], allow: [] },
    )
    expect(r.urls).toContain('https://x.com/admin')          // seed kept despite Disallow
    expect(r.urls).not.toContain('https://x.com/admin/x')    // linked child blocked
  })

  it('caps query-string variants per path', async () => {
    const links = ['?a=1', '?a=2', '?a=3', '?a=4', '?a=5', '?a=6'].map((q) => `https://x.com/f${q}`)
    const deps = graph({ 'https://x.com/': links })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B({ maxQueryVariantsPerPath: 3 }), deps, { disallow: [], allow: [] })
    const variants = r.urls.filter((u) => u.startsWith('https://x.com/f'))
    expect(variants.length).toBe(3)
  })

  it('drops deep calendar-trap paths', async () => {
    const deps = graph({ 'https://x.com/': ['https://x.com/a/b/c/d/e/f/g/h/i/j/k/l/m'] })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B({ maxPathSegments: 5 }), deps, { disallow: [], allow: [] })
    expect(r.urls.some((u) => u.includes('/m'))).toBe(false)
  })

  it('honors Disallow on a directory-root trailing-slash target (robots matches the real path, not the coverage key)', async () => {
    const deps = graph({ 'https://x.com/': ['https://x.com/admin/'] })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B(), deps, { disallow: ['/admin/'], allow: [] })
    expect(r.urls.some((u) => u.includes('/admin'))).toBe(false)
  })

  it('stops at hardCap, including capping seeds', async () => {
    const seeds = Array.from({ length: 5 }, (_, i) => ({ url: `https://x.com/s${i}`, source: 'sitemap' as const }))
    const r = await hybridCrawl(seeds, HOST, B({ hardCap: 3 }), graph({}), { disallow: [], allow: [] })
    expect(r.urls.length).toBe(3)
    expect(r.stoppedBy).toBe('hardCap')
  })

  it('stops at the time budget', async () => {
    const deps = graph({ 'https://x.com/': ['https://x.com/a'], 'https://x.com/a': [] })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B({ timeBudgetMs: 5 }), deps, { disallow: [], allow: [] })
    expect(r.stoppedBy).toBe('timeBudget')
  })

  it('counts sitemap/seed seeds in sitemapCount, linked in addedByCrawl', async () => {
    const deps = graph({ 'https://x.com/': ['https://x.com/a'], 'https://x.com/a': [] })
    const r = await hybridCrawl([{ url: 'https://x.com/', source: 'sitemap' }], HOST, B(), deps, { disallow: [], allow: [] })
    expect(r.sitemapCount).toBe(1)
    expect(r.addedByCrawl).toBe(1)
  })
})
