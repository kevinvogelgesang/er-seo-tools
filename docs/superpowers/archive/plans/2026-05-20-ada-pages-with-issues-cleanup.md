# ADA Audit — Pages with Issues Cleanup Implementation Plan (PR 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the "Pages with Issues" section of a completed site audit: remove the underused Paths (sitemap-tree) view, replace the three-icon view toggle with a labeled two-button control (`Pages` / `Violations`), fix three broken filter behaviors (Critical/Serious/Moderate/Minor drop error + null-scorecard pages; the Errors pill silently calls `'all'` and never lights up), and wire the Critical/Serious/Moderate/Minor scorecard tiles to be clickable shortcuts that scroll to and activate the matching filter in Pages view.

**Architecture:** All changes are presentational in `components/ada-audit/`. The filter logic lives in a hook (`useSiteAuditPages.ts`) whose pure predicates (`filterByImpact`, `computeCounts`) are exported and unit-tested with Vitest. The UI changes (toolbar, scorecard, results view wiring) are verified via lint + production build + a manual acceptance pass — there is no React Testing Library coverage for these components today and adding it is out of scope.

**Tech Stack:** Next.js 15 App Router · TypeScript · Tailwind (class-based dark mode) · Vitest

**Companion spec:** `docs/superpowers/specs/2026-05-20-ada-pages-with-issues-cleanup-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `components/ada-audit/useSiteAuditPages.ts` | Modify | Export `filterByImpact` and `computeCounts`. Add `'error'` to `ImpactFilter` union. Fix `filterByImpact` to pass through error + null-scorecard pages on impact filters; add `'error'` branch returning only `status === 'error'` pages. |
| `components/ada-audit/useSiteAuditPages.test.ts` | Create | Vitest unit tests for `filterByImpact` and `computeCounts`. |
| `components/ada-audit/SiteAuditToolbar.tsx` | Modify | Remove `'sitemap'` from `ViewMode` union. Replace three-icon segmented control with a labeled two-button control (`[ Pages (N) ] [ Violations (M) ]`). Fix Errors pill `onClick` to toggle `'error'` ↔ `'all'`; update active state; remove misleading tooltip. |
| `components/ada-audit/AuditScorecard.tsx` | Modify | Add optional `onImpactClick?` and `activeImpact?` props. Render impact tiles as `<button>` when prop present AND `count > 0`; otherwise `<div>`. Apply `ring-2 ring-orange/50` when `tile.impact === activeImpact`. |
| `components/ada-audit/SiteAuditResultsView.tsx` | Modify | Remove the sitemap render branch; remove the `SitemapTreeView` import. Default `viewMode` to `'table'`. Add `pagesWithIssuesRef`. Pass `onImpactClick` + `activeImpact` to `AuditScorecard`. Handler sets `filterImpact` (toggle to `'all'` when re-clicked), switches `viewMode` to `'table'`, resets `currentPage` to 1, scrolls the ref smoothly. |
| `components/ada-audit/SitemapTreeView.tsx` | Untouched | Stays on disk as dead code per spec section 3. No edits, no import. |

---

### Task 1: Branch + working tree

**Files:** none

- [ ] **Step 1: Pull latest main**

```bash
git checkout main && git pull origin main
```

- [ ] **Step 2: Create the feature branch**

```bash
git checkout -b feat/ada-pages-with-issues-cleanup
```

---

### Task 2: Export `filterByImpact` / `computeCounts` + write failing unit tests (TDD)

**Files:**
- Modify: `components/ada-audit/useSiteAuditPages.ts`
- Create: `components/ada-audit/useSiteAuditPages.test.ts`

**Why paired:** the predicate fix lives in Task 3. This task only (a) exports the two pure functions so a test file can import them and (b) writes the tests that encode the *new* (correct) behavior. The tests must compile (real imports, not `is not exported` errors), then fail because the predicate still has the old behavior. That confirms the failure mode is "wrong filter output," which is what the fix in Task 3 will flip.

- [ ] **Step 1: Export the two pure helpers from `useSiteAuditPages.ts`**

Open `components/ada-audit/useSiteAuditPages.ts`. Locate the existing private `filterByImpact` function and the existing private `computeCounts` function. Add `export` to both declarations. Also `export` the `ImpactFilter` type if it is not already exported (it must be importable from the test file).

No logic changes in this step — only visibility. The predicate still has the old buggy behavior (`p.scorecard && p.scorecard[impact] > 0`) and there is still no `'error'` branch. That is intentional: the failing test in Step 2 needs the broken code to fail against.

- [ ] **Step 2: Write the failing tests**

Create `components/ada-audit/useSiteAuditPages.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  filterByImpact,
  computeCounts,
  type ImpactFilter,
} from './useSiteAuditPages'

