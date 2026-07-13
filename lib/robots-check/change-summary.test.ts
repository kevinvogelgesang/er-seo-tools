// lib/robots-check/change-summary.test.ts
//
// D5 pure change-summary tests. The completeness invariant (Codex #4) is the
// load-bearing suite: whenever D4 alert evidence differs, at least one
// summary field explains it.
import { describe, it, expect } from 'vitest'
import type { RobotsCheckDetail } from './types'
import { ROBOTS_DIFF_MAX_LINES, ROBOTS_DIFF_MAX_LINE_CHARS } from './types'
import { buildChangeSummary, type RobotsChangeSide } from './change-summary'

function detailFixture(overrides: {
  robotsStatus?: 'ok' | 'missing' | 'unreachable'
  robotsHash?: string | null
  blockedBots?: string[]
  sitemaps?: Array<{ url: string; contentHash: string | null; childrenHash: string | null; urlCount?: number | null }>
  sitemapUrlTotal?: number | null
  errors?: number
  warnings?: number
} = {}): RobotsCheckDetail {
  const sitemaps = (overrides.sitemaps ?? [{ url: 'https://x.com/s.xml', contentHash: 'h1', childrenHash: null }]).map((s) => ({
    url: s.url, source: 'robots' as const, ok: s.contentHash !== null,
    httpStatus: 200, failure: null, isIndex: s.childrenHash !== null,
    urlCount: s.urlCount === undefined ? 3 : s.urlCount, childrenTotal: 0, childrenExcluded: 0,
    childrenFailed: 0, childrenSkipped: 0, contentHash: s.contentHash,
    children: [], childrenHash: s.childrenHash, issues: [],
  }))
  return {
    v: 1, domain: 'x.com',
    robots: {
      status: overrides.robotsStatus ?? 'ok', httpStatus: 200, failure: null,
      contentHash: overrides.robotsHash === undefined ? 'rh1' : overrides.robotsHash,
      issues: [], blockedBots: overrides.blockedBots ?? [], sitemapUrls: [],
    },
    sitemaps, sitemapsSkipped: 0, timeBudgetExhausted: false,
    totals: {
      sitemapUrlTotal: overrides.sitemapUrlTotal === undefined ? 3 : overrides.sitemapUrlTotal,
      errors: overrides.errors ?? 0, warnings: overrides.warnings ?? 0,
    },
  }
}

function side(detail: RobotsCheckDetail, robotsContent: string | null = null): RobotsChangeSide {
  return { detail, robotsContent }
}

/** D4 evidence string — mirrors service.ts evidenceOf (order-sensitive). */
function evidence(s: RobotsChangeSide): string {
  return JSON.stringify([
    s.detail.robots.status,
    s.detail.robots.contentHash,
    s.detail.sitemaps.map((m) => [m.url, m.contentHash, m.childrenHash]),
  ])
}

function hasExplanation(sum: ReturnType<typeof buildChangeSummary>): boolean {
  return (
    sum.robotsStatus !== null || sum.robotsContentChanged ||
    sum.robotsDiff !== null || sum.blockedBots !== null || sum.sitemaps !== null
  )
}

