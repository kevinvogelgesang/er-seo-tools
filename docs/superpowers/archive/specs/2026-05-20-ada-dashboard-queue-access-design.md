# ADA Audit Dashboard — Queue Access Redesign (PR 4)

**Date:** 2026-05-20
**Status:** Approved for implementation planning

## 1. Goal

Add two persistent, always-visible status cards between the "New Audit" card and the "Clients" section on `/ada-audit` — one for the currently running scan, one for the queued count — so operators can navigate to either with one click rather than hunting for a small hyperlink. The dedicated queue page at `/ada-audit/queue` remains the destination; this PR improves the path to it.

## 2. Why now

Two low-discoverability access points currently exist for queue status:
- A conditional banner inside `SiteAuditForm` — only visible on the Full Site tab, only appears when the queue is non-empty.
- A "View queue →" text link at 12px inside the `ClientsAuditSummary` trailing toolbar.

Operators running multi-site batches check queue progress frequently. Prominent top-of-page cards fix this for all operators regardless of which tab is active.

## 3. Non-goals

- Redesigning queue page content — `QueueActiveView`, `QueueHistoryView`, and `QueuePageTabs` are unchanged.
- Changing queue mechanics (FIFO, `processNext`, batch grouping).
- Adding queue management actions from the dashboard (cancel, reorder, priority bump).
- Replacing the `SiteAuditForm` banner — it stays as a contextual reminder; the new cards are the primary navigation surface.

## 4. Dashboard card layout

### 4.1 Placement

`AuditIndexTabs.tsx` currently renders top to bottom: New Audit card → `<ClientsAuditSummary />` → `<AuditHistory />` → `<SiteAuditHistory />`. A new `<DashboardQueueStatus>` component is inserted between the New Audit card and `<ClientsAuditSummary />` in the `space-y-8` stack.

### 4.2 Visual treatment

Both status cards render as a `grid grid-cols-2 gap-4` pair. Each card uses the same chrome as the New Audit and Clients cards:

```
bg-white dark:bg-navy-card
border border-gray-200 dark:border-navy-border
rounded-2xl shadow-sm
```

Each card has a compact header bar (`px-5 py-3.5 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep`) with a small coloured icon and title. The card body (`px-5 py-4`) holds status content. The cards are intentionally lighter than the New Audit card — same chrome, no form inside, less vertical weight.

### 4.3 Idle state

**True idle** (`queueStatus` is non-null with `queueStatus.active === null` AND `queueStatus.queued.length === 0`):

- Both cards render at full opacity with stable structure. No layout shift when activity begins.
- Body text: `"No scans running or queued"` in `text-[13px] font-body text-navy/40 dark:text-white/40`.
- The card headers render as plain `<div>` elements (no `<Link>`), with `opacity-40`. Rendering as `<Link>` with `pointer-events-none` is wrong for a11y — pointer-events doesn't disable keyboard activation. A non-link element correctly conveys "nothing to click here." Implementation: branch on idle to pick `<div>` vs `<Link>`.
- Both cards carry the same idle message.

**Pre-first-poll** (`queueStatus === null`):

- Distinct from idle. Render the cards with a subtle skeleton: pulsing `bg-gray-100 dark:bg-navy-light` placeholder bars where the body text would be. No "No scans" copy yet — we don't know.
- Header stays as `<div>` (non-link) until the first poll resolves.
- Typically resolved within the initial render cycle: `AuditIndexTabs` mounts → fires fetch → 5s interval starts. So the skeleton is shown only briefly. Treating null as idle would falsely tell the operator there's no queue when there might be one — that's the bug codex flagged.

**Poll error / stale data:** if the poll fails, `queueStatus` keeps its last successful value. Cards continue showing that snapshot. No error UI — same swallow-silently pattern as the rest of the app.

### 4.4 Current Scan card — active state

When `queueStatus.active` is non-null, the card body shows:

```
Domain name (font-bold, 14px, links to /ada-audit/site/[active.id])
Phase label + counts  — e.g. "Scanning pages · 12 / 30 (40%)"
Progress bar (h-1.5 rounded-full orange fill, 500ms transition)
```

