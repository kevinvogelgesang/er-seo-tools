# C12 Tier-0 content auditing — GSC cannibalization report + content signals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two zero-AI, zero-new-fetch content-auditing increments — a full GSC query×page cannibalization report card on the client dashboard, and per-page stale-date + readability signals stored as live-scan run metadata.

**Architecture:** Increment A re-derives the cannibalization list at read time from KS-1's already-stored `GscSnapshot` raw rows (the pure `deriveKeywordSignals` already returns the full uncapped list — only `buildSummary` caps it), exposed via a new cookie-gated GET route and a new dashboard card. Increment B computes stale-date + readability signals in the live-scan builder (`broken-link-verify.ts`) from transient `HarvestedPageSeo.contentText` before deletion, stored on a new nullable `CrawlRun.contentSignalsJson`, surfaced read-time on the results-page SEO tab. Measurement-first: NOT Findings, NO score change.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, Vitest, Tailwind (class-based dark mode).

**Spec:** `docs/superpowers/specs/2026-07-11-c12-tier0-content-signals-design.md` (Codex accept-with-fixes ×6).

## Global Constraints

- **Array-form `$transaction([...])` only** — never interactive. This plan adds NO new transactions (the writer's existing `crawlRun.create` spread persists the new field).
- **Measurement-first** — content signals land as run-metadata JSON, never a `Finding` or score input. Promotion is a separate gated step.
- **`contentText` stays transient** — computed in the builder before `harvestedPageSeo.deleteMany`, never durable, never logged.
- **KS-1 honesty phrasing** — absence = "not observed in this GSC window", never "not ranking"; `queryAtLimit || queryPageAtLimit`/`capped` = "possibly truncated", never definite.
- **Cookie-gated client routes need NO middleware change** — the new GET route is under `/api/clients/[id]/...`, default-gated; no `middleware.ts`/`middleware.test.ts` edit.
- **Migrations hand-authored, additive** — `migrate dev` is interactive-only here; author SQL by hand and apply with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … generate`. SQLite: no `ALTER COLUMN`.
- **Never `git add -A`/`-u` at repo root** — `pentest-results/` etc. untracked; add explicit paths only.
- **Test conventions** — vitest `globals:false` (component tests `afterEach(cleanup)`, `getAllBy*` for repeated copy); route files export only handlers + config; the pure `content-signals` module takes `currentYear` as input (Date-free, deterministic).
- **Injected-code contract does NOT apply here** — `content-signals.ts` is an ordinary Node module run in the builder over already-harvested text, NOT `.toString()`-injected into the page. No `typeof`/SWC-helper concerns.
- **Gates before merge:** `npx tsc --noEmit` + `DATABASE_URL="file:./local-dev.db" npm test` + `npm run build`, all green.

---

## File Structure

**Increment A (cannibalization report):**
- Modify `lib/keywords/types.ts` — add `CANNIBALIZATION_REPORT_CAP`, `CannibalizationReport` type.
- Modify `lib/keywords/gsc-snapshot.ts` — extract private `loadLatestValidSnapshot`, add `getCannibalizationReport`, keep `getLatestGscSnapshot` behavior-preserving.
- Create `app/api/clients/[id]/gsc-cannibalization/route.ts` — GET, cookie-gated.
- Create `components/clients/GscCannibalizationCard.tsx` — dashboard card.
- Modify `app/(app)/clients/[id]/page.tsx` — load the report + render the card.

**Increment B (content signals):**
- Create `lib/ada-audit/seo/content-signals.ts` — pure `computeContentSignals`.
- Modify `prisma/schema.prisma` + new migration — nullable `CrawlRun.contentSignalsJson`.
- Modify `lib/findings/types.ts` — `CrawlRunInput.contentSignalsJson`.
- Modify `lib/jobs/handlers/broken-link-verify.ts` — compute block + budget guard + bundle field.
- Create `components/site-audit/ContentSignalsSection.tsx` — results-page section.
- Modify `app/(app)/ada-audit/site/[id]/page.tsx` — select the column + render the section.

---

## Task 1: Cannibalization report types + cap

**Files:**
- Modify: `lib/keywords/types.ts`
- Test: `lib/keywords/types.test.ts` (create if absent — a compile-only export presence check)

**Interfaces:**
- Consumes: existing `CannibalizationEntry`, `KeywordSignalThresholds` from this file.
- Produces: `CANNIBALIZATION_REPORT_CAP: number` (200); `type CannibalizationReport`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/keywords/types.test.ts
import { describe, it, expect } from 'vitest'
import { CANNIBALIZATION_REPORT_CAP } from './types'

describe('cannibalization report constants', () => {
  it('caps the report payload at 200 entries', () => {
    expect(CANNIBALIZATION_REPORT_CAP).toBe(200)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/keywords/types.test.ts`
Expected: FAIL — `CANNIBALIZATION_REPORT_CAP` is not exported.

- [ ] **Step 3: Add the constant + type**

Append to `lib/keywords/types.ts`:

```ts
/** Payload bound for the full cannibalization report (Increment A). Applied at the
 *  service boundary only — never in derive.ts. Full count is still reported via
 *  totalCannibalizedQueries. */
export const CANNIBALIZATION_REPORT_CAP = 200

/** The read-time cannibalization report (Increment A). `report: null` = no usable
 *  snapshot yet; `clientExists:false` is the ONLY thing the route 404s on. */
export type CannibalizationReport = {
  clientExists: boolean
  gscMapped: boolean
  report: {
    fetchedAt: string
    windowStart: string
    windowEnd: string
    queryAtLimit: boolean
    queryPageAtLimit: boolean
    thresholds: KeywordSignalThresholds
    totalCannibalizedQueries: number
    capped: boolean
    entries: CannibalizationEntry[]
  } | null
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/keywords/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/keywords/types.ts lib/keywords/types.test.ts && git commit -m "feat(c12): cannibalization report cap + type"
```

---

## Task 2: `loadLatestValidSnapshot` refactor + `getCannibalizationReport`

**Files:**
- Modify: `lib/keywords/gsc-snapshot.ts`
- Test: `lib/keywords/gsc-snapshot.test.ts` (existing — add cases; existing cases MUST still pass)

**Interfaces:**
- Consumes: `deriveKeywordSignals`, `CANNIBALIZATION_REPORT_CAP`, `CannibalizationReport`, existing `prisma.client`/`prisma.gscSnapshot`.
- Produces: `getCannibalizationReport(clientId: number): Promise<CannibalizationReport>`. Private `loadLatestValidSnapshot(clientId): Promise<{ clientExists: boolean; gscMapped: boolean; row: GscSnapshot | null; payload: { queryRows: GscQueryRow[]; queryPageRows: GscQueryPageRow[] } | null }>`.

**Context:** the current `getLatestGscSnapshot` (read it — `lib/keywords/gsc-snapshot.ts:193`) does: `findUnique` client → null/`gscSiteUrl===null` → `{gscMapped:false, summary:null}`; else `findMany` newest 3 on the verbatim `gscSiteUrl`, `orderBy [{fetchedAt:'desc'},{id:'desc'}]`, loop parsing `queryRowsJson`/`queryPageRowsJson`, `isValidPayload` guard, log+continue past corrupt, derive on the first valid, return `buildSummary`. Extract the client-resolve + row-loop into `loadLatestValidSnapshot`; `getLatestGscSnapshot` calls it and keeps its exact return shape.

- [ ] **Step 1: Write the failing tests**

Add to `lib/keywords/gsc-snapshot.test.ts` (follow the file's existing prisma-mock setup — read it first for the mock helpers):

```ts
describe('getCannibalizationReport', () => {
  it('returns clientExists:false for an unknown client', async () => {
    // arrange: client.findUnique -> null
    const r = await getCannibalizationReport(999999)
    expect(r).toEqual({ clientExists: false, gscMapped: false, report: null })
  })

  it('returns gscMapped:false for a client with no mapped property', async () => {
    // arrange: client.findUnique -> { id, gscSiteUrl: null }
    const r = await getCannibalizationReport(clientId)
    expect(r).toEqual({ clientExists: true, gscMapped: false, report: null })
  })

  it('returns report:null when mapped but no usable snapshot exists', async () => {
    // arrange: client mapped, gscSnapshot.findMany -> []
    const r = await getCannibalizationReport(clientId)
    expect(r).toEqual({ clientExists: true, gscMapped: true, report: null })
  })

  it('reports the FULL cannibalized count and caps entries at the report cap', async () => {
    // arrange: a stored snapshot whose derived cannibalization list exceeds the cap.
    // Build queryPageRows for N>200 distinct queries, each with 2 pages splitting
    // impressions >= threshold; queryRows carrying matching query impressions.
    const r = await getCannibalizationReport(clientId)
    expect(r.report!.totalCannibalizedQueries).toBeGreaterThan(CANNIBALIZATION_REPORT_CAP)
    expect(r.report!.entries.length).toBe(CANNIBALIZATION_REPORT_CAP)
    expect(r.report!.capped).toBe(true)
    expect(r.report!.queryAtLimit).toBe(false)
    expect(r.report!.queryPageAtLimit).toBe(false)
  })

  it('falls back past a corrupt newest snapshot to the next valid one', async () => {
    // arrange: findMany -> [ {..queryRowsJson:'{bad'}, {..valid..} ]
    const r = await getCannibalizationReport(clientId)
    expect(r.report).not.toBeNull()
  })
})

// existing getLatestGscSnapshot describe block stays UNCHANGED and must pass.
```

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/keywords/gsc-snapshot.test.ts`
Expected: new cases FAIL (`getCannibalizationReport` undefined); existing cases still PASS.

- [ ] **Step 3: Refactor + implement**

In `lib/keywords/gsc-snapshot.ts`, add (importing `CANNIBALIZATION_REPORT_CAP`, `type CannibalizationReport` from `./types`, and `type { GscSnapshot } from '@prisma/client'`):

```ts
type LoadedSnapshot = {
  clientExists: boolean
  gscMapped: boolean
  row: GscSnapshot | null
  payload: { queryRows: GscQueryRow[]; queryPageRows: GscQueryPageRow[] } | null
}

/** Shared newest-valid-snapshot resolver. Distinguishes unknown client
 *  (clientExists:false) from unmapped (gscMapped:false) from no-usable-snapshot
 *  (both true, row/payload null). Corrupt-newest falls through to the next valid. */
async function loadLatestValidSnapshot(clientId: number): Promise<LoadedSnapshot> {
  const client = await prisma.client.findUnique({ where: { id: clientId } })
  if (!client) return { clientExists: false, gscMapped: false, row: null, payload: null }
  if (client.gscSiteUrl === null) return { clientExists: true, gscMapped: false, row: null, payload: null }

  const rows = await prisma.gscSnapshot.findMany({
    where: { clientId, gscSiteUrl: client.gscSiteUrl },
    orderBy: [{ fetchedAt: 'desc' }, { id: 'desc' }],
    take: 3,
  })

  for (const row of rows) {
    let queryRows: unknown
    let queryPageRows: unknown
    try {
      queryRows = JSON.parse(row.queryRowsJson)
      queryPageRows = JSON.parse(row.queryPageRowsJson)
    } catch (err) {
      logError({ clientId, gscSnapshotId: row.id }, err)
      continue
    }
    const payload = { queryRows, queryPageRows }
    if (!isValidPayload(payload)) {
      logError({ clientId, gscSnapshotId: row.id }, new Error('gsc_snapshot_invalid_stored_payload'))
      continue
    }
    return { clientExists: true, gscMapped: true, row, payload }
  }
  return { clientExists: true, gscMapped: true, row: null, payload: null }
}
```

Rewrite `getLatestGscSnapshot` to delegate (behavior-preserving — unknown client still returns `gscMapped:false`):

```ts
export async function getLatestGscSnapshot(
  clientId: number,
): Promise<{ gscMapped: boolean; summary: GscSnapshotSummary | null }> {
  const loaded = await loadLatestValidSnapshot(clientId)
  if (!loaded.gscMapped || !loaded.row || !loaded.payload) return { gscMapped: loaded.gscMapped, summary: null }
  const signals = deriveKeywordSignals(loaded.payload.queryRows, loaded.payload.queryPageRows, {
    minImpressions: loaded.row.minImpressions,
  })
  return { gscMapped: true, summary: buildSummary(loaded.row, signals) }
}

export async function getCannibalizationReport(clientId: number): Promise<CannibalizationReport> {
  const loaded = await loadLatestValidSnapshot(clientId)
  if (!loaded.clientExists) return { clientExists: false, gscMapped: false, report: null }
  if (!loaded.gscMapped || !loaded.row || !loaded.payload) {
    return { clientExists: true, gscMapped: loaded.gscMapped, report: null }
  }
  const signals = deriveKeywordSignals(loaded.payload.queryRows, loaded.payload.queryPageRows, {
    minImpressions: loaded.row.minImpressions,
  })
  const all = signals.cannibalization
  return {
    clientExists: true,
    gscMapped: true,
    report: {
      fetchedAt: loaded.row.fetchedAt.toISOString(),
      windowStart: loaded.row.windowStart.toISOString(),
      windowEnd: loaded.row.windowEnd.toISOString(),
      queryAtLimit: loaded.row.queryAtLimit,
      queryPageAtLimit: loaded.row.queryPageAtLimit,
      thresholds: signals.thresholds,
      totalCannibalizedQueries: all.length,
      capped: all.length > CANNIBALIZATION_REPORT_CAP,
      entries: all.slice(0, CANNIBALIZATION_REPORT_CAP),
    },
  }
}
```

Note: `isValidPayload` currently narrows to `{queryRows, queryPageRows}`; keep using it so the `payload` fields are typed. If its return type doesn't already flow the element types, cast at the two `deriveKeywordSignals` call sites exactly as the original `getLatestGscSnapshot` did.

- [ ] **Step 4: Run the full file, verify all pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/keywords/gsc-snapshot.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add lib/keywords/gsc-snapshot.ts lib/keywords/gsc-snapshot.test.ts && git commit -m "feat(c12): getCannibalizationReport + shared loadLatestValidSnapshot"
```

---

## Task 3: GET `/api/clients/[id]/gsc-cannibalization` route

**Files:**
- Create: `app/api/clients/[id]/gsc-cannibalization/route.ts`
- Test: `app/api/clients/[id]/gsc-cannibalization/route.test.ts`

**Interfaces:**
- Consumes: `getCannibalizationReport` from `@/lib/keywords/gsc-snapshot`, `withRoute` from `@/lib/api/with-route`.
- Produces: `GET` handler. Response `{ gscMapped, report }`; 400 on non-numeric id; 404 when `clientExists:false`.

- [ ] **Step 1: Write the failing test**

```ts
// app/api/clients/[id]/gsc-cannibalization/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/keywords/gsc-snapshot', () => ({
  getCannibalizationReport: vi.fn(),
}))
import { getCannibalizationReport } from '@/lib/keywords/gsc-snapshot'
import { GET } from './route'

const makeCtx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/clients/[id]/gsc-cannibalization', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400s on a non-numeric id', async () => {
    const res = await GET({} as any, makeCtx('abc'))
    expect(res.status).toBe(400)
  })

  it('404s when the client does not exist', async () => {
    ;(getCannibalizationReport as any).mockResolvedValue({ clientExists: false, gscMapped: false, report: null })
    const res = await GET({} as any, makeCtx('5'))
    expect(res.status).toBe(404)
  })

  it('200s with { gscMapped, report } for a mapped client', async () => {
    ;(getCannibalizationReport as any).mockResolvedValue({
      clientExists: true, gscMapped: true,
      report: { fetchedAt: 'x', windowStart: 'a', windowEnd: 'b', queryAtLimit: false, queryPageAtLimit: false, thresholds: {}, totalCannibalizedQueries: 0, capped: false, entries: [] },
    })
    const res = await GET({} as any, makeCtx('5'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.gscMapped).toBe(true)
    expect(body.report.entries).toEqual([])
  })

  it('200s with gscMapped:false, report:null for an unmapped client', async () => {
    ;(getCannibalizationReport as any).mockResolvedValue({ clientExists: true, gscMapped: false, report: null })
    const res = await GET({} as any, makeCtx('5'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ gscMapped: false, report: null })
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/clients/[id]/gsc-cannibalization/route.test.ts"`
Expected: FAIL — `./route` has no `GET`.

- [ ] **Step 3: Implement the route**

```ts
// app/api/clients/[id]/gsc-cannibalization/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { getCannibalizationReport } from '@/lib/keywords/gsc-snapshot'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * GET /api/clients/:id/gsc-cannibalization
 * Full query×page cannibalization report re-derived from the latest stored
 * GSC snapshot (Increment A). 404 ONLY when the client does not exist;
 * unmapped/no-snapshot return 200 with gscMapped/report reflecting state.
 * Cookie-gated by global middleware.
 */
export const GET = withRoute(async (_request: NextRequest, { params }: RouteParams) => {
  const { id } = await params
  const clientId = parseInt(id, 10)
  if (isNaN(clientId)) {
    return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 })
  }
  const { clientExists, gscMapped, report } = await getCannibalizationReport(clientId)
  if (!clientExists) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }
  return NextResponse.json({ gscMapped, report })
})
```

- [ ] **Step 4: Run test, verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/clients/[id]/gsc-cannibalization/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/clients/[id]/gsc-cannibalization/route.ts" "app/api/clients/[id]/gsc-cannibalization/route.test.ts" && git commit -m "feat(c12): gsc-cannibalization GET route"
```

---

## Task 4: `GscCannibalizationCard` component

**Files:**
- Create: `components/clients/GscCannibalizationCard.tsx`
- Test: `components/clients/GscCannibalizationCard.test.tsx`

**Interfaces:**
- Consumes: `type CannibalizationReport` from `@/lib/keywords/types` (client-safe — no server imports in its chain), fetches `POST /api/clients/${clientId}/gsc-snapshot` then re-GETs `/api/clients/${clientId}/gsc-cannibalization`.
- Produces: `export function GscCannibalizationCard({ clientId, initial }: { clientId: number; initial: { gscMapped: boolean; report: CannibalizationReport['report'] } })`.

**Copy rules (Global Constraints):** clean = "No cannibalized queries observed in this GSC window."; unmapped = "No GSC property is mapped for this client."; truncation line when `report.queryAtLimit || report.queryPageAtLimit || report.capped` = "Results may be truncated — GSC returned the maximum rows for this window." Refresh copy must NOT claim the other GSC card updates in lockstep (independent controls, spec §4.1 Codex #6). Follow `GscKeywordCard.tsx` for structure, dark-mode classes, and ephemeral-error handling (a failed refresh never clears the prior report).

- [ ] **Step 1: Write the failing test**

```tsx
// components/clients/GscCannibalizationCard.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { GscCannibalizationCard } from './GscCannibalizationCard'

afterEach(cleanup)

const entry = {
  query: 'nursing program', queryImpressions: 500, observedPageImpressions: 480, observedPageCoverage: 0.96,
  pages: [
    { page: 'https://x.edu/a', impressions: 260, clicks: 12, share: 0.54 },
    { page: 'https://x.edu/b', impressions: 220, clicks: 9, share: 0.46 },
  ],
}

describe('GscCannibalizationCard', () => {
  it('shows the not-mapped state', () => {
    render(<GscCannibalizationCard clientId={1} initial={{ gscMapped: false, report: null }} />)
    expect(screen.getByText(/No GSC property is mapped/i)).toBeInTheDocument()
  })

  it('shows the clean state when the report has zero entries', () => {
    render(<GscCannibalizationCard clientId={1} initial={{ gscMapped: true, report: {
      fetchedAt: '2026-07-01T00:00:00Z', windowStart: '2026-04-01T00:00:00Z', windowEnd: '2026-06-28T00:00:00Z',
      queryAtLimit: false, queryPageAtLimit: false, thresholds: { minImpressions: 10, cannibalizationMinShare: 0.2, cannibalizationMinPageImpressions: 10 },
      totalCannibalizedQueries: 0, capped: false, entries: [],
    } }} />)
    expect(screen.getByText(/No cannibalized queries observed/i)).toBeInTheDocument()
  })

  it('renders a cannibalized query and its competing pages', () => {
    render(<GscCannibalizationCard clientId={1} initial={{ gscMapped: true, report: {
      fetchedAt: '2026-07-01T00:00:00Z', windowStart: '2026-04-01T00:00:00Z', windowEnd: '2026-06-28T00:00:00Z',
      queryAtLimit: false, queryPageAtLimit: false, thresholds: { minImpressions: 10, cannibalizationMinShare: 0.2, cannibalizationMinPageImpressions: 10 },
      totalCannibalizedQueries: 1, capped: false, entries: [entry],
    } }} />)
    expect(screen.getByText('nursing program')).toBeInTheDocument()
    expect(screen.getByText(/x\.edu\/a/)).toBeInTheDocument()
  })

  it('shows a truncation notice when capped', () => {
    render(<GscCannibalizationCard clientId={1} initial={{ gscMapped: true, report: {
      fetchedAt: '2026-07-01T00:00:00Z', windowStart: '2026-04-01T00:00:00Z', windowEnd: '2026-06-28T00:00:00Z',
      queryAtLimit: false, queryPageAtLimit: false, thresholds: { minImpressions: 10, cannibalizationMinShare: 0.2, cannibalizationMinPageImpressions: 10 },
      totalCannibalizedQueries: 250, capped: true, entries: [entry],
    } }} />)
    expect(screen.getByText(/may be truncated/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/GscCannibalizationCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the card**

Build a `'use client'` component mirroring `GscKeywordCard`'s state model: `const [report, setReport] = useState(initial.report)`, `gscMapped` from `initial`, `refreshing`/`error` state. `refresh()` POSTs `/api/clients/${clientId}/gsc-snapshot`; on non-ok set an ephemeral error (do NOT clear `report`); on ok, GET `/api/clients/${clientId}/gsc-cannibalization` and `setReport(body.report)`. Render states in order: not-mapped (`!gscMapped`) → no-report (`gscMapped && report===null`, offer Refresh) → clean (`report.entries.length===0`) → list. Each entry: query text, observed impressions, expandable competing-pages list (`<details>`), each page a row with URL + a share proportion bar (`style={{width: `${Math.round(share*100)}%`}}`) + impressions + clicks. Header shows the window + fetchedAt (reuse a `formatDate` like `GscKeywordCard`'s). Truncation line rendered when `report.queryAtLimit || report.queryPageAtLimit || report.capped`. All colors via `dark:` variants (map `bg-white`→`dark:bg-navy-card`, `text-gray-*`→`dark:text-white/*`, `border-gray-*`→`dark:border-navy-border`).

- [ ] **Step 4: Run test, verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/GscCannibalizationCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/clients/GscCannibalizationCard.tsx components/clients/GscCannibalizationCard.test.tsx && git commit -m "feat(c12): GscCannibalizationCard"
```

---

## Task 5: Wire the card onto the client dashboard

**Files:**
- Modify: `app/(app)/clients/[id]/page.tsx`

**Interfaces:**
- Consumes: `getCannibalizationReport` from `@/lib/keywords/gsc-snapshot`, `GscCannibalizationCard`.

**Context:** the page already calls `getLatestGscSnapshot(clientId)` inside a parallel load (`app/(app)/clients/[id]/page.tsx:46`) and renders `<GscKeywordCard clientId={clientId} initial={gscSnapshot} />` (line 127). Add the report load to the same parallel batch and render the new card immediately after `GscKeywordCard`.

- [ ] **Step 1: Add the load + render (no separate test — server component; covered by build + manual verify)**

Add `getCannibalizationReport` to the import from `@/lib/keywords/gsc-snapshot`; import `GscCannibalizationCard`. In the parallel load (the `Promise.all` around line 46), add `getCannibalizationReport(clientId)` and destructure it as `cannibalization`. After the `<GscKeywordCard .../>` line, add:

```tsx
<GscCannibalizationCard clientId={clientId} initial={{ gscMapped: cannibalization.gscMapped, report: cannibalization.report }} />
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/clients/[id]/page.tsx" && git commit -m "feat(c12): render GscCannibalizationCard on the client dashboard"
```

---

## Task 6: `content-signals.ts` pure module

**Files:**
- Create: `lib/ada-audit/seo/content-signals.ts`
- Test: `lib/ada-audit/seo/content-signals.test.ts`

**Interfaces:**
- Produces: `computeContentSignals(pages: ContentSignalsInput[], opts: { currentYear: number }): ContentSignalsResult | null` and the exported types `ContentSignalsInput`, `StaleDateHit`, `ContentSignalsResult` (shapes verbatim from spec §4.2). Constants `READABILITY_MIN_WORDS = 100`, per-page hit cap 5, per-list page cap 50.

**Algorithm contract (spec §4.2, Codex #3/#4 — implement EXACTLY):**
- Words = maximal `[A-Za-z]` runs (intra-word `'` kept); number/URL tokens are not words, not syllable-counted.
- Sentences = split on `[.!?]+`; zero terminators → 1 sentence.
- Syllables = `[aeiouy]+` group count per lowercased word, min 1; subtract 1 for a trailing silent `e` (not preceded by another vowel forming `le`... use: if word ends in `e`, not `le`, and syllable count > 1, subtract 1).
- FRE = `206.835 - 1.015*(W/S) - 84.6*(Syl/W)`; FK = `0.39*(W/S) + 11.8*(Syl/W) - 15.59`; both rounded to 1 decimal. Even-count median = average of the two middle values, rounded to 1 decimal.
- Stale-date `copyright`: `©`/`(c)`/`Copyright` token then a year or year-RANGE; evaluate the LATEST year of a range; flag when that year ≤ `currentYear - 2`.
- `term`: season word + year `< currentYear` in the same match window.
- `deadline`: an enrollment keyword (`apply|enroll|enrollment|deadline|registration|starts?|start date|class of`) + year `< currentYear` in the same sentence.
- Bare years never flag. Excerpt ≤ ~120 chars around the match. Regexes: no nested quantifiers; scan per-line/per-sentence, not whole-document multiline backtracking.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/ada-audit/seo/content-signals.test.ts
import { describe, it, expect } from 'vitest'
import { computeContentSignals } from './content-signals'

const YEAR = 2026
const page = (url: string, text: string) => ({ url, contentText: text, contentTruncated: false })

describe('computeContentSignals — stale dates', () => {
  it('flags an old copyright year', () => {
    const r = computeContentSignals([page('/a', '© 2021 Example College. All rights reserved.')], { currentYear: YEAR })
    expect(r!.staleDates.pagesWithHits).toBe(1)
    expect(r!.staleDates.pages[0].hits[0].kind).toBe('copyright')
    expect(r!.staleDates.pages[0].hits[0].year).toBe(2021)
  })
  it('does NOT flag a current copyright RANGE (uses the latest year)', () => {
    const r = computeContentSignals([page('/a', '© 2018–2026 Example College.')], { currentYear: YEAR })
    expect(r!.staleDates.pagesWithHits).toBe(0)
  })
  it('flags a stale term reference', () => {
    const r = computeContentSignals([page('/a', 'Fall 2023 enrollment is now open.')], { currentYear: YEAR })
    expect(r!.staleDates.pages[0].hits.some(h => h.kind === 'term' && h.year === 2023)).toBe(true)
  })
  it('flags a stale application deadline', () => {
    const r = computeContentSignals([page('/a', 'Apply by the March 2024 deadline.')], { currentYear: YEAR })
    expect(r!.staleDates.pages[0].hits.some(h => h.kind === 'deadline' && h.year === 2024)).toBe(true)
  })
  it('does NOT flag a bare historical year ("founded in 1998")', () => {
    const r = computeContentSignals([page('/a', 'The college was founded in 1998 and since 1998 has grown.')], { currentYear: YEAR })
    expect(r!.staleDates.pagesWithHits).toBe(0)
  })
  it('does NOT flag a future date or a non-year "start"', () => {
    const r = computeContentSignals([page('/a', 'Class of 2027 applications open. Start your journey today.')], { currentYear: YEAR })
    expect(r!.staleDates.pagesWithHits).toBe(0)
  })
  it('caps hits at 5 per page', () => {
    const text = Array.from({ length: 9 }, (_, i) => `© ${2010 + i} note.`).join(' ')
    const r = computeContentSignals([page('/a', text)], { currentYear: YEAR })
    expect(r!.staleDates.pages[0].hits.length).toBeLessThanOrEqual(5)
  })
})

describe('computeContentSignals — readability', () => {
  it('scores only pages at or above the word floor', () => {
    const short = page('/s', 'Too short to score.')
    const long = page('/l', Array.from({ length: 120 }, () => 'the reading passage is simple and clear').join(' '))
    const r = computeContentSignals([short, long], { currentYear: YEAR })
    expect(r!.readability.scoredPages).toBe(1)
    expect(r!.readability.medianFleschReadingEase).not.toBeNull()
  })
  it('handles text with no sentence terminators (single-sentence fallback, no NaN)', () => {
    const noPunct = page('/n', Array.from({ length: 110 }, () => 'word').join(' '))
    const r = computeContentSignals([noPunct], { currentYear: YEAR })
    expect(Number.isNaN(r!.readability.pages[0].fleschReadingEase)).toBe(false)
  })
})

describe('computeContentSignals — shape + edges', () => {
  it('returns null when no page has contentText', () => {
    expect(computeContentSignals([{ url: '/a', contentText: null, contentTruncated: false }], { currentYear: YEAR })).toBeNull()
  })
  it('counts truncated pages', () => {
    const r = computeContentSignals([{ url: '/a', contentText: 'x', contentTruncated: true }], { currentYear: YEAR })
    expect(r!.truncatedPages).toBe(1)
  })
  it('is deterministic given a fixed currentYear', () => {
    const input = [page('/a', '© 2020 Example.')]
    expect(computeContentSignals(input, { currentYear: YEAR })).toEqual(computeContentSignals(input, { currentYear: YEAR }))
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/content-signals.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `content-signals.ts`** per the algorithm contract above. Keep the whole thing pure (no `Date`, no I/O). Structure: `tokenizeWords`, `countSentences`, `countSyllables`, `readabilityForPage`, `staleDatesForPage` (one regex pass per rule class over lines), `median`, then `computeContentSignals` assembling the result, applying the word floor, per-page hit cap (5), per-list page cap (50, stale sorted by hit count desc, readability sorted by FRE asc), and returning `null` when `observedPages === 0`.

- [ ] **Step 4: Run tests, verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/content-signals.test.ts`
Expected: PASS. Iterate on the syllable/formula details until the readability assertions and every stale-date fixture pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/content-signals.ts lib/ada-audit/seo/content-signals.test.ts && git commit -m "feat(c12): pure content-signals (stale dates + readability)"
```

---

## Task 7: Schema — `CrawlRun.contentSignalsJson` + `CrawlRunInput`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260712000000_content_signals/migration.sql`
- Modify: `lib/findings/types.ts`

**Interfaces:**
- Produces: nullable `CrawlRun.contentSignalsJson String?`; `CrawlRunInput.contentSignalsJson?: string | null`.

- [ ] **Step 1: Edit the schema**

In `prisma/schema.prisma`, add beside the other metadata columns on `CrawlRun` (after `programEntitiesJson`):

```prisma
  contentSignalsJson    String? // C12: stale-date + readability signals (live-scan runs only); measurement, NOT a finding
```

- [ ] **Step 2: Author + apply the migration**

Create `prisma/migrations/20260712000000_content_signals/migration.sql`:

```sql
-- C12 Increment B: additive nullable content-signals metadata on CrawlRun.
ALTER TABLE "CrawlRun" ADD COLUMN "contentSignalsJson" TEXT;
```

Run:
```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate
```
Expected: migration applied, client regenerated.

- [ ] **Step 3: Add the input field**

In `lib/findings/types.ts`, in `CrawlRunInput` after `programEntitiesJson`:

```ts
  contentSignalsJson?: string | null   // C12: stale-date + readability signals; live-scan runs only
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (writer's `crawlRun.create({ data: { ...run } })` persists the new field automatically).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260712000000_content_signals/migration.sql lib/findings/types.ts && git commit -m "feat(c12): CrawlRun.contentSignalsJson column + CrawlRunInput field"
```

---

## Task 8: Builder integration in `broken-link-verify.ts`

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts`
- Test: `lib/jobs/handlers/broken-link-verify.test.ts` (existing — add cases mirroring the similarity fail-to-null / budget-skip tests)

**Interfaces:**
- Consumes: `computeContentSignals` from `@/lib/ada-audit/seo/content-signals`; the existing `seoRows` (already selects `contentText`, `contentTruncated`), `indexableOf`, `deps.now()`, `jobStartedAt`, `JOB_TIMEOUT_MS`, `SAFETY_RESERVE_MS`, `CONTENT_SIM_RESERVE_MS`.
- Produces: `contentSignalsJson` on the `bundle.run`.

**Context:** the similarity block is at `broken-link-verify.ts:534`; the bundle assembly with the metadata fields is right after (`contentSimilarityJson, schemaTypesJson, programEntitiesJson`). Insert the content-signals block IMMEDIATELY BEFORE the similarity block so its reserve accounts for both (spec §4.2 Codex #1: skip when `sigRemaining < CONTENT_SIGNALS_RESERVE_MS + CONTENT_SIM_RESERVE_MS`).

- [ ] **Step 1: Write the failing tests**

Add to `lib/jobs/handlers/broken-link-verify.test.ts` (follow the file's harness for constructing a completed audit with `HarvestedPageSeo` rows; find the existing similarity assertion and mirror it):

```ts
it('writes contentSignalsJson from harvested page text', async () => {
  // arrange a completed audit with an indexable HTML page whose contentText has an old copyright.
  await runBrokenLinkVerify(/* job for that audit */)
  const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } } })
  expect(run!.contentSignalsJson).toBeTruthy()
  const parsed = JSON.parse(run!.contentSignalsJson!)
  expect(parsed.v).toBe(1)
  expect(parsed.staleDates.pagesWithHits).toBeGreaterThanOrEqual(1)
})

it('writes the run with contentSignalsJson null when the compute throws', async () => {
  // spy computeContentSignals -> throw; assert run still written, contentSignalsJson null.
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: new cases FAIL.

- [ ] **Step 3: Implement**

Add the reserve constant near `CONTENT_SIM_RESERVE_MS` (line 94):

```ts
const CONTENT_SIGNALS_RESERVE_MS = 10_000 // skip content signals if under this + the similarity reserve
```

Import at the top: `import { computeContentSignals } from '@/lib/ada-audit/seo/content-signals'`.

Immediately before the `// C6 Phase 5: content similarity.` comment (line 534), insert:

```ts
  // C12: stale-date + readability signals over the SAME indexable ∧ ¬login-like
  // aggregation set. Best-effort + time-budget-guarded (runs before similarity, so
  // its reserve accounts for both). Never fails the live-scan write (fail-to-null).
  let contentSignalsJson: string | null = null
  const sigRemaining = JOB_TIMEOUT_MS - (deps.now() - jobStartedAt) - SAFETY_RESERVE_MS
  if (sigRemaining >= CONTENT_SIGNALS_RESERVE_MS + CONTENT_SIM_RESERVE_MS) {
    try {
      const sigInputs = seoRows
        .filter((r) => indexableOf(r) && !r.loginLike)
        .map((r) => ({ url: r.url, contentText: r.contentText, contentTruncated: r.contentTruncated }))
      const signals = computeContentSignals(sigInputs, { currentYear: new Date().getUTCFullYear() })
      if (signals) contentSignalsJson = JSON.stringify({ v: 1, ...signals })
    } catch (e) {
      console.error('[live-seo] content signals failed', e)
    }
  }
```

Add `contentSignalsJson,` to the `bundle.run` object beside `programEntitiesJson`.

- [ ] **Step 4: Run tests, verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.test.ts && git commit -m "feat(c12): compute content signals in the live-scan builder"
```

---

## Task 9: `ContentSignalsSection` results-page component

**Files:**
- Create: `components/site-audit/ContentSignalsSection.tsx`
- Test: `components/site-audit/ContentSignalsSection.test.tsx`

**Interfaces:**
- Consumes: a `run` prop shaped `{ contentSignalsJson: string | null }` (mirror `ContentSimilaritySection`'s prop contract — read it first).
- Produces: `export function ContentSignalsSection({ run }: { run: { contentSignalsJson: string | null } | null })`.

**States + copy:** null column → "Content signals were not analyzed for this audit." (never "no issues"). Parsed with hits → stale-date list grouped by page (kind + year + excerpt) and readability medians + worst-pages list. Clean (parsed, zero stale hits) → "No stale date references detected." plus, when `truncatedPages > 0`, "Some page text was truncated at 30k characters, so this is not a full-content guarantee." Readability block always labels "English-calibrated (Flesch)". JSON.parse wrapped in try/catch → treat as not-analyzed on failure.

- [ ] **Step 1: Write the failing test**

```tsx
// components/site-audit/ContentSignalsSection.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ContentSignalsSection } from './ContentSignalsSection'

afterEach(cleanup)

const withSignals = (o: object) => ({ contentSignalsJson: JSON.stringify({ v: 1, observedPages: 3, truncatedPages: 0,
  staleDates: { pagesWithHits: 0, pages: [] },
  readability: { scoredPages: 3, medianFleschReadingEase: 55.2, medianGradeLevel: 9.1, pages: [] }, ...o }) })

describe('ContentSignalsSection', () => {
  it('renders the not-analyzed state for a null column', () => {
    render(<ContentSignalsSection run={{ contentSignalsJson: null }} />)
    expect(screen.getByText(/were not analyzed/i)).toBeInTheDocument()
  })
  it('renders the clean state', () => {
    render(<ContentSignalsSection run={withSignals({})} />)
    expect(screen.getByText(/No stale date references detected/i)).toBeInTheDocument()
  })
  it('renders a stale-date hit', () => {
    render(<ContentSignalsSection run={withSignals({ staleDates: { pagesWithHits: 1, pages: [
      { url: 'https://x.edu/a', hits: [{ kind: 'copyright', year: 2021, excerpt: '© 2021 Example' }] } ] } })} />)
    expect(screen.getByText(/x\.edu\/a/)).toBeInTheDocument()
    expect(screen.getByText(/2021/)).toBeInTheDocument()
  })
  it('notes truncation on a clean-but-truncated result', () => {
    render(<ContentSignalsSection run={withSignals({ truncatedPages: 2 })} />)
    expect(screen.getByText(/truncated at 30k/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/ContentSignalsSection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** the section mirroring `ContentSimilaritySection.tsx` (dark-mode classes, `<details>` for per-page hit lists). try/catch the `JSON.parse`; on parse failure render the not-analyzed state.

- [ ] **Step 4: Run test, verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/ContentSignalsSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/site-audit/ContentSignalsSection.tsx components/site-audit/ContentSignalsSection.test.tsx && git commit -m "feat(c12): ContentSignalsSection results-page block"
```

---

## Task 10: Wire the section onto the site-audit results page

**Files:**
- Modify: `app/(app)/ada-audit/site/[id]/page.tsx`

**Context:** the page loads `liveScanRun` via `prisma.crawlRun.findUnique` (`app/(app)/ada-audit/site/[id]/page.tsx:219`) selecting the metadata columns, and renders the SEO section stack (`ContentSimilaritySection` at line 287). Add the column to the select and render the new section in the stack. Share view (`app/(public)/ada-audit/site/share/[token]/page.tsx`) is intentionally UNCHANGED (content-similarity precedent).

- [ ] **Step 1: Select the column + render**

In the `select` object of the `liveScanRun` `findUnique` (near line 228), add `contentSignalsJson: true,`. Import `ContentSignalsSection` from `@/components/site-audit/ContentSignalsSection`. In the SEO content stack after `<ContentSimilaritySection run={liveScanRun} />` (line 287), add:

```tsx
<ContentSignalsSection run={liveScanRun} />
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/ada-audit/site/[id]/page.tsx" && git commit -m "feat(c12): render ContentSignalsSection on the site-audit results page"
```

---

## Task 11: Full gates + docs ritual

**Files:**
- Modify: `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`, `docs/superpowers/todos/HANDOFF-improvement-roadmap.md`, `CLAUDE.md`.
- Move: spec + plan → `docs/superpowers/archive/` on ship.

- [ ] **Step 1: Run all three gates**

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: all green.

- [ ] **Step 2: Open the PR**, merge once gate-green (rule 1), deploy (`ssh seo@144.126.213.242 "~/deploy.sh"` — the OOM fix restored the plain recipe), verify prod (fresh BUILD_ID, health, migration applied via read-only Prisma probe of `CrawlRun.contentSignalsJson`).

- [ ] **Step 3: Docs ritual (same commit):** tick C12 on the tracker (or mark the Tier-0-A+B slice shipped, leaving Tier-1/cat_ as remaining scope), add a dated status-log line, rewrite the handoff doc, add a CLAUDE.md `## Key files` bullet for `content-signals.ts` + a note on `CrawlRun.contentSignalsJson` and the new cannibalization route/card. `git mv` the spec + plan to `docs/superpowers/archive/`.

- [ ] **Step 4: End the chat reply with the handoff paste-in prompt in a code block.**

---

## Self-Review

**Spec coverage:** Increment A — Task 1 (cap/type), 2 (service), 3 (route), 4 (card), 5 (wiring). Increment B — Task 6 (pure module), 7 (schema/input), 8 (builder), 9 (section), 10 (wiring). All six Codex fixes: #1 Task 8 (reserve + CrawlRunInput), #2 Task 6/8 (eligibility filter + truncatedPages), #3 Task 6 (copyright range), #4 Task 6 (pinned algorithm), #5 Task 2/3 (clientExists + both AtLimit flags), #6 Task 4 (independent refresh copy). Retention/error-handling need no code (metadata rides CrawlRun cascade; contentText transience unchanged).

**Placeholder scan:** every code step has literal code or a precise contract; the two "mirror the existing test harness" notes (Task 8) point at a named existing assertion to copy, not a vague TODO.

**Type consistency:** `CannibalizationReport` (Task 1) → returned by `getCannibalizationReport` (Task 2) → consumed by route (Task 3) and card (Task 4, via `CannibalizationReport['report']`). `ContentSignalsResult` (Task 6) → `{v:1,...}`-wrapped in builder (Task 8) → parsed in section (Task 9). `contentSignalsJson` field name identical across Task 7/8/10.
