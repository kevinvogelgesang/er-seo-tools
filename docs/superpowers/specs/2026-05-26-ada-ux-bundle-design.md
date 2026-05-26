# ADA Audit UX Bundle — Design

**Date:** 2026-05-26
**Scope:** Items 1–5 of the ADA Updates batch (nav dropdown, recents-shows-all, full-featured home recents, batch click-to-expand with operator name, client-side timezone). Item 6 (screenshots) lives in a separate spec.

## Goals

1. Make Queue and Recents discoverable from the nav.
2. Recents become a team-wide view, with a "Mine only" filter.
3. The recents block on the `/ada-audit` home page uses the same component as the full Recents page so they stay consistent forever.
4. Batch rows in the Audit Queue history expand on click; rename is a small pencil affordance. Operator name shows on the batch row.
5. All user-visible timestamps render in the viewer's local timezone (browser TZ), not the server's.

## Non-goals

- No per-user TZ preference setting. The browser TZ is the source of truth.
- No changes to how operator names are collected (still cookie-based).
- No backfilling `requestedBy` for old batches — those just display "by unknown".
- No changes to batch creation, queue scheduling, or audit execution.

## 1. Nav dropdown

**File:** `components/Nav.tsx`.

Add a dropdown to the existing `'ADA Audit'` entry (alongside the existing `'SEO Parser'` dropdown):

```ts
{
  name: 'ADA Audit',
  href: '/ada-audit',
  dropdown: [
    { name: 'ADA Audit', href: '/ada-audit', description: 'Run an audit' },
    { name: 'Audit Queue', href: '/ada-audit/queue' },
    { name: 'Recents', href: '/ada-audit/recents' },
  ],
}
```

### Mobile nav bug to fix in the same change

`components/Nav.tsx:288` renders submenu links as the literal string `V{i + 1}` (`V1`, `V2`) instead of `{item.name}`. This is a pre-existing bug — likely a placeholder that survived. The fix is one-liner:

```diff
- V{i + 1}
+ {item.name}
```

Without this, "Audit Queue" and "Recents" would appear as `V1`/`V2` on mobile.

### Desktop dropdown numeric badge

The desktop dropdown at `Nav.tsx:201-208` renders a small numeric badge (`1`, `2`, …) next to non-leading items. For SEO Parser ("All Sessions", "Compare Crawls") it reads as visual flair; for ADA ("Audit Queue", "Recents") it can read as version labels. Drop the numeric badge in this change — render each item as `{item.name}` only. This applies to all dropdowns; SEO Parser also benefits from the cleanup.

## 2. Recents page becomes team-wide

**File:** `app/ada-audit/recents/page.tsx`, `lib/ada-audit/recents-query.ts`, plus new shared table component.

### Query layer

Add `fetchAllRecents(limit = 100, operator?: string)` next to the existing `fetchRecentsForOperator`. When `operator` is set, it filters; otherwise it returns everyone's audits.

The returned `RecentItem` already carries `requestedBy`, so the table can render an Operator column without a new query.

#### Score is not persisted — derive it in the query

**Critical fix (Codex finding):** `RecentItem.score` is currently populated from `p.score` / `s.score`, but those columns are **never written** in the runner or queue manager (verified: no `score:` write in `lib/ada-audit/queue-manager.ts`, `site-audit-helpers.ts`, or the site-audit finalize path). `SiteAudit.score` is always `null`; `AdaAudit.score` is also unwritten (the single-page API computes score on-read into the response, not into the column). So the existing recents table has been showing a blank Score column for site audits.

The recents query must derive scores the same way other read paths do:
- **Page audits:** parse `AdaAudit.result` and call `computeScore(violations, wcagLevel)` (see `app/api/ada-audit/route.ts:194`).
- **Site audits:** parse `SiteAudit.summary.aggregate` and call `computeScoreFromCounts(aggregate, wcagLevel)` (see `app/api/audit-batches/[id]/route.ts` and `app/api/clients/audit-summary/route.ts`).

To keep this affordable (see endpoint section), **only derive scores for rows with `status === 'complete'`**, and only after slicing to the requested `limit`. Pull `result` / `summary` with an explicit `select` so we don't over-fetch on incomplete rows. Wrap every `JSON.parse` in try/catch → `score: null` on failure (matches existing convention).

#### Timestamps as ISO strings at the query boundary

**Fix (Codex finding):** `fetchRecentsForOperator` currently returns `Date` objects. The new `/api/ada-audit/recents` endpoint will JSON-serialize them to strings, so the home page (server-rendered `Date`) and the client refetch (string) would feed `RecentsTable` two different runtime shapes. Change `RecentItem.createdAt | startedAt | completedAt` to **ISO `string`** at the query boundary (both `fetchAllRecents` and `fetchRecentsForOperator`). `<ClientDate />` consumes ISO strings anyway, so this aligns cleanly. Update the `RecentItem` type and both query functions.

