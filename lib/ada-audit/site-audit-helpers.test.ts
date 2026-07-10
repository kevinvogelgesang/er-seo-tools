import { describe, it, expect } from 'vitest'
import {
  addScorecards,
  parseAxeScorecardFromResult,
  ZERO_SCORECARD,
  buildSiteAuditSummary,
  isAllowedSiteAuditUrl,
  normaliseDiscoveredSiteAuditUrls,
  normaliseSiteAuditDomain,
} from '@/lib/ada-audit/site-audit-helpers'
import type { AuditScorecard } from '@/lib/ada-audit/types'

describe('ZERO_SCORECARD', () => {
  it('has all fields set to 0', () => {
    expect(ZERO_SCORECARD).toEqual({
      critical: 0,
      serious: 0,
      moderate: 0,
      minor: 0,
      total: 0,
      passed: 0,
      incomplete: 0,
    })
  })
})

describe('addScorecards', () => {
  it('adds two scorecards correctly', () => {
    const a: AuditScorecard = {
      critical: 1, serious: 2, moderate: 3, minor: 4,
      total: 10, passed: 5, incomplete: 1,
    }
    const b: AuditScorecard = {
      critical: 3, serious: 1, moderate: 2, minor: 0,
      total: 6, passed: 10, incomplete: 2,
    }
    expect(addScorecards(a, b)).toEqual({
      critical: 4, serious: 3, moderate: 5, minor: 4,
      total: 16, passed: 15, incomplete: 3,
    })
  })

  it('adding to ZERO_SCORECARD returns same values', () => {
    const card: AuditScorecard = {
      critical: 2, serious: 3, moderate: 1, minor: 5,
      total: 11, passed: 8, incomplete: 4,
    }
    expect(addScorecards(ZERO_SCORECARD, card)).toEqual(card)
    expect(addScorecards(card, ZERO_SCORECARD)).toEqual(card)
  })
})

