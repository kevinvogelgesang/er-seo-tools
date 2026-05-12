# ADA Audit UI Overhaul — Design Spec

**Date:** 2026-05-12
**Branch:** `feat/ada-audit-ui-overhaul` (branches off `main` after PR 1 merges)
**Scope:** PR 2 of 2. Runner enhancements (RAM, Lighthouse, PDF) are PR 1 with its own spec.

## Goals

1. Add a Clients section to `/ada-audit` showing each client and their most recent site audit at a glance — daily worklist surface.
2. Paginate the Recent Page Audits and Recent Site Audits sections so the page stays compact as audit history grows.
3. Keep existing API consumers backward compatible.

## Non-goals

- Showing single-page audits in the Clients view — site audits only.
- Bulk actions (re-scan all clients, multi-select).
- Per-client audit history drill-in modal — accessible via `/clients` and `/ada-audit/site/[id]` already.
- CSV export.
- Any runner / schema changes — those are PR 1.

## Page structure on `/ada-audit`

Top to bottom:
1. **New Audit** card (existing, unchanged).
2. **Clients** section (new).
3. **Recent Page Audits** (existing, paginated).
4. **Recent Site Audits** (existing, paginated).

## Clients section

### Data source
New endpoint `GET /api/clients/audit-summary`. Joins `Client` → latest `SiteAudit` (where `status = 'complete'`, ordered by `createdAt desc`, one per client). **In-progress / queued audits are intentionally excluded** — the Clients view is a results dashboard, not a live progress board. Active audits remain visible in the existing Recent Site Audits section. Returns a flat list:

```ts
type ClientAuditSummary = {
  clientId: number
  clientName: string
  firstDomain: string | null         // for the run-audit pre-fill
  latestSiteAudit: {
    id: string
    createdAt: string                 // ISO
    score: number | null
    pagesTotal: number
    pagesError: number
    summary: SiteAuditSummary | null  // for issue counts (critical/serious/...)
  } | null                            // null = never scanned
}
```

Single GET, no wire pagination (30ish rows). Polled every 30s while the tab is foregrounded — matches the cadence of `SiteAuditHistory`.

### Columns

| Column | Sortable | Behavior |
|---|---|---|
| Client name | ✓ | Tiebreaker sort. Click toggles asc/desc. |
| Last audit date | ✓ | **Default sort (descending).** Never-scanned clients always sort to the bottom regardless of direction. |
| Score + issue pills | ✓ by score | Same badge/pill UI as `SiteAuditHistory`. Cells render `—` for never-scanned clients. |
| Action | — | Right-most column. For never-scanned clients: renders a **Run audit** button. For clients with a `latestSiteAudit`: renders a "View →" chevron only; the whole row is also clickable. Row-level link target = `/ada-audit/site/{latestSiteAudit.id}`. **Run audit** target = `/ada-audit/?prefillDomain={firstDomain}` and the `SiteAuditForm` reads `prefillDomain` from the search params on mount. If `firstDomain` is also null, the button instead links to `/clients` to add a domain first. |

### Search/filter
- Single text input above the column headers, placeholder "Search clients by name".
- Case-insensitive substring match on `clientName`.
- Client-side filter over the loaded array.
- Count line below the input: `"Filtered to 3 of 28 clients"` when filtering, hidden otherwise.

### Pagination
Same model as the Recents sections: 10 rows visible at a time inside a fixed-height scroll container, 25 rows per page, `[< Prev] Page X of N [Next >]` footer. With 30 clients that's 2 pages total.

### Empty state
- Zero clients in DB: section renders `"No clients yet — add some at /clients."` with a link.
- Filter matches zero rows: section content area renders `"No clients match 'foo'."` (filter input still shown).

## Paginated Recents

Both `Recent Page Audits` and `Recent Site Audits` get the same treatment.

### API extensions

`GET /api/site-audit` and `GET /api/ada-audit` accept new query params:
- `page` — 1-indexed, default 1
- `pageSize` — default 25, max 100 (sanity cap)

Response shape changes from `T[]` to:

```ts
type PaginatedResponse<T> = {
  items: T[]
  totalCount: number
  page: number
  pageSize: number
}
```

