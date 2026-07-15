import { describe, expect, it } from 'vitest'
import { aggregatePerformance, pickHomepageCwv, MIN_MEASURED_PAGES } from './cwv-aggregate'
import type { LighthouseSummary } from '@/lib/ada-audit/lighthouse-types'

function summary(perf: number, lcp: number, pass: boolean): LighthouseSummary {
  const status = pass ? 'pass' : 'fail'
  return {
    scores: { performance: perf, accessibility: 90, bestPractices: 90 },
    cwv: { lcp, cls: 0.05, tbt: 100, lcpStatus: status, clsStatus: 'pass', tbtStatus: 'pass' },
    topFailures: [],
  }
}

describe('aggregatePerformance', () => {
  it('returns null below the minimum sample', () => {
    const rows = Array.from({ length: MIN_MEASURED_PAGES - 1 }, (_, i) => ({
      url: `https://x.test/${i}`, summary: summary(90, 2000, true),
    }))
    expect(aggregatePerformance(rows)).toBeNull()
  })

  it('computes p75, pass %, buckets, and worst pages', () => {
    const rows = [
      { url: 'https://x.test/a', summary: summary(95, 1000, true) },
      { url: 'https://x.test/b', summary: summary(80, 2000, true) },
      { url: 'https://x.test/c', summary: summary(55, 3000, false) },
      { url: 'https://x.test/d', summary: summary(30, 4000, false) },
    ]
    const out = aggregatePerformance(rows)!
    expect(out.measuredPages).toBe(4)
    expect(out.p75LcpMs).toBe(3000) // ceil(0.75*4)-1 = index 2 of sorted [1000,2000,3000,4000]
    expect(out.pctPassing).toBe(50) // a,b pass all three statuses
    expect(out.scoreBuckets).toEqual({ good: 1, fair: 2, poor: 1 }) // ≥90 / 50–89 / <50
    expect(out.worstPages).toEqual([
      { url: 'https://x.test/d', performance: 30 },
      { url: 'https://x.test/c', performance: 55 },
      { url: 'https://x.test/b', performance: 80 },
      { url: 'https://x.test/a', performance: 95 }, // cap is 5 — all 4 rows fit
    ])
    expect(out.medianPerformance).toBe(68) // round((80+55)/2)
  })

  it('caps worstPages at 5 (sales view is the only consumer)', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      url: `https://x.test/${i}`, summary: summary(10 + i, 2000, false),
    }))
    const out = aggregatePerformance(rows)!
    expect(out.worstPages).toHaveLength(5)
    expect(out.worstPages[0].performance).toBe(10)
  })

  describe('pickHomepageCwv', () => {
    const row = (url: string, id: string, perf = 50) => ({ url, id, summary: summary(perf, 2000, true) })
    it('prefers the exact canonical root over other variants', () => {
      const out = pickHomepageCwv([
        row('https://www.x.test/', 'b'),
        row('https://x.test/', 'a', 33),
        row('https://x.test/about', 'c'),
      ], 'x.test')
      expect(out?.performance).toBe(33)
    })
    it('falls back deterministically by (url, id) among non-canonical root variants', () => {
      const out1 = pickHomepageCwv([row('https://www.x.test/', 'b', 70), row('http://x.test/', 'a', 60)], 'x.test')
      const out2 = pickHomepageCwv([row('http://x.test/', 'a', 60), row('https://www.x.test/', 'b', 70)], 'x.test')
      expect(out1?.performance).toBe(60) // 'http://x.test/' sorts before 'https://www.x.test/'
      expect(out2?.performance).toBe(60) // input order irrelevant
    })
    it('null when no root variant was measured', () => {
      expect(pickHomepageCwv([row('https://x.test/about', 'a')], 'x.test')).toBeNull()
    })
    it('is independent of aggregatePerformance (works with a single row)', () => {
      expect(pickHomepageCwv([row('https://x.test/', 'a', 44)], 'x.test')?.performance).toBe(44)
    })
  })
})
