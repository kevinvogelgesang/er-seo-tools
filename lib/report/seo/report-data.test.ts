// lib/report/seo/report-data.test.ts
// TDD tests for buildSeoReportData — pure snapshot → view-model transform.
// Run with: npx vitest run lib/report/seo/report-data.test.ts

import { describe, it, expect } from 'vitest'
import { buildSeoReportData } from './report-data'
import type {
  PerformanceAnalyticsBundle,
  Ga4Bundle,
  GscBundle,
  ProspectsBundle,
} from '@/lib/analytics/types'

// ---------------------------------------------------------------------------
// Helpers for building test fixtures
// ---------------------------------------------------------------------------

const makeGa4Bundle = (overrides: Partial<Ga4Bundle> = {}): Ga4Bundle => ({
  totals: {
    sessions: 1000,
    engagedSessions: 600,
    averageSessionDuration: 125, // 2:05
    eventsPerSession: 4.5,
    bounceRate: 0.4,
    keyEvents: 50,
  },
  comparisonTotals: {
    sessions: 800,
    engagedSessions: 500,
    averageSessionDuration: 100,
    eventsPerSession: 4.0,
    bounceRate: 0.5,
    keyEvents: 40,
  },
  sessionsSeries: [{ date: '2026-05-01', value: 100 }],
  sessionsSeriesPrev: [{ date: '2026-04-01', value: 80 }],
  landingPages: Array.from({ length: 15 }, (_, i) => ({
    path: `/page-${i + 1}`,
    sessions: 100 - i * 5,
    keyEvents: 10 - i,
  })),
  cities: [
    { city: 'Vancouver', sessions: 200, keyEvents: 20 },
    { city: 'Toronto', sessions: 150, keyEvents: 15 },
  ],
  newVsReturning: [
    { label: 'new', sessions: 700 },
    { label: 'returning', sessions: 300 },
  ],
  devices: [
    { label: 'mobile', sessions: 600 },
    { label: 'desktop', sessions: 400 },
  ],
  ...overrides,
})

const makeGscBundle = (overrides: Partial<GscBundle> = {}): GscBundle => ({
  totals: { clicks: 500, impressions: 10000, ctr: 0.05, position: 8.3 },
  comparisonTotals: { clicks: 400, impressions: 8000, ctr: 0.04, position: 9.5 },
  clicksSeries: [{ date: '2026-05-01', value: 50 }],
  clicksSeriesPrev: [{ date: '2026-04-01', value: 40 }],
  impressionsSeries: [{ date: '2026-05-01', value: 1000 }],
  impressionsSeriesPrev: [{ date: '2026-04-01', value: 800 }],
  positionSeries: [{ date: '2026-05-01', value: 8.3 }],
  positionSeriesPrev: [{ date: '2026-04-01', value: 9.5 }],
  queries: Array.from({ length: 25 }, (_, i) => ({
    query: `keyword ${i + 1}`,
    position: 5 + i * 0.5,
    positionPrev: 6 + i * 0.5,
  })),
  ...overrides,
})

const makeProspectsBundle = (overrides: Partial<ProspectsBundle> = {}): ProspectsBundle => ({
  total: 42,
  organic: 20,
  ...overrides,
})

const makeMeta = () => ({
  clientName: 'Acme University',
  domain: 'acme.edu',
  periodLabel: 'May 2026',
  comparisonLabel: 'Apr 2026',
  generatedAt: '2026-06-22T10:00:00Z',
  operator: 'kevin',
})

