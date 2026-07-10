import { describe, it, expect } from 'vitest'
import { deriveKeywordSignals } from './derive'
import type { GscQueryRow, GscQueryPageRow } from './types'

function qRow(overrides: Partial<GscQueryRow> & { query: string }): GscQueryRow {
  return { clicks: 0, impressions: 0, ctr: 0, position: 0, ...overrides }
}

function qpRow(overrides: Partial<GscQueryPageRow> & { query: string; page: string }): GscQueryPageRow {
  return { clicks: 0, impressions: 0, position: 0, ...overrides }
}

const OPTS = { minImpressions: 10 }

describe('deriveKeywordSignals — bands', () => {
  it('classifies raw-decimal position band edges exactly', () => {
    const rows: GscQueryRow[] = [
      qRow({ query: 'edge-win', impressions: 50, clicks: 1, position: 10.0 }),
      qRow({ query: 'edge-opp-quick', impressions: 50, clicks: 1, position: 10.4 }),
      qRow({ query: 'edge-opp-only', impressions: 50, clicks: 1, position: 20.4 }),
      qRow({ query: 'edge-neither', impressions: 50, clicks: 1, position: 30.1 }),
    ]

    const result = deriveKeywordSignals(rows, [], OPTS)

    const winsQueries = result.wins.map((r) => r.query)
    const oppsQueries = result.opportunities.map((r) => r.query)
    const quickQueries = result.quickWins.map((r) => r.query)

    expect(winsQueries).toEqual(['edge-win'])
    expect(oppsQueries.sort()).toEqual(['edge-opp-only', 'edge-opp-quick'])
    expect(quickQueries).toEqual(['edge-opp-quick'])

    // 30.1 is in none of the three bands
    expect(winsQueries).not.toContain('edge-neither')
    expect(oppsQueries).not.toContain('edge-neither')
    expect(quickQueries).not.toContain('edge-neither')
  })

  it('discards position 0 and negative positions entirely (never a false win)', () => {
    const rows: GscQueryRow[] = [
      qRow({ query: 'zero-position', impressions: 50, clicks: 5, position: 0 }),
      qRow({ query: 'negative-position', impressions: 50, clicks: 5, position: -3 }),
    ]

    const result = deriveKeywordSignals(rows, [], OPTS)

    expect(result.wins).toEqual([])
    expect(result.opportunities).toEqual([])
    expect(result.quickWins).toEqual([])
    expect(result.counts).toEqual({ wins: 0, opportunities: 0, quickWins: 0, cannibalizedQueries: 0 })
  })

  it('excludes a query below minImpressions from every list, including cannibalization', () => {
    const rows: GscQueryRow[] = [qRow({ query: 'low-impressions', impressions: 5, clicks: 5, position: 3 })]
    const pageRows: GscQueryPageRow[] = [
      qpRow({ query: 'low-impressions', page: '/p1', impressions: 40, clicks: 4, position: 3 }),
      qpRow({ query: 'low-impressions', page: '/p2', impressions: 30, clicks: 3, position: 4 }),
    ]

    const result = deriveKeywordSignals(rows, pageRows, OPTS)

    expect(result.wins).toEqual([])
    expect(result.opportunities).toEqual([])
    expect(result.quickWins).toEqual([])
    expect(result.cannibalization).toEqual([])
  })

  it('sorts bands by clicks desc, then impressions desc', () => {
    const rows: GscQueryRow[] = [
      qRow({ query: 'low-clicks', impressions: 100, clicks: 5, position: 3 }),
      qRow({ query: 'tie-low-impressions', impressions: 50, clicks: 10, position: 3 }),
      qRow({ query: 'tie-high-impressions', impressions: 80, clicks: 10, position: 3 }),
    ]

    const result = deriveKeywordSignals(rows, [], OPTS)

    expect(result.wins.map((r) => r.query)).toEqual([
      'tie-high-impressions',
      'tie-low-impressions',
      'low-clicks',
    ])
  })
})