describe('buildSiteAuditSummary', () => {
  it('returns zero aggregate and empty pages for empty array', () => {
    const result = buildSiteAuditSummary([])
    expect(result.pages).toEqual([])
    expect(result.aggregate).toEqual(ZERO_SCORECARD)
  })

  it('parses complete children into scorecards and errors into null', () => {
    const children = [
      {
        id: 'a1',
        url: 'https://example.com/page1',
        status: 'complete',
        error: null,
        result: JSON.stringify({
          violations: [{ impact: 'critical' }, { impact: 'minor' }],
          passes: [{ id: 'p1' }],
          incomplete: [],
        }),
        lighthouseSummary: null,
        pdfAudits: [],
      },
      {
        id: 'a2',
        url: 'https://example.com/page2',
        status: 'error',
        error: 'Timeout',
        result: null,
        lighthouseSummary: null,
        pdfAudits: [],
      },
    ]
    const summary = buildSiteAuditSummary(children)

    const completePage = summary.pages.find((p) => p.adaAuditId === 'a1')!
    expect(completePage.status).toBe('complete')
    expect(completePage.scorecard).toEqual({
      critical: 1, serious: 0, moderate: 0, minor: 1,
      total: 2, passed: 1, incomplete: 0,
    })

    const errorPage = summary.pages.find((p) => p.adaAuditId === 'a2')!
    expect(errorPage.status).toBe('error')
    expect(errorPage.error).toBe('Timeout')
    expect(errorPage.scorecard).toBeNull()
  })

  it('sorts pages by total violations descending, errors last', () => {
    const children = [
      {
        id: 'low',
        url: 'https://example.com/low',
        status: 'complete',
        error: null,
        result: JSON.stringify({
          violations: [{ impact: 'minor' }],
          passes: [],
          incomplete: [],
        }),
        lighthouseSummary: null,
        pdfAudits: [],
      },
      {
        id: 'err',
        url: 'https://example.com/err',
        status: 'error',
        error: 'Failed',
        result: null,
        lighthouseSummary: null,
        pdfAudits: [],
      },
      {
        id: 'high',
        url: 'https://example.com/high',
        status: 'complete',
        error: null,
        result: JSON.stringify({
          violations: [
            { impact: 'critical' },
            { impact: 'serious' },
            { impact: 'moderate' },
          ],
          passes: [],
          incomplete: [],
        }),
        lighthouseSummary: null,
        pdfAudits: [],
      },
    ]
    const summary = buildSiteAuditSummary(children)
    expect(summary.pages.map((p) => p.adaAuditId)).toEqual(['high', 'low', 'err'])
  })

  it('aggregates scorecards from all complete pages', () => {
    const children = [
      {
        id: 'a1',
        url: 'https://example.com/1',
        status: 'complete',
        error: null,
        result: JSON.stringify({
          violations: [{ impact: 'critical' }, { impact: 'serious' }],
          passes: [{ id: 'p1' }, { id: 'p2' }],
          incomplete: [{ id: 'i1' }],
        }),
        lighthouseSummary: null,
        pdfAudits: [],
      },
      {
        id: 'a2',
        url: 'https://example.com/2',
        status: 'complete',
        error: null,
        result: JSON.stringify({
          violations: [{ impact: 'moderate' }, { impact: 'minor' }, { impact: 'critical' }],
          passes: [{ id: 'p3' }],
          incomplete: [],
        }),
        lighthouseSummary: null,
        pdfAudits: [],
      },
      {
        id: 'a3',
        url: 'https://example.com/3',
        status: 'error',
        error: 'Network error',
        result: null,
        lighthouseSummary: null,
        pdfAudits: [],
      },
    ]
    const summary = buildSiteAuditSummary(children)
    expect(summary.aggregate).toEqual({
      critical: 2, serious: 1, moderate: 1, minor: 1,
      total: 5, passed: 3, incomplete: 1,
    })
  })

  it('returns null scorecard when result contains invalid JSON', () => {
    const children = [
      {
        id: 'bad',
        url: 'https://example.com/bad',
        status: 'complete',
        error: null,
        result: '<<<not json>>>',
        lighthouseSummary: null,
        pdfAudits: [],
      },
    ]
    const summary = buildSiteAuditSummary(children)
    expect(summary.pages[0].scorecard).toBeNull()
    expect(summary.aggregate).toEqual(ZERO_SCORECARD)
  })

  it('returns null scorecard when result is null', () => {
    const children = [
      {
        id: 'nil',
        url: 'https://example.com/nil',
        status: 'complete',
        error: null,
        result: null,
        lighthouseSummary: null,
        pdfAudits: [],
      },
    ]
    const summary = buildSiteAuditSummary(children)
    expect(summary.pages[0].scorecard).toBeNull()
    expect(summary.aggregate).toEqual(ZERO_SCORECARD)
  })

  it('returns scorecard with total 0 when result has no violations array', () => {
    const children = [
      {
        id: 'empty',
        url: 'https://example.com/empty',
        status: 'complete',
        error: null,
        result: JSON.stringify({ passes: [{ id: 'p1' }], incomplete: [] }),
        lighthouseSummary: null,
        pdfAudits: [],
      },
    ]
    const summary = buildSiteAuditSummary(children)
    expect(summary.pages[0].scorecard).toEqual({
      critical: 0, serious: 0, moderate: 0, minor: 0,
      total: 0, passed: 1, incomplete: 0,
    })
  })

  it('aggregates PDF state per page and across the site', () => {
    const children = [
      {
        id: 'p1',
        url: 'https://example.com/policies',
        status: 'complete',
        error: null,
        result: JSON.stringify({ violations: [{ impact: 'minor' }], passes: [], incomplete: [] }),
        lighthouseSummary: JSON.stringify({
          scores: { performance: 80, accessibility: 90, bestPractices: 85 },
          cwv: { lcp: 2000, cls: 0.05, tbt: 100, lcpStatus: 'pass', clsStatus: 'pass', tbtStatus: 'pass' },
          topFailures: [],
        }),
        pdfAudits: [
          { status: 'complete', issues: JSON.stringify([{ code: 'not-tagged', severity: 'high', title: 'X', description: 'Y', remediation: 'Z' }]) },
          { status: 'complete', issues: JSON.stringify([]) },
          { status: 'error', issues: null },
          { status: 'skipped', issues: null },
        ],
      },
      {
        id: 'p2',
        url: 'https://example.com/broken',
        status: 'error',
        error: 'Network error',
        result: null,
        lighthouseSummary: null,
        pdfAudits: [],
      },
    ]

    const summary = buildSiteAuditSummary(children)

    expect(summary.pdfsAggregate).toEqual({ total: 4, complete: 2, errored: 1, skipped: 1, withIssues: 1 })

    const p1 = summary.pages.find((p) => p.adaAuditId === 'p1')!
    expect(p1.pdfs).toEqual({ total: 4, complete: 2, errored: 1, withIssues: 1 })
    expect(p1.lighthouse?.scores.performance).toBe(80)

    const p2 = summary.pages.find((p) => p.adaAuditId === 'p2')!
    expect(p2.pdfs).toEqual({ total: 0, complete: 0, errored: 0, withIssues: 0 })
    expect(p2.lighthouse).toBeNull()
  })
})