**Backward compatibility:** if a request includes no `page` and no `pageSize`, the response is still wrapped (`items: [...first 25...], totalCount, page: 1, pageSize: 25`). Existing client code reads only `items` after a small adapter update; no other consumers exist outside of `AuditHistory.tsx` and `SiteAuditHistory.tsx`.

### UI

- Fixed-height scroll container sized to ~10 rows (CSS `max-height: 10 * row-height; overflow-y: auto`).
- "Page X of N" prev/next footer underneath the container.
- Loading state on page change: container dims to 50% opacity until fetch resolves; prevents layout flash.

### URL state
Page state lives in URL search params:
- `recentPagesPage` — page index for Recent Page Audits
- `recentSitesPage` — page index for Recent Site Audits
- `clientsPage` — page index for Clients section
- `clientsSort` — `name-asc | name-desc | date-asc | date-desc | score-asc | score-desc`
- `clientsSearch` — current search filter

Reading/writing handled via `useSearchParams` and `router.replace` (no history entry per page change, so back-button doesn't accumulate pagination state).

A hard refresh on page 3 of recents stays on page 3 of recents.

### Polling interaction

`SiteAuditHistory` already smart-polls every 8s when active audits exist. PR 2 keeps that polling but:
- Polling refreshes the current page only (passes current `page` and `pageSize`).
- The fetch handler diffs `items` by `id` and only replaces rows that changed, so scroll position inside the container is preserved.
- If the page the user is on becomes empty after deletion (e.g. they were on page 4, deleted enough to drop to 3 pages), the UI auto-falls back to the last valid page.

## Components affected

| File | Change |
|---|---|
| `components/ada-audit/AuditIndexTabs.tsx` | Insert `<ClientsAuditSummary />` between New Audit card and the two Recents cards. |
| `components/ada-audit/ClientsAuditSummary.tsx` | **NEW** — search input, sortable column headers, scroll container, pagination footer, row link / Run audit button. |
| `components/ada-audit/AuditHistory.tsx` | Switch to server-side pagination via the new response shape. Add fixed-height scroll container and pagination footer. |
| `components/ada-audit/SiteAuditHistory.tsx` | Same treatment as `AuditHistory.tsx`. Preserve existing smart-poll. |
| `components/ada-audit/PaginatedSection.tsx` | **NEW** — shared layout (scroll container + footer controls + loading dim). Both Recents and Clients consume it. |
| `components/ada-audit/SiteAuditForm.tsx` | Read `prefillDomain` from `useSearchParams` on mount, populate the domain input if set. |
| `app/api/site-audit/route.ts` | Accept `page` / `pageSize`. Return `{ items, totalCount, page, pageSize }`. |
| `app/api/ada-audit/route.ts` | Same. |
| `app/api/clients/audit-summary/route.ts` | **NEW** — joins `Client` → latest complete `SiteAudit` per client, returns flat list. |

## Schema migration

None. PR 2 is UI + API extension only.

## Acceptance criteria

- Clients section renders one row per client. Default sort: latest audit date desc, with never-scanned clients pinned at the bottom.
- Column header click toggles asc/desc with a visible sort indicator (arrow).
- Search input filters case-insensitively in real time and shows the "X of N" count.
- Pagination footer in all three sections shows correct "Page X of N", prev/next disable correctly at boundaries.
- The scroll container preserves scroll position across polling refreshes.
- Hard refresh restores the page each section was on (URL query state).
- Existing API consumers that pass no `page` query param continue to work — `items` field contains the first 25 rows, same as the prior bare array.
- Clicking a never-scanned client's **Run audit** button lands on the audit form with the domain pre-filled.
- If a client deletion or audit completion changes the row count so the current page is out of range, the UI auto-falls back to the last valid page rather than showing an empty container.

## Branch ordering and dependency on PR 1

PR 2 branches off `main` after PR 1 merges. There is **no code dependency** — PR 2 doesn't touch the runner, schema, or audit logic. If PR 1 is delayed, PR 2 can ship against the current `main` first and the spec needs no changes.

## Future considerations (explicitly not in this PR)

- Bulk re-scan from the Clients view.
- CSV / clipboard export of the client summary.
- Showing single-page audit counts as a secondary metric per client.
- Per-client audit trend chart (score over time).
