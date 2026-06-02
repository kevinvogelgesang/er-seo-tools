# ADA Audit — Pages with Issues Cleanup (PR 2)

**Date:** 2026-05-20
**Status:** Approved for implementation planning
**Scope:** Site-audit results page, `SiteAuditResultsView` and supporting components. No schema changes, no runner changes, no single-page audit changes.

---

## 1. Goal

Tighten the "Pages with Issues" section of a completed site audit by removing the underused Paths (sitemap-tree) view, making Pages and Violations the two prominent view choices, fixing three broken filter behaviors, and wiring the Critical/Serious/Moderate/Minor scorecard tiles so clicking one scrolls to and activates the matching filter in Pages view — giving operators a one-click path from "how bad is it" to "show me the affected pages."

---

## 2. Why now

The sitemap-tree view (`SitemapTreeView`) was added speculatively and is rarely used in practice — the Pages table and Violations grouping cover the two real workflows (page-by-page triage and violation-type triage). Its icon-only button in the view toggle is opaque, the tree rendering is CPU-heavy on 200+ page audits, and it sits between the two views operators actually want, making the toggle confusing. At the same time, the filter pills are unreliable enough that operators can't trust what they're seeing, and the scorecard tiles are static when they could be direct navigation shortcuts.

---

## 3. Non-goals

- Not redesigning the Pages table rows or the Violations cards — only the view affordance and filtering change.
- Not changing what counts as a violation — axe-core output, scoring, and WCAG level logic are untouched.
- The `SitemapTreeView` component file stays in the codebase (dead import is fine). But the `'sitemap'` value is removed from the `ViewMode` union, the sitemap render branch in `SiteAuditResultsView` is removed, and the toggle button is removed. Half-measures (keeping `'sitemap'` in the type but unselectable) create the type inconsistency codex flagged: `SiteAuditResultsView` would still own a state of `'table' | 'sitemap' | 'by-violation'` and try to hand it to a toolbar prop typed `'table' | 'by-violation'`. Cleaner to fully drop `'sitemap'` from the union, the state, and the render branch in one pass.
- Not adding URL hash or query-string state for view mode or filter state. Browser back exits the page entirely; that is intentional.
- Not touching the `filterStatus` (`'complete' | 'error' | 'all'`) code path — it is hardcoded to `'all'` in `SiteAuditResultsView` and was never exposed in UI. Leave it alone.

---

## 4. Tab UI — replacing the three-icon toggle

**Current state.** `SiteAuditToolbar.tsx` renders three icon-only `<button>` elements inside a segmented control (`bg-gray-100` pill container). No text labels. The three icons correspond to: table rows (Pages), indented lines (Paths), stacked boxes (Violations). The Paths button is the middle button.

**New state.** Remove the three-icon segmented control. Replace with a two-option labeled segmented control using the same visual pattern as `AuditIndexTabs` ("Single Page" / "Full Site"):

```
[ Pages ]  [ Violations ]
```

- Both buttons display a text label. Optionally append the count in a small badge: `Pages (47)` and `Violations (12)`.
- Active state: `bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm` (matches existing segmented control active style).
- Default selected tab when the results view first loads: **Pages**.
- The `ViewMode` type in `SiteAuditToolbar.tsx` narrows from `'table' | 'sitemap' | 'by-violation'` to `'table' | 'by-violation'`. The sitemap branch render block stays in `SiteAuditResultsView` but will never execute once the toggle no longer offers it.
- The "Pages" label maps to `viewMode === 'table'`. The "Violations" label maps to `viewMode === 'by-violation'`.
- The Violations count badge shows the number of unique violation IDs currently loaded in `groupedViolations`. Show `—` while the grouped data is loading (the fetch is deferred until the tab is first clicked).

**Props change to `SiteAuditToolbar`.** The `viewMode` and `onViewModeChange` props keep the same types at the component boundary — the narrowing is behavioral (only two options are rendered), not a TypeScript breaking change.

---

## 5. Filter audit

### 5a. Complete filter inventory

The Pages-with-Issues section has these user-facing controls:

1. **Impact filter pills** — All / Critical / Serious / Moderate / Minor (always shown)
2. **Errors pill** — shown only when `counts.error > 0`
3. **Sort dropdown** — Total Violations / Critical Count / Serious Count / URL (A-Z)

The Violations view (`GroupedViolationsView`) has no filter controls of its own — it renders all grouped violations, already sorted by impact then affected-page count. This is out of scope.

### 5b. Filter audit table

