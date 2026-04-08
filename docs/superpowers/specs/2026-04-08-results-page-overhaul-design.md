# SEO Parser Results Page Overhaul — Design Spec
**Date:** 2026-04-08
**Status:** Approved

---

## Goal

Improve the usability of the `/seo-parser/results/[sessionId]` page across three areas: layout restructure, issue row improvements, and data correctness fixes.

---

## 1. Layout: Full-Width with Metrics Bar

### Remove the sidebar

The current 3-column grid (1/3 summary sidebar + 2/3 issues) is replaced with a full-width single-column layout. The sidebar's content (health score, crawl stats, issue breakdown pie chart) is redistributed.

### Metrics bar

A horizontal row of 6 stat tiles sits directly below the page header, above the issue tabs:

| Tile | Value | Color cue |
|------|-------|-----------|
| Health Score | Circle badge (0–100) | Red/orange/green per current thresholds |
| Total URLs | Number | Neutral |
| Critical | Count of critical issues | Red |
| Warnings | Count of warning issues | Orange |
| Notices | Count of notice issues | Blue |
| Indexable | `crawl_summary.indexable_urls` | Green |

**Responsive breakpoints:**
- `lg+` (≥1024px): all 6 tiles in one row
- `md` (768–1023px): 3×2 grid
- `sm` and below: 2×3 grid

The Issue Breakdown pie chart (`IssuesPieChart`) is removed — the critical/warnings/notices counts in the metrics bar make it redundant.

### Page section order (top to bottom)

1. Page header (site name, file count, action buttons)
2. Metrics bar (6 tiles)
3. Issue tabs (Critical / Warnings / Notices) — full width
4. Recommendations — full width
5. Charts row (Response Code Distribution + Crawl Depth Distribution) — 2-col on md+, 1-col on mobile
6. Duplicate Content section (if data present)
7. Keyword Signals panel (if data present)
8. Debug footer: `<details><summary>Debug info</summary>Parsers used: ...</details>`

---

## 2. Issue Row Improvements

### Title formatting

Display titles are cleaned at render time in `IssueList.tsx` — no data changes needed:

```typescript
function formatIssueTitle(type: string): string {
  const stripped = type.startsWith('sf_') ? type.slice(3) : type;
  const spaced = stripped.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
```

Examples:
- `sf_content_spelling_errors` → "Content spelling errors"
- `sf_images_missing_alt_attribute` → "Images missing alt attribute"
- `broken_internal_links` → "Broken internal links"
- `missing_title` → "Missing title"

### All rows expandable

Currently, issue rows with no URLs and no groups render without a chevron and cannot be expanded. In the new design, **every row has a chevron**. When expanded, it always shows `issue.description`. URL list and groups render below the description only when present.

### URL list: paginated scrollable

When `issue.urls` is non-empty:

- Show 50 URLs per page in a fixed-height (`max-h-64`) scrollable container
- Pagination controls below the list: "← Prev" / "Next →" buttons + "Page N of M" label
- Header label: `"Affected URLs — showing 50 of 780"` (when truncated) or `"Affected URLs — 43 total"` (when all fit on one page)
- When total exceeds 50: append `"· export JSON for full list"` to the header (plain text, no link needed — the export buttons are in the page header)
- Pagination state is local per issue row (each `IssueItem` manages its own `currentPage` state)

### External link icons

Each URL in the list renders as two adjacent elements:

1. **URL text** (existing behavior) — clicking opens the PageDetailModal if `onUrlClick` is provided, otherwise plain text
2. **↗ icon button** — always present, always opens the URL in a new tab (`target="_blank" rel="noopener noreferrer"`), independent of the modal

```
https://wellspring.edu/programs/nursing/   ↗
```

The icon is an `<a>` tag with `aria-label="Open in new tab"`, rendered as an inline icon (SVG external-link icon, `w-3.5 h-3.5`, `text-gray-400 hover:text-[#f5a623]`).

---

## 3. Data Fixes

### Remove URL caps

Current caps cause issue rows to show far fewer URLs than actually exist (e.g. "780 broken internal links" but only ~30 URLs stored). Caps are removed in three places:

| File | Current cap | Change |
|------|-------------|--------|
| `lib/parsers/resources/links.parser.ts` | 30 destination URLs | Remove cap — collect all matching rows |
| `lib/parsers/base.parser.ts` — `getUrlsWhereMask` | Default `limit = 20` | Change default to `Number.MAX_SAFE_INTEGER` (effectively unlimited); callers that pass an explicit limit are unchanged |
| `lib/services/aggregator.service.ts` — `dedupeIssues` | `.slice(0, 50)` + `truncated`/`total_affected` assignments | Remove all three — no longer needed |

With no slice, `issue.urls.length` equals the true total — so both `truncated` and `total_affected` become redundant and are removed from the `Issue` type and all write sites. The paginated URL list derives "showing 50 of 780" from `currentPage * PAGE_SIZE` vs `issue.urls.length` directly.

### Filter spelling/grammar from JSON export

In `app/api/export/[sessionId]/[format]/route.ts`, before streaming the JSON result, filter the issues arrays:

```typescript
const EXPORT_EXCLUDED_ISSUE_TYPES = new Set(['spelling_errors', 'grammar_errors']);

function filterResultForExport(result: AggregatedResult): AggregatedResult {
  const filterIssues = (issues: Issue[]) =>
    issues.filter(i => !EXPORT_EXCLUDED_ISSUE_TYPES.has(i.type));
  return {
    ...result,
    issues: {
      critical: filterIssues(result.issues.critical),
      warnings: filterIssues(result.issues.warnings),
      notices: filterIssues(result.issues.notices),
    },
  };
}
```

Apply to the `json` format only. `summary` and `markdown` exports already do their own shaping and are unaffected.

---

## Files Changed

| File | Change |
|------|--------|
| `components/seo-parser/ResultsView.tsx` | Replace 3-col grid with full-width layout + metrics bar; remove `IssuesPieChart`; wrap parsers footer in `<details>` |
| `components/seo-parser/SummaryCard.tsx` | Remove (content replaced by metrics bar tiles) |
| `components/seo-parser/IssueList.tsx` | `formatIssueTitle()`; always-visible chevron; paginated URL list with ↗ icons |
| `components/seo-parser/MetricsBar.tsx` | New component — 6 stat tiles, responsive grid |
| `lib/parsers/resources/links.parser.ts` | Remove 30-URL cap on broken link collection |
| `lib/parsers/base.parser.ts` | Change `getUrlsWhereMask` default limit to `Number.MAX_SAFE_INTEGER` |
| `lib/services/aggregator.service.ts` | Remove `.slice(0, 50)`, `truncated`, and `total_affected` assignments in `dedupeIssues` |
| `lib/types/index.ts` | Remove `truncated?: boolean` and `total_affected?: number` from `Issue` interface |
| `app/api/export/[sessionId]/[format]/route.ts` | Add `filterResultForExport()` applied to `json` format |

---

## Out of Scope

- `CopyToClipboard` behavior — unchanged
- `PageDetailModal` — unchanged
- `ShareModal` — unchanged
- `DuplicateContentSection` — unchanged
- `KeywordSignalsPanel` — unchanged
- `RecommendationList` — unchanged
- `IssueTabs` — unchanged (tabs themselves; only `IssueList` changes)
- Markdown and summary export formats — unchanged