const makeBundle = (
  ga4Override?: Ga4Bundle | { ok: false; reason: 'error'; message?: string },
  gscOverride?: GscBundle | { ok: false; reason: 'error'; message?: string },
  prospectsOverride?: ProspectsBundle | { ok: false; reason: 'error'; message?: string }
): PerformanceAnalyticsBundle => ({
  period: { start: '2026-05-01', end: '2026-05-31' },
  comparison: { start: '2026-04-01', end: '2026-04-30' },
  ga4:
    ga4Override && 'ok' in ga4Override && ga4Override.ok === false
      ? (ga4Override as { ok: false; reason: 'error'; message?: string })
      : { ok: true, data: (ga4Override as Ga4Bundle) ?? makeGa4Bundle() },
  gsc:
    gscOverride && 'ok' in gscOverride && gscOverride.ok === false
      ? (gscOverride as { ok: false; reason: 'error'; message?: string })
      : { ok: true, data: (gscOverride as GscBundle) ?? makeGscBundle() },
  prospects:
    prospectsOverride && 'ok' in prospectsOverride && prospectsOverride.ok === false
      ? (prospectsOverride as { ok: false; reason: 'error'; message?: string })
      : { ok: true, data: (prospectsOverride as ProspectsBundle) ?? makeProspectsBundle() },
})

// Cleaner helper that avoids the awkward union type
const makeBundleWith = (opts: {
  ga4?: 'ok' | 'fail'
  gsc?: 'ok' | 'fail'
  prospects?: 'ok' | 'fail'
}): PerformanceAnalyticsBundle => ({
  period: { start: '2026-05-01', end: '2026-05-31' },
  comparison: { start: '2026-04-01', end: '2026-04-30' },
  ga4:
    (opts.ga4 ?? 'ok') === 'ok'
      ? { ok: true, data: makeGa4Bundle() }
      : { ok: false, reason: 'error', message: 'GA4 error' },
  gsc:
    (opts.gsc ?? 'ok') === 'ok'
      ? { ok: true, data: makeGscBundle() }
      : { ok: false, reason: 'error', message: 'GSC error' },
  prospects:
    (opts.prospects ?? 'ok') === 'ok'
      ? { ok: true, data: makeProspectsBundle() }
      : { ok: false, reason: 'error', message: 'Prospects error' },
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildSeoReportData — meta passthrough', () => {
  it('carries header meta fields through unchanged', () => {
    const meta = makeMeta()
    const result = buildSeoReportData(makeBundleWith({}), meta)
    expect(result.clientName).toBe('Acme University')
    expect(result.domain).toBe('acme.edu')
    expect(result.periodLabel).toBe('May 2026')
    expect(result.comparisonLabel).toBe('Apr 2026')
    expect(result.generatedAt).toBe('2026-06-22T10:00:00Z')
    expect(result.operator).toBe('kevin')
  })

  it('handles null operator', () => {
    const result = buildSeoReportData(makeBundleWith({}), { ...makeMeta(), operator: null })
    expect(result.operator).toBeNull()
  })
})

describe('buildSeoReportData — delta math', () => {
  it('computes delta as (cur - prev) / prev ratio', () => {
    // sessions: cur=1000, prev=800 → delta = (1000-800)/800 = 0.25
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    const sessionsCard = result.scorecards.find((s) => s.label === 'Sessions')
    expect(sessionsCard).toBeDefined()
    expect(sessionsCard!.delta).toBeCloseTo(0.25, 5)
  })

  it('returns delta=null when prev is 0', () => {
    const ga4 = makeGa4Bundle({
      totals: { sessions: 100, engagedSessions: 50, averageSessionDuration: 60, eventsPerSession: 2, bounceRate: 0.3, keyEvents: 10 },
      comparisonTotals: { sessions: 0, engagedSessions: 0, averageSessionDuration: 0, eventsPerSession: 0, bounceRate: 0, keyEvents: 0 },
    })
    const bundle: PerformanceAnalyticsBundle = {
      period: { start: '2026-05-01', end: '2026-05-31' },
      comparison: { start: '2026-04-01', end: '2026-04-30' },
      ga4: { ok: true, data: ga4 },
      gsc: { ok: true, data: makeGscBundle() },
      prospects: { ok: true, data: makeProspectsBundle() },
    }
    const result = buildSeoReportData(bundle, makeMeta())
    const sessionsCard = result.scorecards.find((s) => s.label === 'Sessions')
    expect(sessionsCard!.delta).toBeNull()
    expect(sessionsCard!.deltaGood).toBeNull()
  })

  it('does not produce Infinity or NaN for any delta', () => {
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    for (const card of result.scorecards) {
      if (card.delta !== null) {
        expect(isFinite(card.delta)).toBe(true)
        expect(isNaN(card.delta)).toBe(false)
      }
    }
  })
})