Phase logic mirrors the existing `SiteAuditForm` banner: `lighthouse-running` shows Lighthouse counts, `pdfs-running` shows PDF counts, anything else shows page counts. Extract this logic into `computeActivePhaseSummary(active)` in `lib/ada-audit/queue-ui-helpers.ts` (pure function, no imports) so both the card and the banner call it without duplication.

The card header title reads "Current Scan" and the whole header is a `<Link>` to `/ada-audit/site/[active.id]`.

No elapsed time, no ETA — that lives on the detail page (`SiteAuditPoller`). This card is a navigation surface.

### 4.5 Queue card — active state

When `queueStatus.queued.length > 0`:

- Header title: `"Queue (N)"` where N is the live count.
- Body: `"N audits waiting"` on the first line. Second line (muted, 12px): first three domains comma-separated; if more than three, append `"…and N more"`.
- The entire card header links to `/ada-audit/queue`.

When `active` is non-null but `queued` is empty: body reads `"No audits waiting"` in the muted style; header reads `"Queue"` with no count badge.

## 5. Polling

### 5.1 Single poll, lifted to `AuditIndexTabs`

`SiteAuditForm` currently owns a 5s `setInterval` polling `/api/site-audit/queue` (its own `useEffect` + `queueTimerRef`). Adding a second interval in `DashboardQueueStatus` would create redundant traffic for the same data.

Lift the poll into `AuditIndexTabs`. Pass `queueStatus` as a prop to:
- `SiteAuditForm` — receives it, removes its own fetch loop entirely
- `DashboardQueueStatus` — new component, prop-only, no internal fetch
- `SiteAuditHistory` — receives it, removes its own 5s `/api/site-audit/queue` polling loop. Today this component polls when active rows exist (`SiteAuditHistory.tsx` line ~103); replacing with the lifted prop eliminates the second 5s request on `/ada-audit`.

`SiteAuditForm`'s local `QueueStatus` interface is deleted; the prop type becomes `QueueStatusWithBatch | null` from `lib/ada-audit/types.ts` (structurally a superset, banner render logic unchanged).

`ClientsAuditSummary` retains its independent 30s poll — intentional; the client table fetch is heavier and tied to that component's refresh cycle.

`AuditIndexTabs` is already a `'use client'` component; adding a `useEffect` with `setInterval` is a one-to-one match of the existing pattern in `SiteAuditForm`.

### 5.2 Cadence

5 seconds, unchanged. `getQueueStatus()` is a fast SQLite read (two `findFirst` / `findMany` calls + one batch lookup).

## 6. `/ada-audit/queue` page — what changes vs. what stays

### Current content

`app/ada-audit/queue/page.tsx` renders a page header ("Audit Queue" + subtitle) and `<QueuePageTabs />`.

`QueuePageTabs` provides an **Active** / **History** tab toggle via `?tab=` search param.

**Active tab (`QueueActiveView`):** Polls `/api/site-audit/queue` at 5s to detect an open batch, then polls `/api/audit-batches/[batchId]` for member detail. Renders the open batch label, per-status counts (queued · running · complete · errored), and a full table of `QueueMemberRow` entries. When no batch is open: "No audits in flight. Queue some from [/ada-audit link]."

**History tab (`QueueHistoryView`):** Paginated list of closed batches via `/api/audit-batches`, 25 per page. Each `QueueBatchRow` is expandable to show member detail inline.

### What changes in this PR

Nothing structural. The page already delivers exactly what the user described as "dedicated to the entire queue" — active run + queued members in one view, closed batches in the History tab.

One copy tweak: the empty-state anchor in `QueueActiveView` uses `<a href="/ada-audit">` — change to `<Link href="/ada-audit">` for consistency with the rest of the codebase. No functional change.

The dashboard Queue button deep-links to `/ada-audit/queue` with no `?tab=` param (lands on the Active tab by default).

## 7. File structure

