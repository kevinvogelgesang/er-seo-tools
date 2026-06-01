# PSI Accessibility Reframe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop presenting PSI's accessibility findings/score as a competing result: hide PSI a11y findings already caught by our primary axe scan, loudly surface PSI-only findings with a verify-this disclaimer, hide the Lighthouse "Best practices" a11y group, and remove the PSI accessibility score card from the score grid.

**Architecture:** One pure helper, `splitPsiAccessibility(summary, axeViolationIds)`, partitions PSI a11y audits into `psiOnly` / `duplicates` / `hiddenBestPractice` (exact rule-ID match, since Lighthouse a11y audit IDs are axe rule IDs). The render layer (`LighthouseSection`) is authoritative — it filters old stored summaries with no migration. The same helper is later reused server-side by the sibling ACE auto-trigger.

**Tech Stack:** Next.js 15 (App Router), TypeScript, React 19, Tailwind, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-29-psi-a11y-reframe-design.md`

**Reviewed:** Codex (ACCEPT WITH NAMED FIXES) 2026-05-29 — fixes applied: jsdom test pragma + no-jest-dom assertions, scoped score-grid assertion (`data-testid="lh-score-grid"`), simplified test typing, no duplicate `LighthouseSummary` import, explicit `useMemo` import, all-duplicated test, collapse-vs-reassurance reconciled.

---

## File Structure

- **Create** `lib/ada-audit/psi-a11y-split.ts` — pure split helper (no prisma, no React).
- **Create** `lib/ada-audit/psi-a11y-split.test.ts` — unit tests for the helper.
- **Modify** `components/ada-audit/LighthouseSection.tsx` — drop Accessibility score card; rewrite `AccessibilityBreakdown` to consume the helper; add disclaimer + suppressed-count; accept `axeViolationIds` prop.
- **Modify** `components/ada-audit/AuditResultsView.tsx:51,167` — compute `axeViolationIds` from `results.violations` and pass to `<LighthouseSection>`.
- **Create** `components/ada-audit/LighthouseSection.test.tsx` — render tests for dedup/PSI-only/empty/best-practices-on-old-summary.

Types already exist in `lib/ada-audit/lighthouse-types.ts`: `LighthouseSummary`, `LighthouseAccessibility`, `LighthouseA11yGroup`, `LighthouseA11yAudit`. `BEST_PRACTICES_GROUP_ID = 'a11y-best-practices'` is introduced by the helper (confirm against a live LHR during the ACE smoke test or by inspecting any stored summary with that group; the Molloy row has it).

---

## Task 1: The pure split helper

**Files:**
- Create: `lib/ada-audit/psi-a11y-split.ts`
- Test: `lib/ada-audit/psi-a11y-split.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ada-audit/psi-a11y-split.test.ts
import { describe, it, expect } from 'vitest'
import { splitPsiAccessibility } from './psi-a11y-split'
import type { LighthouseSummary } from './lighthouse-types'

function summaryWith(groups: LighthouseSummary['accessibility']): LighthouseSummary {
  return {
    scores: { performance: 100, accessibility: 50, bestPractices: 88 },
    cwv: { lcp: 0, cls: 0, tbt: 0, lcpStatus: 'pass', clsStatus: 'pass', tbtStatus: 'pass' },
    topFailures: [],
    accessibility: groups as LighthouseSummary['accessibility'],
  }
}

const baseAccessibility = {
  score: 50,
  groups: [
    { id: 'a11y-names-labels', title: 'Names and labels', description: '', audits: [
      { id: 'document-title', title: 'No <title>', description: '', failingElements: [{ snippet: '<html>' }] },
      { id: 'image-alt', title: 'Images missing alt', description: '', failingElements: [{ snippet: '<img>' }] },
    ] },
    { id: 'a11y-best-practices', title: 'Best practices', description: '', audits: [
      { id: 'landmark-one-main', title: 'No main landmark', description: '', failingElements: [{ snippet: '<html>' }] },
    ] },
  ],
}

