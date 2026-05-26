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

Mobile nav: dropdowns already render as a flat sub-list on small screens — verify visually, no logic change.

## 2. Recents page becomes team-wide

**File:** `app/ada-audit/recents/page.tsx`, `lib/ada-audit/recents-query.ts`, plus new shared table component.

### Query layer

Add `fetchAllRecents(limit = 100, operator?: string)` next to the existing `fetchRecentsForOperator`. When `operator` is set, it filters; otherwise it returns everyone's audits.

The returned `RecentItem` already carries `requestedBy`, so the table can render an Operator column without a new query.

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

## 4. Audit Queue past batches: click-to-expand + operator

**Files:** `components/ada-audit/QueueBatchRow.tsx`, `app/api/audit-batches/route.ts`, `app/api/audit-batches/[id]/route.ts`, `lib/ada-audit/types.ts`.

### Row interaction

Today, the label is a `<button>` that opens an inline `<input>` on click. The caret is a separate button for expand. We invert this:

- The full row (caret area, label area, metadata area) becomes a single expand toggle.
- A small pencil icon `✎` appears next to the label on row hover. Clicking the pencil (with `stopPropagation`) opens the inline rename input. The existing PATCH flow is unchanged.
- Pressing `Escape` while editing cancels; `Enter` or blur saves (existing behavior).

Accessibility: the row is a `<button>` (or a `<div role="button">` with `onKeyDown` for `Enter`/`Space`). The pencil is a nested `<button>` with `aria-label="Rename batch"`.

### Operator on the metadata line

**Type change:** `AuditBatchSummary` gains `operatorSummary: string`.

**Server logic (`/api/audit-batches`):** when building each summary, aggregate `requestedBy` across `siteAudits`:

```ts
function summarizeOperators(siteAudits: { requestedBy: string | null }[]): string {
  const counts = new Map<string, number>()
  for (const s of siteAudits) {
    const name = s.requestedBy ?? 'unknown'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  if (sorted.length === 0) return 'unknown'
  if (sorted.length === 1) return sorted[0][0]
  return `${sorted[0][0]} +${sorted.length - 1}`
}
```

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
```

### Callsite changes

Swap raw `.toLocaleDateString()` / `.toLocaleString()` / `formatTime()` calls for `<ClientDate />` in:

- `app/ada-audit/recents/page.tsx` (Date column) — pass ISO string.
- `components/ada-audit/RecentsTable.tsx` (when extracted) — Date column.
- `components/ada-audit/QueueBatchRow.tsx` (Started/Closed) — replace local `formatTime()`.
- `components/ada-audit/QueueMemberRow.tsx` — any date column.
- `components/ada-audit/AuditPoller.tsx`, `SiteAuditPoller.tsx` — visible Started/Completed timestamps.
- Audit detail page header (`app/ada-audit/[id]/page.tsx`) and site detail page header.

Local helper formatters that compute server-side strings are deleted in favor of `<ClientDate />`.

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

- Unit: `summarizeOperators()` — empty, single, two-way tie, all nulls.
- Unit: `ClientDate` — null/invalid/valid; SSR snapshot matches post-mount text shape (just no TZ assertion).
- Component: `RecentsTable` renders identical columns in `home` vs `full` variant.
- Manual: nav dropdown opens to all three items; "Mine" pill is disabled-with-tooltip when no cookie; clicking a batch row expands it; clicking the pencil opens rename without expanding; dates change when you change your OS TZ.

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