describe('normaliseSiteAuditDomain', () => {
  it('strips scheme, path, and lowercases the hostname', () => {
    expect(normaliseSiteAuditDomain('https://Example.EDU/some/path?x=1')).toBe('example.edu')
  })
})

describe('isAllowedSiteAuditUrl', () => {
  it('allows http and https URLs on the exact domain or www equivalent', () => {
    expect(isAllowedSiteAuditUrl('https://example.edu/page', 'example.edu')).toBe(true)
    expect(isAllowedSiteAuditUrl('http://www.example.edu/page', 'example.edu')).toBe(true)
    expect(isAllowedSiteAuditUrl('https://example.edu/page', 'www.example.edu')).toBe(true)
  })

  it('rejects other domains and non-http protocols', () => {
    expect(isAllowedSiteAuditUrl('https://evil.test/page', 'example.edu')).toBe(false)
    expect(isAllowedSiteAuditUrl('javascript:alert(1)', 'example.edu')).toBe(false)
    expect(isAllowedSiteAuditUrl('mailto:test@example.edu', 'example.edu')).toBe(false)
  })
})

describe('normaliseDiscoveredSiteAuditUrls', () => {
  it('dedupes, strips fragments and tracking params, and filters outside domains', () => {
    const urls = normaliseDiscoveredSiteAuditUrls([
      'https://example.edu/page#section',
      'https://example.edu/page?utm_source=newsletter#other',
      'https://evil.test/page',
      'ftp://example.edu/file',
      'not a url',
      'https://www.example.edu/other',
    ], 'example.edu')

    expect(urls).toEqual([
      'https://example.edu/page',
      'https://www.example.edu/other',
    ])
  })
})

describe('parseAxeScorecardFromResult (C13 blob shapes)', () => {
  it('reads the passCount scalar + incomplete array from a trimmed (post-C13) blob', () => {
    const blob = JSON.stringify({
      violations: [
        { id: 'a', impact: 'critical', nodes: [] },
        { id: 'b', impact: 'minor', nodes: [] },
      ],
      incomplete: [{ id: 'c', nodes: [] }, { id: 'd', nodes: [] }],
      passCount: 42,
    })
    const sc = parseAxeScorecardFromResult(blob)
    expect(sc).not.toBeNull()
    expect(sc!.passed).toBe(42)
    expect(sc!.incomplete).toBe(2)
    expect(sc!.critical).toBe(1)
    expect(sc!.minor).toBe(1)
    expect(sc!.total).toBe(2)
  })

  it('legacy stripped blob (no passes/incomplete/passCount) yields 0s, not a crash', () => {
    const blob = JSON.stringify({ violations: [{ id: 'a', impact: 'serious', nodes: [] }] })
    const sc = parseAxeScorecardFromResult(blob)
    expect(sc).not.toBeNull()
    expect(sc!.passed).toBe(0)
    expect(sc!.incomplete).toBe(0)
  })

  it('pre-C13 full-arrays blob still counts passes by array length', () => {
    const blob = JSON.stringify({
      violations: [],
      passes: [{ id: 'a' }, { id: 'b' }],
      incomplete: [{ id: 'c' }],
    })
    const sc = parseAxeScorecardFromResult(blob)
    expect(sc!.passed).toBe(2)
    expect(sc!.incomplete).toBe(1)
  })
})
