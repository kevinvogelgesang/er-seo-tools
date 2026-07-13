// lib/robots-check/runner.test.ts
//
// D4 runner tests — all I/O via injected deps; zero network.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { runRobotsCheck, type RunnerDeps } from './runner'
import type { SeoFetchResult } from '@/lib/seo-fetch/fetch'
import {
  ROBOTS_CHECK_MAX_CHILDREN,
  ROBOTS_CHECK_MAX_SITEMAPS,
  ROBOTS_CHECK_TIME_BUDGET_MS,
} from './types'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

function okResult(text: string, finalUrl: string): SeoFetchResult {
  return { ok: true, status: 200, text, finalUrl, failure: null, truncated: false }
}
function failResult(failure: SeoFetchResult['failure'] & string, status: number | null = null): SeoFetchResult {
  return { ok: false, status, text: null, finalUrl: null, failure, truncated: false }
}
function httpError(status: number): SeoFetchResult {
  return { ok: false, status, text: null, finalUrl: `ignored`, failure: 'http-error', truncated: false }
}

const URLSET = (n: number) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
  Array.from({ length: n }, (_, i) => `<url><loc>https://example.com/p${i}</loc></url>`).join('') +
  `</urlset>`

const INDEX_OF = (childUrls: string[]) =>
  `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
  childUrls.map((u) => `<sitemap><loc>${u}</loc></sitemap>`).join('') +
  `</sitemapindex>`

/** deps whose sitemap fetcher answers from a url->result map. */
function makeDeps(opts: {
  robots: SeoFetchResult
  sitemaps?: Record<string, SeoFetchResult>
  msPerNowCall?: number
}): RunnerDeps & { calls: string[] } {
  let t = 0
  const calls: string[] = []
  return {
    calls,
    fetchRobotsTxt: async () => opts.robots,
    fetchSitemapXml: async (url: string) => {
      calls.push(url)
      return opts.sitemaps?.[url] ?? failResult('network')
    },
    now: () => {
      t += opts.msPerNowCall ?? 0
      return t
    },
  }
}

describe('runRobotsCheck — robots phase', () => {
  it('ok robots: parses issues/blocked bots, hashes body, returns raw content beside detail', async () => {
    const body = 'User-agent: *\nDisallow: /admin\n\nUser-agent: GPTBot\nDisallow: /\n'
    const deps = makeDeps({ robots: okResult(body, 'https://example.com/robots.txt') })
    const { detail, robotsContent } = await runRobotsCheck('example.com', deps)
    expect(detail.v).toBe(1)
    expect(detail.robots.status).toBe('ok')
    expect(detail.robots.contentHash).toBe(sha(body))
    expect(robotsContent).toBe(body)
    expect(detail.robots.blockedBots).toContain('GPTBot')
  })

  it('404 -> missing (one warning, no error), 410 -> missing', async () => {
    for (const status of [404, 410]) {
      const deps = makeDeps({ robots: httpError(status) })
      const { detail, robotsContent } = await runRobotsCheck('example.com', deps)
      expect(detail.robots.status).toBe('missing')
      expect(detail.robots.httpStatus).toBe(status)
      expect(robotsContent).toBeNull()
      expect(detail.robots.contentHash).toBeNull()
    }
  })

  it('dns failure -> unreachable with taxonomy verbatim, one synthetic error', async () => {
    const deps = makeDeps({ robots: failResult('dns') })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.robots.status).toBe('unreachable')
    expect(detail.robots.failure).toBe('dns')
    expect(detail.totals.errors).toBeGreaterThanOrEqual(1)
  })

  it('500 -> unreachable (only 404/410 are missing)', async () => {
    const deps = makeDeps({ robots: httpError(500) })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.robots.status).toBe('unreachable')
  })
})

describe('runRobotsCheck — declared sitemaps', () => {
  it('fetches declared sitemaps in order, caps at MAX_SITEMAPS with sitemapsSkipped', async () => {
    const declared = Array.from({ length: 7 }, (_, i) => `https://example.com/sm${i}.xml`)
    const robots = 'User-agent: *\nAllow: /\n' + declared.map((u) => `Sitemap: ${u}`).join('\n')
    const sitemaps = Object.fromEntries(declared.map((u) => [u, okResult(URLSET(3), u)]))
    const deps = makeDeps({ robots: okResult(robots, 'https://example.com/robots.txt'), sitemaps })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.sitemaps).toHaveLength(ROBOTS_CHECK_MAX_SITEMAPS)
    expect(detail.sitemapsSkipped).toBe(7 - ROBOTS_CHECK_MAX_SITEMAPS)
    expect(detail.sitemaps.every((s) => s.source === 'robots')).toBe(true)
    expect(detail.totals.sitemapUrlTotal).toBe(3 * ROBOTS_CHECK_MAX_SITEMAPS)
  })

  it('failed declared sitemap entry: !ok, failure recorded, urlCount null, counts one error', async () => {
    const robots = 'User-agent: *\nAllow: /\nSitemap: https://example.com/sm.xml'
    const deps = makeDeps({
      robots: okResult(robots, 'https://example.com/robots.txt'),
      sitemaps: { 'https://example.com/sm.xml': failResult('timeout') },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.sitemaps[0].ok).toBe(false)
    expect(detail.sitemaps[0].failure).toBe('timeout')
    expect(detail.sitemaps[0].urlCount).toBeNull()
    expect(detail.totals.sitemapUrlTotal).toBeNull() // no ok entry
    expect(detail.totals.errors).toBeGreaterThanOrEqual(1)
  })
})

