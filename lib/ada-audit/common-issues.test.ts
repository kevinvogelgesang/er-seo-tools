import { describe, it, expect } from 'vitest'
import {
  detectCommonIssues,
  extractTagsFromSelector,
  extractLandmarkFromTarget,
  tierForRatio,
  COMMON_ISSUE_THRESHOLD,
  COMMON_ISSUE_TIER_TEMPLATE,
  COMMON_ISSUE_TIER_COMMON,
  COMMON_ISSUE_TIER_RECURRING,
  COMMON_ISSUE_MIN_PAGES,
  type CommonIssueInputRow,
} from './common-issues'

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

interface FixtureNode { target?: string[]; html?: string }
interface FixtureViolation {
  id?: string
  impact?: string | null
  help?: string
  description?: string
  helpUrl?: string
  nodes?: FixtureNode[] | unknown
}

function colorContrast(nodes: FixtureNode[]): FixtureViolation {
  return {
    id: 'color-contrast',
    impact: 'serious',
    help: 'Elements must have sufficient color contrast',
    description: 'Ensures the contrast between foreground and background colors meets WCAG 2 AA contrast ratio thresholds',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.11/color-contrast',
    nodes,
  }
}

function makeRows(
  n: number,
  buildViolations: (i: number) => FixtureViolation[],
  opts?: { erroredFrom?: number },
): CommonIssueInputRow[] {
  const erroredFrom = opts?.erroredFrom ?? n
  return Array.from({ length: n }, (_, i) => {
    if (i >= erroredFrom) {
      return { id: `e-${i}`, status: 'error', result: null }
    }
    const violations = buildViolations(i)
    return {
      id: `c-${i}`,
      status: 'complete',
      result: JSON.stringify({ violations, passes: [], incomplete: [] }),
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// extractTagsFromSelector
// ─────────────────────────────────────────────────────────────────────────────

describe('extractTagsFromSelector', () => {
  it('extracts tag names from a simple descendant selector', () => {
    expect(extractTagsFromSelector('footer > div.content > a')).toEqual(['footer', 'div', 'a'])
  })

  it('returns no tag for selectors that start with an id', () => {
    expect(extractTagsFromSelector('#footer-widget > a')).toEqual(['a'])
  })

  it('ignores tag names inside :not()', () => {
    expect(extractTagsFromSelector('div:not(footer)')).toEqual(['div'])
  })

  it('ignores tag names inside attribute selector values (double-quoted)', () => {
    expect(extractTagsFromSelector('main[data-label="footer > nav"] > a')).toEqual(['main', 'a'])
  })

  it('ignores tag names inside attribute selector values (single-quoted)', () => {
    expect(extractTagsFromSelector("div[data-x='footer'] > a")).toEqual(['div', 'a'])
  })

  it('handles combinators + and ~', () => {
    expect(extractTagsFromSelector('nav + section')).toEqual(['nav', 'section'])
    expect(extractTagsFromSelector('header ~ footer')).toEqual(['header', 'footer'])
  })

  it('returns empty for an all-class selector', () => {
    expect(extractTagsFromSelector('.foo .bar')).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// extractLandmarkFromTarget
// ─────────────────────────────────────────────────────────────────────────────

describe('extractLandmarkFromTarget', () => {
  it('returns the landmark when the selector contains it', () => {
    expect(extractLandmarkFromTarget(['footer > div.content > a'])).toBe('footer')
  })

  it('returns null when no landmark tag is present', () => {
    expect(extractLandmarkFromTarget(['#footer-widget > a'])).toBeNull()
  })

  it('returns null for undefined target', () => {
    expect(extractLandmarkFromTarget(undefined)).toBeNull()
  })

  it('returns null for an empty target array', () => {
    expect(extractLandmarkFromTarget([])).toBeNull()
  })

  it('finds a landmark even when it appears in a nested selector segment', () => {
    expect(extractLandmarkFromTarget(['html > body > header > nav > a'])).toBe('header')
  })

  it('ignores attribute-value landmark names', () => {
    expect(extractLandmarkFromTarget(['div[data-region="footer"]'])).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectCommonIssues — threshold / floor
// ─────────────────────────────────────────────────────────────────────────────

describe('detectCommonIssues — threshold / floor', () => {
  it('returns [] when complete-page count is below the floor', () => {
    const rows = makeRows(COMMON_ISSUE_MIN_PAGES - 1, () => [
      colorContrast([{ target: ['footer > a'] }]),
    ])
    expect(detectCommonIssues(rows)).toEqual([])
  })

  it('returns [] when no rule meets the lowest threshold', () => {
    // 20 pages, violation on only 4 (< ceil(20*0.25)=5)
    const rows = makeRows(20, (i) =>
      i < 4 ? [colorContrast([{ target: ['footer > a'] }])] : [],
    )
    expect(detectCommonIssues(rows)).toEqual([])
  })

  it('returns a CommonIssue at the exact 80% boundary (5 pages, 4 hits) tier=template', () => {
    const rows = makeRows(5, (i) =>
      i < 4 ? [colorContrast([{ target: ['footer > a'] }])] : [],
    )
    const out = detectCommonIssues(rows)
    expect(out).toHaveLength(1)
    expect(out[0].ruleId).toBe('color-contrast')
    expect(out[0].affectedPagesCount).toBe(4)
    expect(out[0].totalPagesScanned).toBe(5)
    expect(out[0].tier).toBe('template')
  })

  it('20/25 qualifies as template (catches floating-point ambiguity)', () => {
    const rows = makeRows(25, (i) =>
      i < 20 ? [colorContrast([{ target: ['footer > a'] }])] : [],
    )
    const out = detectCommonIssues(rows)
    expect(out).toHaveLength(1)
    expect(out[0].tier).toBe('template')
  })

  it('5/20 qualifies as recurring (≥25% boundary)', () => {
    const rows = makeRows(20, (i) =>
      i < 5 ? [colorContrast([{ target: ['footer > a'] }])] : [],
    )
    const out = detectCommonIssues(rows)
    expect(out).toHaveLength(1)
    expect(out[0].tier).toBe('recurring')
    expect(out[0].affectedPagesCount).toBe(5)
  })

  it('10/20 qualifies as common (≥50% boundary)', () => {
    const rows = makeRows(20, (i) =>
      i < 10 ? [colorContrast([{ target: ['footer > a'] }])] : [],
    )
    const out = detectCommonIssues(rows)
    expect(out).toHaveLength(1)
    expect(out[0].tier).toBe('common')
  })

  it('4/20 does NOT qualify (below 25%)', () => {
    const rows = makeRows(20, (i) =>
      i < 4 ? [colorContrast([{ target: ['footer > a'] }])] : [],
    )
    expect(detectCommonIssues(rows)).toHaveLength(0)
  })

  it('excludes errored pages from N and from hit counts', () => {
    // 25 rows: 23 complete (all with the violation), 2 errored.
    // N = 23, minHits = ceil(23 * 0.25) = 6. Violation hits = 23 → qualifies as template.
    const rows = makeRows(25, () => [colorContrast([{ target: ['footer > a'] }])], { erroredFrom: 23 })
    const out = detectCommonIssues(rows)
    expect(out).toHaveLength(1)
    expect(out[0].affectedPagesCount).toBe(23)
    expect(out[0].totalPagesScanned).toBe(23)
    expect(out[0].tier).toBe('template')
  })

  it('asserts the threshold constants', () => {
    expect(COMMON_ISSUE_THRESHOLD).toBe(0.25)
    expect(COMMON_ISSUE_TIER_TEMPLATE).toBe(0.8)
    expect(COMMON_ISSUE_TIER_COMMON).toBe(0.5)
    expect(COMMON_ISSUE_TIER_RECURRING).toBe(0.25)
    expect(COMMON_ISSUE_MIN_PAGES).toBe(5)
  })
})

describe('tierForRatio', () => {
  it('maps ratios to the correct tier', () => {
    expect(tierForRatio(1.0)).toBe('template')
    expect(tierForRatio(0.8)).toBe('template')
    expect(tierForRatio(0.79)).toBe('common')
    expect(tierForRatio(0.5)).toBe('common')
    expect(tierForRatio(0.49)).toBe('recurring')
    expect(tierForRatio(0.25)).toBe('recurring')
    expect(tierForRatio(0.24)).toBeNull()
    expect(tierForRatio(0)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectCommonIssues — vote-by-page ancestor logic
// ─────────────────────────────────────────────────────────────────────────────

describe('detectCommonIssues — ancestor voting', () => {
  it('reports sharedAncestor + confidence "all" when every page votes the same landmark', () => {
    const rows = makeRows(10, () => [colorContrast([
      { target: ['footer > div > a'] },
      { target: ['footer > p'] },
    ])])
    const out = detectCommonIssues(rows)
    expect(out).toHaveLength(1)
    expect(out[0].sharedAncestor).toBe('footer')
    expect(out[0].ancestorConfidence).toBe('all')
  })

  it('votes by page, NOT by raw node — one page with 80 footer nodes does not overpower 9 main-node pages', () => {
    // Page 0: 80 footer nodes (modal landmark for this page = footer)
    // Pages 1–9: 1 main node each (modal landmark for each = main)
    // Cross-page vote: 9 main vs 1 footer → 'main' wins, > 50% of pages.
    const rows: CommonIssueInputRow[] = makeRows(10, (i) => {
      if (i === 0) {
        const footerNodes: FixtureNode[] = Array.from({ length: 80 }, () => ({ target: ['footer > div > a'] }))
        return [colorContrast(footerNodes)]
      }
      return [colorContrast([{ target: ['main > section > a'] }])]
    })
    const out = detectCommonIssues(rows)
    expect(out).toHaveLength(1)
    expect(out[0].sharedAncestor).toBe('main')
  })

  it('reports "majority" confidence when > 50% but not all affected pages vote the same landmark', () => {
    // 10 pages, 6 vote footer, 4 vote header.
    const rows = makeRows(10, (i) =>
      i < 6
        ? [colorContrast([{ target: ['footer > a'] }])]
        : [colorContrast([{ target: ['header > nav > a'] }])],
    )
    const out = detectCommonIssues(rows)
    expect(out).toHaveLength(1)
    expect(out[0].sharedAncestor).toBe('footer')
    expect(out[0].ancestorConfidence).toBe('majority')
  })

  it('returns null sharedAncestor + null confidence on a 50/50 tie', () => {
    const rows = makeRows(10, (i) =>
      i < 5
        ? [colorContrast([{ target: ['footer > a'] }])]
        : [colorContrast([{ target: ['header > a'] }])],
    )
    const out = detectCommonIssues(rows)
    expect(out).toHaveLength(1)
    expect(out[0].sharedAncestor).toBeNull()
    expect(out[0].ancestorConfidence).toBeNull()
  })

  it('returns null sharedAncestor when fewer than half of affected pages contribute any landmark', () => {
    // 10 pages all qualify, but only 3 of them have a detectable landmark.
    const rows = makeRows(10, (i) =>
      i < 3
        ? [colorContrast([{ target: ['footer > a'] }])]
        : [colorContrast([{ target: ['#widget > a'] }])],
    )
    const out = detectCommonIssues(rows)
    expect(out).toHaveLength(1)
    expect(out[0].sharedAncestor).toBeNull()
    expect(out[0].ancestorConfidence).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectCommonIssues — defensive guards
// ─────────────────────────────────────────────────────────────────────────────

describe('detectCommonIssues — defensive guards', () => {
  it('silently skips violations without a string id', () => {
    const rows = makeRows(10, () => [
      { /* no id */ impact: 'critical', nodes: [] } as FixtureViolation,
      colorContrast([{ target: ['footer > a'] }]),
    ])
    const out = detectCommonIssues(rows)
    expect(out.map((r) => r.ruleId)).toEqual(['color-contrast'])
  })

  it('silently skips violations with null or invalid impact', () => {
    const rows = makeRows(10, () => [
      { id: 'aria-foo', impact: null, nodes: [] } as FixtureViolation,
      { id: 'aria-bar', impact: 'not-a-real-impact', nodes: [] } as FixtureViolation,
      colorContrast([{ target: ['footer > a'] }]),
    ])
    const out = detectCommonIssues(rows)
    expect(out.map((r) => r.ruleId)).toEqual(['color-contrast'])
  })

  it('treats non-array `nodes` as empty without throwing', () => {
    const rows: CommonIssueInputRow[] = makeRows(10, () => [
      { id: 'color-contrast', impact: 'serious', help: 'h', description: 'd', helpUrl: 'u', nodes: 'not-an-array' as unknown as FixtureNode[] },
    ])
    const out = detectCommonIssues(rows)
    expect(out).toHaveLength(1)
    expect(out[0].sharedAncestor).toBeNull()
  })

  it('skips a row whose `result` is malformed JSON without throwing', () => {
    const rows: CommonIssueInputRow[] = [
      ...makeRows(9, () => [colorContrast([{ target: ['footer > a'] }])]),
      { id: 'c-bad', status: 'complete', result: '{not-json' },
    ]
    // N=10 (the bad row still counts as a complete page), hits = 9, minHits = 8 → qualifies
    const out = detectCommonIssues(rows)
    expect(out).toHaveLength(1)
    expect(out[0].affectedPagesCount).toBe(9)
    expect(out[0].totalPagesScanned).toBe(10)
  })

  it('skips a row whose result has missing or non-array violations', () => {
    const rows: CommonIssueInputRow[] = [
      ...makeRows(8, () => [colorContrast([{ target: ['footer > a'] }])]),
      { id: 'c-no-vs', status: 'complete', result: JSON.stringify({ /* no violations */ }) },
      { id: 'c-bad-vs', status: 'complete', result: JSON.stringify({ violations: 'not-an-array' }) },
    ]
    // N = 10, hits = 8, minHits = 8 → qualifies
    const out = detectCommonIssues(rows)
    expect(out).toHaveLength(1)
    expect(out[0].affectedPagesCount).toBe(8)
    expect(out[0].totalPagesScanned).toBe(10)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectCommonIssues — output sorting
// ─────────────────────────────────────────────────────────────────────────────

describe('detectCommonIssues — sort order', () => {
  it('sorts a minor template-tier issue ABOVE a critical recurring-tier issue (tier wins over impact)', () => {
    // 20 pages. Minor rule hits all 20 (100% → template). Critical rule hits 5 (25% → recurring).
    const rows: CommonIssueInputRow[] = Array.from({ length: 20 }, (_, i) => {
      const violations: FixtureViolation[] = [
        {
          id: 'minor-everywhere',
          impact: 'minor',
          help: 'm',
          description: '',
          helpUrl: '',
          nodes: [{ target: ['footer > a'] }],
        },
      ]
      if (i < 5) {
        violations.push({
          id: 'critical-recurring',
          impact: 'critical',
          help: 'c',
          description: '',
          helpUrl: '',
          nodes: [{ target: ['header > a'] }],
        })
      }
      return {
        id: `c-${i}`,
        status: 'complete',
        result: JSON.stringify({ violations, passes: [], incomplete: [] }),
      }
    })
    const out = detectCommonIssues(rows)
    expect(out.map((o) => ({ id: o.ruleId, tier: o.tier }))).toEqual([
      { id: 'minor-everywhere', tier: 'template' },
      { id: 'critical-recurring', tier: 'recurring' },
    ])
  })

  it('sorts by impact severity (critical → minor), then by affectedPagesCount desc', () => {
    const rows: CommonIssueInputRow[] = Array.from({ length: 10 }, (_, i) => ({
      id: `c-${i}`,
      status: 'complete',
      result: JSON.stringify({
        violations: [
          {
            id: 'serious-rule',
            impact: 'serious',
            help: 's',
            description: '',
            helpUrl: '',
            nodes: [{ target: ['footer > a'] }],
          },
          {
            id: 'critical-rule',
            impact: 'critical',
            help: 'c',
            description: '',
            helpUrl: '',
            nodes: [{ target: ['header > a'] }],
          },
        ],
        passes: [],
        incomplete: [],
      }),
    }))
    const out = detectCommonIssues(rows)
    expect(out.map((o) => o.ruleId)).toEqual(['critical-rule', 'serious-rule'])
  })
})