describe('buildSeoReportData — deltaGood polarity', () => {
  it('deltaGood=true for sessions when delta > 0 (higher is better)', () => {
    // sessions: 1000 vs 800 → +25% → good
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    const sessionsCard = result.scorecards.find((s) => s.label === 'Sessions')
    expect(sessionsCard!.deltaGood).toBe(true)
  })

  it('deltaGood=false for sessions when delta < 0 (higher is better)', () => {
    const ga4 = makeGa4Bundle({
      totals: { sessions: 700, engagedSessions: 400, averageSessionDuration: 90, eventsPerSession: 3, bounceRate: 0.45, keyEvents: 35 },
      comparisonTotals: { sessions: 1000, engagedSessions: 600, averageSessionDuration: 120, eventsPerSession: 4, bounceRate: 0.4, keyEvents: 50 },
    })
    const bundle: PerformanceAnalyticsBundle = {
      period: { start: '2026-05-01', end: '2026-05-31' },
      comparison: { start: '2026-04-01', end: '2026-04-30' },
      ga4: { ok: true, data: ga4 },
      gsc: { ok: true, data: makeGscBundle() },
      prospects: { ok: true, data: makeProspectsBundle() },
    }
    const result = buildSeoReportData(bundle, makeMeta())
    const sessionsCard = result.scorecards.find((s) => s.label === 'Sessions')
    expect(sessionsCard!.deltaGood).toBe(false)
  })

  it('deltaGood=true for bounce rate when delta < 0 (lower is better)', () => {
    // bounceRate: cur=0.4, prev=0.5 → delta = (0.4-0.5)/0.5 = -0.2 → lower is better → good
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    const bounceCard = result.scorecards.find((s) => s.label === 'Bounce Rate')
    expect(bounceCard!.delta).toBeCloseTo(-0.2, 5)
    expect(bounceCard!.deltaGood).toBe(true)
  })

  it('deltaGood=false for bounce rate when delta > 0 (lower is better)', () => {
    const ga4 = makeGa4Bundle({
      totals: { sessions: 1000, engagedSessions: 600, averageSessionDuration: 125, eventsPerSession: 4.5, bounceRate: 0.6, keyEvents: 50 },
      comparisonTotals: { sessions: 800, engagedSessions: 500, averageSessionDuration: 100, eventsPerSession: 4.0, bounceRate: 0.5, keyEvents: 40 },
    })
    const bundle: PerformanceAnalyticsBundle = {
      period: { start: '2026-05-01', end: '2026-05-31' },
      comparison: { start: '2026-04-01', end: '2026-04-30' },
      ga4: { ok: true, data: ga4 },
      gsc: { ok: true, data: makeGscBundle() },
      prospects: { ok: true, data: makeProspectsBundle() },
    }
    const result = buildSeoReportData(bundle, makeMeta())
    const bounceCard = result.scorecards.find((s) => s.label === 'Bounce Rate')
    expect(bounceCard!.deltaGood).toBe(false)
  })

  it('deltaGood=true for avg position when delta < 0 (lower number = better rank)', () => {
    // position: cur=8.3, prev=9.5 → delta negative → good (lower rank number is better)
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    const posCard = result.scorecards.find((s) => s.label === 'Avg Position')
    expect(posCard!.delta).toBeLessThan(0)
    expect(posCard!.deltaGood).toBe(true)
  })

  it('deltaGood=null when delta is null', () => {
    const ga4 = makeGa4Bundle({
      totals: { sessions: 100, engagedSessions: 50, averageSessionDuration: 60, eventsPerSession: 2, bounceRate: 0, keyEvents: 10 },
      comparisonTotals: { sessions: 200, engagedSessions: 100, averageSessionDuration: 120, eventsPerSession: 4, bounceRate: 0, keyEvents: 20 },
    })
    const bundle: PerformanceAnalyticsBundle = {
      period: { start: '2026-05-01', end: '2026-05-31' },
      comparison: { start: '2026-04-01', end: '2026-04-30' },
      ga4: { ok: true, data: ga4 },
      gsc: { ok: true, data: makeGscBundle() },
      prospects: { ok: true, data: makeProspectsBundle() },
    }
    const result = buildSeoReportData(bundle, makeMeta())
    // bounceRate: cur=0, prev=0 → prev===0 → delta=null → deltaGood=null
    const bounceCard = result.scorecards.find((s) => s.label === 'Bounce Rate')
    expect(bounceCard!.delta).toBeNull()
    expect(bounceCard!.deltaGood).toBeNull()
  })
})

