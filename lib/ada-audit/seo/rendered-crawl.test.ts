// lib/ada-audit/seo/rendered-crawl.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../security/safe-url', () => ({ assertSafeHttpUrl: vi.fn() }))
import { fetchPageLinksViaBrowser, buildProbeTargets, type RenderedFetchDeps } from './rendered-crawl'
import { assertSafeHttpUrl } from '../../security/safe-url'

function fakePage(finalUrl: string, hrefs: string[]) {
  return {
    setDefaultNavigationTimeout: vi.fn(),
    setRequestInterception: vi.fn(async () => undefined),
    on: vi.fn(),
    mainFrame: () => ({}),
    goto: vi.fn(async () => ({ ok: () => true })),
    url: () => finalUrl,
    waitForNetworkIdle: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => hrefs),
  }
}
const deps = (page: unknown, over: Partial<RenderedFetchDeps> = {}): RenderedFetchDeps => ({
  acquirePage: vi.fn(async () => page as never),
  releasePage: vi.fn(async () => undefined),
  now: () => 0,
  ...over,
})

describe('fetchPageLinksViaBrowser', () => {
  it('returns rendered links + finalUrl on the happy path', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined as never)
    const page = fakePage('https://x.com/', ['https://x.com/a', 'https://x.com/b'])
    const d = deps(page)
    const r = await fetchPageLinksViaBrowser('https://x.com/', 'x.com', 60_000, d)
    expect(r).toEqual({ links: ['https://x.com/a', 'https://x.com/b'], finalUrl: 'https://x.com/' })
    expect(d.releasePage).toHaveBeenCalledTimes(1)
  })

  it('returns null and acquires no page when the SSRF check fails', async () => {
    vi.mocked(assertSafeHttpUrl).mockRejectedValue(new Error('blocked'))
    const d = deps(fakePage('https://x.com/', []))
    expect(await fetchPageLinksViaBrowser('https://x.com/', 'x.com', 60_000, d)).toBeNull()
    expect(d.acquirePage).not.toHaveBeenCalled()
  })

  it('returns null when the final URL left the audited host (off-domain redirect)', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined as never)
    const d = deps(fakePage('https://evil.com/', ['https://evil.com/a']))
    const r = await fetchPageLinksViaBrowser('https://x.com/', 'x.com', 60_000, d)
    expect(r).toBeNull()
    expect(d.releasePage).toHaveBeenCalledTimes(1) // still released
  })

  it('returns null when the deadline already passed (acquires nothing)', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined as never)
    const d = deps(fakePage('https://x.com/', []), { now: () => 100 })
    expect(await fetchPageLinksViaBrowser('https://x.com/', 'x.com', 100, d)).toBeNull()
    expect(d.acquirePage).not.toHaveBeenCalled()
  })

  it('returns null and releases the page when page.evaluate exceeds the deadline (Codex F1)', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined as never)
    const page = fakePage('https://x.com/', [])
    page.evaluate = vi.fn(() => new Promise(() => {})) as never // never resolves → must be bounded by the deadline
    const d = deps(page) // now() === 0
    const r = await fetchPageLinksViaBrowser('https://x.com/', 'x.com', 40, d) // 40ms deadline
    expect(r).toBeNull()
    expect(d.releasePage).toHaveBeenCalledTimes(1)
  })

  it('caps returned anchors at HYBRID_RENDER_MAX_ANCHORS_PER_PAGE', async () => {
    process.env.HYBRID_RENDER_MAX_ANCHORS_PER_PAGE = '2'
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined as never)
    const page = fakePage('https://x.com/', [])
    // the cap is applied in-page (slice before map); the fake evaluate honors it
    page.evaluate = vi.fn(async (code: string) => {
      const m = /slice\(0, (\d+)\)/.exec(code); const cap = m ? Number(m[1]) : 9999
      return ['https://x.com/a', 'https://x.com/b', 'https://x.com/c'].slice(0, cap)
    }) as never
    const r = await fetchPageLinksViaBrowser('https://x.com/', 'x.com', 60_000, deps(page))
    expect(r?.links).toHaveLength(2)
    delete process.env.HYBRID_RENDER_MAX_ANCHORS_PER_PAGE
  })
})

describe('buildProbeTargets', () => {
  it('is homepage + up to maxHubs shallowest known hubs, deduped', () => {
    const known = ['https://x.com/', 'https://x.com/deep/a/b', 'https://x.com/hub', 'https://x.com/hub2']
    expect(buildProbeTargets('x.com', known, 2)).toEqual(['https://x.com/', 'https://x.com/hub', 'https://x.com/hub2'])
  })
  it('is just the homepage when no other known hubs exist', () => {
    expect(buildProbeTargets('x.com', ['https://x.com/'], 2)).toEqual(['https://x.com/'])
  })
})
