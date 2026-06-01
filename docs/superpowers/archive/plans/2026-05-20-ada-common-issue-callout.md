# Common Issue Callout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a site audit completes, detect violation rules that appear on ≥80% of successfully scanned pages and surface them as a callout above the Pages-with-Issues toolbar. Each card names the rule, the affected page count, and — when detectable from the stored CSS selector data — the likely shared template region (header/footer/nav/aside/main). "View affected pages" jumps the operator to the by-violation tab with the relevant card auto-expanded and scrolled into view.

**Architecture:** Detection is a **pure function** (`detectCommonIssues`) in `lib/ada-audit/common-issues.ts` that takes pre-fetched child rows and returns `CommonIssue[]`. It is called once at finalization from `buildSiteAuditSummary` and the result is persisted inside `SiteAudit.summary`. No new DB columns. No I/O in the helper. Client reads `summary.commonIssues ?? []` and renders `<CommonIssueCallout>` when non-empty.

**Tech Stack:** Next.js 15 App Router · TypeScript · Prisma + SQLite · vitest

**Companion spec:** `docs/superpowers/specs/2026-05-20-ada-common-issue-callout-design.md`

**Pre-flight gate:** PR 4 of the ADA Audit UX Overhaul series should be merged first so the by-violation tab + `GroupedViolationsView` exist in their current shape. If not, this PR will need a re-base after that lands.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/ada-audit/types.ts` | Modify | Add `LandmarkTag`, `AncestorConfidence`, `CommonIssue`; extend `SiteAuditSummary` with `commonIssues: CommonIssue[]` |
| `lib/ada-audit/common-issues.ts` | Create | Pure `detectCommonIssues(children)` + exported threshold constants + selector-segment-aware tag extractor. **No DB access, no React.** |
| `lib/ada-audit/common-issues.test.ts` | Create | Pure-function unit tests — selector edge cases, threshold boundary, vote-by-page logic, defensive guards |
| `lib/ada-audit/site-audit-helpers.ts` | Modify | Import `detectCommonIssues`; call at end of `buildSiteAuditSummary`; include `commonIssues` in returned object |
| `lib/ada-audit/site-audit-helpers.test.ts` | Modify | Update any existing assertion on the shape of the returned summary to include `commonIssues` |
| `components/ada-audit/CommonIssueCallout.tsx` | Create | Card-stack component. Renders up to `COMMON_ISSUE_MAX_CALLOUTS` + "+ N more" expander. Three body-sentence forms per confidence |
| `components/ada-audit/SiteAuditResultsView.tsx` | Modify | Add `selectedViolationId` state; render `<CommonIssueCallout>` above `<SiteAuditToolbar>`; forward `selectedViolationId` to `<GroupedViolationsView>` |
| `components/ada-audit/GroupedViolationsView.tsx` | Modify | Accept optional `selectedViolationId?: string`. On mount and on prop change, auto-expand that rule's card and `scrollIntoView({ behavior: 'smooth', block: 'start' })` |

---

### Task 1: Branch + working tree

**Files:** none

- [ ] **Step 1: Pull latest main**

```bash
git checkout main && git pull origin main
```

- [ ] **Step 2: Create the feature branch**

```bash
git checkout -b feat/ada-common-issue-callout
```

---

### Task 2: Add `LandmarkTag`, `AncestorConfidence`, `CommonIssue` types

**Files:**
- Modify: `lib/ada-audit/types.ts`

- [ ] **Step 1: Add the new type aliases and interface**

Insert immediately after the existing `SiteAuditPdfAggregate` interface (search for `interface SiteAuditPdfAggregate` to locate):

```typescript
/** Top-level HTML5 landmark tags we attempt to detect as shared ancestors. */
export type LandmarkTag = 'header' | 'footer' | 'nav' | 'aside' | 'main'

/**
 * Confidence that a CommonIssue's `sharedAncestor` reflects a real template
 * region rather than coincidental selector overlap.
 *
 * - 'all'      — every page that contributed a landmark vote agreed, AND at
 *                least half of affected pages contributed a vote.
 * - 'majority' — > 50% of affected pages voted for the top landmark, no tie.
 * - null       — sharedAncestor is null (no landmark detected with confidence).
 */
export type AncestorConfidence = 'all' | 'majority'

/**
 * One row in `SiteAuditSummary.commonIssues`. A rule that fires on a large
 * fraction of pages — likely a one-time template fix rather than N separate
 * page edits. Computed by `detectCommonIssues` and persisted inside the
 * `SiteAudit.summary` JSON column.
 */
