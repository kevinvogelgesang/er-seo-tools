# Live Audit Page — Design

**Date:** 2026-05-14
**Status:** Approved for implementation planning
**Revised:** 2026-05-14 (round 2) — pure helpers, drop misleading `updatedAt`, route `pdfs-running` to the running view

## Goal

While a site audit is running, the audit detail page (`/ada-audit/site/[id]`) should show a live, dynamically updating table of completed pages alongside the existing progress bar. Operators can click through to any completed page's audit results the moment that page finishes, instead of waiting for the whole batch to finalize.

Today the page renders only `<SiteAuditPoller>` while status is `queued`/`pending`/`running` (note: **not** `pdfs-running`, which is a pre-existing routing bug fixed in this PR). After completion it switches to `<SiteAuditResultsView>` with the full aggregated table, sitemap tree, and issue grouping.

## Why now

- The data is already in the DB by the time each page completes — each `AdaAudit` child row has its full result JSON, scorecard, and Lighthouse summary as soon as the page is scanned. The detail page just doesn't surface any of it during the running state.
- 30-page audits take ~15 minutes. Operators want to triage early failures (e.g., a top-traffic page with critical violations) without waiting for the full run.
- The cancel feature now exists. Combined with a live view, an operator who sees garbage results in the first three pages can cancel rather than waste 12 minutes on a doomed run.

## Pre-flight gate

This PR is **sequenced after** `2026-05-14-audit-stability.md` ships and is observed running cleanly in production. Reason: a live page that surfaces audit progress is only useful if audits actually finish. The stability fixes are the foundation; this is the UX win on top.

## Non-goals (out of scope)

- **Aggregate views during running.** No live sitemap-tree, no live issue grouping, no rolling "X total critical violations so far" score. These require the full set to be meaningful and re-computing them every 3 seconds is wasteful for no operator benefit.
- **Live updates inside a single page's `/ada-audit/[childId]` view.** Once an operator drills into a child page, that page is already terminal (status `complete` or `error`) — it doesn't need polling.
- **WebSocket / SSE streaming.** Polling at 3s remains the transport. SSE would require infrastructure work (sticky sessions on NGINX, reconnect logic) for marginal latency gain.
- **Pagination of live rows.** Cap the live children response at 100 most-recent rows. Sites larger than 100 pages will eventually hit the final view for the full list; this is purely a running-state convenience.
- **Re-ordering controls.** Sort is fixed: rows arrive in `createdAt desc` (most recent first). Operators can re-sort once the audit completes and the full view loads.

## Architectural principle: pure helpers, DB access at the route

`lib/ada-audit/site-audit-helpers.ts` today is intentionally pure — none of its exports import `prisma`. `buildSiteAuditSummary(children)` takes pre-fetched child rows as a parameter and produces a summary. This PR preserves that boundary:

- The new helper `buildLiveChildren(rows)` is a **pure function** — no DB access.
- The route layer (`app/api/site-audit/[id]/route.ts`) does the `prisma.adaAudit.findMany` and hands the rows to the helper.

This matches the existing pattern, keeps the helper trivially unit-testable, and avoids ambient I/O in a module everyone imports.

## Data flow

### Backend

Extend `GET /api/site-audit/[id]` with one optional field on the response:

```ts
interface SiteAuditDetail {
  // …existing fields…
  liveChildren?: LiveAuditChild[]   // present only when status is running/pdfs-running
}

interface LiveAuditChild {
  adaAuditId: string
  url: string
  status: 'pending' | 'running' | 'complete' | 'error'
  scorecard: AuditScorecard | null  // null while running/pending; present when complete
  error: string | null              // populated when status === 'error'
}
```

Note: no `updatedAt` / `createdAt` field on the wire. The server returns rows in `createdAt desc` order (newest first) — the client renders in that order. No reason to expose timestamps for cosmetic sort that we already perform server-side.

The route handler does the work:

```ts
// inside app/api/site-audit/[id]/route.ts
const childRows = (audit.status === 'running' || audit.status === 'pdfs-running')
  ? await prisma.adaAudit.findMany({
      where: { siteAuditId: audit.id },
      orderBy: { createdAt: 'desc' },
      take: LIVE_CHILDREN_LIMIT,
      select: { id: true, url: true, status: true, result: true, error: true },
    })
  : []
const liveChildren = (audit.status === 'running' || audit.status === 'pdfs-running')
  ? buildLiveChildren(childRows)
  : undefined
```

`buildLiveChildren` is a pure transform — given the row shape above, returns `LiveAuditChild[]`. For complete children it parses the axe result JSON into a scorecard (via the existing `parseAxeScorecardFromResult` extracted in Task 2 of the plan). For non-complete children scorecard is null.