### Page

Convert `app/ada-audit/recents/page.tsx` into a thin server component that:

- Reads `?scope=mine|all` (default `all`) and the operator cookie.
- Calls `fetchAllRecents()` when scope is `all`, `fetchRecentsForOperator()` when scope is `mine` (returns empty if no cookie).
- Renders `<RecentsTable items scope operator />`.

The current "Set your operator name…" empty state is removed. With `scope=all` no operator is required.

### Toggle behavior

The `<RecentsTable />` component owns the toggle. When clicked, it updates the `scope` query param via `router.replace()` (no full reload — `useRouter` already exists in similar components). Toggle UI: two pill buttons "All" / "Mine", "Mine" disabled with tooltip "Set your operator on the dashboard" when no cookie.

### Columns

`Type | URL / Domain | Client | Operator | Status | Score | Duration | Date`

(Same as today plus the new "Operator" column.)

## 3. Home page recents card

**Files:** `components/ada-audit/MyRecentsCard.tsx` (delete), `components/ada-audit/AuditIndexTabs.tsx` (callsite swap), new `components/ada-audit/RecentsTable.tsx` (shared).

`RecentsTable` is the single rendering component used by both:
- The home page (capped at 10 rows, defaults to `mine` if operator cookie present else `all`, footer link "See all recents →" to `/ada-audit/recents`).
- The full Recents page (no cap, default `all`).

Props:

```ts
type RecentsTableProps = {
  items: RecentItem[]      // already filtered server-side for initial render
  scope: 'all' | 'mine'
  operator: string | null
  variant: 'home' | 'full' // controls row cap + "See all" footer
  // When user toggles scope on the client, the table refetches via a new
  // /api/ada-audit/recents endpoint that takes ?scope&limit and returns the
  // same RecentItem shape.
}
```

### New endpoint

`GET /api/ada-audit/recents?scope=all|mine&limit=N` — thin wrapper around `fetchAllRecents` / `fetchRecentsForOperator`. Returns `{ items: RecentItem[] }`. The home page server-renders the initial state, then the table refetches client-side when the user toggles.

This keeps the two contexts consistent: identical columns, identical sort, identical behavior.

**Hardening (Codex findings):**
- **Clamp `limit` server-side** to `1..100` (`Math.min(100, Math.max(1, parsed))`), defaulting to 100. Never trust the client value.
- **Operator for `scope=mine`** comes from the server-read cookie (`OPERATOR_NAME_COOKIE_NAME`), not a query param — a client can't request another operator's "mine" view. If no cookie, `scope=mine` returns `{ items: [] }`.
- **Stale-response protection in `RecentsTable`:** a fast `all → mine → all` toggle can resolve out of order and clobber newer state. The component holds an `AbortController` (abort the in-flight request before firing a new one) **and** a monotonic request-sequence id; only apply a response whose sequence id is the latest. Abort errors are swallowed.

## 4. Audit Queue past batches: click-to-expand + operator

**Files:** `components/ada-audit/QueueBatchRow.tsx`, `app/api/audit-batches/route.ts`, `app/api/audit-batches/[id]/route.ts`, `lib/ada-audit/types.ts`.

### Row interaction

Today, the label is a `<button>` that opens an inline `<input>` on click. The caret is a separate button for expand. We invert this.

**Layout (Codex fix — no nested buttons):** the row is a flex container (`<div>`, *not* a button). It holds two **sibling** interactive elements:

1. **Expand button** — a real `<button>` covering the caret + label + metadata area, with `aria-expanded={expanded}` and `aria-controls="batch-panel-<id>"`. Clicking or pressing Enter/Space toggles the panel. The expanded panel gets `id="batch-panel-<id>"`.
2. **Rename button** — a sibling `<button aria-label="Rename batch">` (the pencil `✎`), visible on row hover/focus, placed *outside* the expand button in the DOM. Clicking it enters edit mode (swaps the label area for the inline `<input>`). Because it's a sibling, no `stopPropagation` hack is needed and there's no invalid `<button>`-in-`<button>` nesting.

While editing, the inline `<input>` replaces the expand button's label region:
- `Escape` cancels without saving and does **not** trigger a PATCH on the subsequent blur (guard the blur handler with an `escaped` ref so Escape-then-blur is inert).
- `Enter` or blur (when not escaped) saves via the existing PATCH flow.

**Keyboard order:** Tab reaches the expand button, then the rename button. Screen readers announce expand state via `aria-expanded`.

### Operator on the metadata line