// Minimal shape — only the fields the predicates read.
type Page = Parameters<typeof filterByImpact>[0][number]

function p(overrides: Partial<Page>): Page {
  return {
    url: 'https://x/p',
    status: 'complete',
    scorecard: { critical: 0, serious: 0, moderate: 0, minor: 0, total: 0, passed: 0, incomplete: 0 },
    ...overrides,
  } as Page
}

describe('filterByImpact', () => {
  const errorPage      = p({ url: 'https://x/err',  status: 'error',    scorecard: null })
  const nullScorecard  = p({ url: 'https://x/null', status: 'complete', scorecard: null })
  const criticalPage   = p({ url: 'https://x/crit', scorecard: { critical: 2, serious: 0, moderate: 0, minor: 0, total: 2, passed: 0, incomplete: 0 } })
  const seriousPage    = p({ url: 'https://x/ser',  scorecard: { critical: 0, serious: 3, moderate: 0, minor: 0, total: 3, passed: 0, incomplete: 0 } })
  const moderatePage   = p({ url: 'https://x/mod',  scorecard: { critical: 0, serious: 0, moderate: 1, minor: 0, total: 1, passed: 0, incomplete: 0 } })
  const minorPage      = p({ url: 'https://x/min',  scorecard: { critical: 0, serious: 0, moderate: 0, minor: 4, total: 4, passed: 0, incomplete: 0 } })
  const cleanPage      = p({ url: 'https://x/ok',   scorecard: { critical: 0, serious: 0, moderate: 0, minor: 0, total: 0, passed: 10, incomplete: 0 } })

  const all = [errorPage, nullScorecard, criticalPage, seriousPage, moderatePage, minorPage, cleanPage]

  it("'all' returns the input unchanged", () => {
    expect(filterByImpact(all, 'all')).toEqual(all)
  })

  it("'critical' returns critical pages PLUS error and null-scorecard pages", () => {
    const out = filterByImpact(all, 'critical')
    const urls = out.map((r) => r.url).sort()
    expect(urls).toEqual([errorPage.url, nullScorecard.url, criticalPage.url].sort())
  })

  it("'serious' returns serious pages PLUS error and null-scorecard pages", () => {
    const out = filterByImpact(all, 'serious')
    const urls = out.map((r) => r.url).sort()
    expect(urls).toEqual([errorPage.url, nullScorecard.url, seriousPage.url].sort())
  })

  it("'moderate' returns moderate pages PLUS error and null-scorecard pages", () => {
    const out = filterByImpact(all, 'moderate')
    const urls = out.map((r) => r.url).sort()
    expect(urls).toEqual([errorPage.url, nullScorecard.url, moderatePage.url].sort())
  })

  it("'minor' returns minor pages PLUS error and null-scorecard pages", () => {
    const out = filterByImpact(all, 'minor')
    const urls = out.map((r) => r.url).sort()
    expect(urls).toEqual([errorPage.url, nullScorecard.url, minorPage.url].sort())
  })

  it("'error' returns only pages where status === 'error'", () => {
    const out = filterByImpact(all, 'error' as ImpactFilter)
    expect(out.map((r) => r.url)).toEqual([errorPage.url])
  })
})