describe('buildSeoReportData — value formatting', () => {
  it('formats averageSessionDuration as mm:ss', () => {
    // 125 seconds = 2:05
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    const card = result.scorecards.find((s) => s.label === 'Avg Session Duration')
    expect(card!.value).toBe('2:05')
  })

  it('formats a duration under 1 minute correctly (e.g. 45s → 0:45)', () => {
    const ga4 = makeGa4Bundle({
      totals: { ...makeGa4Bundle().totals, averageSessionDuration: 45 },
    })
    const bundle: PerformanceAnalyticsBundle = {
      period: { start: '2026-05-01', end: '2026-05-31' },
      comparison: { start: '2026-04-01', end: '2026-04-30' },
      ga4: { ok: true, data: ga4 },
      gsc: { ok: true, data: makeGscBundle() },
      prospects: { ok: true, data: makeProspectsBundle() },
    }
    const result = buildSeoReportData(bundle, makeMeta())
    const card = result.scorecards.find((s) => s.label === 'Avg Session Duration')
    expect(card!.value).toBe('0:45')
  })

  it('formats bounceRate as a percentage string', () => {
    // bounceRate=0.4 → '40%' (or '40.0%')
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    const card = result.scorecards.find((s) => s.label === 'Bounce Rate')
    expect(card!.value).toMatch(/^40/)
    expect(card!.value).toContain('%')
  })

  it('formats CTR as a percentage string', () => {
    // ctr=0.05 → '5%' or '5.0%'
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    const card = result.scorecards.find((s) => s.label === 'Site CTR')
    expect(card!.value).toMatch(/^5/)
    expect(card!.value).toContain('%')
  })

  it('formats sessions with thousands separators for large values', () => {
    const ga4 = makeGa4Bundle({
      totals: { ...makeGa4Bundle().totals, sessions: 12345 },
    })
    const bundle: PerformanceAnalyticsBundle = {
      period: { start: '2026-05-01', end: '2026-05-31' },
      comparison: { start: '2026-04-01', end: '2026-04-30' },
      ga4: { ok: true, data: ga4 },
      gsc: { ok: true, data: makeGscBundle() },
      prospects: { ok: true, data: makeProspectsBundle() },
    }
    const result = buildSeoReportData(bundle, makeMeta())
    const card = result.scorecards.find((s) => s.label === 'Sessions')
    expect(card!.value).toBe('12,345')
  })

  it('formats avg position to 1 decimal place', () => {
    // position=8.3 → '8.3'
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    const card = result.scorecards.find((s) => s.label === 'Avg Position')
    expect(card!.value).toBe('8.3')
  })

  it('formats eventsPerSession to 1 decimal place', () => {
    // eventsPerSession=4.5
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    const card = result.scorecards.find((s) => s.label === 'Events / Session')
    expect(card!.value).toBe('4.5')
  })
})

