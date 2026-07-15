# Prospect Scans Dashboard UX — Design

**Date:** 2026-07-14
**Status:** Approved by Kevin (chat); Codex-reviewed 2026-07-14 (accept with named fixes — applied)
**PR:** 3 of 3 (sales-audit overhaul series — independent of PRs 1–2, can land in any order)

## Problem

The `/sales` intake dashboard shows only a text status ("Scanning…") per prospect. Kevin wants: a real progress bar with an estimated time remaining, whole-card click-through to the public sales report in a new tab, and prospect scans jumping to the front of the site-audit queue.

## Decisions already made (Kevin, chat 2026-07-14)

- Card click opens the **public sales report** (`/sales/[token]`) in a new tab — the pending "being prepared" page is the correct target while a scan runs.
- Queue priority = **front of the queued line only**. A currently-running audit always finishes; no preemption.

## Non-goals

- No SiteAudit schema change. No new poll endpoints (the existing list poll + SSE invalidation carry the new fields).
- No change to the discover job's conditional claim, recovery, or the one-active-audit invariant — the promoter's *selection order* plus the discover job's `Job.priority` (Codex fix 2, §3) are the only queue changes.
- No per-second polling; the existing health-gated 8 s / 60 s cadence stays.

## Design

### 1. Progress + ETA data (`lib/services/prospects.ts`)

`ProspectRow.latestAudit` gains: `pagesTotal`, `pagesComplete`, `pagesError`, `pagesRedirected`, `pdfsTotal`, `pdfsComplete`, `pdfsError`, `pdfsSkipped`, `lighthouseTotal`, `lighthouseComplete`, `lighthouseError`, `startedAt` (Codex fix 4 — NOT `createdAt`, which includes queue wait and inflates the ETA), and `queuePosition: number | null` (for `queued` audits: position under the **shared priority ordering** of §3; null otherwise). One extra indexed count query for queued rows; the audit list query just selects more scalars. `ProspectRow` also gains `salesUrl: string | null` (active token only), built by a **shared sales-URL builder helper** extracted from the share route so the two can't drift (Codex fix 5).

### 2. Dashboard UI (`components/sales/intake/ProspectDashboard.tsx`)

- **Progress bar:** for transient audits, a phase-labeled bar. Fraction = weighted phases: pages 70%, PDFs 15%, Lighthouse 15%. **Settled pages = `pagesComplete + pagesError + pagesRedirected`** — the finalizer's exact semantics (Codex fix 3). **Phase-aware redistribution (Codex fix 3):** while pages are still settling, PDF/Lighthouse totals are still growing — zero-total phases keep their reserved weight (shown as pending) and only redistribute once the pages phase is done and the totals are final; progress must never move backward as denominators appear. `complete && !reportable` renders a full bar with "Building report…" (the broken-link-verify window). Queued renders "Queued — next in line" / "position N".
- **ETA (Codex fix 4):** `remaining = elapsed × (1 − f) / f`, where `elapsed = now − startedAt` (queue wait excluded) and `f` is the weighted fraction. No ETA while `startedAt` is null. Shown only when `f ≥ 0.05` **and** `elapsed ≥ 20 s` (before that: "estimating…"). Formatted "~N min remaining" (floor "~1 min"; > 30 min shows "> 30 min"). Recomputed on a 1 s local tick from last-fetched counters — the tick starts **after mount** so the server render and first client render agree (no hydration mismatch).
- **Clickable cards (Codex fix 5):** the whole row becomes a link-styled clickable region (`role="link"`, keyboard-activatable). The click handler ignores events originating inside nested interactive controls (`event.target.closest('button, a, input, [role="button"]')`) in addition to the buttons' own `stopPropagation`. Click → open `/sales/[token]` in a new tab with `opener = null`. If `salesTokenActive`, the server-provided `salesUrl` opens directly (cookie-gated internal dashboard — same token "Copy sales link" already hands out). Otherwise: synchronously `window.open('about:blank')` (popup-blocker-safe), null the opener, then `POST /api/sales/prospects/[id]/share` and set the new tab's `location`; a blocked popup (`window.open` returns null) falls back to a notice with the link; a failed share POST closes the pre-opened tab + notice.
- Visual pass on the card layout to fit the bar (name/domain left, progress center, actions right; stacks on mobile).

### 3. Queue priority (`lib/ada-audit/queue-manager.ts`)

- **One total ordering, one home (Codex fix 1):** define the queue ordering **once** — `(prospect-owned first, createdAt ASC, id ASC)` — as a shared helper in the queue manager, and reuse it in ALL FOUR readers: `processNext()` selection, `getQueueStatus()`'s queued list, `listProspects()`'s `queuePosition`, and `GET /api/site-audit/[id]`'s queue-position count (which today counts all older queued audits and would otherwise disagree with the new order).
- **`processNext()`:** select by the shared ordering (two cheap `findFirst`s; no mutex change — the discover claim still enforces one-active).
- **Already-enqueued discover-job gap (Codex fix 2):** selection order alone is insufficient when an older non-prospect discover job is already enqueued but unclaimed (both audits still `queued`, two discover jobs pending — the worker would claim the older one first). Prospect audits' `site-audit-discover` jobs are enqueued with a higher `Job.priority`; the worker already claims by priority then creation time. No-preemption is preserved — priority only affects which *unclaimed* job is picked.
- Fairness note (accepted): multiple prospect scans are FIFO among themselves; client/scheduled audits wait behind all queued prospect scans. Scheduled scans already tolerate delay (duplicate in-flight slots are consumed without catch-up).

## Error handling

- Share-POST failure during card click: close the pre-opened tab, show the existing notice line.
- Counter fields missing/zero (`pagesTotal === 0` while running = discovery still in flight): indeterminate bar ("Discovering pages…"), no ETA.
- ETA is presentation-only — no persistence, no new server math.

## Testing

- Prospects service: new scalar fields present; `queuePosition` respects the shared ordering; `salesUrl` only when token active and built by the shared builder.
- Queue manager: promoter picks a prospect-owned queued audit over an older non-prospect one; falls back correctly; `getQueueStatus` and `GET /api/site-audit/[id]` positions match the shared ordering; **the Codex race case: an already-enqueued non-prospect discover job followed by a prospect enqueue — the prospect's higher-priority job is claimed first** (DB-backed tests beside the existing queue suites).
- Dashboard component: weighted fraction math — fixtures cover `pagesRedirected`, growing PDF/LH totals mid-pages-phase (no backward movement), zero-phase audits, and long queue waits; ETA gating (null `startedAt` → none) + formatting; "Building report…" state; click opens tab with nulled opener / nested controls don't trigger it (stubbed `window.open`).
- Gates: `tsc --noEmit` + vitest.
