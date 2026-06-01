# ADA Audit Re-scan Feature — Design Spec

**Date:** 2026-04-10  
**Status:** Approved

## Overview

Add a "Re-scan" button to the ADA audit per-page results view so users can quickly re-run an audit after fixing an issue, without returning to the main form. Re-scanning creates a new audit record (preserving history) and navigates to the new audit page with a comparison banner showing before/after score.

## User Flow

1. User views a completed (or errored) audit at `/ada-audit/[id]`
2. Clicks **Re-scan** button
3. Button shows a loading spinner; POST is made to `/api/ada-audit`
4. On success, browser navigates to `/ada-audit/[newId]?from=[oldId]`
5. `AuditPoller` runs as normal, showing the live progress bar
6. When the scan completes, the results page renders with a **Re-scan complete** comparison banner at the top
7. User sees the score delta (or "unchanged") and can dismiss the banner

## Components

### `components/ada-audit/ReScanButton.tsx` (new)

- `'use client'` component
- Props: `url: string`, `wcagLevel: string`, `auditId: string`
- On click: disables button, shows inline spinner, POSTs `{ url, wcagLevel }` to `/api/ada-audit`
- On success: `router.push(/ada-audit/${newId}?from=${auditId})`
- On error: shows brief inline error message, re-enables button
- `captureScreenshots` is intentionally omitted (not stored on audit records; defaults to `false`, matching the form default)

### `components/ada-audit/RescanBanner.tsx` (new)

- `'use client'` component (needs dismiss state)
- Props: `previousScore: number | null`, `currentScore: number | null`, `completedAt: string`
- Renders a dismissable banner (✕ button) at the top of the results view
- Score line: **"Re-scan complete — Score: 72 → 85"** or **"Re-scan complete — Score unchanged at 72"** or no score line if either score is unavailable
- Includes the completed timestamp so it's unambiguous the scan just ran
- Styled consistently with existing banner components (orange accent, rounded card)

### `AuditResultsView.tsx` (modified)

- Accept two new optional props: `previousScore: number | null`, `fromAuditId: string | null`
- Render `RescanBanner` above the compliance banner when `fromAuditId` is present
- Add `ReScanButton` to the header row, to the right of `ShareAuditButton`

### `app/ada-audit/[id]/page.tsx` (modified)

**Completed state:**
- Read `searchParams.from` (the previous audit ID)
- If present, fetch `prisma.adaAudit.findUnique({ where: { id: from }, select: { score: true } })` to get the previous score
- Pass `previousScore` and `fromAuditId` to `AuditResultsView`
- Pass `url`, `wcagLevel`, `auditId` to `ReScanButton` (already available)

**Error state:**
- Replace the existing `<Link href="/ada-audit">Try again</Link>` with `ReScanButton`
- `ReScanButton` receives the same `url` and `wcagLevel` from the existing `audit` record

## Data Flow

```
ReScanButton
  → POST /api/ada-audit { url, wcagLevel }        (existing endpoint, no changes)
  ← { id: newId }
  → router.push(/ada-audit/${newId}?from=${oldId})

[id]/page.tsx (server)
  → reads searchParams.from = oldId
  → prisma.adaAudit.findUnique(oldId) → { score: previousScore }
  → renders AuditResultsView with previousScore + fromAuditId

AuditResultsView
  → renders RescanBanner (if fromAuditId present)
  → renders ReScanButton in header
```

## What Does Not Change

- `/api/ada-audit` POST endpoint — no modifications
- No schema migration — `captureScreenshots` is not stored and is omitted from re-scans
- `AuditPoller` — unchanged; handles the in-progress state as normal
- Share view (`/ada-audit/share/[token]`) — no re-scan button (read-only public view)
- Site audit pages — out of scope

## Out of Scope

- Linking old→new audit records in the DB (a `previousAuditId` FK) — not needed for this feature
- Carrying `captureScreenshots` through re-scans — requires schema change, low value
- Re-scan from the site audit per-page drilldown — separate feature