describe('splitPsiAccessibility', () => {
  it('returns empty buckets for null summary', () => {
    const r = splitPsiAccessibility(null, new Set())
    expect(r).toEqual({ psiOnly: [], duplicates: [], hiddenBestPractice: [] })
  })

  it('drops the a11y-best-practices group into hiddenBestPractice', () => {
    const r = splitPsiAccessibility(summaryWith(baseAccessibility), new Set())
    expect(r.hiddenBestPractice.map(a => a.id)).toEqual(['landmark-one-main'])
  })

  it('splits remaining audits into psiOnly vs duplicates by exact rule id', () => {
    const r = splitPsiAccessibility(summaryWith(baseAccessibility), new Set(['image-alt']))
    expect(r.duplicates.map(a => a.id)).toEqual(['image-alt'])
    expect(r.psiOnly.map(a => a.id)).toEqual(['document-title'])
  })

  it('treats missing accessibility section as empty', () => {
    const s = summaryWith(baseAccessibility); delete (s as any).accessibility
    expect(splitPsiAccessibility(s, new Set())).toEqual({ psiOnly: [], duplicates: [], hiddenBestPractice: [] })
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run lib/ada-audit/psi-a11y-split.test.ts`
Expected: FAIL — `splitPsiAccessibility` is not defined / module not found.

- [ ] **Step 3: Implement the helper**

```ts
// lib/ada-audit/psi-a11y-split.ts
//
// Pure partition of PSI/Lighthouse accessibility audits relative to our
// primary axe scan. No prisma, no React — usable at render time AND
// server-side (sibling ACE auto-trigger). See
// docs/superpowers/specs/2026-05-29-psi-a11y-reframe-design.md
import type { LighthouseSummary, LighthouseA11yAudit } from './lighthouse-types'

// Lighthouse's non-conformance "Best practices" a11y group. Blocklisted
// (not an allowlist) so a future WCAG group is never silently dropped.
export const BEST_PRACTICES_GROUP_ID = 'a11y-best-practices'

export interface PsiA11ySplit {
  psiOnly: LighthouseA11yAudit[]       // surface with disclaimer
  duplicates: LighthouseA11yAudit[]    // hide — already covered by primary axe scan
  hiddenBestPractice: LighthouseA11yAudit[] // dropped — non-WCAG best-practice group
}

export function splitPsiAccessibility(
  summary: LighthouseSummary | null | undefined,
  axeViolationIds: Set<string>,
): PsiA11ySplit {
  const out: PsiA11ySplit = { psiOnly: [], duplicates: [], hiddenBestPractice: [] }
  const groups = summary?.accessibility?.groups
  if (!groups) return out
  for (const group of groups) {
    const isBestPractice = group.id === BEST_PRACTICES_GROUP_ID
    for (const audit of group.audits) {
      if (isBestPractice) out.hiddenBestPractice.push(audit)
      else if (axeViolationIds.has(audit.id)) out.duplicates.push(audit)
      else out.psiOnly.push(audit)
    }
  }
  return out
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run lib/ada-audit/psi-a11y-split.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/psi-a11y-split.ts lib/ada-audit/psi-a11y-split.test.ts
git commit -m "feat(ada): pure splitPsiAccessibility helper (psiOnly/duplicates/best-practice)"
```

---

## Task 2: Rewrite LighthouseSection to consume the split + drop the a11y score card

**Files:**
- Modify: `components/ada-audit/LighthouseSection.tsx`

- [ ] **Step 1: Change the Props and the score grid**

Replace the `Props` interface (lines 24–27) and the default export signature (line 29) so the component accepts the axe IDs, and remove the Accessibility card from the score grid (lines 47–58 → two columns):

```tsx
interface Props {
  summary: LighthouseSummary | null
  error?: string | null
  axeViolationIds?: Set<string>   // ids of violations our primary axe scan found
}

export default function LighthouseSection({ summary, error, axeViolationIds }: Props) {
```

> **Import note (Codex fix):** the file already imports `LighthouseSummary` from `@/lib/ada-audit/lighthouse-types` (line 3–7). Do **not** add a second import from that module in Step 3 — extend the existing import to add `LighthouseA11yAudit` and drop the now-unused `LighthouseAccessibility`, and add `import { splitPsiAccessibility } from '@/lib/ada-audit/psi-a11y-split'` as a separate new line.

Replace the score grid block (the `grid grid-cols-3` of Performance/Accessibility/Best Practices) with a two-column grid that omits Accessibility (PSI a11y is no longer presented as a peer compliance score):

```tsx
      {/* Scores — Accessibility intentionally omitted: PSI a11y is not a
          compliance signal (it's axe on Google's render). See spec. */}
      <div data-testid="lh-score-grid" className="grid grid-cols-2 gap-3">
        {[
          { label: 'Performance', value: s.scores.performance },
          { label: 'Best Practices', value: s.scores.bestPractices },
        ].map((c) => (
          <div key={c.label} className={`rounded-xl p-4 text-center ${scoreColor(c.value)}`}>
            <div className="font-display font-bold text-2xl">{c.value}</div>
            <div className="text-[11px] uppercase tracking-wider font-body">{c.label}</div>
          </div>
        ))}
      </div>
```

- [ ] **Step 2: Pass the ids into the breakdown**

Change line 82 from `{s.accessibility && <AccessibilityBreakdown accessibility={s.accessibility} />}` to:

```tsx
      <AccessibilityBreakdown summary={s} axeViolationIds={axeViolationIds ?? new Set()} />
```

- [ ] **Step 3: Rewrite `AccessibilityBreakdown` to use the helper**

Replace the entire `AccessibilityBreakdown` function (lines 87–150) with a version that splits, hides duplicates + best-practices, and surfaces PSI-only under a disclaimer:

Imports go at the top of the file (see Import note above); they are NOT repeated inside this code block.

```tsx
function AccessibilityBreakdown({ summary, axeViolationIds }: { summary: LighthouseSummary; axeViolationIds: Set<string> }) {
  const { psiOnly, duplicates } = splitPsiAccessibility(summary, axeViolationIds)
  if (psiOnly.length === 0) {
    // Intentional design (reconciles spec's "empty-section collapse"): when
    // there is nothing PSI-only to show, render a single quiet reassurance line
    // (optionally with a suppressed count) rather than literally nothing — never
    // a competing score. "Collapse" in the spec means "no findings list/score
    // card," which this satisfies.
    return (
      <div className="pt-4 border-t border-gray-100 dark:border-navy-border text-[12px] font-body text-navy/50 dark:text-white/50">
        Google PageSpeed Insights found no accessibility issues beyond our primary scan.
        {duplicates.length > 0 && ` (${duplicates.length} PSI item${duplicates.length === 1 ? '' : 's'} suppressed as already covered.)`}
      </div>
    )
  }
  return (
    <div className="pt-4 border-t border-gray-100 dark:border-navy-border">
      <div className="font-display font-bold text-[15px] text-navy dark:text-white mb-1">
        Flagged by PageSpeed Insights only
      </div>
      <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 p-3 mb-3 text-[12px] font-body text-amber-800 dark:text-amber-300">
        ⚠️ Flagged by Google PageSpeed Insights, not by our primary scan. PSI renders the page from Google&rsquo;s own servers
        (different region, fresh session, desktop viewport) and is occasionally served a different or incompletely-loaded page.
        This may not reflect what your visitors experience — <strong>verify on the live page before reporting.</strong>
        {duplicates.length > 0 && <span className="block mt-1 text-amber-700/70 dark:text-amber-300/70">{duplicates.length} other PSI item{duplicates.length === 1 ? '' : 's'} suppressed as already covered by the primary scan.</span>}
      </div>
      <ul className="space-y-1">
        {psiOnly.map((audit: LighthouseA11yAudit) => (
          <li key={audit.id} className="border-t border-gray-100 dark:border-navy-border">
            <details className="group">
              <summary className="flex items-start gap-2 py-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <span className="text-amber-500 dark:text-amber-400 flex-shrink-0 mt-0.5" aria-hidden="true">▲</span>
                <span className="text-[13px] font-body text-navy dark:text-white flex-1">{audit.title}</span>
                <span className="text-navy/40 dark:text-white/40 transition-transform group-open:rotate-180" aria-hidden="true">▾</span>
              </summary>
              <div className="pl-6 pb-3 space-y-2">
                {audit.description && <p className="text-[12px] font-body text-navy/60 dark:text-white/60">{audit.description}</p>}
                {audit.failingElements.length > 0 && (
                  <ul className="space-y-1">
                    {audit.failingElements.map((el, i) => (
                      <li key={i} className="bg-gray-50 dark:bg-navy-deep border border-gray-100 dark:border-navy-border rounded px-2 py-1.5 text-[11px] font-mono text-navy/70 dark:text-white/70 overflow-x-auto">
                        <code className="whitespace-pre-wrap break-all">{el.snippet}</code>
                        {el.selector && <div className="text-navy/40 dark:text-white/40 text-[10px] mt-1">{el.selector}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (The old `LighthouseAccessibility` import may now be unused — remove it if `tsc`/lint flags it.)

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/LighthouseSection.tsx
git commit -m "feat(ada): reframe PSI a11y — drop score card, surface PSI-only with disclaimer"
```

---

## Task 3: Wire axe violation IDs from AuditResultsView

**Files:**
- Modify: `components/ada-audit/AuditResultsView.tsx`

- [ ] **Step 1: Compute the id set and pass it**

First widen the React import on line 3 — it is currently `import { useEffect, useState } from 'react'`; change it to `import { useEffect, useMemo, useState } from 'react'`. Then, at the top of the component body (after line 52 `const scorecard = buildScorecard(results)`), add a memoized set.

```tsx
  const axeViolationIds = useMemo(
    () => new Set(results.violations.map((v) => v.id)),
    [results.violations],
  )
```

Change the LighthouseSection usage (line 167) to:

```tsx
      <LighthouseSection summary={lighthouseSummary} error={lighthouseError} axeViolationIds={axeViolationIds} />
```

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit && npx next build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/ada-audit/AuditResultsView.tsx
git commit -m "feat(ada): pass axe violation ids into LighthouseSection for PSI dedup"
```

---

## Task 4: Render tests

**Files:**
- Create: `components/ada-audit/LighthouseSection.test.tsx`

- [ ] **Step 1: Write the tests**

Repo convention (confirmed): component tests start with the `// @vitest-environment jsdom` pragma (repo default env is `node`), and **`@testing-library/jest-dom` is NOT installed** — so use plain `getByText` (throws if absent) + `queryByText(...)` with `.toBeTruthy()` / `.toBeNull()`, never `toBeInTheDocument()`. Scope the "Accessibility" check to the score-grid labels rather than a fragile whole-component query.

```tsx
// @vitest-environment jsdom
// components/ada-audit/LighthouseSection.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import LighthouseSection from './LighthouseSection'
import type { LighthouseSummary } from '@/lib/ada-audit/lighthouse-types'

const summary: LighthouseSummary = {
  scores: { performance: 100, accessibility: 50, bestPractices: 88 },
  cwv: { lcp: 100, cls: 0, tbt: 0, lcpStatus: 'pass', clsStatus: 'pass', tbtStatus: 'pass' },
  topFailures: [],
  accessibility: {
    score: 50,
    groups: [
      { id: 'a11y-names-labels', title: 'Names and labels', description: '', audits: [
        { id: 'document-title', title: 'No title element', description: '', failingElements: [{ snippet: '<html>' }] },
        { id: 'image-alt', title: 'Images missing alt', description: '', failingElements: [{ snippet: '<img>' }] },
      ] },
      { id: 'a11y-best-practices', title: 'Best practices', description: '', audits: [
        { id: 'landmark-one-main', title: 'No main landmark', description: '', failingElements: [{ snippet: '<html>' }] },
      ] },
    ],
  },
}

describe('LighthouseSection PSI a11y reframe', () => {
  it('score grid shows only Performance and Best Practices (no Accessibility card)', () => {
    render(<LighthouseSection summary={summary} axeViolationIds={new Set()} />)
    const grid = screen.getByTestId('lh-score-grid')   // testid added in Task 2
    expect(within(grid).getByText('Performance')).toBeTruthy()
    expect(within(grid).getByText('Best Practices')).toBeTruthy()
    expect(within(grid).queryByText('Accessibility')).toBeNull()
  })

  it('hides duplicates and best-practice; surfaces PSI-only with disclaimer', () => {
    render(<LighthouseSection summary={summary} axeViolationIds={new Set(['image-alt'])} />)
    expect(screen.getByText('No title element')).toBeTruthy()        // psiOnly
    expect(screen.queryByText('Images missing alt')).toBeNull()      // duplicate, hidden
    expect(screen.queryByText('No main landmark')).toBeNull()        // best-practice, hidden
    expect(screen.getByText(/verify on the live page/i)).toBeTruthy()
    expect(screen.getByText(/1 other PSI item suppressed/i)).toBeTruthy()
  })

  it('best-practice filtering applies to an old stored summary at render time', () => {
    // Only the best-practice group present → no psiOnly, quiet reassurance line.
    const onlyBP: LighthouseSummary = { ...summary, accessibility: { score: 88, groups: [summary.accessibility!.groups[1]] } }
    render(<LighthouseSection summary={onlyBP} axeViolationIds={new Set()} />)
    expect(screen.getByText(/no accessibility issues beyond our primary scan/i)).toBeTruthy()
    expect(screen.queryByText('No main landmark')).toBeNull()
  })

  it('all PSI audits duplicated → reassurance line with suppressed count, no findings', () => {
    render(<LighthouseSection summary={summary} axeViolationIds={new Set(['document-title', 'image-alt'])} />)
    expect(screen.getByText(/no accessibility issues beyond our primary scan/i)).toBeTruthy()
    expect(screen.getByText(/2 PSI items suppressed as already covered/i)).toBeTruthy()
    expect(screen.queryByText('No title element')).toBeNull()
  })
})
```

- [ ] **Step 2: Run, verify pass**

Run: `npx vitest run components/ada-audit/LighthouseSection.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add components/ada-audit/LighthouseSection.test.tsx
git commit -m "test(ada): cover PSI a11y reframe (dedup, PSI-only, old-summary best-practice)"
```

---

## Task 5: Full verification

- [ ] **Step 1: Run the full suite + build**

Run: `npx vitest run && npx tsc --noEmit && npx next build`
Expected: all green.

- [ ] **Step 2: Manual smoke (optional, local)**

Open any completed audit detail page locally; confirm: no Accessibility score card in the Lighthouse grid; PSI-only items appear with the amber disclaimer; an audit whose only PSI issues match axe shows the quiet reassurance line.

- [ ] **Step 3: Commit any fixups**

```bash
git commit -am "chore(ada): PSI a11y reframe verification fixups" || true
```

---

## Self-Review (completed)

- **Spec coverage:** hide duplicates (Task 2/3), surface PSI-only + disclaimer (Task 2), hide best-practices group (Task 1 helper), remove a11y score card (Task 2), shared helper reused server-side later (Task 1 — pure, exported), old-summary filtering at render (Task 1+2, tested Task 4), both-sides-missing guards (helper handles null summary; `axeViolationIds` defaults to empty set), tests (Task 1, Task 4). ✓
- **Placeholders:** none — all code shown. ✓
- **Type consistency:** `splitPsiAccessibility(summary, Set<string>)`, `PsiA11ySplit`, prop `axeViolationIds?: Set<string>` consistent across helper, LighthouseSection, AuditResultsView. ✓