describe('deriveKeywordSignals — cannibalization', () => {
  it('uses the observed page-impression sum as the share denominator (page sum below query total)', () => {
    const rows: GscQueryRow[] = [qRow({ query: 'below-total', impressions: 100, clicks: 10, position: 5 })]
    const pageRows: GscQueryPageRow[] = [
      qpRow({ query: 'below-total', page: '/p1', impressions: 40, clicks: 4, position: 5 }),
      qpRow({ query: 'below-total', page: '/p2', impressions: 30, clicks: 3, position: 6 }),
    ]

    const result = deriveKeywordSignals(rows, pageRows, OPTS)

    expect(result.cannibalization).toHaveLength(1)
    const entry = result.cannibalization[0]
    expect(entry.query).toBe('below-total')
    expect(entry.queryImpressions).toBe(100)
    expect(entry.observedPageImpressions).toBe(70)
    expect(entry.observedPageCoverage).toBeCloseTo(0.7, 10)
    expect(entry.observedPageCoverage!).toBeLessThan(1)

    const shareSum = entry.pages.reduce((sum, p) => sum + p.share, 0)
    expect(shareSum).toBeCloseTo(1, 10)
  })

  it('preserves observedPageCoverage above 1 without clamping (page sum exceeds query total)', () => {
    const rows: GscQueryRow[] = [qRow({ query: 'above-total', impressions: 50, clicks: 5, position: 5 })]
    const pageRows: GscQueryPageRow[] = [
      qpRow({ query: 'above-total', page: '/p1', impressions: 40, clicks: 4, position: 5 }),
      qpRow({ query: 'above-total', page: '/p2', impressions: 30, clicks: 3, position: 6 }),
    ]

    const result = deriveKeywordSignals(rows, pageRows, OPTS)

    expect(result.cannibalization).toHaveLength(1)
    const entry = result.cannibalization[0]
    expect(entry.observedPageImpressions).toBe(70)
    expect(entry.observedPageCoverage).toBeCloseTo(1.4, 10)
    expect(entry.observedPageCoverage!).toBeGreaterThan(1)
  })

  it('sets queryImpressions and observedPageCoverage to null when the query is absent from query rows', () => {
    const pageRows: GscQueryPageRow[] = [
      qpRow({ query: 'no-query-row', page: '/p1', impressions: 40, clicks: 4, position: 5 }),
      qpRow({ query: 'no-query-row', page: '/p2', impressions: 30, clicks: 3, position: 6 }),
    ]

    const result = deriveKeywordSignals([], pageRows, OPTS)

    expect(result.cannibalization).toHaveLength(1)
    const entry = result.cannibalization[0]
    expect(entry.query).toBe('no-query-row')
    expect(entry.queryImpressions).toBeNull()
    expect(entry.observedPageImpressions).toBe(70)
    expect(entry.observedPageCoverage).toBeNull()
  })

  it('requires >=2 pages each >=20% share AND >=10 impressions (only 1 of 3 qualifies -> not cannibalized)', () => {
    const rows: GscQueryRow[] = [qRow({ query: 'one-qualifies', impressions: 100, clicks: 10, position: 5 })]
    const pageRows: GscQueryPageRow[] = [
      qpRow({ query: 'one-qualifies', page: '/p1', impressions: 60, clicks: 6, position: 5 }), // 60/80=0.75, qualifies
      qpRow({ query: 'one-qualifies', page: '/p2', impressions: 15, clicks: 1, position: 6 }), // 15/80=0.1875, share fails
      qpRow({ query: 'one-qualifies', page: '/p3', impressions: 5, clicks: 0, position: 7 }), // 5/80=0.0625, both fail
    ]

    const result = deriveKeywordSignals(rows, pageRows, OPTS)

    expect(result.cannibalization).toEqual([])
  })

  it('is absent from cannibalization ("no cannibalization observed") when an eligible query has zero qualifying page rows', () => {
    const rows: GscQueryRow[] = [qRow({ query: 'zero-qualifying', impressions: 50, clicks: 5, position: 5 })]
    const pageRows: GscQueryPageRow[] = [
      qpRow({ query: 'zero-qualifying', page: '/p1', impressions: 5, clicks: 1, position: 5 }), // share 0.5 but impressions<10
      qpRow({ query: 'zero-qualifying', page: '/p2', impressions: 5, clicks: 1, position: 6 }),
    ]

    const result = deriveKeywordSignals(rows, pageRows, OPTS)

    expect(result.cannibalization).toEqual([])
    expect(result.counts.cannibalizedQueries).toBe(0)
  })

  it('sorts cannibalization pages by impressions desc, and the list by observedPageImpressions desc', () => {
    const rows: GscQueryRow[] = [
      qRow({ query: 'big', impressions: 200, clicks: 20, position: 5 }),
      qRow({ query: 'small', impressions: 60, clicks: 6, position: 5 }),
    ]
    const pageRows: GscQueryPageRow[] = [
      qpRow({ query: 'big', page: '/low', impressions: 40, clicks: 4, position: 5 }),
      qpRow({ query: 'big', page: '/high', impressions: 60, clicks: 6, position: 6 }),
      qpRow({ query: 'small', page: '/a', impressions: 20, clicks: 2, position: 5 }),
      qpRow({ query: 'small', page: '/b', impressions: 20, clicks: 2, position: 6 }),
    ]

    const result = deriveKeywordSignals(rows, pageRows, OPTS)

    expect(result.cannibalization.map((e) => e.query)).toEqual(['big', 'small'])
    expect(result.cannibalization[0].pages.map((p) => p.page)).toEqual(['/high', '/low'])
  })
})

describe('deriveKeywordSignals — thresholds, counts, empty input', () => {
  it('echoes back the thresholds used', () => {
    const result = deriveKeywordSignals([], [], { minImpressions: 25 })
    expect(result.thresholds).toEqual({
      minImpressions: 25,
      cannibalizationMinShare: 0.2,
      cannibalizationMinPageImpressions: 10,
    })
  })

  it('returns empty lists and zero counts for empty input', () => {
    const result = deriveKeywordSignals([], [], OPTS)

    expect(result.wins).toEqual([])
    expect(result.opportunities).toEqual([])
    expect(result.quickWins).toEqual([])
    expect(result.cannibalization).toEqual([])
    expect(result.counts).toEqual({ wins: 0, opportunities: 0, quickWins: 0, cannibalizedQueries: 0 })
  })
})
