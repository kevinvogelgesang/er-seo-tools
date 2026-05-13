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
New endpoint `GET /api/clients/audit-summary`. Joins `Client` → latest `SiteAudit` (where `status = 'complete'`, ordered by `createdAt desc`, one per client). **In-progress / queued audits are intentionally excluded** — the Clients view is a results dashboard, not a live progress board. Active audits remain visible in the existing Recent Site Audits section. Returns a flat list (no wire pagination — see "Pagination" below for the rationale):

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
| Action | — | Right-most column. For never-scanned clients with at least one domain: renders an enabled **Run audit** button that navigates to `/ada-audit/?prefillDomain={firstDomain}` (the `SiteAuditForm` reads `prefillDomain` from search params on mount and populates the domain input). For never-scanned clients with **no domains**: renders a **disabled** Run audit button with a tooltip `"Add a domain on the Clients page to enable audits."` The button does **not** redirect off-page — the client name in the row links to `/clients` if the user wants to add one. For clients with a `latestSiteAudit`: renders a "View →" chevron only; the whole row is also clickable and links to `/ada-audit/site/{latestSiteAudit.id}`. |

### Search/filter
- Single text input above the column headers, placeholder "Search clients by name".
- Case-insensitive substring match on `clientName`.
- Client-side filter over the loaded array.
- Count line below the input: `"Filtered to 3 of 28 clients"` when filtering, hidden otherwise.

**Debouncing.** Two pieces of state:
- `searchInput` (local component state) — bound directly to the controlled `<input>`. Updates on every keystroke. The filter `useMemo` reads this so filtering applies instantly while typing.
- `clientsSearch` URL param — written via a 300ms debounced effect on `searchInput`. This keeps `router.replace` off the keystroke path, avoiding layout-wide re-renders and visible typing lag.

On mount, `searchInput` initializes from `clientsSearch` so a hard refresh restores the user's filter.

### Pagination
**No pagination footer.** The full client list (~30 rows today) is rendered into a fixed-height scroll container sized to ~10 rows. The user scrolls inside the container to see the rest. Pagination would have manufactured friction — clicking "Next" just to see rows 26–30.

**Threshold for revisiting:** if the client roster crosses ~100 rows, switch to server-side pagination + filtering to match the Recents architecture. Today's API (single GET, no wire pagination) leaves room for that change without breaking callers.

### Empty state
- Zero clients in DB: section renders `"No clients yet — add some at /clients."` with a link.
- Filter matches zero rows: section content area renders `"No clients match 'foo'."` (filter input still shown).

### Error state

Applies to all three paginated sections, same pattern:

- **Initial fetch fails** (no prior data to show): container renders `"Failed to load <section>. [Retry]"` with a retry button that re-runs the fetch. No infinite spinner.
- **Polling refresh fails** (prior data exists): silent. Keep the last successful data on screen, log the error to `console.warn`, retry on the next poll tick. A subtle stale indicator may be added in a future PR but is **out of scope here** — keeping the UI quiet is the priority.
- **User-initiated page change fails** (Recents only): container un-dims, current page state is rolled back to the last known good page, and a brief inline error message appears under the pagination footer (`"Failed to load page N. [Retry]"`). The user is not stranded on a blank page.

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

**This is a breaking API change**, not a backward-compatible extension. Returning `{ items, totalCount, page, pageSize }` instead of a bare `T[]` is a different root type and any consumer assuming an array would break.

**Consumer audit:** the only callers are `components/ada-audit/AuditHistory.tsx` and `components/ada-audit/SiteAuditHistory.tsx`, both updated atomically in this same PR. No external API consumers exist (no public docs, no third-party callers).

Rationale for not hiding behind a `?paginate=true` opt-in: it would leave permanent dead-weight in the API surface to preserve compat for callers that don't exist. The breaking change is real but contained — accept it, update both consumers in lockstep, move on.

### UI

- Fixed-height scroll container sized to ~10 rows (CSS `max-height: 10 * row-height; overflow-y: auto`).
- "Page X of N" prev/next footer underneath the container.
- **User-initiated page change:** container dims to 50% opacity until the fetch resolves; prevents layout flash if row heights vary slightly between pages.
- **Background poll refresh: no dim.** Polling fetches are silent — they swap the data in place without any visible loading state. Dimming the dashboard every 8–30 seconds would be highly distracting while reading. The 50% dim is reserved strictly for fetches triggered by an explicit user action (prev/next click, sort change).

