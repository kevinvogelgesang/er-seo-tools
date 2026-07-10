import { describe, expect, it } from 'vitest'
import { aggregatePerformance, MIN_MEASURED_PAGES } from './cwv-aggregate'
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
    ])
    expect(out.medianPerformance).toBe(68) // round((80+55)/2)
  })
})