**Type change:** `AuditBatchSummary` gains `operatorSummary: string`.

**Server logic (`/api/audit-batches`):** when building each summary, aggregate `requestedBy` across `siteAudits`:

```ts
function summarizeOperators(siteAudits: { requestedBy: string | null }[]): string {
  const counts = new Map<string, number>()
  for (const s of siteAudits) {
    const name = s.requestedBy?.trim() || 'unknown'   // trim; blank → unknown
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => {
    // count desc, then 'unknown' last, then name asc — fully deterministic,
    // independent of DB row order (Codex fix).
    if (b[1] !== a[1]) return b[1] - a[1]
    if (a[0] === 'unknown') return 1
    if (b[0] === 'unknown') return -1
    return a[0].localeCompare(b[0])
  })
  if (sorted.length === 0) return 'unknown'
  if (sorted.length === 1) return sorted[0][0]
  return `${sorted[0][0]} +${sorted.length - 1}`
}
```

The tie-breaker is deterministic (count desc → unknown last → name asc), so the displayed lead operator doesn't flip-flop between requests just because Prisma returned rows in a different order.

Add `requestedBy` to the existing `siteAudits` select in `/api/audit-batches/route.ts`.

**Detail endpoint:** already returns members with their site audit fields; add `requestedBy` to the returned `AuditBatchMember` so the expanded panel can show per-audit operator if we ever want to. Not rendered in V1 to avoid scope creep — the field is just available.

**UI:** metadata line in `QueueBatchRow.tsx` becomes:

```
Started Apr 12, 2:34 PM · Closed Apr 12, 3:01 PM (27m) · by Alice +2
```

## 5. Client-side timezone rendering

**New file:** `components/ClientDate.tsx`.

A small client component that takes an ISO string and renders it formatted in the viewer's timezone, with no hydration mismatch.

```tsx
'use client'
import { useEffect, useState } from 'react'

type Variant = 'date' | 'dateTime' | 'dateTimeShort'

const formatters: Record<Variant, Intl.DateTimeFormatOptions> = {
  date:           { year: 'numeric', month: 'short', day: 'numeric' },
  dateTime:       { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  dateTimeShort:  { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
}

export function ClientDate({ iso, variant = 'date' }: { iso: string | null | undefined; variant?: Variant }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (!iso) return <>—</>

  // SSR + first paint: render an ISO-derived stable fallback (browser-tz
  // formatting on the server would produce server-tz, then re-render to
  // browser-tz on mount, causing hydration mismatch).
  if (!mounted) return <span suppressHydrationWarning>{iso.slice(0, 10)}</span>

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return <>—</>
  return <span>{date.toLocaleString('en-US', formatters[variant])}</span>
}

// For attribute contexts (e.g. title="…") where a string is required rather
// than an element. Shares the same formatter table. Callers that use this in
// SSR must accept that the first paint shows server-tz until hydration; for
// hover titles that's invisible until the user hovers, so it's acceptable.
export function formatInBrowserTZ(iso: string | null | undefined, variant: Variant = 'date'): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-US', formatters[variant])
}
```

### Callsite changes

Swap raw `.toLocaleDateString()` / `.toLocaleString()` / `formatTime()` calls for `<ClientDate />` in:

- `app/ada-audit/recents/page.tsx` (Date column) — pass ISO string.
- `components/ada-audit/RecentsTable.tsx` (when extracted) — Date column.
- `components/ada-audit/QueueBatchRow.tsx` (Started/Closed) — replace local `formatTime()`.
- `components/ada-audit/QueueMemberRow.tsx` — any date column.
- `components/ada-audit/AuditPoller.tsx`, `SiteAuditPoller.tsx` — visible Started/Completed timestamps.
- Audit detail page header (`app/ada-audit/[id]/page.tsx`) and site detail page header.

**Additional callsites found by Codex (do not miss these):**
- `components/ada-audit/ClientsAuditSummary.tsx:309` — `new Date(la.createdAt).toLocaleDateString()`.
- `components/ada-audit/AuditResultsView.tsx:125` — `new Date(createdAt).toLocaleString()`.
- `components/ada-audit/SiteAuditResultsView.tsx:324` — `new Date(createdAt).toLocaleString()`.
- `lib/ada-audit/duration.ts` — `formatDurationHover()` builds a user-visible hover **title** with server-formatted timestamps. Either move its formatting client-side or feed the raw ISO into a `<ClientDate variant="dateTime" />` title. Note: `<ClientDate />` renders an element, so a hover `title=` attribute needs a string — provide a small `formatInBrowserTZ(iso, variant)` helper for attribute contexts, used by both `ClientDate` and `duration.ts`.
- `components/ada-audit/AuditHistory.tsx:183` and `components/ada-audit/SiteAuditHistory.tsx:275` — these components render dates but appear to be **dead code** (only referenced in `AuditIndexTabs.tsx` comments, never imported/rendered). Verify during implementation: if dead, delete them; if reachable, swap their dates too.