| File | Status | Role |
|---|---|---|
| `components/ada-audit/DashboardQueueStatus.tsx` | New | Two-card grid. Accepts `queueStatus: QueueStatusWithBatch \| null` prop. Pure render — no fetch, no internal state beyond what the prop provides. |
| `lib/ada-audit/queue-ui-helpers.ts` | New | `computeActivePhaseSummary(active)` — pure function returning `{ label, complete, total, pct, unit }`. No imports except the `active` field type from `types.ts`. |
| `components/ada-audit/AuditIndexTabs.tsx` | Modify | Add 5s poll for `queueStatus`. Insert `<DashboardQueueStatus queueStatus={queueStatus} />` between New Audit card and `<ClientsAuditSummary>`. Pass `queueStatus` to `<SiteAuditForm>` and `<SiteAuditHistory>`. |
| `components/ada-audit/SiteAuditForm.tsx` | Modify | Add `queueStatus: QueueStatusWithBatch \| null` prop. Remove internal `useEffect` poll + `queueTimerRef`. Delete local `QueueStatus` interface. Call `computeActivePhaseSummary` from shared helper. |
| `components/ada-audit/SiteAuditHistory.tsx` | Modify | Add `queueStatus: QueueStatusWithBatch \| null` prop. Remove internal `/api/site-audit/queue` polling loop. Use lifted `queueStatus` to decide whether to refresh the audit list. |
| `components/ada-audit/QueueActiveView.tsx` | Minor | Change `<a href>` on empty-state line to `<Link>`. |
| `lib/ada-audit/types.ts` | No change | `QueueStatusWithBatch` already has all needed fields. |
| `app/ada-audit/queue/page.tsx` | No change | Page is already complete. |
| `components/ada-audit/QueuePageTabs.tsx` | No change | |
| `components/ada-audit/QueueHistoryView.tsx` | No change | |

## 8. Data flow

```
AuditIndexTabs
  └── 5s poll → GET /api/site-audit/queue → queueStatus state
        ├── <DashboardQueueStatus queueStatus={queueStatus}>
        │     ├── Current Scan card  → <Link href="/ada-audit/site/[active.id]">
        │     └── Queue card         → <Link href="/ada-audit/queue">
        │
        └── <SiteAuditForm queueStatus={queueStatus}>
              └── queue banner (existing render logic, now prop-fed)

ClientsAuditSummary  ← independent 30s poll (unchanged)
```

`computeActivePhaseSummary(active)` is called in `DashboardQueueStatus` (progress bar) and `SiteAuditForm` (banner text). One implementation, two consumers.

## 9. Edge cases

**Audit transitions queued → running while user is on dashboard.** The 5s poll picks up `active` becoming non-null within one tick. Current Scan card transitions from idle to domain + progress bar; queue count drops by 1 in the same render. No special handling needed.

**Click Current Scan during queued→running transition.** The link always targets `/ada-audit/site/[active.id]`. That page handles all live statuses (`running`, `pdfs-running`, `lighthouse-running`, `queued`). No broken state.

**Many queued audits (10+).** Header badge shows the count as a number — no truncation needed. Body shows the first 3 domains + "…and N more". The queue page is the full list.

**First-time user, no audits ever.** Both cards render idle on mount. The poll confirms idle state within 5s. No flash or skeleton.

**Poll network error.** Errors swallowed silently (same pattern as existing callers in `SiteAuditForm` and `ClientsAuditSummary`). Cards hold their last-known state. Polling self-heals.

**`SiteAuditForm` mounted before `AuditIndexTabs` delivers first poll.** Prop arrives as `null`; banner is not shown (`queueStatus && (queueStatus.active || ...)` guard already handles null). No change in banner behaviour.

**Active audit in `pending` status.** `QueueStatusActiveAudit.status` can be `'pending'` per the queue manager (briefly, between enqueue and runner pickup). `computeActivePhaseSummary` should fall through to the page-phase branch for `pending` — same as it would for `running`. The label reads "Scanning pages…" with `complete: 0, total: 0`. This matches the existing `SiteAuditForm` banner behavior.

## 10. Tests

| Test | File |
|---|---|
| `computeActivePhaseSummary` returns pages phase for `running` status | `lib/ada-audit/queue-ui-helpers.test.ts` |
| `computeActivePhaseSummary` returns pdfs phase for `pdfs-running` status | same |
| `computeActivePhaseSummary` returns lighthouse phase for `lighthouse-running` status | same |
| `computeActivePhaseSummary` returns `pct: 0` when `total === 0` (discovery in progress) | same |
| `computeActivePhaseSummary` correctly computes pct from complete + error counts | same |
| `computeActivePhaseSummary` returns pages-phase fallback for `pending` status | same |
| `DashboardQueueStatus` idle / active / queue states | manual verification in dev |

No React testing stack. Unit tests cover the pure helper only. UI states verified manually against the running dev server.
