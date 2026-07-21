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

import { hybridCrawl as hc2, admissibleLink, mergeCrawlResults, type CrawlResult } from './hybrid-crawl'

describe('hybridCrawl L2 opts', () => {
  const graph2 = (g: Record<string, string[]>) => {
    let clock = 0
    return { now: () => (clock += 10), async fetchPageLinks(u: string) { return u in g ? { links: g[u], finalUrl: u } : null } }
  }
  it('knownKeys are deduped-not-fetched: a discovered link already in knownKeys is not added', async () => {
    const deps = graph2({ 'https://x.com/': ['https://x.com/a', 'https://x.com/known'], 'https://x.com/a': [] })
    const known = new Set(['https://x.com/known'])
    const r = await hc2([{ url: 'https://x.com/', source: 'rendered' }], 'x.com', B(), deps, { disallow: [], allow: [] }, { knownKeys: known, linkedSource: 'rendered-linked' })
    expect(r.urls).toContain('https://x.com/a')
    expect(r.urls).not.toContain('https://x.com/known') // already known ⇒ skipped
    expect(r.sources['https://x.com/a']).toBe('rendered-linked')
  })
  it('a Disallow-ed rendered link is dropped (candidates go through robots)', async () => {
    const deps = graph2({ 'https://x.com/': ['https://x.com/ok', 'https://x.com/admin/x'], 'https://x.com/ok': [] })
    const r = await hc2([{ url: 'https://x.com/', source: 'rendered' }], 'x.com', B(), deps, { disallow: ['/admin/'], allow: [] }, { linkedSource: 'rendered-linked' })
    expect(r.urls).toContain('https://x.com/ok')
    expect(r.urls).not.toContain('https://x.com/admin/x')
  })
  it('prioritizeShallowFrontier fetches shallower novel hubs first under a fetch cap', async () => {
    const deps = graph2({
      'https://x.com/': ['https://x.com/deep/a/b', 'https://x.com/hub'],
      'https://x.com/hub': ['https://x.com/hubchild'], 'https://x.com/deep/a/b': ['https://x.com/deepchild'],
    })
    const r = await hc2([{ url: 'https://x.com/', source: 'rendered' }], 'x.com', B({ maxFetches: 2, concurrency: 1 }), deps, { disallow: [], allow: [] }, { linkedSource: 'rendered-linked', prioritizeShallowFrontier: true })
    expect(r.urls).toContain('https://x.com/hubchild')     // /hub was fetched (shallower)
    expect(r.urls).not.toContain('https://x.com/deepchild')// /deep/a/b was not
  })
})

describe('admissibleLink', () => {
  const robots = { disallow: ['/admin/'], allow: [] }
  it('accepts a same-host content page', () => {
    expect(admissibleLink('https://x.com/programs', 'x.com', robots, 12)).toBe(true)
  })
  it('rejects off-host, non-page, over-segment, and Disallow-ed', () => {
    expect(admissibleLink('https://evil.com/a', 'x.com', robots, 12)).toBe(false)
    expect(admissibleLink('https://x.com/a.pdf', 'x.com', robots, 12)).toBe(false)
    expect(admissibleLink('https://x.com/a/b/c/d', 'x.com', robots, 3)).toBe(false)
    expect(admissibleLink('https://x.com/admin/secret', 'x.com', robots, 12)).toBe(false)
  })
})

const R = (urls: string[], sources: Record<string, string>): CrawlResult => ({
  urls, sources: sources as never, sitemapCount: 0, addedByCrawl: 0, fetches: 0, stoppedBy: 'exhausted',
})

describe('mergeCrawlResults', () => {
  it('unions novel rendered URLs after raw, preserving raw order', () => {
    const raw = R(['https://x.com/a'], { 'https://x.com/a': 'sitemap' })
    const rendered = R(['https://x.com/b'], { 'https://x.com/b': 'rendered-linked' })
    const m = mergeCrawlResults(raw, rendered, 1000)
    expect(m.urls).toEqual(['https://x.com/a', 'https://x.com/b'])
    expect(m.sources['https://x.com/b']).toBe('rendered-linked')
  })
  it('dedups by coverage key and keeps the raw fetch URL + higher-precedence label', () => {
    const raw = R(['https://x.com/a'], { 'https://x.com/a': 'linked' })
    const rendered = R(['https://x.com/a/'], { 'https://x.com/a': 'rendered' }) // same coverage key
    const m = mergeCrawlResults(raw, rendered, 1000)
    expect(m.urls).toEqual(['https://x.com/a'])       // raw fetch URL kept
    expect(m.sources['https://x.com/a']).toBe('rendered') // rendered(2) > linked(1) ⇒ upgraded label
  })
  it('slices the merged set to hardCap and prunes orphaned sources', () => {
    const raw = R(['https://x.com/a', 'https://x.com/b'], { 'https://x.com/a': 'sitemap', 'https://x.com/b': 'sitemap' })
    const rendered = R(['https://x.com/c'], { 'https://x.com/c': 'rendered-linked' })
    const m = mergeCrawlResults(raw, rendered, 2)
    expect(m.urls).toEqual(['https://x.com/a', 'https://x.com/b'])
    expect(m.sources['https://x.com/c']).toBeUndefined() // pruned — not in the sliced set
  })
})

// L3 (2026-07-20): regression guards proving bounds are honored at the raised
// magnitudes (maxAdded 600 / maxFetches 800). Green characterization guards —
// bounds are parameters, so behavior is already correct; Task 1's default change
// is the actual red→green. These catch any hidden fixed-size assumption.
describe('hybridCrawl L3 magnitude guards', () => {
  it('stops at maxAdded at the L3 magnitude (600), wide frontier', async () => {
    const children = Array.from({ length: 800 }, (_, i) => `https://x.com/p${i}`)
    const g: Record<string, string[]> = { 'https://x.com/': children }
    for (const c of children) g[c] = []
    const r = await hybridCrawl(
      [{ url: 'https://x.com/', source: 'sitemap' }], HOST,
      B({ maxAdded: 600, maxFetches: 5000, hardCap: 5000 }), graph(g), { disallow: [], allow: [] },
    )
    expect(r.addedByCrawl).toBe(600)
    expect(r.stoppedBy).toBe('maxAdded')
  })

  it('stops at maxFetches at the L3 magnitude (800), wide frontier', async () => {
    // WIDE star (not a chain — a chain would be a no-concurrency 800-wave case):
    // seed links to 1000 leaves so bounded concurrency processes real waves.
    const children = Array.from({ length: 1000 }, (_, i) => `https://x.com/p${i}`)
    const g: Record<string, string[]> = { 'https://x.com/': children }
    for (const c of children) g[c] = []
    const r = await hybridCrawl(
      [{ url: 'https://x.com/', source: 'sitemap' }], HOST,
      B({ maxFetches: 800, maxAdded: 5000, hardCap: 5000, concurrency: 6 }), graph(g), { disallow: [], allow: [] },
    )
    // Boundary guard: strictly past the OLD 400 cap (proves the raise took
    // effect) and never over the new 800 cap.
    expect(r.fetches).toBeGreaterThan(400)
    expect(r.fetches).toBeLessThanOrEqual(800)
    expect(r.stoppedBy).toBe('maxFetches')
  })
})
