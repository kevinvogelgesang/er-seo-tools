# Audit Queue Batches — Design

**Date:** 2026-05-13
**Status:** Approved for implementation planning

## Goal

Turn the existing flat FIFO site-audit queue into a feature with first-class **batches** ("blocks"), make queuing audits a one-click action from the Clients section, and give the user a dedicated page to monitor the active block and review past ones.

A **batch** is an auto-grouped run of one or more site audits. A new batch opens when an audit is enqueued and no other batch is open; it closes when its last in-flight audit settles. This mirrors how the user already thinks about the queue — "this block I'm running right now" vs. "the block I ran last week" — without asking them to name or manage batches up front.

## Why now

- The Clients section we just shipped surfaces every client + their latest site audit, but the only way to queue a re-audit is to click "Run audit", which navigates to the Full Site form and requires a manual submit. Three clicks for a one-domain operation.
- The existing `/api/site-audit/queue` endpoint reports a flat list. There's no concept of "the current run" vs. "previous runs" — operators have to mentally reconstruct boundaries.
- The Full Site form has a domain-fill bug when a selected client has no domain configured (silent no-op). Bundling the fix into this feature keeps related UX work together.

## Non-goals (out of scope)

- **Per-client audit settings or schedules.** All quick-queue audits run with `wcag21aa`. WCAG 2.2 AA and pre-discovered URLs remain on the manual Full Site form. No cron/scheduled audits.
- **Batch retention / auto-delete.** Closed batches accumulate indefinitely. Existing site-audit DELETE already cascades to child page audits and artifacts; a deleted SiteAudit just disappears from its batch (FK `onDelete: SetNull`). Daily cleanup remains unchanged.
- **Reporting / exports.** No CSV/PDF batch summaries. The History tab is read-only.
- **Bulk batch operations.** No "delete batch", "re-run batch", or "cancel all in batch" in v1. Individual SiteAudit DELETE on its detail page still works.
- **Notifications.** No email, push, or audio alerts when a batch closes.

## Data model

### New table: `AuditBatch`

```prisma
model AuditBatch {
  id         String      @id @default(cuid())
  startedAt  DateTime    @default(now())
  closedAt   DateTime?                          // null = currently open
  label      String?                            // user-editable; null = render auto-label from startedAt
  siteAudits SiteAudit[]

  @@index([closedAt])                           // fast "is there an open batch?" lookup
  @@index([startedAt])                          // history list ordering
}
```

### Modified table: `SiteAudit`

```prisma
model SiteAudit {
  // …existing fields…
  batchId    String?
  batch      AuditBatch? @relation(fields: [batchId], references: [id], onDelete: SetNull)

  @@index([batchId])
}
```