### URL state
Per-section state lives in URL search params so a hard refresh restores context:
- `recentPagesPage` — page index for Recent Page Audits
- `recentSitesPage` — page index for Recent Site Audits
- `clientsSort` — `name-asc | name-desc | date-asc | date-desc | score-asc | score-desc`
- `clientsSearch` — current search filter

(Clients section has no `clientsPage` because it's scroll-only.)

Reading/writing handled via `useSearchParams` and `router.replace` (no history entry per page change, so back-button doesn't accumulate pagination state).

A hard refresh on page 3 of Recents stays on page 3 of Recents.

### Polling interaction

`SiteAuditHistory` already smart-polls every 8s when active audits exist. PR 2 keeps that polling but:
- Polling refreshes the current page only (passes current `page` and `pageSize`).
- Scroll position inside the container is preserved across refreshes.
- If the page the user is on becomes empty after deletion (e.g. they were on page 4, deleted enough to drop to 3 pages), the UI auto-falls back to the last valid page.

### User-driven state survives polling (both Clients and Recents)

Render derivation pattern, documented here once because it applies to all three sections:

```ts
const rendered = useMemo(
  () => deriveView(rawData, { search, sort, page }),
  [rawData, search, sort, page],
)
```

`rawData` is the API response array. User state (`search`, `sort`, `page`) lives in component state / URL search params. A poll refresh updates `rawData` only — search, sort, and page selection are NOT touched. The memoized view re-derives on the new data with the user's filters and sort still applied.

Concrete: a user has filtered to "foo" and sorted by score on the Clients view. 30 seconds passes, the 30s poll fires, the API returns refreshed data. The list does NOT visually reset, jump around, or lose the filter. The filtered/sorted view is recomputed against the new data and re-rendered in place.

Same pattern for Recents: page selection survives polling refreshes because the polling fetch passes the current `page` to the API and the response replaces `rawData` for that page only.

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
- Pagination footer in the two Recents sections shows correct "Page X of N", prev/next disable correctly at boundaries. The Clients section has **no** pagination footer (scroll-only).
- The scroll container preserves scroll position across polling refreshes.
- Hard refresh restores the page each Recents section was on (URL query state).
- The two paginated API endpoints (`GET /api/site-audit`, `GET /api/ada-audit`) return the new `{ items, totalCount, page, pageSize }` shape unconditionally. Both internal consumers (`AuditHistory.tsx`, `SiteAuditHistory.tsx`) are updated in the same PR to read `items`. No code outside these two components calls the endpoints.
- Clicking a never-scanned client's **Run audit** button (when at least one domain exists) lands on the audit form with the domain pre-filled.
- A never-scanned client with **no domains** shows a disabled Run audit button with the documented tooltip; clicking does nothing. The client name link still leads to `/clients`.
- A user-applied search filter and sort on the Clients view survive the 30s background poll — list does not visually reset or jump.
- If a deletion changes the row count so the current Recents page is out of range, the UI auto-falls back to the last valid page rather than showing an empty container.
- Typing in the Clients search input remains responsive (no perceptible keystroke lag); URL `clientsSearch` param updates 300ms after the user stops typing, not per-keystroke.
- The 50% dim loading state appears ONLY on user-initiated page change. Background poll refreshes are visually silent.
- Initial fetch failures render an inline `"Failed to load … [Retry]"` UI inside each section's container. Polling failures are silent and retain the last good data.

## Branch ordering and dependency on PR 1

PR 2 branches off `main` after PR 1 merges. There is **no code dependency** — PR 2 doesn't touch the runner, schema, or audit logic. If PR 1 is delayed, PR 2 can ship against the current `main` first and the spec needs no changes.

## Future considerations (explicitly not in this PR)

- Bulk re-scan from the Clients view.
- CSV / clipboard export of the client summary.
- Showing single-page audit counts as a secondary metric per client.
- Per-client audit trend chart (score over time).
