# Plan: Grouped Issues View (By Violation Type)

## Current Behavior

Issues are displayed **per page** — you expand a page row to see that page's violations. There's no way to see "how many pages have the `color-contrast` violation" or prioritize fixes by most-common issue.

**Relevant files:**
- `components/ada-audit/SiteAuditResultsView.tsx` — main site results, manages view state
- `components/ada-audit/SiteAuditToolbar.tsx` — toolbar with sort/filter/view toggles
- `components/ada-audit/AuditIssueTabs.tsx` — per-page violation tabs (Critical/Serious/etc.)

---

## Proposed Architecture

### New view mode: `'by-violation'`

Add a third view mode alongside the existing `'table'` and `'sitemap'` modes.

**State change in `SiteAuditResultsView.tsx`:**
```typescript
// Current:
const [viewMode, setViewMode] = useState<'table' | 'sitemap'>('table')

// New:
const [viewMode, setViewMode] = useState<'table' | 'sitemap' | 'by-violation'>('table')
```

---

## Data Fetching Strategy

The grouped view needs violation details across all pages, not just scorecards. Two options:

### Option A: Fetch on demand (recommended)
When user switches to the grouped view, fetch each page's violations in parallel (same API call pattern as the existing expanded-row lazy load: `GET /api/ada-audit/{page.adaAuditId}`). Show a loading state while fetching.

### Option B: New aggregate API endpoint
Add `GET /api/site-audit/{siteAuditId}/violations` that returns all violations across all pages pre-aggregated. More efficient but requires new route.

**Recommendation: Option A first** — reuses existing API, lower effort.

---

## Grouping Logic

Create a hook `useGroupedViolations` (new file: `components/ada-audit/useGroupedViolations.ts`):

```typescript
interface GroupedViolation {
  id: string              // axe violation ID, e.g., "color-contrast"
  help: string            // human-readable title
  impact: ImpactLevel
  helpUrl: string
  affectedPages: Array<{
    url: string
    adaAuditId: string
    nodeCount: number
  }>
  totalNodes: number      // sum across all pages
}

function groupViolations(
  pages: SitePageResult[],
  violationsByAuditId: Map<string, AxeViolation[]>
): GroupedViolation[] {
  const grouped = new Map<string, GroupedViolation>()

  for (const page of pages) {
    const violations = violationsByAuditId.get(page.adaAuditId) ?? []
    for (const v of violations) {
      if (!grouped.has(v.id)) {
        grouped.set(v.id, {
          id: v.id,
          help: v.help,
          impact: v.impact ?? 'minor',
          helpUrl: v.helpUrl,
          affectedPages: [],
          totalNodes: 0,
        })
      }
      const g = grouped.get(v.id)!
      g.affectedPages.push({ url: page.url, adaAuditId: page.adaAuditId, nodeCount: v.nodes.length })
      g.totalNodes += v.nodes.length
    }
  }

  // Sort: by impact severity first, then by affected page count
  const impactOrder = { critical: 0, serious: 1, moderate: 2, minor: 3 }
  return Array.from(grouped.values()).sort((a, b) => {
    const impactDiff = (impactOrder[a.impact] ?? 3) - (impactOrder[b.impact] ?? 3)
    if (impactDiff !== 0) return impactDiff
    return b.affectedPages.length - a.affectedPages.length
  })
}
```

---

## New Component: `GroupedViolationsView.tsx`

New file: `components/ada-audit/GroupedViolationsView.tsx`

Each violation renders as a card:

```
┌──────────────────────────────────────────────────────┐
│ [CRITICAL] color-contrast                            │
│ Ensures the contrast between foreground and          │
│ background colors meets WCAG 2 AA contrast ratio     │
│                                                      │
│ Affects 12 pages • 47 total elements                 │
│                                                      │
│ ▼ Pages affected                                     │
│   client.edu/about          3 elements  [View audit] │
│   client.edu/contact        5 elements  [View audit] │
│   client.edu/programs       8 elements  [View audit] │
│   + 9 more pages            ...                      │
└──────────────────────────────────────────────────────┘
```

- Impact badge uses same color scheme as existing violation tabs
- "View audit" links to `/ada-audit/{adaAuditId}` (same as existing)
- Pages list is collapsed by default, expandable
- Filter by impact level (reuse existing `filterImpact` state)

---

## Toolbar Change

**File:** `components/ada-audit/SiteAuditToolbar.tsx`

Add a third button to the view mode toggle group alongside Table and Sitemap:

```tsx
<button
  onClick={() => setViewMode('by-violation')}
  title="Group by violation type"
  className={viewMode === 'by-violation' ? activeClass : inactiveClass}
>
  {/* List/group icon */}
  <svg .../>
</button>
```

---

## Files to Create/Change

| File | Change |
|------|--------|
| `components/ada-audit/SiteAuditResultsView.tsx` | Add `'by-violation'` to `viewMode` type; add fetch logic; conditionally render new view |
| `components/ada-audit/SiteAuditToolbar.tsx` | Add third view mode button |
| `components/ada-audit/GroupedViolationsView.tsx` | **New file** — renders the grouped cards |
| `components/ada-audit/useGroupedViolations.ts` | **New file** — grouping hook with data fetching |

## Effort

Medium — two new files, two modified files. No schema changes. The main complexity is the parallel-fetch-then-group logic.