describe('buildSeoReportData — scorecards shape', () => {
  it('produces exactly 12 scorecards', () => {
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    expect(result.scorecards).toHaveLength(12)
  })

  it('scorecards[0] is Sessions (first in spec §5 order)', () => {
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    expect(result.scorecards[0].label).toBe('Sessions')
  })

  it('includes all 12 expected labels', () => {
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    const labels = result.scorecards.map((s) => s.label)
    expect(labels).toContain('Sessions')
    expect(labels).toContain('Prospects')
    expect(labels).toContain('Organic Prospects')
    expect(labels).toContain('Avg Position')
    expect(labels).toContain('Avg Session Duration')
    expect(labels).toContain('Events / Session')
    expect(labels).toContain('Bounce Rate')
    expect(labels).toContain('Engaged Sessions')
    expect(labels).toContain('Clicks')
    expect(labels).toContain('Impressions')
    expect(labels).toContain('Site CTR')
    expect(labels).toHaveLength(12)
  })
})

describe('buildSeoReportData — top-N slicing', () => {
  it('slices landing pages to top 10 (from 15 provided)', () => {
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    expect(result.landingPages).toHaveLength(10)
  })

  it('top 10 landing pages are the ones with highest sessions (original order preserved)', () => {
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    // The fixture has /page-1 as sessions=100, /page-2 as 95, etc — top 10 should include /page-1 through /page-10
    expect(result.landingPages[0].path).toBe('/page-1')
    expect(result.landingPages[9].path).toBe('/page-10')
  })

  it('returns all queries when fewer than the top-100 cap (25 provided)', () => {
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    expect(result.queries).toHaveLength(25)
  })

  it('caps queries at top 100 when more are provided', () => {
    const manyQueries = Array.from({ length: 150 }, (_, i) => ({
      query: `kw ${i + 1}`,
      position: i + 1,
      positionPrev: null,
    }))
    const result = buildSeoReportData(
      makeBundle(undefined, makeGscBundle({ queries: manyQueries })),
      makeMeta(),
    )
    expect(result.queries).toHaveLength(100)
  })

  it('caps cities to top 10 by sessions, sorted descending', () => {
    const manyCities = Array.from({ length: 14 }, (_, i) => ({
      city: `City ${i + 1}`,
      sessions: i + 1, // ascending so sort must reorder
      keyEvents: 0,
    }))
    const result = buildSeoReportData(
      makeBundle(makeGa4Bundle({ cities: manyCities })),
      makeMeta(),
    )
    expect(result.cities).toHaveLength(10)
    // Highest-sessions city first (descending order).
    expect(result.cities[0].sessions).toBe(14)
    expect(result.cities[9].sessions).toBe(5)
  })
})

describe('buildSeoReportData — chart series', () => {
  it('passes through sessions series current and previous', () => {
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    expect(result.sessionsSeries).toHaveLength(1)
    expect(result.sessionsSeriesPrev).toHaveLength(1)
    expect(result.sessionsSeries[0]).toEqual({ date: '2026-05-01', value: 100 })
  })

  it('passes through GSC series', () => {
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    expect(result.clicksSeries).toHaveLength(1)
    expect(result.impressionsSeries).toHaveLength(1)
    expect(result.positionSeries).toHaveLength(1)
  })
})

describe('buildSeoReportData — donut slices', () => {
  it('passes through newVsReturning slices', () => {
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    expect(result.newVsReturning).toHaveLength(2)
    expect(result.newVsReturning[0].label).toBe('new')
    expect(result.newVsReturning[0].sessions).toBe(700)
  })

  it('passes through device category slices', () => {
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    expect(result.devices).toHaveLength(2)
  })
})

