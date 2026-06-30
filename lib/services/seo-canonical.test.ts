// lib/services/seo-canonical.test.ts
import { describe, it, expect } from 'vitest'
import { pickCanonicalSeo, SEO_SF_CANONICAL_WINDOW_DAYS } from './seo-canonical'
import type { SeoRunRef } from './seo-canonical'

const NOW = new Date('2026-06-30T12:00:00Z').getTime()
const DAY = 86_400_000

function makeRun(overrides: Partial<SeoRunRef> & { source: string }): SeoRunRef {
  return {
    id: 'run-1',
    source: overrides.source,
    seoIntent: overrides.seoIntent ?? false,
    domain: overrides.domain ?? 'example.com',
    completedAt: overrides.completedAt !== undefined ? overrides.completedAt : new Date(NOW - DAY),
    createdAt: new Date(NOW - DAY),
    sessionId: overrides.sessionId ?? null,
    siteAuditId: overrides.siteAuditId ?? null,
    ...overrides,
  }
}

describe('pickCanonicalSeo', () => {
  it('returns null for empty runs', () => {
    expect(pickCanonicalSeo([], NOW)).toBeNull()
  })

  it('fresh SF wins over newer live-scan', () => {
    // SF completed 5 days ago (fresh, within 30-day window)
    const sfRun = makeRun({ id: 'sf-1', source: 'sf-upload', seoIntent: false, completedAt: new Date(NOW - 5 * DAY) })
    // live-scan completed 1 day ago (newer, but SF is fresh)
    const liveRun = makeRun({ id: 'live-1', source: 'live-scan', seoIntent: true, completedAt: new Date(NOW - 1 * DAY) })
    const result = pickCanonicalSeo([sfRun, liveRun], NOW)
    expect(result).not.toBeNull()
    expect(result!.source).toBe('sf-upload')
    expect(result!.run.id).toBe('sf-1')
  })

  it('stale SF + newer live → returns live-scan', () => {
    // SF completed 35 days ago (stale, outside window)
    const sfRun = makeRun({ id: 'sf-1', source: 'sf-upload', seoIntent: false, completedAt: new Date(NOW - 35 * DAY) })
    // live-scan completed 2 days ago (newer than SF)
    const liveRun = makeRun({ id: 'live-1', source: 'live-scan', seoIntent: true, completedAt: new Date(NOW - 2 * DAY) })
    const result = pickCanonicalSeo([sfRun, liveRun], NOW)
    expect(result).not.toBeNull()
    expect(result!.source).toBe('live-scan')
    expect(result!.run.id).toBe('live-1')
  })

  it('no SF → returns live-scan', () => {
    const liveRun = makeRun({ id: 'live-1', source: 'live-scan', seoIntent: true, completedAt: new Date(NOW - 3 * DAY) })
    const result = pickCanonicalSeo([liveRun], NOW)
    expect(result).not.toBeNull()
    expect(result!.source).toBe('live-scan')
    expect(result!.run.id).toBe('live-1')
  })

  it('stale SF + no live → returns SF', () => {
    // SF is stale but there is no live-scan
    const sfRun = makeRun({ id: 'sf-1', source: 'sf-upload', seoIntent: false, completedAt: new Date(NOW - 40 * DAY) })
    const result = pickCanonicalSeo([sfRun], NOW)
    expect(result).not.toBeNull()
    expect(result!.source).toBe('sf-upload')
    expect(result!.run.id).toBe('sf-1')
  })

  it('live run with seoIntent=false is IGNORED', () => {
    // live-scan run that is NOT seoIntent — should be excluded
    const sfRun = makeRun({ id: 'sf-1', source: 'sf-upload', seoIntent: false, completedAt: new Date(NOW - 35 * DAY) })
    const liveRunIgnored = makeRun({ id: 'live-bad', source: 'live-scan', seoIntent: false, completedAt: new Date(NOW - 1 * DAY) })
    // With stale SF and only a non-seoIntent live, should fall back to SF
    const result = pickCanonicalSeo([sfRun, liveRunIgnored], NOW)
    expect(result).not.toBeNull()
    expect(result!.source).toBe('sf-upload')
    expect(result!.run.id).toBe('sf-1')
  })

  it('live run with seoIntent=false is IGNORED, returning null when SF also absent', () => {
    const liveRunIgnored = makeRun({ id: 'live-bad', source: 'live-scan', seoIntent: false, completedAt: new Date(NOW - 1 * DAY) })
    const result = pickCanonicalSeo([liveRunIgnored], NOW)
    expect(result).toBeNull()
  })

  it('per-domain isolation: multi-domain client picks the right domain run', () => {
    const sfA = makeRun({ id: 'sf-a', source: 'sf-upload', seoIntent: false, domain: 'alpha.com', completedAt: new Date(NOW - 5 * DAY) })
    const sfB = makeRun({ id: 'sf-b', source: 'sf-upload', seoIntent: false, domain: 'beta.com', completedAt: new Date(NOW - 5 * DAY) })
    const liveB = makeRun({ id: 'live-b', source: 'live-scan', seoIntent: true, domain: 'beta.com', completedAt: new Date(NOW - 1 * DAY) })
    // selectCanonicalSeoRun is DB-wrapped; here we test pickCanonicalSeo
    // with a domain filter (simulating what the DB query would return for domain='alpha.com')
    const runsForAlpha = [sfA, sfB, liveB].filter(r => r.domain === 'alpha.com')
    const resultA = pickCanonicalSeo(runsForAlpha, NOW)
    expect(resultA).not.toBeNull()
    expect(resultA!.run.id).toBe('sf-a')
    expect(resultA!.source).toBe('sf-upload')

    // For beta.com: SF is fresh, so SF wins even though live is newer
    const runsForBeta = [sfA, sfB, liveB].filter(r => r.domain === 'beta.com')
    const resultB = pickCanonicalSeo(runsForBeta, NOW)
    expect(resultB).not.toBeNull()
    expect(resultB!.run.id).toBe('sf-b')
    expect(resultB!.source).toBe('sf-upload')
  })

  it('uses custom windowDays override', () => {
    // SF completed 10 days ago; with window=7 it is stale; with window=30 it is fresh
    const sfRun = makeRun({ id: 'sf-1', source: 'sf-upload', seoIntent: false, completedAt: new Date(NOW - 10 * DAY) })
    const liveRun = makeRun({ id: 'live-1', source: 'live-scan', seoIntent: true, completedAt: new Date(NOW - 2 * DAY) })

    // With window=7: SF is stale, live is newer → live wins
    const resultStale = pickCanonicalSeo([sfRun, liveRun], NOW, 7)
    expect(resultStale!.source).toBe('live-scan')

    // With window=30 (default): SF is fresh → SF wins
    const resultFresh = pickCanonicalSeo([sfRun, liveRun], NOW, 30)
    expect(resultFresh!.source).toBe('sf-upload')
  })

  it('SF with null completedAt is treated as stale (Infinity age)', () => {
    // SF with no completedAt (in-progress?) → treated as stale (age=Infinity)
    const sfRun = makeRun({ id: 'sf-1', source: 'sf-upload', seoIntent: false, completedAt: null })
    const liveRun = makeRun({ id: 'live-1', source: 'live-scan', seoIntent: true, completedAt: new Date(NOW - 1 * DAY) })
    const result = pickCanonicalSeo([sfRun, liveRun], NOW)
    expect(result).not.toBeNull()
    // SF is stale; live is newer than SF (null completedAt → time 0)
    expect(result!.source).toBe('live-scan')
  })

  it('picks newest SF when multiple SF runs exist', () => {
    const sfOld = makeRun({ id: 'sf-old', source: 'sf-upload', seoIntent: false, completedAt: new Date(NOW - 10 * DAY) })
    const sfNew = makeRun({ id: 'sf-new', source: 'sf-upload', seoIntent: false, completedAt: new Date(NOW - 2 * DAY) })
    const result = pickCanonicalSeo([sfOld, sfNew], NOW)
    expect(result!.run.id).toBe('sf-new')
    expect(result!.source).toBe('sf-upload')
  })

  it('picks newest qualifying live when multiple live runs exist', () => {
    const sfRun = makeRun({ id: 'sf-1', source: 'sf-upload', seoIntent: false, completedAt: new Date(NOW - 40 * DAY) })
    const liveOld = makeRun({ id: 'live-old', source: 'live-scan', seoIntent: true, completedAt: new Date(NOW - 10 * DAY) })
    const liveNew = makeRun({ id: 'live-new', source: 'live-scan', seoIntent: true, completedAt: new Date(NOW - 2 * DAY) })
    const result = pickCanonicalSeo([sfRun, liveOld, liveNew], NOW)
    // SF is stale; live-new is newer than SF → live-new wins
    expect(result!.run.id).toBe('live-new')
    expect(result!.source).toBe('live-scan')
  })

  it('SEO_SF_CANONICAL_WINDOW_DAYS defaults to 30', () => {
    expect(SEO_SF_CANONICAL_WINDOW_DAYS).toBe(30)
  })
})
