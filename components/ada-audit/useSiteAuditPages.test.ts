// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { SitePageResult, AuditScorecard } from '@/lib/ada-audit/types'
import {
  filterByImpact,
  computeCounts,
  useSiteAuditPages,
  type ImpactFilter,
} from './useSiteAuditPages'

function scorecard(parts: Partial<AuditScorecard>): AuditScorecard {
  return {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
    total: 0,
    passed: 0,
    incomplete: 0,
    ...parts,
  }
}

function complete(url: string, sc: Partial<AuditScorecard>): SitePageResult {
  return { url, status: 'complete', scorecard: scorecard(sc) } as SitePageResult
}

function errored(url: string): SitePageResult {
  return { url, status: 'error', scorecard: null } as SitePageResult
}

function completeNullScorecard(url: string): SitePageResult {
  // Complete status but malformed/missing result JSON — scorecard parses to null.
  return { url, status: 'complete', scorecard: null } as SitePageResult
}

// ─────────────────────────────────────────────────────────────────────────────
// filterByImpact — pure function
// ─────────────────────────────────────────────────────────────────────────────

describe('filterByImpact', () => {
  const mixed: SitePageResult[] = [
    complete('https://x/a', { critical: 2, total: 2 }),
    complete('https://x/b', { serious: 1, total: 1 }),
    complete('https://x/c', { moderate: 1, total: 1 }),
    complete('https://x/d', { minor: 1, total: 1 }),
    complete('https://x/clean', { total: 0 }),
    errored('https://x/err'),
    completeNullScorecard('https://x/null-sc'),
  ]

  it("'all' returns every page unchanged", () => {
    expect(filterByImpact(mixed, 'all')).toEqual(mixed)
  })

  it("'critical' returns pages with critical>0 PLUS error AND null-scorecard pages", () => {
    const out = filterByImpact(mixed, 'critical').map((p) => p.url)
    expect(out).toEqual([
      'https://x/a',          // critical: 2
      'https://x/err',         // error (status === 'error', scorecard null)
      'https://x/null-sc',     // complete but malformed result → null scorecard
    ])
  })

  it("'serious' returns serious pages plus error + null-scorecard pages", () => {
    const out = filterByImpact(mixed, 'serious').map((p) => p.url)
    expect(out).toEqual(['https://x/b', 'https://x/err', 'https://x/null-sc'])
  })

  it("'moderate' returns moderate pages plus error + null-scorecard pages", () => {
    const out = filterByImpact(mixed, 'moderate').map((p) => p.url)
    expect(out).toEqual(['https://x/c', 'https://x/err', 'https://x/null-sc'])
  })

  it("'minor' returns minor pages plus error + null-scorecard pages", () => {
    const out = filterByImpact(mixed, 'minor').map((p) => p.url)
    expect(out).toEqual(['https://x/d', 'https://x/err', 'https://x/null-sc'])
  })

  it("'error' returns only status==='error' pages, excludes null-scorecard complete pages", () => {
    const out = filterByImpact(mixed, 'error' as ImpactFilter).map((p) => p.url)
    expect(out).toEqual(['https://x/err'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// computeCounts — pure function
// ─────────────────────────────────────────────────────────────────────────────

describe('computeCounts', () => {
  it('counts error, impact levels, and clean pages correctly', () => {
    const pages: SitePageResult[] = [
      complete('https://x/a', { critical: 2, serious: 1, total: 3 }),
      complete('https://x/b', { critical: 1, total: 1 }),
      complete('https://x/c', { moderate: 2, total: 2 }),
      complete('https://x/clean', { total: 0 }),
      errored('https://x/err'),
      completeNullScorecard('https://x/null-sc'),
    ]
    const counts = computeCounts(pages)
    expect(counts.error).toBe(1)
    expect(counts.critical).toBe(2)   // a + b
    expect(counts.serious).toBe(1)    // a
    expect(counts.moderate).toBe(1)   // c
    expect(counts.minor).toBe(0)
    // `all` excludes clean (complete + scorecard.total === 0)
    // includes error + null-scorecard + impact pages
    expect(counts.all).toBe(5)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// useSiteAuditPages — hook integration
// ─────────────────────────────────────────────────────────────────────────────

describe('useSiteAuditPages — filterImpact: error', () => {
  it('returns only error pages in issuePages; clean pages unaffected', () => {
    const pages: SitePageResult[] = [
      complete('https://x/a', { total: 0 }),                  // clean
      complete('https://x/b', { critical: 1, total: 1 }),     // issue page (critical)
      errored('https://x/err'),                               // error
    ]
    const { result } = renderHook(() =>
      useSiteAuditPages(pages, {
        filterImpact: 'error' as ImpactFilter,
        filterStatus: 'all',
        sortKey: 'total',
      }),
    )
    expect(result.current.issuePages.map((p) => p.url)).toEqual(['https://x/err'])
    expect(result.current.cleanPages.map((p) => p.url)).toEqual(['https://x/a'])
  })
})
