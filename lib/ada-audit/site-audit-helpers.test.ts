import { describe, it, expect } from 'vitest'
import {
  addScorecards,
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
      },
      {
        id: 'a2',
        url: 'https://example.com/page2',
        status: 'error',
        error: 'Timeout',
        result: null,
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
      },
      {
        id: 'err',
        url: 'https://example.com/err',
        status: 'error',
        error: 'Failed',
        result: null,
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
      },
      {
        id: 'a3',
        url: 'https://example.com/3',
        status: 'error',
        error: 'Network error',
        result: null,
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
      },
    ]
    const summary = buildSiteAuditSummary(children)
    expect(summary.pages[0].scorecard).toEqual({
      critical: 0, serious: 0, moderate: 0, minor: 0,
      total: 0, passed: 1, incomplete: 0,
    })
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