export interface CommonIssue {
  ruleId: string
  impact: ImpactLevel
  help: string                                  // axe violation.help
  description: string                           // axe violation.description
  helpUrl: string
  affectedPagesCount: number
  totalPagesScanned: number                     // N (complete pages only)
  sharedAncestor: LandmarkTag | null
  ancestorConfidence: AncestorConfidence | null // null whenever sharedAncestor is null
}
```

- [ ] **Step 2: Extend `SiteAuditSummary`**

Locate the existing `SiteAuditSummary` interface and add the new field:

```typescript
/** Stored in SiteAudit.summary — computed once when all pages + PDFs finish */
export interface SiteAuditSummary {
  aggregate: AuditScorecard
  pdfsAggregate: SiteAuditPdfAggregate
  pages: SitePageResult[]   // sorted by scorecard.total descending
  commonIssues: CommonIssue[]   // empty array when below floor or no matches
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run lint
```

Expected: PASS — the field is required, so any consumer that constructs a `SiteAuditSummary` literal will fail. The only such caller is `buildSiteAuditSummary` (handled in Task 5) plus tests (Task 5). If lint still fails after Task 5 it indicates a missed call site — chase it down before continuing.

- [ ] **Step 4: Commit**

```bash
git add lib/ada-audit/types.ts
git commit -m "feat(ada-audit): add LandmarkTag, AncestorConfidence, CommonIssue types"
```

---

### Task 3: Write failing tests for `detectCommonIssues` and helpers (TDD)

**Files:**
- Create: `lib/ada-audit/common-issues.test.ts`

The detection module is the highest-value place to test in this PR. Tests come before the implementation. Every spec edge case has a corresponding test below.

- [ ] **Step 1: Create the test file**

```typescript
// lib/ada-audit/common-issues.test.ts
import { describe, it, expect } from 'vitest'
import {
  detectCommonIssues,
  extractTagsFromSelector,
  extractLandmarkFromTarget,
  COMMON_ISSUE_THRESHOLD,
  COMMON_ISSUE_MIN_PAGES,
  type CommonIssueInputRow,
} from './common-issues'

/** Helper to build a stored result JSON the way the runner persists it. */
function resultJson(violations: Array<{
  id?: unknown
  impact?: unknown
  help?: string
  description?: string
  helpUrl?: string
  nodes?: unknown
}>): string {
  return JSON.stringify({ violations, passes: [], incomplete: [] })
}

/** Build N rows that each carry the given violation set. */
function makeRows(
  n: number,
  perRowViolations: (i: number) => Parameters<typeof resultJson>[0],
  opts: { erroredFrom?: number } = {},
): CommonIssueInputRow[] {
  return Array.from({ length: n }, (_, i) => {
    const errored = opts.erroredFrom !== undefined && i >= opts.erroredFrom
    return {
      id: `c${i}`,
      status: errored ? 'error' : 'complete',
      result: errored ? null : resultJson(perRowViolations(i)),
    }
  })
}

const colorContrast = (nodes: Array<{ target?: string[] }> = []) => ({
  id: 'color-contrast',
  impact: 'serious' as const,
  help: 'Elements must meet minimum color contrast ratio thresholds',
  description: 'Ensures the contrast between foreground and background colors meets WCAG 2 AA',
  helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
  nodes,
})

// ─────────────────────────────────────────────────────────────────────────────
// extractTagsFromSelector
// ─────────────────────────────────────────────────────────────────────────────

describe('extractTagsFromSelector', () => {
  it('parses a simple descendant chain', () => {
    expect(extractTagsFromSelector('footer > div.content > a')).toEqual(['footer', 'div', 'a'])
  })

  it('returns nothing for a selector with no leading tag in any segment', () => {
    expect(extractTagsFromSelector('#footer-widget > .link')).toEqual([])
  })

  it('skips content inside :not() — `:not(footer)` does NOT yield footer', () => {
    expect(extractTagsFromSelector('div:not(footer) > a')).toEqual(['div', 'a'])
  })

  it('skips content inside attribute selectors — `[data-region="footer"]` does NOT yield footer', () => {
    expect(extractTagsFromSelector('section[data-region="footer"] > p')).toEqual(['section', 'p'])
  })

  it('handles combinators with no whitespace', () => {
    expect(extractTagsFromSelector('nav>ul>li')).toEqual(['nav', 'ul', 'li'])
  })

  it('lowercases tag names', () => {
    expect(extractTagsFromSelector('FOOTER > A')).toEqual(['footer', 'a'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// extractLandmarkFromTarget
// ─────────────────────────────────────────────────────────────────────────────

describe('extractLandmarkFromTarget', () => {
  it('returns the landmark when target contains `footer > div.content > a`', () => {
    expect(extractLandmarkFromTarget(['footer > div.content > a'])).toBe('footer')
  })

  it('returns null for `#footer-widget > a` (no bare tag, just an id named `footer-widget`)', () => {
    expect(extractLandmarkFromTarget(['#footer-widget > a'])).toBeNull()
  })

  it('returns null for undefined target', () => {
    expect(extractLandmarkFromTarget(undefined)).toBeNull()
  })

  it('returns null for empty target array', () => {
    expect(extractLandmarkFromTarget([])).toBeNull()
  })

  it('returns null when no landmark tag is present anywhere', () => {
    expect(extractLandmarkFromTarget(['div.wrapper > span'])).toBeNull()
  })

  it('returns the first landmark when the selector has multiple', () => {
    // footer comes first in the chain — that wins
    expect(extractLandmarkFromTarget(['footer nav a'])).toBe('footer')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectCommonIssues — gates
// ─────────────────────────────────────────────────────────────────────────────

describe('detectCommonIssues — gates', () => {
  it(`returns [] when complete-page count is below the floor (${COMMON_ISSUE_MIN_PAGES})`, () => {
    // 4 complete pages, all with the same violation
    const rows = makeRows(4, () => [colorContrast([{ target: ['footer > a'] }])])
    expect(detectCommonIssues(rows)).toEqual([])
  })

  it('returns [] when no rule meets the 80% threshold', () => {
    // 10 complete pages: violation on only 5 of them = 50%
    const rows = makeRows(10, (i) =>
      i < 5 ? [colorContrast([{ target: ['footer > a'] }])] : [],
    )
    expect(detectCommonIssues(rows)).toEqual([])
  })

  it('returns a CommonIssue at the exact 80% boundary (minHits = Math.ceil(N * threshold))', () => {
    // 5 complete pages, violation on exactly 4 (4 = ceil(5 * 0.8))
    const rows = makeRows(5, (i) =>
      i < 4 ? [colorContrast([{ target: ['footer > a'] }])] : [],
    )
    const result = detectCommonIssues(rows)
    expect(result).toHaveLength(1)
    expect(result[0].ruleId).toBe('color-contrast')
    expect(result[0].affectedPagesCount).toBe(4)
    expect(result[0].totalPagesScanned).toBe(5)
  })

  it('returns a CommonIssue at the 20/25 boundary (catches floating-point ambiguity)', () => {
    // 25 complete pages, violation on exactly 20 (20 = ceil(25 * 0.8))
    const rows = makeRows(25, (i) =>
      i < 20 ? [colorContrast([{ target: ['footer > a'] }])] : [],
    )
    const result = detectCommonIssues(rows)
    expect(result).toHaveLength(1)
    expect(result[0].affectedPagesCount).toBe(20)
  })

  it('does NOT qualify at 19/25 (just below threshold)', () => {
    const rows = makeRows(25, (i) =>
      i < 19 ? [colorContrast([{ target: ['footer > a'] }])] : [],
    )
    const result = detectCommonIssues(rows)
    expect(result).toHaveLength(0)
  })

  it('excludes errored pages from N and from per-rule hit counts', () => {
    // 25 rows: 23 complete (all with the violation), 2 errored
    // N = 23, minHits = ceil(23 * 0.8) = 19. Violation hits = 23 → qualifies.
    const rows = makeRows(
      25,
      () => [colorContrast([{ target: ['footer > a'] }])],
      { erroredFrom: 23 },
    )
    const result = detectCommonIssues(rows)
    expect(result).toHaveLength(1)
    expect(result[0].affectedPagesCount).toBe(23)
    expect(result[0].totalPagesScanned).toBe(23)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectCommonIssues — defensive guards
// ─────────────────────────────────────────────────────────────────────────────

describe('detectCommonIssues — defensive guards', () => {
  it('silently skips violations without a string id', () => {
    const rows: CommonIssueInputRow[] = makeRows(10, () => [
      { /* no id */ impact: 'critical', nodes: [] },
      colorContrast([{ target: ['footer > a'] }]),
    ])
    const result = detectCommonIssues(rows)
    // Only color-contrast survives — the id-less violation must not appear as `undefined`
    expect(result.map((r) => r.ruleId)).toEqual(['color-contrast'])
  })

  it('silently skips violations with null or invalid impact', () => {
    const rows: CommonIssueInputRow[] = makeRows(10, () => [
      { id: 'aria-foo', impact: null, nodes: [] },
      { id: 'aria-bar', impact: 'not-a-real-impact', nodes: [] },
      colorContrast([{ target: ['footer > a'] }]),
    ])
    const result = detectCommonIssues(rows)
    expect(result.map((r) => r.ruleId)).toEqual(['color-contrast'])
  })

  it('treats non-array `nodes` as empty without throwing', () => {
    const rows: CommonIssueInputRow[] = makeRows(10, () => [
      { id: 'color-contrast', impact: 'serious', help: 'h', description: 'd', helpUrl: 'u', nodes: 'not-an-array' },
    ])
    // Rule still counts (page-level hit), but no landmark vote because nodes is empty.
    const result = detectCommonIssues(rows)
    expect(result).toHaveLength(1)
    expect(result[0].sharedAncestor).toBeNull()
  })

  it('skips a row whose `result` is malformed JSON without throwing', () => {
    const rows: CommonIssueInputRow[] = [
      ...makeRows(9, () => [colorContrast([{ target: ['footer > a'] }])]),
      { id: 'c-bad', status: 'complete', result: '{not-json' },
    ]
    // N = 10 (the bad row still counts as a complete page for N — see spec),
    // hits = 9, minHits = ceil(10 * 0.8) = 8 → qualifies.
    const result = detectCommonIssues(rows)
    expect(result).toHaveLength(1)
    expect(result[0].affectedPagesCount).toBe(9)
    expect(result[0].totalPagesScanned).toBe(10)
  })

  it('treats undefined or empty target as no landmark contribution', () => {
    const rows: CommonIssueInputRow[] = makeRows(10, () => [
      colorContrast([{ /* no target */ }, { target: [] }]),
    ])
    const result = detectCommonIssues(rows)
    expect(result).toHaveLength(1)
    expect(result[0].sharedAncestor).toBeNull()
  })

  it('skips a row whose result has missing or non-array violations', () => {
    // Two rows with completely malformed shapes — neither contributes to any rule.
    const rows: CommonIssueInputRow[] = [
      ...makeRows(8, () => [colorContrast([{ target: ['footer > a'] }])]),
      { id: 'c-no-vs', status: 'complete', result: JSON.stringify({ /* no violations */ }) },
      { id: 'c-bad-vs', status: 'complete', result: JSON.stringify({ violations: 'not-an-array' }) },
    ]
    // N = 10 (all rows count as complete for N), hits = 8, minHits = 8 → qualifies.
    const result = detectCommonIssues(rows)
    expect(result).toHaveLength(1)
    expect(result[0].affectedPagesCount).toBe(8)
    expect(result[0].totalPagesScanned).toBe(10)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// extractTagsFromSelector — additional string-literal coverage
// ─────────────────────────────────────────────────────────────────────────────

describe('extractTagsFromSelector — string-literal contents', () => {
  it('ignores landmark tag names inside attribute selector string values', () => {
    // The attribute value contains "footer > nav" but should be IGNORED.
    // Only the outer `main` and trailing `a` should be returned.
    const tags = extractTagsFromSelector('main[data-label="footer > nav"] > a')
    expect(tags).toEqual(['main', 'a'])
  })

  it('ignores landmark tag names inside single-quoted attribute values', () => {
    const tags = extractTagsFromSelector("div[data-x='footer'] > a")
    expect(tags).toEqual(['div', 'a'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectCommonIssues — vote-by-page logic
// ─────────────────────────────────────────────────────────────────────────────

describe('detectCommonIssues — vote-by-page logic', () => {
  it('one page with 80 footer nodes does not outweigh 9 pages with 1 main node each', () => {
    // Page 0: 80 footer nodes for color-contrast.
    // Pages 1–9: 1 main node each for color-contrast.
    // Each page contributes ONE vote (its modal landmark).
    // Cross-page votes: 1× footer, 9× main → 'main' wins with 'all' confidence
    // (every page that voted, voted main except one — so 'majority', NOT 'all').
    const rows: CommonIssueInputRow[] = [
      {
        id: 'c0',
        status: 'complete',
        result: resultJson([
          colorContrast(Array.from({ length: 80 }, () => ({ target: ['footer > a'] }))),
        ]),
      },
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `c${i + 1}`,
        status: 'complete',
        result: resultJson([colorContrast([{ target: ['main > p > a'] }])]),
      })),
    ]
    const result = detectCommonIssues(rows)
    expect(result).toHaveLength(1)
    expect(result[0].sharedAncestor).toBe('main')
    // 9 of 10 pages voted 'main' → majority, not all (because one page voted footer)
    expect(result[0].ancestorConfidence).toBe('majority')
  })

  it('per-page modal landmark resolves ties to null', () => {
    // Page has 2 footer + 2 main nodes for the same rule — tie → page contributes no vote.
    const rows: CommonIssueInputRow[] = makeRows(10, () => [
      colorContrast([
        { target: ['footer > a'] },
        { target: ['footer > span'] },
        { target: ['main > a'] },
        { target: ['main > span'] },
      ]),
    ])
    // No page contributed a vote → < half of pages have a vote → confidence is null
    const result = detectCommonIssues(rows)
    expect(result).toHaveLength(1)
    expect(result[0].sharedAncestor).toBeNull()
    expect(result[0].ancestorConfidence).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectCommonIssues — confidence levels
// ─────────────────────────────────────────────────────────────────────────────

describe('detectCommonIssues — confidence levels', () => {
  it(`'all' requires every voting page to agree AND >= half of pages contributed a vote`, () => {
    // 10 complete pages, all with one footer node — every page votes footer.
    const rows: CommonIssueInputRow[] = makeRows(10, () => [
      colorContrast([{ target: ['footer > a'] }]),
    ])
    const result = detectCommonIssues(rows)
    expect(result[0].sharedAncestor).toBe('footer')
    expect(result[0].ancestorConfidence).toBe('all')
  })

  it(`'all' demotes to null when fewer than half of pages contributed a vote`, () => {
    // 10 pages with the violation, but only 4 of them have a landmark-bearing target.
    // The other 6 violate with `#footer-widget > a` (no bare tag).
    // 4 footer votes, 0 conflicting → unanimous among voters, but only 4 of 10 (< half)
    // contributed → confidence demotes to null per spec.
    const rows: CommonIssueInputRow[] = makeRows(10, (i) =>
      i < 4
        ? [colorContrast([{ target: ['footer > a'] }])]
        : [colorContrast([{ target: ['#footer-widget > a'] }])],
    )
    const result = detectCommonIssues(rows)
    expect(result[0].sharedAncestor).toBeNull()
    expect(result[0].ancestorConfidence).toBeNull()
  })

  it(`'majority' requires strictly > 50% (a 5/10 tie is null)`, () => {
    // 5 footer, 5 main → tie at the top → null.
    const rows: CommonIssueInputRow[] = makeRows(10, (i) =>
      i < 5
        ? [colorContrast([{ target: ['footer > a'] }])]
        : [colorContrast([{ target: ['main > a'] }])],
    )
    const result = detectCommonIssues(rows)
    expect(result[0].sharedAncestor).toBeNull()
    expect(result[0].ancestorConfidence).toBeNull()
  })

  it(`'majority' fires at 6/10`, () => {
    const rows: CommonIssueInputRow[] = makeRows(10, (i) =>
      i < 6
        ? [colorContrast([{ target: ['footer > a'] }])]
        : [colorContrast([{ target: ['main > a'] }])],
    )
    const result = detectCommonIssues(rows)
    expect(result[0].sharedAncestor).toBe('footer')
    expect(result[0].ancestorConfidence).toBe('majority')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectCommonIssues — output sort
// ─────────────────────────────────────────────────────────────────────────────

describe('detectCommonIssues — output sort', () => {
  it('sorts critical before serious before moderate before minor, then by pageCount desc', () => {
    // 10 complete pages. Two qualifying rules, one critical (5 pages), one serious (10 pages).
    // Sort order: critical first even though it has fewer pages.
    const rows: CommonIssueInputRow[] = makeRows(10, (i) => {
      const violations: Parameters<typeof resultJson>[0] = [
        colorContrast([{ target: ['footer > a'] }]),   // serious, all 10
      ]
      if (i < 8) {
        violations.push({
          id: 'aria-label',
          impact: 'critical',
          help: 'Buttons must have discernible text',
          description: 'desc',
          helpUrl: 'https://example/aria-label',
          nodes: [{ target: ['header > button'] }],
        })
      }
      return violations
    })
    const result = detectCommonIssues(rows)
    expect(result.map((r) => r.ruleId)).toEqual(['aria-label', 'color-contrast'])
  })

  it('within the same impact level, sorts by affectedPagesCount desc', () => {
    // Two serious rules, both qualifying. Rule-A hits 10/10, rule-B hits 8/10.
    const rows: CommonIssueInputRow[] = makeRows(10, (i) => {
      const violations: Parameters<typeof resultJson>[0] = [colorContrast([{ target: ['footer > a'] }])]
      if (i < 8) {
        violations.push({
          id: 'link-name',
          impact: 'serious',
          help: 'Links must have discernible text',
          description: 'desc',
          helpUrl: 'https://example/link-name',
          nodes: [{ target: ['header > a'] }],
        })
      }
      return violations
    })
    const result = detectCommonIssues(rows)
    expect(result.map((r) => r.ruleId)).toEqual(['color-contrast', 'link-name'])
  })
})
```

- [ ] **Step 2: Run, verify the file imports fail**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/common-issues.test.ts
```

Expected: FAIL — `Cannot find module './common-issues'`.

---

### Task 4: Implement `detectCommonIssues` and helpers

**Files:**
- Create: `lib/ada-audit/common-issues.ts`

- [ ] **Step 1: Create the module**

```typescript
// lib/ada-audit/common-issues.ts
import type {
  CommonIssue,
  ImpactLevel,
  LandmarkTag,
  AncestorConfidence,
} from './types'

// ── Constants ──────────────────────────────────────────────────────────────

/** ≥ 80% of successfully scanned pages must hit the rule to qualify. */
export const COMMON_ISSUE_THRESHOLD = 0.8

/** Callout disabled below this many complete pages. See spec for justification. */
export const COMMON_ISSUE_MIN_PAGES = 5

/** Max cards shown by the UI before the "+ N more" expander. */
export const COMMON_ISSUE_MAX_CALLOUTS = 5

const LANDMARK_TAGS = ['header', 'footer', 'nav', 'aside', 'main'] as const

const VALID_IMPACTS: readonly ImpactLevel[] = ['critical', 'serious', 'moderate', 'minor']

const IMPACT_RANK: Record<ImpactLevel, number> = {
  critical: 0,
  serious:  1,
  moderate: 2,
  minor:    3,
}

// ── Input shape ────────────────────────────────────────────────────────────

/**
 * Structural subset of the `ChildRow` used inside `buildSiteAuditSummary`.
 * Keeping this local avoids cross-importing the helpers module's private types.
 */
export interface CommonIssueInputRow {
  id: string
  status: string
  result: string | null
}

// ── Selector parsing ───────────────────────────────────────────────────────

/**
 * Walks a CSS selector and emits its top-level simple-selector segments'
 * leading tag names, lowercased. Content inside (...), [...], or "..."/'...'
 * is opaque — `:not(footer)` does NOT contribute `footer`, and
 * `[data-region="footer"]` does NOT contribute `footer`.
 *
 * Exported for unit testing.
 */
export function extractTagsFromSelector(selector: string): string[] {
  const tags: string[] = []
  let depth = 0                       // tracks (...) and [...] nesting
  let stringChar: string | null = null // tracks " or ' nesting
  let segment = ''

  const flush = () => {
    const trimmed = segment.trim()
    if (trimmed) {
      // Leading tag is alphanumeric+hyphen until the first ., #, [, :, *, (
      const m = trimmed.match(/^([a-z][a-z0-9-]*)/i)
      if (m) tags.push(m[1].toLowerCase())
    }
    segment = ''
  }

  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i]
    if (stringChar) {
      if (ch === stringChar) stringChar = null
      continue
    }
    if (ch === '"' || ch === "'") { stringChar = ch; continue }
    if (ch === '(' || ch === '[') { depth++; segment += ch; continue }
    if (ch === ')' || ch === ']') { depth--; segment += ch; continue }
    if (depth === 0 && /[\s>+~,]/.test(ch)) { flush(); continue }
    segment += ch
  }
  flush()
  return tags
}

/**
 * Returns the first landmark tag found in any of the target's selectors, or
 * null. Exported for unit testing.
 */
export function extractLandmarkFromTarget(
  target: string[] | undefined,
): LandmarkTag | null {
  if (!target || target.length === 0) return null
  for (const sel of target) {
    if (typeof sel !== 'string') continue
    for (const tag of extractTagsFromSelector(sel)) {
      if ((LANDMARK_TAGS as readonly string[]).includes(tag)) {
        return tag as LandmarkTag
      }
    }
  }
  return null
}

// ── Per-page modal landmark ────────────────────────────────────────────────

/**
 * Returns the most common landmark across the page's nodes for one rule,
 * or null when there is a tie or no landmark was detected on any node.
 */
function computeModalLandmarkForPage(
  nodes: unknown,
): LandmarkTag | null {
  if (!Array.isArray(nodes)) return null
  const counts = new Map<LandmarkTag, number>()
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const target = (node as { target?: unknown }).target
    const landmark = extractLandmarkFromTarget(
      Array.isArray(target) ? (target as string[]) : undefined,
    )
    if (landmark) counts.set(landmark, (counts.get(landmark) ?? 0) + 1)
  }
  if (counts.size === 0) return null
  let topTag: LandmarkTag | null = null
  let topCount = -1
  let tied = false
  for (const [tag, n] of counts.entries()) {
    if (n > topCount) { topTag = tag; topCount = n; tied = false }
    else if (n === topCount) { tied = true }
  }
  return tied ? null : topTag
}

// ── Cross-page vote ────────────────────────────────────────────────────────

interface VoteResult {
  sharedAncestor: LandmarkTag | null
  ancestorConfidence: AncestorConfidence | null
}

/**
 * Given a map of pageId → modalLandmark for one rule and the total number of
 * pages the rule affects, returns the cross-page winner and a confidence label.
 *
 * - 'all'      — every voting page agrees AND voters >= ceil(affectedPagesCount / 2)
 * - 'majority' — top count > affectedPagesCount / 2, no tie at the top
 * - null       — otherwise
 */
function voteAcrossPages(
  pageLandmarks: Map<string, LandmarkTag>,
  affectedPagesCount: number,
): VoteResult {
  if (pageLandmarks.size === 0) {
    return { sharedAncestor: null, ancestorConfidence: null }
  }

  const counts = new Map<LandmarkTag, number>()
  for (const tag of pageLandmarks.values()) {
    counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }

  let topTag: LandmarkTag | null = null
  let topCount = 0
  let secondCount = 0
  for (const [tag, n] of counts.entries()) {
    if (n > topCount) { secondCount = topCount; topCount = n; topTag = tag }
    else if (n > secondCount) { secondCount = n }
  }
  if (topTag === null) return { sharedAncestor: null, ancestorConfidence: null }

  // Tie at the top → null.
  if (topCount === secondCount) {
    return { sharedAncestor: null, ancestorConfidence: null }
  }

  // 'all' branch — every voter agrees AND voters are at least half of affected pages.
  const halfPages = affectedPagesCount / 2
  if (
    counts.size === 1 &&
    pageLandmarks.size >= halfPages
  ) {
    return { sharedAncestor: topTag, ancestorConfidence: 'all' }
  }

  // 'majority' branch — top must exceed strict half of affected pages.
  if (topCount > halfPages) {
    return { sharedAncestor: topTag, ancestorConfidence: 'majority' }
  }

  return { sharedAncestor: null, ancestorConfidence: null }
}

// ── Main entry ─────────────────────────────────────────────────────────────

interface RuleAccumulator {
  pageIds: Set<string>
  pageLandmarks: Map<string, LandmarkTag>
  metadata: {
    impact: ImpactLevel
    help: string
    description: string
    helpUrl: string
  }
}

function tryParseResult(result: string | null): unknown {
  if (!result) return null
  try { return JSON.parse(result) } catch { return null }
}

/**
 * Pure detection function. Scans every complete child's stored axe result,
 * counts pages affected per rule, and emits a CommonIssue when a rule
 * appears on >= COMMON_ISSUE_THRESHOLD of completed pages. Returns [] when
 * the page floor isn't met or no rule qualifies.
 *
 * Defensive: tolerates malformed JSON, missing ids, invalid impacts, and
 * non-array `nodes` — the offending entries are skipped silently.
 *
 * The caller is responsible for slicing to `COMMON_ISSUE_MAX_CALLOUTS` for
 * display — this function returns the full sorted list.
 */
export function detectCommonIssues(children: CommonIssueInputRow[]): CommonIssue[] {
  const completed = children.filter((c) => c.status === 'complete')
  const N = completed.length
  if (N < COMMON_ISSUE_MIN_PAGES) return []

  const minHits = Math.ceil(N * COMMON_ISSUE_THRESHOLD)
  const accs = new Map<string, RuleAccumulator>()

  for (const child of completed) {
    const parsed = tryParseResult(child.result) as { violations?: unknown } | null
    if (!parsed || !Array.isArray(parsed.violations)) continue

    // Track which rule ids we've already credited this page for, so 80 nodes
    // for the same rule on one page still only count as one page-hit.
    const seenThisPage = new Set<string>()

    for (const v of parsed.violations as unknown[]) {
      if (!v || typeof v !== 'object') continue
      const violation = v as {
        id?: unknown
        impact?: unknown
        help?: unknown
        description?: unknown
        helpUrl?: unknown
        nodes?: unknown
      }
      if (typeof violation.id !== 'string') continue
      if (typeof violation.impact !== 'string') continue
      if (!VALID_IMPACTS.includes(violation.impact as ImpactLevel)) continue

      const ruleId = violation.id
      const impact = violation.impact as ImpactLevel

      let acc = accs.get(ruleId)
      if (!acc) {
        acc = {
          pageIds: new Set(),
          pageLandmarks: new Map(),
          metadata: {
            impact,
            help:        typeof violation.help        === 'string' ? violation.help        : '',
            description: typeof violation.description === 'string' ? violation.description : '',
            helpUrl:     typeof violation.helpUrl     === 'string' ? violation.helpUrl     : '',
          },
        }
        accs.set(ruleId, acc)
      }

      if (!seenThisPage.has(ruleId)) {
        acc.pageIds.add(child.id)
        seenThisPage.add(ruleId)

        const modal = computeModalLandmarkForPage(violation.nodes)
        if (modal) acc.pageLandmarks.set(child.id, modal)
      }
    }
  }

  const issues: CommonIssue[] = []
  for (const [ruleId, acc] of accs.entries()) {
    if (acc.pageIds.size < minHits) continue
    const { sharedAncestor, ancestorConfidence } = voteAcrossPages(
      acc.pageLandmarks,
      acc.pageIds.size,
    )
    issues.push({
      ruleId,
      impact: acc.metadata.impact,
      help: acc.metadata.help,
      description: acc.metadata.description,
      helpUrl: acc.metadata.helpUrl,
      affectedPagesCount: acc.pageIds.size,
      totalPagesScanned: N,
      sharedAncestor,
      ancestorConfidence,
    })
  }

  // Sort: critical → serious → moderate → minor, then by affectedPagesCount desc.
  issues.sort((a, b) => {
    const r = IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact]
    if (r !== 0) return r
    return b.affectedPagesCount - a.affectedPagesCount
  })

  return issues
}
```

- [ ] **Step 2: Run tests, verify they pass**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/common-issues.test.ts
```

Expected: PASS — all suites green. If any vote-by-page or confidence test fails, fix the implementation, not the test — the tests encode the spec.

- [ ] **Step 3: Commit**

```bash
git add lib/ada-audit/common-issues.ts lib/ada-audit/common-issues.test.ts
git commit -m "feat(ada-audit): detectCommonIssues pure function + selector-segment parser"
```

---

### Task 5: Wire `detectCommonIssues` into `buildSiteAuditSummary`

**Files:**
- Modify: `lib/ada-audit/site-audit-helpers.ts`
- Modify: `lib/ada-audit/site-audit-helpers.test.ts` (if it asserts on the returned summary shape)

- [ ] **Step 1: Add the import**

At the top of `lib/ada-audit/site-audit-helpers.ts`, alongside the existing type import:

```typescript
import { detectCommonIssues } from './common-issues'
```

- [ ] **Step 2: Call it at the end of `buildSiteAuditSummary`**

Locate the final `return { aggregate, pdfsAggregate, pages }` line of `buildSiteAuditSummary`. Replace it with:

```typescript
const commonIssues = detectCommonIssues(
  children.map((c) => ({ id: c.id, status: c.status, result: c.result })),
)

return { aggregate, pdfsAggregate, pages, commonIssues }
```

(The `.map` projection makes the structural-subset assignment explicit and keeps `ChildRow`'s extra fields out of the pure function's input contract.)

- [ ] **Step 3: Update existing tests that assert on the summary shape**

```bash
grep -n "buildSiteAuditSummary" lib/ada-audit/site-audit-helpers.test.ts
```

If the existing tests do a strict `toEqual({ aggregate, pdfsAggregate, pages })` on the returned object, they will now fail because `commonIssues` is missing from the expected shape. Update those expectations to include `commonIssues: []` (the assertions are about non-callout scenarios; small test sites won't trip the callout).

- [ ] **Step 4: Run the existing suite plus the new one**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit
```

Expected: PASS — both `site-audit-helpers.test.ts` and `common-issues.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/site-audit-helpers.ts lib/ada-audit/site-audit-helpers.test.ts
git commit -m "feat(ada-audit): call detectCommonIssues inside buildSiteAuditSummary"
```

---

### Task 6: Build `<CommonIssueCallout>` component

**Files:**
- Create: `components/ada-audit/CommonIssueCallout.tsx`

No unit tests (no React testing stack in this repo). Verification happens via the production build (Task 9) and manual smoke (Task 8 wiring + Task 9 build).

- [ ] **Step 1: Read existing impact styling to keep parity**

```bash
grep -n "IMPACT_STYLES" components/ada-audit/GroupedViolationsView.tsx
```

Mirror the existing border-color / background mapping so the callout matches the by-violation cards.

- [ ] **Step 2: Create the component**

```tsx
'use client'

import { useState } from 'react'
import type { CommonIssue, ImpactLevel } from '@/lib/ada-audit/types'
import { COMMON_ISSUE_MAX_CALLOUTS } from '@/lib/ada-audit/common-issues'

interface Props {
  issues: CommonIssue[]
  onViewAffectedPages: (ruleId: string) => void
}

const IMPACT_STYLES: Record<ImpactLevel, {
  border: string
  bg: string
  badge: string
}> = {
  critical: {
    border: 'border-l-red-500 dark:border-l-red-400',
    bg: 'bg-red-50 dark:bg-red-500/10',
    badge: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400',
  },
  serious: {
    border: 'border-l-orange-500 dark:border-l-orange-400',
    bg: 'bg-orange-50 dark:bg-orange-500/10',
    badge: 'bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400',
  },
  moderate: {
    border: 'border-l-yellow-500 dark:border-l-yellow-400',
    bg: 'bg-yellow-50 dark:bg-yellow-500/10',
    badge: 'bg-yellow-100 dark:bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  },
  minor: {
    border: 'border-l-blue-500 dark:border-l-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-500/10',
    badge: 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400',
  },
}

function bodySentence(issue: CommonIssue): string {
  const { affectedPagesCount, totalPagesScanned, sharedAncestor, ancestorConfidence } = issue
  if (sharedAncestor && ancestorConfidence === 'all') {
    return `Appears on all ${totalPagesScanned} scanned pages inside <${sharedAncestor}> — likely a one-time fix in your ${sharedAncestor} template.`
  }
  if (sharedAncestor && ancestorConfidence === 'majority') {
    return `Appears on ${affectedPagesCount} of ${totalPagesScanned} scanned pages, most often inside <${sharedAncestor}>.`
  }
  return `Appears on ${affectedPagesCount} of ${totalPagesScanned} scanned pages.`
}

function Card({
  issue,
  onViewAffectedPages,
}: { issue: CommonIssue; onViewAffectedPages: (id: string) => void }) {
  const style = IMPACT_STYLES[issue.impact]
  return (
    <div className={`border border-gray-200 dark:border-navy-border ${style.bg} ${style.border} border-l-4 rounded-xl px-4 py-3 shadow-sm`}>
      <div className="flex items-start gap-3">
        <span className={`text-[10px] font-body font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${style.badge} flex-shrink-0 mt-0.5`}>
          {issue.impact}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-[14px] text-navy dark:text-white">{issue.help}</p>
          <p className="text-[12px] font-body text-navy/70 dark:text-white/70 mt-1">
            {bodySentence(issue)}
          </p>
          <div className="flex items-center gap-4 mt-2">
            <button
              type="button"
              onClick={() => onViewAffectedPages(issue.ruleId)}
              className="text-[12px] font-body font-semibold text-orange hover:underline"
            >
              View affected pages
            </button>
            {issue.helpUrl && (
              <a
                href={issue.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] font-body text-navy/60 dark:text-white/60 hover:text-orange transition-colors"
              >
                Learn more ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CommonIssueCallout({ issues, onViewAffectedPages }: Props) {
  const [expanded, setExpanded] = useState(false)
  if (issues.length === 0) return null

  const initial = issues.slice(0, COMMON_ISSUE_MAX_CALLOUTS)
  const remainder = issues.slice(COMMON_ISSUE_MAX_CALLOUTS)
  const visible = expanded ? issues : initial

  return (
    <div className="space-y-3 mb-4">
      <div>
        <h3 className="font-display font-bold text-[15px] text-navy dark:text-white">
          Likely template issues
        </h3>
        <p className="text-[12px] font-body text-navy/50 dark:text-white/50 mt-0.5">
          These violations appear across most of the scanned pages — a single fix may resolve them everywhere.
        </p>
      </div>
      <div className="space-y-2">
        {visible.map((issue) => (
          <Card key={issue.ruleId} issue={issue} onViewAffectedPages={onViewAffectedPages} />
        ))}
      </div>
      {!expanded && remainder.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[12px] font-body font-semibold text-orange hover:underline"
        >
          + {remainder.length} more
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ada-audit/CommonIssueCallout.tsx
git commit -m "feat(ada-audit): add CommonIssueCallout component"
```

---

### Task 7: Wire callout + selected-rule routing into `<SiteAuditResultsView>`

**Files:**
- Modify: `components/ada-audit/SiteAuditResultsView.tsx`

- [ ] **Step 1: Import the new component**

At the top of the file, alongside existing imports:

```typescript
import CommonIssueCallout from './CommonIssueCallout'
```

- [ ] **Step 2: Add `selectedViolationId` state**

Next to the existing `viewMode` state hook:

```typescript
const [selectedViolationId, setSelectedViolationId] = useState<string | undefined>(undefined)
```

- [ ] **Step 3: Render the callout above `<SiteAuditToolbar>`**

Locate the existing `<SiteAuditToolbar …>` (around line 243 per the spec). Immediately before it, inside the "Pages with Issues" section's card body, insert:

```tsx
{(summary.commonIssues ?? []).length > 0 && (
  <CommonIssueCallout
    issues={summary.commonIssues ?? []}
    onViewAffectedPages={(ruleId) => {
      setViewMode('by-violation')
      setSelectedViolationId(ruleId)
    }}
  />
)}
```

- [ ] **Step 4: Forward `selectedViolationId` to `<GroupedViolationsView>`**

Locate the `<GroupedViolationsView …>` render and add the prop:

```tsx
<GroupedViolationsView
  // …existing props…
  selectedViolationId={selectedViolationId}
/>
```

- [ ] **Step 5: Typecheck**

```bash
npm run lint
```

Expected: FAIL — `GroupedViolationsView` doesn't accept `selectedViolationId` yet. That's Task 8.

---

### Task 8: Auto-expand + scroll-to in `<GroupedViolationsView>`

**Files:**
- Modify: `components/ada-audit/GroupedViolationsView.tsx`

- [ ] **Step 1: Read the existing component to find the expansion state shape**

```bash
grep -n "useState\|expanded\|ruleId" components/ada-audit/GroupedViolationsView.tsx | head -30
```

Identify how the component currently tracks which rule card is expanded (typically a `useState<Set<string>>()` or a `useState<string | null>()`).

- [ ] **Step 2: Accept the optional prop**

Update the component's props type:

```typescript
interface Props {
  // …existing fields…
  selectedViolationId?: string
}
```

And destructure it in the function signature.

**Important — current component shape:**
- `GroupedViolation.id` (NOT `ruleId`) is the rule identifier (`useGroupedViolations.ts`).
- `ViolationCard` owns its own `expanded` state internally (`useState(false)` at the top of the component) — there's no parent-level `expandedRuleIds` set today.
- Refactor `ViolationCard` to accept `forceExpanded?: boolean` and a forwarded `ref` so the parent can both expand and scroll-to it.

- [ ] **Step 3: Lift expansion into a forced-open signal**

Modify `ViolationCard` to accept two new props:

```tsx
const ViolationCard = forwardRef<HTMLDivElement, { violation: GroupedViolation; forceExpanded?: boolean }>(
  ({ violation, forceExpanded }, ref) => {
    const [expanded, setExpanded] = useState(false)
    // When forceExpanded flips to true, open the card. Don't lock it open —
    // user can still collapse afterwards.
    useEffect(() => {
      if (forceExpanded) setExpanded(true)
    }, [forceExpanded])
    // …existing rendering, but use `ref` on the outer card wrapper
  }
)
ViolationCard.displayName = 'ViolationCard'
```

- [ ] **Step 4: Add a ref map keyed by `violation.id`**

In `GroupedViolationsView` (the parent), near the top of the function body:

```typescript
const cardRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
```

In the JSX where each `ViolationCard` is rendered, attach a callback ref keyed by `violation.id` and the `forceExpanded` prop:

```tsx
<ViolationCard
  key={violation.id}
  violation={violation}
  forceExpanded={violation.id === selectedViolationId}
  ref={(el) => { cardRefs.current.set(violation.id, el) }}
/>
```

- [ ] **Step 5: Add the effect that scrolls the selected card into view**

```typescript
useEffect(() => {
  if (!selectedViolationId) return
  const exists = groupedViolations.some((g) => g.id === selectedViolationId)
  if (!exists) return

  // Scroll on the next paint so the DOM has rendered the expanded card.
  const id = window.requestAnimationFrame(() => {
    const el = cardRefs.current.get(selectedViolationId)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
  return () => window.cancelAnimationFrame(id)
}, [selectedViolationId, groupedViolations])
```

The expansion itself is driven by the `forceExpanded` prop on `ViolationCard` — the parent doesn't need a separate `expandedRuleIds` state.

- [ ] **Step 6: Typecheck**

```bash
npm run lint
```

Expected: PASS — Task 7's `selectedViolationId` prop now flows through.

- [ ] **Step 7: Commit Tasks 7 + 8 together**

```bash
git add components/ada-audit/SiteAuditResultsView.tsx components/ada-audit/GroupedViolationsView.tsx
git commit -m "feat(ada-audit): render CommonIssueCallout + auto-focus selected rule in GroupedViolationsView"
```

---

### Task 9: Lint + full test suite + production build

**Files:** none.

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 2: Full test suite**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run
```

Expected: PASS — including the ~20 new tests from `common-issues.test.ts` plus any tweaks in `site-audit-helpers.test.ts`.

- [ ] **Step 3: Production build**

```bash
rm -rf .next && npm run build
```

Expected: clean build, no TS errors, no missing-module errors.

- [ ] **Step 4: Optional dev smoke**

If a completed site audit is reachable on local dev:

```bash
npm run dev
```

Navigate to the audit's detail page and verify:

- "Likely template issues" section appears above the toolbar when ≥1 callout
- Card body sentence matches the confidence-aware forms in the spec
- "View affected pages" switches to the by-violation tab AND expands + scrolls to the targeted rule
- "Learn more ↗" opens the axe help URL in a new tab
- "+ N more" expander shows remainder beyond `COMMON_ISSUE_MAX_CALLOUTS`
- On a < 5-page audit, the section is hidden entirely

---

### Task 10: Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/ada-common-issue-callout
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(ada-audit): common-issue callout above pages-with-issues toolbar" --body "$(cat <<'EOF'
## Summary
When a site audit completes, violation rules that appear on ≥80% of successfully scanned pages now surface as cards above the Pages with Issues toolbar. Each card tells the operator: which rule fired, how many pages it affects, and — when detectable from stored CSS selector data — which shared template region (header/footer/nav/aside/main) is the likely source. The "View affected pages" CTA jumps to the by-violation tab AND auto-expands the matching rule card AND scrolls it into view, so the operator never has to manually search.

## What changed
- New pure function `detectCommonIssues` in `lib/ada-audit/common-issues.ts`. Heavily tested — pure-function, no DB access, defensive against malformed result JSON, missing ids, null impacts, non-array nodes.
- Selector-segment-aware tag extractor avoids false positives from `:not(footer)` and `[data-region="footer"]` — both of which a naive regex would mis-credit to the footer landmark.
- **Vote-by-page**, not vote-by-node: a rule with 80 footer nodes on one page and 1 main node on each of 9 other pages does NOT vote "footer" — each page contributes one vote (its modal landmark), and the cross-page vote determines confidence.
- Confidence levels per spec: `'all'` requires every voting page to agree AND ≥ half of affected pages contributed a vote; `'majority'` requires strictly >50% and no tie; `null` otherwise.
- `detectCommonIssues(children)` called once from `buildSiteAuditSummary`. No new DB columns — `commonIssues` lives inside the existing `SiteAudit.summary` JSON.
- `<CommonIssueCallout>` renders up to `COMMON_ISSUE_MAX_CALLOUTS` (5) cards with a "+ N more" expander.
- `<SiteAuditResultsView>` tracks `selectedViolationId` state; `<GroupedViolationsView>` accepts it and auto-expands + scrolls the matching card on mount/change.

## Test plan
- [x] `extractTagsFromSelector`: simple chains, `:not(footer)` skipped, attribute-selector content skipped, no-bare-tag yields empty
- [x] `extractLandmarkFromTarget`: positive cases, `#footer-widget > a` returns null, undefined / empty target handled
- [x] `detectCommonIssues` gates: below-floor returns `[]`, below-threshold returns `[]`, exact 80% boundary qualifies, errored pages excluded from N and counts
- [x] Defensive guards: missing id, null/invalid impact, non-array nodes, malformed JSON — all skipped without throwing
- [x] Vote-by-page: 80 footer nodes on one page vs. 1 main-node on 9 pages → main wins (not footer)
- [x] Confidence: `'all'` requires unanimous voters + ≥ half of pages voting, `'majority'` requires strict >50% no tie, tie/sparse → null
- [x] Output sort: critical → minor first, then by pageCount desc
- [x] Lint passes, full vitest suite passes, production build clean

## Out of scope
- No new schema or migration — `commonIssues` is denormalized inside `SiteAudit.summary`
- No callout on the per-page `/ada-audit/[id]` view — "appears on every page" only exists in a site audit context
- No threshold UI — constants live in one place; operator who needs a different value edits and re-deploys

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return PR URL**

---

## Self-review checklist

- [x] **Spec coverage**: every spec section maps to a task. Types → Task 2. Detection algorithm + selector parser → Tasks 3+4 (TDD). Integration into `buildSiteAuditSummary` → Task 5. UI component → Task 6. Routing + state → Task 7. Auto-expand + scroll → Task 8.
- [x] **TDD throughout the analysis layer**: Task 3 writes failing tests covering every spec edge case (selector parsing, vote-by-page, confidence boundaries, defensive guards, sort). Task 4 implements only enough to make those tests pass.
- [x] **No placeholders**: all code blocks contain working code, except the small "adapt to whatever state shape this component uses" note in Task 8 — flagged as such because `GroupedViolationsView`'s expansion state is whatever the prior PR landed and the plan can't predict it exactly.
- [x] **Type consistency**: `CommonIssue` shape declared in Task 2 matches what `detectCommonIssues` returns in Task 4, what `buildSiteAuditSummary` persists in Task 5, what `<CommonIssueCallout>` consumes in Task 6, and what `summary.commonIssues ?? []` reads in Task 7.
- [x] **No DB or React in the pure function**: Task 4 explicitly defines `CommonIssueInputRow` as a structural subset of `ChildRow` to avoid cross-importing; the module imports only types from `./types`.
- [x] **No schema migration**: confirmed in the spec — `commonIssues` lives inside the existing `SiteAudit.summary` String? column. Older rows without the field decode to `undefined`; consumers default to `[]`.
- [x] **`Math.ceil` for the threshold**: Task 4 uses `Math.ceil(N * COMMON_ISSUE_THRESHOLD)`. Task 3 has an explicit boundary test at N=5, hits=4.
- [x] **Vote-by-page guarded**: Task 3 includes the 80-footer-nodes-on-one-page-vs-1-main-node-on-9-pages test. Task 4 sets `seenThisPage` to dedupe per-page rule hits and uses `computeModalLandmarkForPage` to fold within-page nodes to one vote.
- [x] **`selectedViolationId` routing wired**: Task 7 sets it from the callout's CTA; Task 8 consumes it in `GroupedViolationsView` to expand + scroll. Without this gap the user lands on the by-violation tab and has to scroll/search manually — codex flagged this.