| Filter | Current behavior | Expected behavior | Root cause | Fix |
|---|---|---|---|---|
| **All pill** | Shows all issue pages (error + all violations). Works correctly. | Same. | — | None. |
| **Critical pill** | Shows pages where `scorecard.critical > 0`. Silently drops ANY page with `scorecard === null` — both error pages (`status === 'error'`) AND complete pages with null scorecards (malformed/missing result JSON). | Show pages where `scorecard.critical > 0`, plus error pages AND complete pages with null scorecards. These pages are not clean — the user did not ask to hide them. | `filterByImpact` in `useSiteAuditPages.ts` uses `p.scorecard && p.scorecard[impact] > 0`. Any page with `scorecard === null` fails the predicate. | New predicate: `p.scorecard === null \|\| (p.scorecard !== null && p.scorecard[impact] > 0)`. This passes through every issue-classified page that doesn't have the impact level explicitly — symmetric with how the hook classifies them as "issue pages" in the first place. |
| **Serious / Moderate / Minor pills** | Same silent-drop issue as Critical. | Same fix as Critical. | Same root cause. | Same fix. |
| **Errors pill** | `onClick` calls `onFilterImpactChange('all')`. Clicking "Errors" shows everything, not just error pages. Active state is never set (the active check is `filterImpact === id` and `id` here is `'all'`). Tooltip says "Error pages are included in the 'All' filter" — written when the author knew isolation wasn't implemented. | Clicking "Errors" isolates error pages — shows only pages with `status === 'error'`. Clicking again toggles back to the full view. | `ImpactFilter` type has no `'error'` value. The button fires `'all'` as a workaround. `filterByImpact` has no `'error'` branch. | Add `'error'` to the `ImpactFilter` union in `useSiteAuditPages.ts`. Add an `'error'` branch in `filterByImpact`: `if (impact === 'error') return pages.filter((p) => p.status === 'error')`. Update `SiteAuditToolbar.tsx` Errors button — `onClick` handler: `onFilterImpactChange(filterImpact === 'error' ? 'all' : 'error')`. Active state: `filterImpact === 'error'`. Remove the misleading tooltip. (The other impact pills don't toggle back to 'all' today; preserving that asymmetry for parity with the existing critical/serious/etc. behaviour is intentional — the Errors pill toggles because it's the only filter with no 'All' equivalent in the visual flow.) |
| **Sort: Total Violations** | Works correctly. | Same. | — | None. |
| **Sort: Critical Count** | Works correctly. | Same. | — | None. |
| **Sort: Serious Count** | Works correctly. | Same. | — | None. |
| **Sort: URL (A-Z)** | Works correctly. | Same. | — | None. |

### 5c. Count vs. results semantics (intentional asymmetry)