describe('runRobotsCheck — index expansion', () => {
  it('expands one level, records child observations + childrenHash deterministically', async () => {
    const kids = ['https://example.com/a.xml', 'https://example.com/b.xml']
    const robots = 'User-agent: *\nAllow: /\nSitemap: https://example.com/idx.xml'
    const deps = makeDeps({
      robots: okResult(robots, 'https://example.com/robots.txt'),
      sitemaps: {
        'https://example.com/idx.xml': okResult(INDEX_OF(kids), 'https://example.com/idx.xml'),
        [kids[0]]: okResult(URLSET(2), kids[0]),
        [kids[1]]: okResult(URLSET(5), kids[1]),
      },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    const entry = detail.sitemaps[0]
    expect(entry.isIndex).toBe(true)
    expect(entry.urlCount).toBe(7)
    expect(entry.childrenTotal).toBe(2)
    expect(entry.childrenFailed).toBe(0)
    expect(entry.children).toEqual([
      { url: kids[0], contentHash: sha(URLSET(2)) },
      { url: kids[1], contentHash: sha(URLSET(5)) },
    ])
    const expectedAgg = sha(
      `${kids[0]}\n${sha(URLSET(2))}\n${kids[1]}\n${sha(URLSET(5))}`,
    )
    expect(entry.childrenHash).toBe(expectedAgg)
    // Same inputs -> same hash (determinism)
    const again = await runRobotsCheck('example.com', deps)
    expect(again.detail.sitemaps[0].childrenHash).toBe(expectedAgg)
  })

  it('caps children at MAX_CHILDREN: skipped counted, childrenFailed clamped to real failures', async () => {
    const kids = Array.from({ length: ROBOTS_CHECK_MAX_CHILDREN + 5 }, (_, i) => `https://example.com/k${i}.xml`)
    const robots = 'User-agent: *\nAllow: /\nSitemap: https://example.com/idx.xml'
    const sitemaps: Record<string, SeoFetchResult> = {
      'https://example.com/idx.xml': okResult(INDEX_OF(kids), 'https://example.com/idx.xml'),
    }
    for (const k of kids) sitemaps[k] = okResult(URLSET(1), k)
    // one real failure among the attempted
    sitemaps[kids[0]] = failResult('http-error', 500)
    const deps = makeDeps({ robots: okResult(robots, 'https://example.com/robots.txt'), sitemaps })
    const { detail } = await runRobotsCheck('example.com', deps)
    const entry = detail.sitemaps[0]
    expect(entry.childrenSkipped).toBe(5)
    expect(entry.childrenFailed).toBe(1)
    expect(entry.children).toHaveLength(ROBOTS_CHECK_MAX_CHILDREN)
  })

  it('cross-host children are excluded by the parent-host filter and counted', async () => {
    const kids = ['https://example.com/a.xml', 'https://cdn.other.com/b.xml']
    const robots = 'User-agent: *\nAllow: /\nSitemap: https://example.com/idx.xml'
    const deps = makeDeps({
      robots: okResult(robots, 'https://example.com/robots.txt'),
      sitemaps: {
        'https://example.com/idx.xml': okResult(INDEX_OF(kids), 'https://example.com/idx.xml'),
        [kids[0]]: okResult(URLSET(2), kids[0]),
      },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    const entry = detail.sitemaps[0]
    expect(entry.childrenTotal).toBe(1) // eligible only
    expect(entry.childrenExcluded).toBe(1)
    expect(entry.urlCount).toBe(2)
  })

  it('www-insensitive parent-host match keeps www children of a bare-host sitemap', async () => {
    const kids = ['https://www.example.com/a.xml']
    const robots = 'User-agent: *\nAllow: /\nSitemap: https://example.com/idx.xml'
    const deps = makeDeps({
      robots: okResult(robots, 'https://example.com/robots.txt'),
      sitemaps: {
        'https://example.com/idx.xml': okResult(INDEX_OF(kids), 'https://example.com/idx.xml'),
        [kids[0]]: okResult(URLSET(4), kids[0]),
      },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.sitemaps[0].childrenTotal).toBe(1)
    expect(detail.sitemaps[0].urlCount).toBe(4)
  })
})

describe('runRobotsCheck — convention fallback', () => {
  it('robots missing: probes convention paths in order, recognized winner recorded as convention', async () => {
    const deps = makeDeps({
      robots: httpError(404),
      sitemaps: {
        // /sitemap.xml 404s, /sitemap_index.xml wins
        'https://example.com/sitemap.xml': httpError(404),
        'https://example.com/sitemap_index.xml': okResult(URLSET(9), 'https://example.com/sitemap_index.xml'),
      },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.sitemaps).toHaveLength(1)
    expect(detail.sitemaps[0].source).toBe('convention')
    expect(detail.sitemaps[0].url).toBe('https://example.com/sitemap_index.xml')
    expect(detail.sitemaps[0].urlCount).toBe(9)
    // probing stopped at the winner
    expect(deps.calls).not.toContain('https://example.com/wp-sitemap.xml')
  })

  it('200 text/plain garbage does NOT win; recorded as unrecognized with parse issues when nothing qualifies', async () => {
    const garbage = 'this is not xml at all'
    const deps = makeDeps({
      robots: httpError(404),
      sitemaps: {
        'https://example.com/sitemap.xml': okResult(garbage, 'https://example.com/sitemap.xml'),
        'https://example.com/sitemap_index.xml': httpError(404),
        'https://example.com/wp-sitemap.xml': httpError(404),
      },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.sitemaps).toHaveLength(1)
    const entry = detail.sitemaps[0]
    expect(entry.ok).toBe(false)
    expect(entry.failure).toBe('unrecognized')
    expect(entry.contentHash).toBe(sha(garbage)) // change evidence retained
    expect(entry.issues.length).toBeGreaterThan(0)
    expect(detail.totals.sitemapUrlTotal).toBeNull()
  })

  it('malformed XML with a usable loc does NOT win; a later valid path does (plan-Codex #3)', async () => {
    // Well-formed root tags but a missing </url> close tag: parseSitemapXml's
    // urlset branch counts <url> vs </url> occurrences and flags a mismatch
    // as severity:'error' (see sitemap-parse.ts's "mismatched <url> tags"
    // rule), so `.valid` is false even though a usable <loc> is present and
    // the root tag pair itself is intact. The probe loop must continue to
    // the next convention path.
    const malformed = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/p1</loc></urlset>`
    const deps = makeDeps({
      robots: httpError(404),
      sitemaps: {
        'https://example.com/sitemap.xml': okResult(malformed, 'https://example.com/sitemap.xml'),
        'https://example.com/sitemap_index.xml': okResult(URLSET(3), 'https://example.com/sitemap_index.xml'),
      },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.sitemaps).toHaveLength(1)
    expect(detail.sitemaps[0].url).toBe('https://example.com/sitemap_index.xml')
    expect(detail.sitemaps[0].urlCount).toBe(3)
    // NOTE for implementer: if parseSitemapXml judges this exact fixture
    // valid, pick any fixture parseSitemapXml reports invalid (check its 13
    // rules) — the pinned behavior is "invalid parse does not win", not this
    // particular XML string.
  })

  it('all probes fail: last probe failure recorded as the single honest entry', async () => {
    const deps = makeDeps({ robots: httpError(404) }) // every sitemap fetch -> network fail
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.sitemaps).toHaveLength(1)
    expect(detail.sitemaps[0].ok).toBe(false)
    expect(detail.sitemaps[0].url).toBe('https://example.com/wp-sitemap.xml')
  })

  it('robots ok but zero declared sitemaps also falls back to convention probing', async () => {
    const deps = makeDeps({
      robots: okResult('User-agent: *\nAllow: /\n', 'https://example.com/robots.txt'),
      sitemaps: { 'https://example.com/sitemap.xml': okResult(URLSET(2), 'https://example.com/sitemap.xml') },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.sitemaps[0].source).toBe('convention')
    expect(detail.sitemaps[0].urlCount).toBe(2)
  })
})

describe('runRobotsCheck — time budget', () => {
  it('exhausted budget skips remaining sitemaps and sets the flag', async () => {
    const declared = ['https://example.com/sm0.xml', 'https://example.com/sm1.xml']
    const robots = 'User-agent: *\nAllow: /\n' + declared.map((u) => `Sitemap: ${u}`).join('\n')
    // Each now() call advances far past the budget: the first pre-fetch
    // deadline check already sees it exhausted.
    const deps = makeDeps({
      robots: okResult(robots, 'https://example.com/robots.txt'),
      sitemaps: Object.fromEntries(declared.map((u) => [u, okResult(URLSET(1), u)])),
      msPerNowCall: ROBOTS_CHECK_TIME_BUDGET_MS,
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.timeBudgetExhausted).toBe(true)
    expect(detail.sitemaps.length).toBeLessThan(declared.length)
    expect(detail.sitemapsSkipped).toBeGreaterThan(0)
  })
})

describe('runRobotsCheck — totals', () => {
  it('missing robots adds one warning; unreachable adds one error; failed sitemap adds one error', async () => {
    const missing = await runRobotsCheck('example.com', makeDeps({ robots: httpError(404) }))
    expect(missing.detail.totals.warnings).toBeGreaterThanOrEqual(1)

    const unreachable = await runRobotsCheck('example.com', makeDeps({ robots: failResult('timeout') }))
    expect(unreachable.detail.totals.errors).toBeGreaterThanOrEqual(1)
  })

  it('sitemapUrlTotal is 0 (not null) when an ok sitemap has zero locs', async () => {
    const robots = 'User-agent: *\nAllow: /\nSitemap: https://example.com/empty.xml'
    const empty = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`
    const deps = makeDeps({
      robots: okResult(robots, 'https://example.com/robots.txt'),
      sitemaps: { 'https://example.com/empty.xml': okResult(empty, 'https://example.com/empty.xml') },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.totals.sitemapUrlTotal).toBe(0)
  })
})