describe('buildSeoReportData — gap flags', () => {
  it('gaps.ga4=false when GA4 ok', () => {
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    expect(result.gaps.ga4).toBe(false)
  })

  it('gaps.ga4=true when GA4 source is ok:false', () => {
    const result = buildSeoReportData(makeBundleWith({ ga4: 'fail' }), makeMeta())
    expect(result.gaps.ga4).toBe(true)
  })

  it('gaps.gsc=true when GSC source is ok:false', () => {
    const result = buildSeoReportData(makeBundleWith({ gsc: 'fail' }), makeMeta())
    expect(result.gaps.gsc).toBe(true)
  })

  it('gaps.prospects=true when Prospects source is ok:false', () => {
    const result = buildSeoReportData(makeBundleWith({ prospects: 'fail' }), makeMeta())
    expect(result.gaps.prospects).toBe(true)
  })

  it('all gaps false when all sources ok', () => {
    const result = buildSeoReportData(makeBundleWith({}), makeMeta())
    expect(result.gaps).toEqual({ ga4: false, gsc: false, prospects: false })
  })

  it('multiple gaps can be true simultaneously', () => {
    const result = buildSeoReportData(makeBundleWith({ ga4: 'fail', gsc: 'fail' }), makeMeta())
    expect(result.gaps.ga4).toBe(true)
    expect(result.gaps.gsc).toBe(true)
    expect(result.gaps.prospects).toBe(false)
  })
})

describe('buildSeoReportData — gapped-source scorecards render "—"/null', () => {
  it('GA4 scorecards render "—" with null delta/deltaGood when ga4 is ok:false', () => {
    const result = buildSeoReportData(makeBundleWith({ ga4: 'fail' }), makeMeta())
    const ga4Labels = ['Sessions', 'Avg Session Duration', 'Events / Session', 'Bounce Rate', 'Engaged Sessions']
    for (const label of ga4Labels) {
      const card = result.scorecards.find((s) => s.label === label)
      expect(card).toBeDefined()
      expect(card!.value).toBe('—')
      expect(card!.delta).toBeNull()
      expect(card!.deltaGood).toBeNull()
    }
  })

  it('GSC scorecards render "—" with null delta/deltaGood when gsc is ok:false', () => {
    const result = buildSeoReportData(makeBundleWith({ gsc: 'fail' }), makeMeta())
    const gscLabels = ['Clicks', 'Impressions', 'Avg Position', 'Site CTR']
    for (const label of gscLabels) {
      const card = result.scorecards.find((s) => s.label === label)
      expect(card).toBeDefined()
      expect(card!.value).toBe('—')
      expect(card!.delta).toBeNull()
      expect(card!.deltaGood).toBeNull()
    }
  })

  it('Prospects scorecards render "—" with null delta/deltaGood when prospects is ok:false', () => {
    const result = buildSeoReportData(makeBundleWith({ prospects: 'fail' }), makeMeta())
    for (const label of ['Prospects', 'Organic Prospects']) {
      const card = result.scorecards.find((s) => s.label === label)
      expect(card).toBeDefined()
      expect(card!.value).toBe('—')
      expect(card!.delta).toBeNull()
      expect(card!.deltaGood).toBeNull()
    }
  })
})

describe('buildSeoReportData — gapped-source chart/table data is empty', () => {
  it('sessions series are empty arrays when ga4 is ok:false', () => {
    const result = buildSeoReportData(makeBundleWith({ ga4: 'fail' }), makeMeta())
    expect(result.sessionsSeries).toEqual([])
    expect(result.sessionsSeriesPrev).toEqual([])
    expect(result.landingPages).toEqual([])
    expect(result.cities).toEqual([])
    expect(result.newVsReturning).toEqual([])
    expect(result.devices).toEqual([])
  })

  it('GSC series are empty arrays when gsc is ok:false', () => {
    const result = buildSeoReportData(makeBundleWith({ gsc: 'fail' }), makeMeta())
    expect(result.clicksSeries).toEqual([])
    expect(result.impressionsSeries).toEqual([])
    expect(result.positionSeries).toEqual([])
    expect(result.queries).toEqual([])
  })
})
