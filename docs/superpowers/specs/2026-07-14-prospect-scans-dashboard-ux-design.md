# Prospect Scans Dashboard UX — Design

**Date:** 2026-07-14
**Status:** Approved by Kevin (chat), pending Codex review
**PR:** 3 of 3 (sales-audit overhaul series — independent of PRs 1–2, can land in any order)

## Problem

The `/sales` intake dashboard shows only a text status ("Scanning…") per prospect. Kevin wants: a real progress bar with an estimated time remaining, whole-card click-through to the public sales report in a new tab, and prospect scans jumping to the front of the site-audit queue.

## Decisions already made (Kevin, chat 2026-07-14)

- Card click opens the **public sales report** (`/sales/[token]`) in a new tab — the pending "being prepared" page is the correct target while a scan runs.
- Queue priority = **front of the queued line only**. A currently-running audit always finishes; no preemption.

## Non-goals

- No schema change. No new poll endpoints (the existing list poll + SSE invalidation carry the new fields).
- No change to the discover job's conditional claim, recovery, or the one-active-audit invariant — the promoter's *selection order* is the only queue change.
- No per-second polling; the existing health-gated 8 s / 60 s cadence stays.

## Design

### 1. Progress + ETA data (`lib/services/prospects.ts`)

`ProspectRow.latestAudit` gains: `pagesTotal`, `pagesComplete`, `pagesError`, `pdfsTotal`, `pdfsComplete`, `pdfsError`, `pdfsSkipped`, `lighthouseTotal`, `lighthouseComplete`, `lighthouseError`, `createdAt`, and `queuePosition: number | null` (for `queued` audits: position under the **priority ordering** of §3, so the displayed position matches what the promoter will actually do; null otherwise). One extra indexed count query for queued rows; the audit list query just selects more scalars.

### 2. Dashboard UI (`components/sales/intake/ProspectDashboard.tsx`)

- **Progress bar:** for transient audits, a phase-labeled bar. Fraction = weighted phases: pages 70%, PDFs 15% (skip weight redistributed when `pdfsTotal === 0`), Lighthouse 15% (same). Errors count as settled (denominator-complete), matching the finalizer's semantics. `complete && !reportable` renders a full bar with "Building report…" (the broken-link-verify window). Queued renders "Queued — next in line" / "position N".
- **ETA:** `remaining = elapsed × (1 − f) / f`, where `elapsed = now − createdAt` and `f` is the weighted fraction. Shown only when `f ≥ 0.05` **and** `elapsed ≥ 20 s` (before that: "estimating…"). Formatted "~N min remaining" (floor "~1 min"; > 30 min shows "> 30 min"). Recomputed on a 1 s local tick from last-fetched counters (bar/ETA feel live between 8 s polls without extra requests).
- **Clickable cards:** the whole row becomes a link-styled clickable region (`role="link"`, keyboard-activatable). Click → open `/sales/[token]` in a new tab. If `salesTokenActive`, the server-provided `salesUrl` (new `ProspectRow` field, built from `NEXT_PUBLIC_APP_URL`; this is a cookie-gated internal dashboard — exposing the token here is fine, it's the same token "Copy sales link" already hands out) opens directly. Otherwise: synchronously `window.open('about:blank')` (popup-blocker-safe), then `POST /api/sales/prospects/[id]/share` and set the new tab's `location` (failure → close the tab + notice). Existing buttons (`Copy sales link`, `Re-scan`, `Delete`) `stopPropagation`.
- Visual pass on the card layout to fit the bar (name/domain left, progress center, actions right; stacks on mobile).

### 3. Queue priority (`lib/ada-audit/queue-manager.ts`)

- **`processNext()`:** select the oldest queued audit with `prospectId != null` first; only when none exists, the oldest queued audit overall (two cheap `findFirst`s; no mutex change — the discover claim still enforces one-active).
- **`getQueueStatus()`:** the queued list is ordered the same way (prospect-owned by `createdAt` asc, then the rest by `createdAt` asc) so `SiteAuditForm`'s queue banner and displayed positions stay honest.
- Fairness note (accepted): multiple prospect scans are FIFO among themselves; client/scheduled audits wait behind all queued prospect scans. Scheduled scans already tolerate delay (duplicate in-flight slots are consumed without catch-up).

## Error handling

- Share-POST failure during card click: close the pre-opened tab, show the existing notice line.
- Counter fields missing/zero (`pagesTotal === 0` while running = discovery still in flight): indeterminate bar ("Discovering pages…"), no ETA.
- ETA is presentation-only — no persistence, no new server math.

## Testing

- Prospects service: new scalar fields present; `queuePosition` respects priority ordering; `salesUrl` only when token active.
- Queue manager: promoter picks a prospect-owned queued audit over an older non-prospect one; falls back correctly; `getQueueStatus` ordering matches (DB-backed tests beside the existing queue suites).
- Dashboard component: weighted fraction math (incl. zero-PDF/zero-LH redistribution), ETA gating + formatting, "Building report…" state, click opens tab / buttons don't bubble (stubbed `window.open`).
- Gates: `tsc --noEmit` + vitest.