describe('computeCounts', () => {
  it('counts errors, impact-bearing pages, and total independently', () => {
    const pages = [
      p({ url: 'https://x/e1', status: 'error', scorecard: null }),
      p({ url: 'https://x/e2', status: 'error', scorecard: null }),
      p({ url: 'https://x/c',  scorecard: { critical: 1, serious: 0, moderate: 0, minor: 0, total: 1, passed: 0, incomplete: 0 } }),
      p({ url: 'https://x/s',  scorecard: { critical: 0, serious: 2, moderate: 0, minor: 0, total: 2, passed: 0, incomplete: 0 } }),
      p({ url: 'https://x/ok', scorecard: { critical: 0, serious: 0, moderate: 0, minor: 0, total: 0, passed: 5, incomplete: 0 } }),
    ]
    const counts = computeCounts(pages)
    expect(counts.error).toBe(2)
    expect(counts.critical).toBe(1)
    expect(counts.serious).toBe(2)
    expect(counts.all).toBe(pages.length)
  })
})
```

> If the existing `ImpactFilter` type does not yet include `'error'`, the test cast `'error' as ImpactFilter` keeps this file compiling against the *current* type. The cast disappears once Task 3 widens the union.

- [ ] **Step 3: Run, verify failure mode is "wrong filter output"**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run components/ada-audit/useSiteAuditPages.test.ts
```