describe('buildChangeSummary', () => {
  it('identical sides -> everything null/false', () => {
    const d = detailFixture()
    const sum = buildChangeSummary(side(d, 'User-agent: *'), side(detailFixture(), 'User-agent: *'))
    expect(sum.robotsStatus).toBeNull()
    expect(sum.robotsContentChanged).toBe(false)
    expect(sum.robotsDiff).toBeNull()
    expect(sum.blockedBots).toBeNull()
    expect(sum.sitemaps).toBeNull()
    expect(sum.sitemapUrlTotal).toBeNull()
    expect(sum.counts).toBeNull()
  })

  it('robots line add/remove shows in the diff', () => {
    const prev = side(detailFixture({ robotsHash: 'a' }), 'User-agent: *\nAllow: /')
    const curr = side(detailFixture({ robotsHash: 'b' }), 'User-agent: *\nDisallow: /admin')
    const sum = buildChangeSummary(prev, curr)
    expect(sum.robotsContentChanged).toBe(true)
    expect(sum.robotsDiff!.added).toEqual(['Disallow: /admin'])
    expect(sum.robotsDiff!.removed).toEqual(['Allow: /'])
    expect(sum.robotsDiff!.truncated).toBe(false)
  })

  it('reorder-only robots change -> robotsContentChanged true with empty diff (Codex #4)', () => {
    const prev = side(detailFixture({ robotsHash: 'a' }), 'A: 1\nB: 2')
    const curr = side(detailFixture({ robotsHash: 'b' }), 'B: 2\nA: 1')
    const sum = buildChangeSummary(prev, curr)
    expect(sum.robotsContentChanged).toBe(true)
    expect(sum.robotsDiff!.added).toEqual([])
    expect(sum.robotsDiff!.removed).toEqual([])
  })

  it('caps the diff and flags truncation', () => {
    const prevBody = Array.from({ length: 10 }, (_, i) => `Old: ${i}`).join('\n')
    const currBody = Array.from({ length: ROBOTS_DIFF_MAX_LINES + 10 }, (_, i) => `New: ${i}`).join('\n')
    const sum = buildChangeSummary(
      side(detailFixture({ robotsHash: 'a' }), prevBody),
      side(detailFixture({ robotsHash: 'b' }), currBody),
    )
    expect(sum.robotsDiff!.added).toHaveLength(ROBOTS_DIFF_MAX_LINES)
    expect(sum.robotsDiff!.truncated).toBe(true)
  })

  it('caps overlong lines by characters and flags truncation (plan-Codex #5)', () => {
    const long = `Disallow: /${'a'.repeat(1000)}`
    const sum = buildChangeSummary(
      side(detailFixture({ robotsHash: 'a' }), 'User-agent: *'),
      side(detailFixture({ robotsHash: 'b' }), `User-agent: *\n${long}`),
    )
    expect(sum.robotsDiff!.added[0]).toHaveLength(ROBOTS_DIFF_MAX_LINE_CHARS)
    expect(sum.robotsDiff!.truncated).toBe(true)
  })

  it('null body on either side -> no diff, but the flag still fires', () => {
    const sum = buildChangeSummary(
      side(detailFixture({ robotsHash: 'a' }), null),
      side(detailFixture({ robotsHash: 'b' }), 'User-agent: *'),
    )
    expect(sum.robotsContentChanged).toBe(true)
    expect(sum.robotsDiff).toBeNull()
  })

  it('sitemap add/remove/changed distinguishes content vs children hashes', () => {
    const prev = side(detailFixture({ sitemaps: [
      { url: 'https://x.com/a.xml', contentHash: 'h1', childrenHash: null },
      { url: 'https://x.com/gone.xml', contentHash: 'h2', childrenHash: null },
      { url: 'https://x.com/idx.xml', contentHash: 'same', childrenHash: 'kids1' },
    ] }))
    const curr = side(detailFixture({ sitemaps: [
      { url: 'https://x.com/a.xml', contentHash: 'h1-new', childrenHash: null, urlCount: 9 },
      { url: 'https://x.com/new.xml', contentHash: 'h3', childrenHash: null },
      { url: 'https://x.com/idx.xml', contentHash: 'same', childrenHash: 'kids2' },
    ] }))
    const sum = buildChangeSummary(prev, curr)
    expect(sum.sitemaps!.added).toEqual(['https://x.com/new.xml'])
    expect(sum.sitemaps!.removed).toEqual(['https://x.com/gone.xml'])
    expect(sum.sitemaps!.changed).toEqual([
      { url: 'https://x.com/a.xml', urlCountPrev: 3, urlCountCurr: 9, childrenChanged: false },
      { url: 'https://x.com/idx.xml', urlCountPrev: 3, urlCountCurr: 3, childrenChanged: true },
    ])
    expect(sum.sitemaps!.orderChanged).toBe(false)
  })

  it('sitemap reorder-only -> orderChanged true, nothing else (Codex #4)', () => {
    const a = { url: 'https://x.com/a.xml', contentHash: 'h1', childrenHash: null }
    const b = { url: 'https://x.com/b.xml', contentHash: 'h2', childrenHash: null }
    const sum = buildChangeSummary(
      side(detailFixture({ sitemaps: [a, b] })),
      side(detailFixture({ sitemaps: [b, a] })),
    )
    expect(sum.sitemaps).toEqual({ added: [], removed: [], changed: [], orderChanged: true })
  })

  it('duplicate sitemap URLs pair by ordinal, never collapse (Codex #4)', () => {
    const sum = buildChangeSummary(
      side(detailFixture({ sitemaps: [
        { url: 'https://x.com/d.xml', contentHash: 'h1', childrenHash: null },
        { url: 'https://x.com/d.xml', contentHash: 'h2', childrenHash: null },
      ] })),
      side(detailFixture({ sitemaps: [
        { url: 'https://x.com/d.xml', contentHash: 'h1', childrenHash: null },
        { url: 'https://x.com/d.xml', contentHash: 'h2-new', childrenHash: null },
      ] })),
    )
    expect(sum.sitemaps!.changed).toHaveLength(1)
    expect(sum.sitemaps!.added).toEqual([])
  })

  it('blockedBots and counts deltas', () => {
    const sum = buildChangeSummary(
      side(detailFixture({ blockedBots: ['GPTBot'], errors: 1, warnings: 0, sitemapUrlTotal: 10 })),
      side(detailFixture({ blockedBots: ['ClaudeBot'], errors: 3, warnings: 1, sitemapUrlTotal: 4 })),
    )
    expect(sum.blockedBots).toEqual({ added: ['ClaudeBot'], removed: ['GPTBot'] })
    expect(sum.counts).toEqual({ errorsPrev: 1, errorsCurr: 3, warningsPrev: 0, warningsCurr: 1 })
    expect(sum.sitemapUrlTotal).toEqual({ prev: 10, curr: 4 })
  })

  it('completeness invariant: evidence differs => at least one explanatory field (Codex #4)', () => {
    const base = side(detailFixture(), 'U: *')
    const variants: RobotsChangeSide[] = [
      side(detailFixture({ robotsStatus: 'unreachable', robotsHash: null }), null),
      side(detailFixture({ robotsHash: 'other' }), 'U: *\nX: 1'),
      side(detailFixture({ sitemaps: [{ url: 'https://x.com/s.xml', contentHash: 'h9', childrenHash: null }] }), 'U: *'),
      side(detailFixture({ sitemaps: [
        { url: 'https://x.com/s.xml', contentHash: 'h1', childrenHash: null },
        { url: 'https://x.com/t.xml', contentHash: 'h1', childrenHash: null },
      ] }), 'U: *'),
      side(detailFixture({ sitemaps: [{ url: 'https://x.com/s.xml', contentHash: 'h1', childrenHash: 'kids' }] }), 'U: *'),
    ]
    for (const v of variants) {
      expect(evidence(base)).not.toBe(evidence(v))
      expect(hasExplanation(buildChangeSummary(base, v)), JSON.stringify(v.detail.robots)).toBe(true)
    }
  })
})