100-row cap rationale: typical sites < 100 pages fit entirely. Larger sites show the most recent 100; older completed pages remain reachable via direct URL once the audit finalizes.

### Frontend

Three things change client-side:

1. **`SiteAuditPoller`** tracks `liveChildren` in poll state and renders `<LiveAuditTable>` below the progress card when non-empty.
2. **`<LiveAuditTable>`** (new component) renders a focused table with columns mirroring the eventual `SiteAuditResultsView`, but simpler:

   | URL | Status | Violations |
   |---|---|---|
   | `/blog/` | complete | 2 crit • 0 ser |
   | `/contact/` | running | — |
   | `/about/` | complete | Clean |

   Each row with `status === 'complete'` or `status === 'error'` is a `<Link>` to `/ada-audit/[adaAuditId]`. Rows with `status === 'running'` show a `—` in place of the violation counts.

3. **`app/ada-audit/site/[id]/page.tsx`** routing fixed: today the page sends `queued`/`pending`/`running` to the poller and *everything else* to the `complete`/`error` branches. `pdfs-running` falls through to the complete branch and shows "Result data is unavailable" because `summary` JSON hasn't been written yet. This PR adds `pdfs-running` to the poller branch.

### Polling cadence + message

Unchanged from today: 3000 ms in `SiteAuditPoller`. The `liveChildren` payload for a typical 30-page site at peak is ~6 KB serialized. At 100 rows × ~250 bytes each + headers, the response stays well under 50 KB.

During the `pdfs-running` phase the page-progress bar reads 100% (all pages done). The poller's "Scanning pages…" headline is misleading at that point. This PR updates the poller's running-state copy to show "Scanning PDFs…" when `status === 'pdfs-running'`.

## API contract

| Endpoint | Today | After |
|---|---|---|
| `GET /api/site-audit/[id]` | Returns aggregate counts + `summary` (when complete) | Same, plus `liveChildren?: LiveAuditChild[]` when status is running/pdfs-running |

Backwards compatible — clients that ignore `liveChildren` see no change. The terminal-state response is byte-identical to today.

## File structure

| File | Role |
|---|---|
| `lib/ada-audit/site-audit-helpers.ts` | Export `parseAxeScorecardFromResult` (extracted from existing private `parseScorecard`). New pure exported `buildLiveChildren(rows): LiveAuditChild[]`. **No prisma import.** |
| `lib/ada-audit/types.ts` | Add `LiveAuditChild` type; extend `SiteAuditDetail` with optional `liveChildren`. |
| `app/api/site-audit/[id]/route.ts` | When status is running/pdfs-running, query `adaAudit.findMany` and feed rows to `buildLiveChildren`; include result in response. |
| `app/ada-audit/site/[id]/page.tsx` | Add `pdfs-running` to the poller branch (route-fix). |
| `components/ada-audit/SiteAuditPoller.tsx` | Track `liveChildren` in poll state. Render `<LiveAuditTable>` when non-empty. Show "Scanning PDFs…" copy during `pdfs-running`. |
| `components/ada-audit/LiveAuditTable.tsx` | New component. Renders the table described above. |

## Open behavioural questions resolved

- **What if `liveChildren` is empty (status=running but no children yet)?** Render nothing for the table; the existing progress card already covers this state.
- **What if the audit transitions to `complete` mid-poll?** Server returns no `liveChildren`; existing logic in `SiteAuditPoller` triggers a `router.refresh()`, swapping the page over to `SiteAuditResultsView`. No transient blank state.
- **Click-through during running:** the child `/ada-audit/[id]` already handles all terminal states. No change needed there.
- **Sort stability:** server returns rows in `createdAt desc` already (DB ordering deterministic). Client renders that order. No need to expose timestamps or sort client-side.

## Tests

| Test | File |
|---|---|
| `parseAxeScorecardFromResult` returns null for null/invalid input; counts impacts correctly | `lib/ada-audit/site-audit-helpers.test.ts` |
| `buildLiveChildren` is a pure function — produces correct shape for mixed status fixtures | `lib/ada-audit/site-audit-helpers.test.ts` |
| `buildLiveChildren` produces scorecard only for `status === 'complete'`; copies error for `status === 'error'` | same |
| `GET /api/site-audit/[id]` includes `liveChildren` when SiteAudit status is `running` | `app/api/site-audit/[id]/route.test.ts` |
| `GET /api/site-audit/[id]` includes `liveChildren` when SiteAudit status is `pdfs-running` | same |
| `GET /api/site-audit/[id]` omits `liveChildren` when SiteAudit status is `complete` | same |

No UI tests — this codebase doesn't have a React testing stack and adding one is out of scope. Manual verification on the live audit per the plan.