Expected: FAIL — assertions for `'critical'`/`'serious'`/`'moderate'`/`'minor'` reject `errorPage` and `nullScorecard` (current predicate's silent-drop bug); the `'error'` branch test fails because the predicate has no `'error'` case so it returns the unfiltered list or an empty list depending on the fall-through. **Verify the failures are assertion failures, not `is not exported` / import errors.** If you see an import error, fix the export in Step 1 before continuing.

- [ ] **Step 4: Commit the failing tests + exports**

```bash
git add components/ada-audit/useSiteAuditPages.ts components/ada-audit/useSiteAuditPages.test.ts
git commit -m "$(cat <<'EOF'
refactor(ada-audit): export filterByImpact + computeCounts and add failing tests for impact/error filter fix

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Implement the `filterByImpact` predicate fix

**Files:**
- Modify: `components/ada-audit/useSiteAuditPages.ts`

- [ ] **Step 1: Widen the `ImpactFilter` union**

Locate the `ImpactFilter` type. Add `'error'`:

```typescript
export type ImpactFilter = 'all' | 'critical' | 'serious' | 'moderate' | 'minor' | 'error'
```

- [ ] **Step 2: Fix the predicate**

Locate the body of `filterByImpact`. Replace the per-impact branch.

Before (buggy):

```typescript
return pages.filter((p) => p.scorecard && p.scorecard[impact] > 0)
```

After:

```typescript
if (impact === 'all')   return pages
if (impact === 'error') return pages.filter((p) => p.status === 'error')
return pages.filter(
  (p) => p.scorecard === null || (p.scorecard !== null && p.scorecard[impact] > 0),
)
```

The `p.scorecard === null` clause sweeps in both `status === 'error'` pages (where the runner never produced a scorecard) AND `status === 'complete'` pages whose result JSON was malformed (the runner produced output, but `parseAxeScorecardFromResult` returned `null`). Both classes are issue pages by the hook's own classification — they should not vanish when the user filters by impact.

- [ ] **Step 3: Remove the now-redundant `'error'` cast from the test**

In `components/ada-audit/useSiteAuditPages.test.ts`, drop the `as ImpactFilter` cast on the `'error'` test now that the union accepts it:

```typescript
const out = filterByImpact(all, 'error')
```

- [ ] **Step 4: Add hook-level integration test**

Append one more test that exercises `useSiteAuditPages` end-to-end with `filterImpact: 'error'`, asserting that the issuePages list contains only the error rows and that clean pages remain untouched. The hook-level test catches integration regressions the pure-function tests can't see (e.g. someone wires the filter to the wrong slot).

```typescript
import { renderHook } from '@testing-library/react'
import { useSiteAuditPages } from './useSiteAuditPages'

describe('useSiteAuditPages — filterImpact: error', () => {
  it('returns only error pages in issuePages; clean pages unaffected', () => {
    const pages = [
      { url: 'https://x/a', status: 'complete', scorecard: { critical: 0, serious: 0, moderate: 0, minor: 0, total: 0, passed: 5, incomplete: 0 } } as SitePageResult,
      { url: 'https://x/b', status: 'complete', scorecard: { critical: 1, serious: 0, moderate: 0, minor: 0, total: 1, passed: 4, incomplete: 0 } } as SitePageResult,
      { url: 'https://x/c', status: 'error', scorecard: null } as SitePageResult,
    ]
    const { result } = renderHook(() => useSiteAuditPages(pages, {
      filterImpact: 'error', filterStatus: 'all', sortKey: 'total', currentPage: 1,
    }))
    expect(result.current.issuePages.map((p) => p.url)).toEqual(['https://x/c'])
    expect(result.current.cleanPages.map((p) => p.url)).toEqual(['https://x/a'])
  })
})
```

- [ ] **Step 5: Run, verify all tests pass**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run components/ada-audit/useSiteAuditPages.test.ts
```

Expected: all 9 tests green (8 pure-function + 1 hook-level integration).

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/useSiteAuditPages.ts components/ada-audit/useSiteAuditPages.test.ts
git commit -m "$(cat <<'EOF'
fix(ada-audit): impact filters keep error + null-scorecard pages; add 'error' branch

filterByImpact previously dropped any page whose scorecard was null when the
user picked Critical/Serious/Moderate/Minor — including error pages and
complete pages with malformed result JSON. They are issue pages by the
hook's own classification and should not vanish from the row list.

Also adds an 'error' branch so the Errors pill can isolate error pages
(wired up in the toolbar in the next commit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Remove the sitemap view from `SiteAuditResultsView`

**Files:**
- Modify: `components/ada-audit/SiteAuditResultsView.tsx`

**Why:** the `'sitemap'` `ViewMode` value is going away in the toolbar (Task 5). To avoid the type drift Codex flagged in the spec ("toolbar prop typed `'table' | 'by-violation'` but parent state typed `'table' | 'sitemap' | 'by-violation'`"), drop `'sitemap'` from the parent's state in the same PR, in this task.

- [ ] **Step 1: Remove the `SitemapTreeView` import**

At the top of `components/ada-audit/SiteAuditResultsView.tsx`, delete the `import SitemapTreeView from './SitemapTreeView'` line (or the equivalent named import). The component file stays on disk — only the import goes.

- [ ] **Step 2: Update the `viewMode` state initializer**

Find the `useState` call for `viewMode`. Update both the initial value and the type annotation:

```typescript
const [viewMode, setViewMode] = useState<'table' | 'by-violation'>('table')
```

- [ ] **Step 3: Remove the sitemap render branch**

Locate the conditional render block that handles `viewMode === 'sitemap'` and delete it entirely. The two remaining branches are `viewMode === 'table'` (renders the Pages table) and `viewMode === 'by-violation'` (renders `<GroupedViolationsView>`). If the deletion leaves a stray `else if` chain, normalize to:

```tsx
{viewMode === 'table' ? (
  /* …existing Pages table JSX… */
) : (
  /* …existing GroupedViolationsView JSX… */
)}
```

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: PASS. If there is a stale `treeRoot` or other sitemap-only variable that is now unused, remove it.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/SiteAuditResultsView.tsx
git commit -m "$(cat <<'EOF'
refactor(ada-audit): drop sitemap view from SiteAuditResultsView

The Paths (sitemap-tree) view sat between the two views operators actually
use. Removing it from the parent's render branch and state union here so
the toolbar narrowing in the next commit is type-consistent end to end.

SitemapTreeView.tsx stays on disk as dead code per spec section 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Replace the three-icon toggle with a labeled two-button control

**Files:**
- Modify: `components/ada-audit/SiteAuditToolbar.tsx`

- [ ] **Step 1: Narrow the `ViewMode` type**

At the top of `components/ada-audit/SiteAuditToolbar.tsx`, find the local `ViewMode` type alias and narrow it:

```typescript
export type ViewMode = 'table' | 'by-violation'
```

- [ ] **Step 2: Add a `violationsCount?` prop**

Extend the component's props interface with an optional violations count, used to render the badge on the Violations button:

```typescript
interface Props {
  // …existing props, unchanged…
  violationsCount?: number  // undefined while grouped data is loading → renders as "—"
}
```

- [ ] **Step 3: Replace the icon segmented control with labeled buttons**

Delete the three-icon segmented control block (the `<div className="bg-gray-100 …">` wrapper with three icon-only `<button>` children).

Replace with a two-button labeled control matching the `AuditIndexTabs` visual pattern. Both buttons live in a `bg-gray-100 dark:bg-navy-deep` pill container; the active button gets `bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm`; the inactive button gets `text-navy/60 dark:text-white/60 hover:text-navy dark:hover:text-white`:

```tsx
<div className="inline-flex items-center gap-1 bg-gray-100 dark:bg-navy-deep rounded-lg p-1">
  <button
    type="button"
    onClick={() => onViewModeChange('table')}
    className={`px-3 py-1.5 rounded-md text-[13px] font-body font-semibold transition-colors ${
      viewMode === 'table'
        ? 'bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm'
        : 'text-navy/60 dark:text-white/60 hover:text-navy dark:hover:text-white'
    }`}
  >
    Pages <span className="text-navy/40 dark:text-white/40">({counts.all})</span>
  </button>
  <button
    type="button"
    onClick={() => onViewModeChange('by-violation')}
    className={`px-3 py-1.5 rounded-md text-[13px] font-body font-semibold transition-colors ${
      viewMode === 'by-violation'
        ? 'bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm'
        : 'text-navy/60 dark:text-white/60 hover:text-navy dark:hover:text-white'
    }`}
  >
    Violations <span className="text-navy/40 dark:text-white/40">({violationsCount ?? '—'})</span>
  </button>
</div>
```

The `counts.all` reference uses the existing `counts` prop the toolbar already receives. If that prop is named differently, use the existing name.

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/SiteAuditToolbar.tsx
git commit -m "$(cat <<'EOF'
feat(ada-audit): labeled Pages/Violations view toggle in site-audit toolbar

Replaces the three-icon segmented control (Pages / Paths / Violations) with
a two-button labeled control using the same visual pattern as
AuditIndexTabs. Default selected = Pages. Each button shows a count badge;
Violations renders "—" while grouped data is still loading.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Fix the Errors pill in the toolbar

**Files:**
- Modify: `components/ada-audit/SiteAuditToolbar.tsx`

- [ ] **Step 1: Update the Errors button**

Locate the Errors pill `<button>`. It currently has `onClick={() => onFilterImpactChange('all')}`, an active-state check that compares against `'all'`, and a `title` (tooltip) saying "Error pages are included in the 'All' filter."

Replace with:

```tsx
<button
  type="button"
  onClick={() => onFilterImpactChange(filterImpact === 'error' ? 'all' : 'error')}
  className={`px-3 py-1 rounded-full text-[12px] font-body font-semibold transition-colors ${
    filterImpact === 'error'
      ? 'bg-red-500 text-white'
      : 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-500/25'
  }`}
>
  Errors ({counts.error})
</button>
```

Match the existing class palette if the surrounding pills use different exact tokens — what matters is (a) the onClick toggle, (b) the active state keyed on `filterImpact === 'error'`, (c) the removed tooltip.

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/ada-audit/SiteAuditToolbar.tsx
git commit -m "$(cat <<'EOF'
fix(ada-audit): Errors pill isolates error pages and toggles back to All

The Errors pill previously called onFilterImpactChange('all') and was never
visibly active — a workaround left in place when ImpactFilter had no
'error' value. Now that filterByImpact has an 'error' branch, the pill
toggles between 'error' (isolate error pages) and 'all' (clear filter)
and lights up red when active. The misleading "included in All" tooltip
is gone.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Make `AuditScorecard` impact tiles interactive

**Files:**
- Modify: `components/ada-audit/AuditScorecard.tsx`

- [ ] **Step 1: Extend the props interface**

At the top of `components/ada-audit/AuditScorecard.tsx`, import the impact type and add two optional props:

```typescript
import type { ImpactFilter } from './useSiteAuditPages'

interface Props {
  // …existing props, unchanged…
  onImpactClick?: (impact: 'critical' | 'serious' | 'moderate' | 'minor') => void
  activeImpact?: ImpactFilter
}
```

- [ ] **Step 2: Add an `impact` field to the tile box model**

The current `StatBox` (`AuditScorecard.tsx`) has only `label / count / bg / text / border`. To wire each tile to a specific impact level, add `impact: 'critical' | 'serious' | 'moderate' | 'minor'` to the box type, and populate it for each of the four boxes:

```tsx
type StatBox = {
  label: string
  count: number
  impact: 'critical' | 'serious' | 'moderate' | 'minor'
  bg: string
  text: string
  border: string
}

const boxes: StatBox[] = [
  { label: 'Critical', count: critical, impact: 'critical', bg: '…', text: '…', border: '…' },
  { label: 'Serious',  count: serious,  impact: 'serious',  bg: '…', text: '…', border: '…' },
  { label: 'Moderate', count: moderate, impact: 'moderate', bg: '…', text: '…', border: '…' },
  { label: 'Minor',    count: minor,    impact: 'minor',    bg: '…', text: '…', border: '…' },
]
```

- [ ] **Step 3: Render tiles as buttons when interactive**

With the `impact` field in place, update the JSX that maps over the four impact tiles so that:

- When `onImpactClick` is provided AND `tile.count > 0`, render a `<button type="button">` with `onClick={() => onImpactClick(tile.impact)}` and a hover state.
- Otherwise render the same `<div>` as today — no hover, no cursor change, no `onClick`.
- When `tile.impact === activeImpact`, apply `ring-2 ring-orange/50` to the outer element on top of its existing classes.

```tsx
{boxes.map((tile) => {
  const isInteractive = !!onImpactClick && tile.count > 0
  const isActive = tile.impact === activeImpact
  const baseClass = `…existing tile classes… ${isActive ? 'ring-2 ring-orange/50' : ''}`

  if (isInteractive) {
    return (
      <button
        key={tile.impact}
        type="button"
        onClick={() => onImpactClick!(tile.impact)}
        className={`${baseClass} cursor-pointer hover:bg-gray-50 dark:hover:bg-navy-light transition-colors text-left`}
      >
        {/* …existing inner JSX… */}
      </button>
    )
  }
  return (
    <div key={tile.impact} className={baseClass}>
      {/* …existing inner JSX… */}
    </div>
  )
})}
```

Single-page audit usage (which does not pass `onImpactClick`) is unaffected — every tile falls through to the `<div>` branch.

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/AuditScorecard.tsx
git commit -m "$(cat <<'EOF'
feat(ada-audit): clickable impact tiles in AuditScorecard

Adds optional onImpactClick + activeImpact props. When onImpactClick is
provided and tile.count > 0, the tile renders as a <button> with hover
state; otherwise it stays a <div>. ring-2 ring-orange/50 lights up the
tile whose impact matches activeImpact regardless of where the filter
came from.

Backwards compatible: single-page audit scorecard callers pass neither
prop and get today's behavior.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Wire the scorecard CTAs in `SiteAuditResultsView`

**Files:**
- Modify: `components/ada-audit/SiteAuditResultsView.tsx`

- [ ] **Step 1: Add the ref**

Inside `SiteAuditResultsView`, alongside the existing refs/state, add:

```typescript
const pagesWithIssuesRef = useRef<HTMLDivElement>(null)
```

(Add `useRef` to the existing `react` import if needed.)

- [ ] **Step 2: Attach the ref to the Pages with Issues card**

Locate the outer card `<div>` of the Pages with Issues section. Add `ref={pagesWithIssuesRef}` to it.

- [ ] **Step 3: Define the handler**

Add a `handleScorecardImpactClick` callback:

```typescript
const handleScorecardImpactClick = (
  impact: 'critical' | 'serious' | 'moderate' | 'minor',
) => {
  setFilterImpact((current) => {
    const isToggleOff = current === impact
    if (!isToggleOff) {
      // First click: anchor the user at the Pages-with-Issues section
      pagesWithIssuesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    return isToggleOff ? 'all' : impact
  })
  setViewMode('table')
  setCurrentPage(1)
}
```

Per the spec (section 6g), scrolling only happens on the first click (when the filter is being applied). The toggle-off click clears the filter without scrolling — the user is already at the section.

- [ ] **Step 4: Pass props to `AuditScorecardComponent`**

Find the `<AuditScorecardComponent …>` (or whichever name the file uses) render call inside `SiteAuditResultsView`. Add the two new props:

```tsx
<AuditScorecardComponent
  // …existing props, unchanged…
  onImpactClick={handleScorecardImpactClick}
  activeImpact={filterImpact}
/>
```

- [ ] **Step 5: Pass `violationsCount` to the toolbar**

While the file is open, wire the `violationsCount` prop introduced in Task 5 into the `<SiteAuditToolbar …>` render call.

**Important:** `useGroupedViolations` initializes its `groupedViolations` to `[]` (not `undefined`) when not yet enabled — so `groupedViolations?.length` would render as `0`, not `—`. To distinguish "loaded with zero violations" from "not yet loaded", the hook exposes a `loaded` boolean (or analogous flag). Pass `undefined` to the toolbar when not loaded so the badge renders as `—`:

```tsx
<SiteAuditToolbar
  // …existing props, unchanged…
  violationsCount={groupedLoaded ? groupedViolations.length : undefined}
/>
```

If the hook does NOT currently expose a loaded flag, extend it as part of this task — return `{ groupedViolations, loaded }` instead of just the array. The `loaded` flag is set to `true` inside the hook's effect once the cross-page fetch resolves. Update the existing call site in `SiteAuditResultsView` accordingly.

- [ ] **Step 6: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/ada-audit/SiteAuditResultsView.tsx
git commit -m "$(cat <<'EOF'
feat(ada-audit): scorecard tile click scrolls to + filters Pages with Issues

Clicking a Critical/Serious/Moderate/Minor scorecard tile now:
  1. sets filterImpact to the matching level (or back to 'all' on re-click)
  2. switches viewMode to 'table' (Pages view)
  3. resets pagination to page 1
  4. smooth-scrolls the Pages with Issues card into view

Also wires violationsCount into the toolbar so the Violations button shows
the unique-violation count badge.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Lint + full test suite + production build

**Files:** none — verification gate.

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 2: Full test suite**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run
```

Expected: PASS, including the +8 new tests from Task 2/3 (6 `filterByImpact` + 1 `'error'` branch + 1 `computeCounts`). No previously-passing tests regress.

- [ ] **Step 3: Production build**

```bash
rm -rf .next && npm run build
```

Expected: clean build, no type errors, no missing-import warnings about `SitemapTreeView`.

- [ ] **Step 4: Manual acceptance pass on `npm run dev`**

Per spec section 9 acceptance checklist:

```bash
npm run dev
```

Open a completed site audit in the browser and verify:

- Critical/Serious/Moderate/Minor pill no longer drops error or null-scorecard pages.
- Errors pill isolates error pages on click and lights up red; clicking again returns to All.
- View toggle shows two labeled buttons (`Pages (N)` / `Violations (M)`); no Paths option.
- Pages is the default selected view on fresh load.
- Clicking the Critical scorecard tile scrolls to the Pages with Issues card AND activates the Critical filter; re-clicking the Critical tile clears the filter to All.
- Clicking the Critical pill in the toolbar while on the Violations tab does *not* switch tabs (filter is remembered).
- Clicking the Critical *tile* while on the Violations tab *does* switch to Pages and apply the filter.
- A zero-count scorecard tile (e.g. Critical = 0 on a clean site) is not interactive — no pointer cursor, no hover.

---

### Task 10: Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/ada-pages-with-issues-cleanup
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(ada-audit): Pages with Issues cleanup — labeled view toggle, filter fixes, scorecard CTAs" --body "$(cat <<'EOF'
## Summary
Tightens the "Pages with Issues" section of a completed site audit. Removes the underused Paths (sitemap-tree) view, replaces the three-icon view toggle with a labeled two-button control (Pages / Violations), fixes three broken filter behaviors, and wires the Critical/Serious/Moderate/Minor scorecard tiles as clickable shortcuts that scroll to and activate the matching filter in Pages view.

## What changed
- `filterByImpact` now keeps error pages and complete-but-null-scorecard pages on impact filters (Critical/Serious/Moderate/Minor). Previously these silently disappeared.
- New `'error'` branch on `ImpactFilter` + the Errors pill in the toolbar now isolates error pages on click and toggles back to All. The misleading "included in All" tooltip is gone.
- Three-icon segmented control replaced with `[ Pages (N) ] [ Violations (M) ]`. Default selected = Pages.
- `'sitemap'` removed from the `ViewMode` union, the render branch, and the toolbar. `SitemapTreeView.tsx` stays on disk as dead code.
- `AuditScorecard` impact tiles render as `<button>` when an `onImpactClick` handler is provided AND the tile's count > 0. Active ring lights up whichever tile matches the current `filterImpact`, regardless of where the filter was set.
- `SiteAuditResultsView` owns a `pagesWithIssuesRef`. Tile click → set filter (or toggle to All) → switch to Pages view → reset pagination → smooth-scroll into view.

## Intentional count vs. results asymmetry
The Critical pill badge still shows "pages with `scorecard.critical > 0`" (unchanged). After this fix, clicking the pill can show MORE rows than the badge says — because the row list also includes error and null-scorecard pages. This is the bug being fixed: those pages are not clean and should not be hidden. Making the badge match the wider row count would be a different bug (it would inflate the visible critical-count number).

## Test plan
- [x] Vitest: `filterByImpact` All / Critical / Serious / Moderate / Minor / Error branches (+ error + null-scorecard inclusion)
- [x] Vitest: `computeCounts` reflects errors, impact-bearing pages, total independently
- [x] `npm run lint` clean
- [x] Production build clean (`rm -rf .next && npm run build`)
- [x] Manual on a completed site audit: filter pills no longer drop error pages; Errors pill isolates + toggles; scorecard tiles scroll + filter; view toggle is two labeled buttons; Pages is default; zero-count tiles are non-interactive

## Out of scope
- Redesigning Pages table rows or Violations cards
- URL hash / query-string state for view mode or filter
- The hardcoded `filterStatus = 'all'` (not exposed in UI)
- The `SitemapTreeView` component file (stays on disk, dead import)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return PR URL**

---

## Self-review checklist

- [x] **Spec coverage**: every spec section maps to a task. Section 4 (view toggle) → Tasks 4 + 5. Section 5 (filter audit) → Tasks 2 + 3 + 6. Section 6 (scorecard CTA) → Tasks 7 + 8. Section 7 (file structure) matches the file table at the top of this plan. Section 8 (edge cases) is exercised in the Task 9 manual checklist.
- [x] **TDD on the filter fix**: Task 2 exports the pure functions + writes tests that fail because of *wrong output*, not import errors. Task 3 implements the predicate and re-runs to green. Task 2/3 commits are separable so reviewers can see "failing test" and "fix" as distinct steps.
- [x] **No placeholders**: every code block is concrete and pastable. Where prop or variable names depend on the existing file (e.g. `groupedViolations`), the task text notes "if named differently in this file, use the existing name."
- [x] **Type consistency end-to-end**: `'sitemap'` is dropped from the `ViewMode` union in the toolbar (Task 5) AND from the parent's `useState<…>` (Task 4) AND from the parent's render branches (Task 4) in the same PR. No half-state where parent and child disagree on the union.
- [x] **`AuditScorecard` backwards compatibility**: the new props are optional. Single-page audit scorecard usage (does not pass `onImpactClick` or `activeImpact`) keeps today's behavior — every tile renders as `<div>`, no ring.
- [x] **Active-ring source-agnostic**: spec section 6f locks "active = `filterImpact === tile.impact`," not "active = clicked via scorecard." Task 7 implements that directly via the `activeImpact` prop; Task 8 wires it to whatever the current filter is. The toolbar Critical pill lights up the scorecard Critical tile and vice versa.
- [x] **Toggle behavior**: Task 8 handler sets `filterImpact` to `'all'` when the clicked tile equals the current `filterImpact`, matching spec section 6g. (The toolbar impact pills retain their current non-toggling behavior; only the Errors pill and the scorecard tiles toggle. This asymmetry is called out in the spec and preserved here.)
- [x] **No new schema, no API, no runner changes**: confirmed — all edits are in `components/ada-audit/`.
- [x] **Commit conventions**: every commit uses `feat(ada-audit):`, `fix(ada-audit):`, or `refactor(ada-audit):` per the prefix rules.
- [x] **Verification gate**: Task 9 runs lint, full vitest, production build, and a manual acceptance pass against the spec section 9 checklist before the PR is opened.