After the fix, the **Critical** pill badge shows the count of pages with `scorecard.critical > 0` (unchanged from today), but clicking the pill can yield MORE rows than the badge says — because the row list now also includes error pages and null-scorecard pages. This asymmetry is intentional. The badge answers "how many pages have a critical violation?" while the row list answers "what should I look at if I'm investigating critical issues?" Hiding unclassifiable pages from the row list is the bug being fixed; making the badge match those wider counts would be a different bug (it'd inflate the visible critical count). Call this out in the implementation PR description so reviewers don't read it as a regression.

### 5d. Summary of code changes for filters

All filter changes are in two files:

- `components/ada-audit/useSiteAuditPages.ts` — `ImpactFilter` type and `filterByImpact` function.
- `components/ada-audit/SiteAuditToolbar.tsx` — Errors button `onClick` and active state logic.

No other file touches `ImpactFilter` or `filterByImpact`.

---

## 6. Score CTA behavior

### 6a. Current state

`AuditScorecard.tsx` renders four `<div>` tiles (Critical, Serious, Moderate, Minor) as non-interactive elements. They display the aggregate violation count for that impact level across the entire site. They are plain `div` elements — no `onClick`, no `cursor-pointer`.

### 6b. Desired behavior

The four tiles become `<button>` elements. Clicking one:

1. Sets `filterImpact` to the matching level (`'critical'`, `'serious'`, `'moderate'`, or `'minor'`).
2. Switches `viewMode` to `'table'` (Pages view) if not already on it.
3. Scrolls to the "Pages with Issues" section heading, smooth scroll.
4. Clears pagination back to page 1.

These four effects happen synchronously in a single event handler — no separate useEffect needed.

### 6c. Scroll implementation

Add a `ref` to the "Pages with Issues" outer card div in `SiteAuditResultsView.tsx`. Pass the handler as a prop down from `SiteAuditResultsView` to `AuditScorecard`. The scroll call is `pagesWithIssuesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })`.

No URL hash, no `id` attribute on the element — the scroll is purely imperative.

### 6d. Prop change to `AuditScorecard`

Add an optional `onImpactClick?: (impact: 'critical' | 'serious' | 'moderate' | 'minor') => void` prop. When present, each tile renders as `<button>` instead of `<div>`. When absent (single-page audit scorecard usage), tiles remain `<div>` — no behavior change for the single-page audit view.

### 6e. Disabled state

If `count === 0` for a given impact level, the tile should not be interactive. Render as `<div>` with no hover state, no pointer cursor, no onClick. A zero-count Critical tile should look identical to today — the number `0` is rendered dimly, no affordance that it can be clicked.

### 6f. Active state

Define the active ring as **"current active impact filter matches this tile"** — not as "the filter came from a scorecard click." So if the user clicks the Critical toolbar pill, the Critical scorecard tile also lights up. If they click the All pill, no scorecard tile is lit. This is simpler, doesn't require tracking filter provenance, and matches user expectation: the scorecard tile is a visual indicator of "what's filtered" wherever the filter came from.

Implementation: pass `filterImpact` directly as the `activeImpact` prop to `AuditScorecard`. The ring renders when `tile.impact === activeImpact`. `ring-2 ring-orange/50` on the outer tile div.

### 6g. Double-click / toggle behavior

Clicking the same impact tile a second time clears the filter (sets `filterImpact` back to `'all'`). This is the standard toggle expectation. No scroll on the second click (already in the section from the first click).

---

## 7. File structure

| File | Status | Role |
|---|---|---|
| `components/ada-audit/useSiteAuditPages.ts` | Modify | Add `'error'` to `ImpactFilter` union. Fix `filterByImpact` to pass through error pages on impact filters; add `'error'` branch. |
| `components/ada-audit/SiteAuditToolbar.tsx` | Modify | Replace three-icon view toggle with labeled two-button segmented control. Fix Errors button to call `onFilterImpactChange('error')` with correct active state. Update `ViewMode` type to `'table' \| 'by-violation'`. |
| `components/ada-audit/AuditScorecard.tsx` | Modify | Add `onImpactClick?` prop. Render impact tiles as `<button>` when prop is present and `count > 0`. Add active ring when the called-back impact matches current `filterImpact` (requires passing `activeImpact?: ImpactFilter` prop as well). |
| `components/ada-audit/SiteAuditResultsView.tsx` | Modify | Add `pagesWithIssuesRef`. Pass `onImpactClick` and `activeImpact` to `AuditScorecardComponent`. Handler sets `filterImpact`, `viewMode`, resets `currentPage`, scrolls ref. |

No new files. No schema changes. No API changes.

---

## 8. Edge cases

**User on Violations tab clicks a scorecard CTA.**
The handler switches `viewMode` to `'table'` before scrolling. The user lands on the Pages view with the filter applied. Rationale: the scorecard CTAs are explicitly "show me pages affected by X" actions — the Pages table is the correct destination. Silently applying the filter to the Violations view (which has no filter UI) would be confusing.

**Filter state across tab switches.**
`filterImpact` is state owned by `SiteAuditResultsView`, not the individual view components. Switching from Pages → Violations preserves the `filterImpact` value in state, but the Violations view ignores it (it renders all violations regardless). When switching back to Pages the filter is still active. This is correct and intentional — the filter is "remembered."

**Browser back after scorecard CTA click.**
No URL was changed. The browser back button exits the site-audit results page entirely, returning to wherever the operator navigated from. This is intentional per the locked decision.

**Errors filter while a scorecard CTA was used.**
If the operator clicked the Critical tile (setting `filterImpact = 'critical'`) and then clicks the Errors pill, the filter becomes `'error'` — only error pages show. The scorecard tile active ring disappears (since `activeImpact !== 'critical'` anymore). Clicking the Critical tile again re-applies the critical filter. Both paths go through the same `filterImpact` state, so they compose correctly.

**Site with zero errors.**
The Errors pill is hidden when `counts.error === 0` (existing behavior in `SiteAuditToolbar.tsx`). No change needed.

---

## 9. Tests

Vitest is wired up in this repo (`package.json`) and React Testing Library is available. The filter functions (`filterByImpact`, `computeCounts`) are currently private to `useSiteAuditPages.ts`. To make them unit-testable, **export them from the module** (this is a low-risk change — they're pure functions with no side effects). Then write tests in a new `components/ada-audit/useSiteAuditPages.test.ts`:

| Test | Assertion |
|---|---|
| `filterByImpact('critical')` on a mixed page list | Returns only pages where `scorecard.critical > 0` AND pages where `status === 'error'`; excludes clean and non-critical pages. |
| `filterByImpact('serious')` — same shape | Same as above for serious. |
| `filterByImpact('moderate')` | Same. |
| `filterByImpact('minor')` | Same. |
| `filterByImpact('error')` | Returns only `status === 'error'` pages; excludes all pages with scorecards regardless of violation counts. |
| `filterByImpact('all')` | Returns all pages unchanged. |
| `computeCounts` with a mix of error, issue, and clean pages | `counts.error` reflects only error pages; `counts.critical` reflects only pages with `scorecard.critical > 0` (not error pages); `counts.all` includes both. |
| `useSiteAuditPages` with `filterImpact: 'error'` | `issuePages` contains only error pages; clean pages list is unchanged; treeRoot reflects only error pages. |

Manual acceptance checklist (no automated UI tests):
- Clicking Critical tile in the scorecard scrolls to and activates the Critical filter in Pages view.
- Clicking the same tile again clears the filter to All.
- Clicking Critical pill in toolbar while on Violations tab does not switch tab.
- Clicking Critical tile in scorecard while on Violations tab switches to Pages and applies filter.
- Errors pill shows only error pages when clicked; no longer shows all pages.
- Critical/Serious/Moderate/Minor filters no longer drop error pages from the list.
- View toggle shows "Pages" and "Violations" with text labels; no Paths option.
- Pages is the default selected view on fresh load.