**Server-baked batch label (important — Codex fix):** `lib/ada-audit/audit-batch-helpers.ts:93` (`resolveBatchLabel`) formats `batch.startedAt` server-side into the auto-label (e.g. `Batch — May 13, 2026 7:15 PM`), which both batch endpoints return. That bakes server timezone into the string before any client sees it. Fix: the API returns `label: string | null` where `null` signals "no custom label set", and `QueueBatchRow` constructs the auto-label on the client from `batch.startedAt` via `<ClientDate variant="dateTime" />`. This also simplifies the existing "clear label → re-fetch resolved label" round-trip in `QueueBatchRow.saveLabel()` — clearing now just yields `null` and the client renders the auto-label directly, so the post-clear re-fetch can be removed. Update `AuditBatchSummary.label` / `AuditBatchDetail.label` types to `string | null` and the PATCH response accordingly.

Local helper formatters that compute server-side strings (e.g. `formatTime` in `QueueBatchRow.tsx`) are deleted in favor of `<ClientDate />` / `formatInBrowserTZ`.

**Out of scope:** `<title>` metadata, OpenGraph dates, share-token expiry math — these stay server-side. They're not user-visible TZ-sensitive.

### Edge cases

- `iso` of `null` / `undefined` → render `—`.
- Invalid ISO → render `—`.
- Server-render fallback (`iso.slice(0, 10)`) is a date-only string in UTC — fine as a one-frame placeholder; mounts within ~16ms.

## Data flow

```
Nav (client)
 └── /ada-audit/queue ──── QueuePageTabs
                            └── QueueHistoryView ── /api/audit-batches (+ operatorSummary)
                                                    └── QueueBatchRow (click → expand, ✎ → rename)
                                                         └── /api/audit-batches/[id]
                                                              └── QueueMemberRow (ClientDate)

 └── /ada-audit ──────────── AuditIndexTabs
                              └── RecentsTable (variant='home', scope=mine|all)
                                   ├── server: fetchRecentsForOperator() OR fetchAllRecents()
                                   └── client toggle: GET /api/ada-audit/recents?scope=…&limit=10

 └── /ada-audit/recents ── RecentsTable (variant='full', scope=all default)
                            ├── server: fetchAllRecents() OR fetchRecentsForOperator()
                            └── client toggle: GET /api/ada-audit/recents?scope=…
```

## Testing

- Unit: `summarizeOperators()` — empty, single, two-way tie (assert deterministic lead via name asc), all nulls/blanks → "unknown", unknown-sorts-last.
- Unit: `ClientDate` / `formatInBrowserTZ` — null/invalid/valid; SSR fallback (`iso.slice(0,10)`) renders without throwing.
- Unit: recents score derivation — complete page row computes from `result`, complete site row from `summary.aggregate`, incomplete row → `null`, malformed JSON → `null`.
- Unit: `/api/ada-audit/recents` — `limit` clamps to 1..100; `scope=mine` with no cookie → empty; `scope=mine` ignores any operator query param.
- Component: `RecentsTable` renders identical columns in `home` vs `full` variant; rapid scope toggle applies only the latest response (sequence-id guard).
- Manual: nav dropdown opens to all three items and shows real names on **mobile** (not `V1`/`V2`); "Mine" pill disabled-with-tooltip when no cookie; clicking a batch row expands it; clicking the pencil opens rename without expanding; Escape-then-blur does not PATCH; dates change when you change your OS TZ; batch auto-label renders in browser TZ; test around midnight UTC.

## Risks and trade-offs

- **Hydration mismatch on `<ClientDate />`:** mitigated by the `mounted` gate + stable ISO-slice fallback. We accept a one-frame placeholder.
- **Operator summary "by unknown":** old batches predate `requestedBy`; their summaries will read "by unknown". Acceptable per scope.
- **New `/api/ada-audit/recents` endpoint** doubles the surface for recents queries. We accept it because eliminating it would force a full server round-trip per toggle.
- **Deleting `MyRecentsCard`** breaks any external bookmarks or import paths — there are none outside the home page.

## Spec self-review

- Placeholders: none.
- Internal consistency: `RecentsTable` is referenced by both the home and recents pages; both contracts match (props, columns, endpoint).
- Scope: focused on UX; no scoring/queue/runner changes leak in.
- Ambiguity: "by Alice +2" format made explicit; tie-breaker rule (count desc, no secondary sort) noted.