`onDelete: SetNull` because batches are logical groupings — deleting an audit should not delete the batch, and deleting a batch should not cascade to audits (in practice we don't expose batch deletion in v1 anyway).

### Auto-label format

When `label IS NULL`, the UI renders `Batch — <localized timestamp>`, e.g. `Batch — May 13, 2026 7:15 PM`. The label column lets the user override this inline on the History tab.

### Existing data

Pre-feature SiteAudits have `batchId = null`. They remain visible in the Recent Site Audits list on `/ada-audit` (existing pagination) and are NOT shown on the new `/ada-audit/queue` page. No backfill.

## Enqueue and close logic

Both live in `lib/ada-audit/queue-manager.ts`. The key invariant: **at most one batch is open at any time** (`closedAt IS NULL`).

### Enqueue (extend existing `enqueueAudit`)

```
1. Find the open batch (closedAt IS NULL). If none, create one.
2. Create the SiteAudit row with batchId = openBatch.id.
3. Kick processNext() (unchanged from today).
```

The "find open batch" step uses `findFirst({ where: { closedAt: null } })`. Race condition: two near-simultaneous enqueues could both observe "no open batch" and both create one. Mitigated by a unique partial index on `closedAt IS NULL`? SQLite doesn't support partial unique indexes well. Acceptable alternative: wrap enqueue in a `$transaction` with serializable behavior, OR live with the rare double-batch case (cosmetic only — both batches would be valid containers; one happens to be empty or holds 1 audit). v1 ships with the transaction approach.

### Close (extend `finalizeSiteAudit` + error paths)

A batch closes when no SiteAudit attached to it remains in flight (`status IN ['queued', 'running', 'pdfs-running']`). Checked at the same boundaries that already finalize a site audit:

```
After SiteAudit transitions to complete OR error:
  if its batchId is set:
    count in-flight siblings (same batchId, status in [queued, running, pdfs-running])
    if count == 0:
      set batch.closedAt = now()
```

Two paths trigger close: `finalizeSiteAudit` (success path, including the post-PDF settle callback) and the existing top-level error handler in `runAudit` (when a SiteAudit hits status=error). Both paths call a small new helper `lib/ada-audit/audit-batch-helpers.ts::closeBatchIfDrained(batchId)` so the logic lives in one place.

### What if all audits in a batch are deleted?

If the user deletes every member SiteAudit of an open batch, the batch stays open with zero in-flight members. Acceptable in v1 — the next enqueue attaches to it (it's still "the open batch"). The label timestamp may end up disconnected from real audit work, but this is an edge case operators don't encounter in practice.

## API surface

### Modified — `GET /api/site-audit/queue`

Existing response shape extended with `batch`:

```ts
{
  active: { id, domain, pagesTotal, pagesComplete, pagesError } | null  // unchanged
  queued: { id, domain, position }[]                                    // unchanged
  batch: {
    id: string
    startedAt: string  // ISO
    label: string      // auto-rendered if null in DB
  } | null
}
```

`batch` describes the currently open batch (if any). `null` when no batch is open (i.e. queue is fully drained). Existing callers (`SiteAuditForm`'s queue banner, `SiteAuditHistory`'s smart-poll) ignore the new field — backwards compatible.

### New — `GET /api/audit-batches`

Paginated list of closed batches, newest first.

Query params: `page` (default 1), `pageSize` (default 25, max 100).
Response:

```ts
{
  items: Array<{
    id: string
    startedAt: string         // ISO
    closedAt: string          // ISO (always non-null in this endpoint)
    label: string             // resolved auto-label if DB column is null
    auditCount: number        // total members
    completeCount: number     // status === 'complete'
    errorCount: number        // status === 'error'
  }>
  totalCount: number
  page: number
  pageSize: number
}
```

### New — `GET /api/audit-batches/[id]`

One batch + its members. Used by both the Active tab (open batch detail) and the History tab (expanded row).

```ts
{
  id: string
  startedAt: string
  closedAt: string | null    // null = open batch
  label: string
  members: Array<{
    id: string
    domain: string
    clientId: number | null
    clientName: string | null
    status: string            // queued | running | pdfs-running | complete | error
    pagesTotal: number
    pagesComplete: number
    pagesError: number
    score: number | null      // derived from summary.aggregate (same as /api/site-audit)
    createdAt: string
  }>  // ordered by createdAt ascending — queue/start order
}
```

### New — `PATCH /api/audit-batches/[id]`

```ts
// Request: { label: string | null }  // null clears to auto-label
// Response: 200 { id, label }
```

Lets the History tab inline-edit a batch label. Validates label length (≤ 200 chars) and trims whitespace.

### New — `POST /api/site-audit/bulk-queue`

Used by the Clients section's "Queue all" button. Body: nothing — derives the eligible client list server-side.

```
1. Fetch all clients with at least one domain.
2. If ANY client (in the full table) has zero domains, return 400:
   { error: 'missing_domains', clientsWithoutDomains: [{ id, name }] }
   This is the "fail loudly" requirement — bulk-queue refuses to fire if any
   client is missing a domain, so the operator can fix the data first.
3. For each eligible client, attempt to enqueue an audit for client.domains[0].
   The existing in-flight duplicate guard returns 409 per row; collect those.
4. Return 200:
   { queued: [{ clientId, auditId }], skipped: [{ clientId, reason }] }
```

The per-client error reporting in the response feeds a result panel in the UI.

## UI surfaces

### Clients section (`components/ada-audit/ClientsAuditSummary.tsx`)

Three changes:

1. **Per-row 'Queue audit' button replaces the existing 'Run audit' link.** Click handler:
   - `POST /api/site-audit { domain: client.firstDomain, clientId }`
   - On 202: show toast `Queued audit for <client>`. No optimistic UI mutation — the row's status chip updates on the next 30s `/api/site-audit/queue` poll. (Keeps the rendering source of truth on the server.)
   - On 409 (already in flight): toast `<client> already queued`.
   - On error: toast `Couldn't queue audit: <message>`.
   For clients with an existing audit (current 'View →' state), the row gets BOTH buttons: 'View →' and 'Queue audit' (re-run).
   For clients with no domain, the button stays disabled with today's tooltip.

2. **Section header gets two new controls** to the right of the search input:
   - `Queue all` button. Click → confirmation modal: `Queue audits for <N> clients?` (counts only eligible clients). Confirm → `POST /api/site-audit/bulk-queue`. If the server returns 400 with `clientsWithoutDomains`, switch modal content to a list of those clients with `/clients` deep-links — user must resolve before the bulk queue runs. Success → result panel summarizing queued vs. skipped.
   - `View queue →` link to `/ada-audit/queue`.

3. **Active-row decoration.** A small chip on each row whose client has a member in the currently open batch — e.g. a `Queued` / `Running` / `Scanning PDFs` badge alongside the score. Driven by polling `/api/site-audit/queue` on the same 30s cadence the section already uses. (Polls are silent — no opacity dim.)

### New page — `/ada-audit/queue`

App router: `app/ada-audit/queue/page.tsx`. Server component that renders a client component `<QueuePageTabs />`.

URL state: `?tab=active` (default) or `?tab=history`.

#### Active tab

Renders the currently open batch's members, polled every 5s. Layout:
- Header: batch auto-label + member counts (`N queued · M running · K complete · J errored`).
- Body: rows sorted by status (running first, then queued, then complete/error at bottom). Each row links to its `/ada-audit/site/[id]` detail.
- Empty state when no batch is open: `No audits in flight. Queue some from /ada-audit.`

When the batch closes (poll observes `closedAt != null`), the page surfaces a one-time toast `Batch complete` and the row block goes static. Next poll returns `batch: null`; the page shows the empty state.

#### History tab

Reuses the `PaginatedSection` component shipped in the UI overhaul. Each row:
- Auto-label (or user label if set), inline-editable (click → input → blur or Enter saves via `PATCH /api/audit-batches/[id]`)
- Date range: `Started May 13, 7:15 PM · Closed 7:38 PM (23 min)`
- Counts: `5 audits · 4 complete · 1 errored`
- Expand caret → reveal member list (fetched via `GET /api/audit-batches/[id]` on first expand, cached in component state).

URL state: `?historyPage=N` (omit on 1). 25 batches per page.

### SiteAuditForm bug fix

Root cause: `selectClient` only calls `setDomain(...)` when `client.domains.length > 0`. When the user picks a client with no domain, the function returns silently and the domain input keeps whatever was in it (often empty, sometimes a stale value from a previous selection).

Fix in `components/ada-audit/SiteAuditForm.tsx::selectClient`:

```ts
function selectClient(client: Client | null) {
  setSelectedClient(client)
  setOpen(false)
  if (!client) { setQuery(''); return }

  setQuery(client.name)
  if (client.domains.length > 0) {
    setDomain(client.domains[0].replace(/^https?:\/\//i, '').replace(/\/.*$/, ''))
    setDomainTouched(false)
  } else {
    // Clear any leftover domain — picking a client with no domain shouldn't
    // leave the previous client's domain sitting in the input.
    setDomain('')
    setDomainTouched(false)
  }
}
```

Plus a small inline hint under the domain input when `selectedClient && selectedClient.domains.length === 0`:

> This client has no domain configured. [Add one →](`/clients`)

The submit button is already disabled when `domain` is empty, so no extra guard needed.

## Components inventory

### New
- `app/ada-audit/queue/page.tsx` — route shell
- `components/ada-audit/QueuePageTabs.tsx` — tab container, URL state
- `components/ada-audit/QueueActiveView.tsx` — Active tab content + 5s polling
- `components/ada-audit/QueueHistoryView.tsx` — History tab with paginated `PaginatedSection`
- `components/ada-audit/QueueBatchRow.tsx` — one collapsible batch row (used by History)
- `components/ada-audit/QueueMemberRow.tsx` — one site-audit member row (used by Active + expanded History)
- `components/ada-audit/BulkQueueModal.tsx` — confirmation + missing-domains error state
- `lib/ada-audit/audit-batch-helpers.ts` — `closeBatchIfDrained(batchId)`, `resolveBatchLabel(batch)`, query helpers
- `app/api/audit-batches/route.ts` — paginated GET
- `app/api/audit-batches/[id]/route.ts` — GET + PATCH
- `app/api/site-audit/bulk-queue/route.ts` — POST

### Modified
- `prisma/schema.prisma` — new `AuditBatch` model, `SiteAudit.batchId` column + index
- `lib/ada-audit/queue-manager.ts` — `enqueueAudit` attaches to open batch (creating one if needed); `runAudit` / error path calls `closeBatchIfDrained` after settling
- `lib/ada-audit/site-audit-finalizer.ts` — calls `closeBatchIfDrained` after the complete-flip
- `app/api/site-audit/queue/route.ts` — response gains `batch` field
- `components/ada-audit/ClientsAuditSummary.tsx` — per-row Queue button, header bulk + view-queue buttons, active-row chip
- `components/ada-audit/SiteAuditForm.tsx` — `selectClient` always updates domain; render no-domain hint
- `lib/ada-audit/types.ts` — `AuditBatchSummary`, `AuditBatchDetail`, `QueueStatusWithBatch` types

## Concurrency and edge cases

- **Two simultaneous enqueues both see "no open batch":** mitigated by wrapping `findFirst({ closedAt: null }) → create-if-missing → create SiteAudit` in a Prisma `$transaction`. The second transaction sees the row created by the first if Prisma's default isolation suffices (SQLite is serializable by default). v1 ships with the transaction; if surfacing a duplicate-empty-batch ever bites, harden later.
- **Batch closes while a new audit is being enqueued:** the close happens in `finalizeSiteAudit` after the SiteAudit row flips to complete. If `enqueueAudit` runs concurrently, one of:
  - Enqueue starts first: it attaches to the still-open batch. The close path then sees the new in-flight member and bails (count > 0). Correct.
  - Close starts first: batch is marked closed. Enqueue sees no open batch, creates a new one. Also correct.
- **`pdfs-running` is in-flight for batch-close purposes.** The query for in-flight siblings uses `status IN ['queued', 'running', 'pdfs-running']`. A batch does not close while any member is still scanning PDFs.
- **Stale recovery (`resetStaleAudits`).** When a stuck audit gets force-errored, the existing flow runs `closeBatchIfDrained` as part of the error path. No special-case needed.
- **Bulk-queue race:** if two operators hit "Queue all" within the same second, both pre-checks may pass. The server processes each request sequentially; in-flight dup guard rejects per-audit. End state: every client has at most one audit queued, surplus requests get 409 per row.

## Testing strategy

### Unit (vitest, `environment: 'node'`)

- `audit-batch-helpers.test.ts` — `closeBatchIfDrained` with various member-status mixes, label fallback (`resolveBatchLabel`).
- `queue-manager.test.ts` extensions — enqueue attaches to existing open batch, creates new when none open.

### Route tests (vitest)

- `app/api/audit-batches/route.test.ts` — pagination, ordering, count derivation.
- `app/api/audit-batches/[id]/route.test.ts` — GET shape, PATCH happy path, PATCH validation (length, type), 404.
- `app/api/site-audit/bulk-queue/route.test.ts` — fail-loud on missing domains, partial success with skipped, all-success.

### Integration (manual / Playwright stub)

- Click 'Queue audit' on a client → row chip transitions queued → running → complete → chip clears.
- 'Queue all' with one client missing a domain → modal shows the list, no audits queued, deep link to `/clients` works.
- Active tab polls and updates row status without page reload.
- History tab expand/collapse, inline label edit persists across refresh.

## Migration and rollout

Single Prisma migration: `add_audit_batches`. Adds `AuditBatch` table + `batchId` column on `SiteAudit` + indexes. Runs automatically via `prisma migrate deploy` on next prod deploy.

No backfill. Existing audits stay `batchId = null` and don't appear in the new Queue page. Operators can verify the feature works end-to-end by queuing one fresh audit and watching it appear on `/ada-audit/queue?tab=active`.

Feature is additive — no breaking API change, no UI removal. Safe to deploy without a flag.

## Open questions for the implementation plan

None. The design is fully resolved. Implementation can begin.
