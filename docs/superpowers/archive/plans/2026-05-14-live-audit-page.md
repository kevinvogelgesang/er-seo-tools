# Live Audit Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a SiteAudit is in a running state, surface a live, polling-driven table of completed/in-flight child pages on `/ada-audit/site/[id]` so operators can click through to per-page results the moment a page finishes. Also fix the pre-existing routing miss where `pdfs-running` falls through to the "Result data is unavailable" branch.

**Architecture:** Extend `GET /api/site-audit/[id]` with an optional `liveChildren` array. The route does the DB query; `buildLiveChildren()` is a **pure function** that takes pre-fetched rows and returns the wire shape — matching the existing convention that `lib/ada-audit/site-audit-helpers.ts` does no I/O. `SiteAuditPoller` renders the new `<LiveAuditTable>` beneath the progress card.

**Tech Stack:** Next.js 15 App Router · TypeScript · Prisma + SQLite · vitest

**Companion spec:** `docs/superpowers/specs/2026-05-14-live-audit-page-design.md`

**Pre-flight gate:** open this PR only after `2026-05-14-audit-stability.md` has shipped and audits are observed running to completion in production.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/ada-audit/types.ts` | Modify | Add `LiveAuditChild` interface; extend `SiteAuditDetail` with optional `liveChildren` |
| `lib/ada-audit/site-audit-helpers.ts` | Modify | Export `parseAxeScorecardFromResult` (rename from private `parseScorecard`); add **pure** `buildLiveChildren(rows)`. **No `prisma` import.** |
| `lib/ada-audit/site-audit-helpers.test.ts` | Modify | Tests for `parseAxeScorecardFromResult` and `buildLiveChildren` — pure-function tests, no DB seeding |
| `app/api/site-audit/[id]/route.ts` | Modify | When status is running/pdfs-running, query `adaAudit.findMany` and feed rows to `buildLiveChildren`; include `liveChildren` in response |
| `app/api/site-audit/[id]/route.test.ts` | Modify | Test `liveChildren` presence/absence by parent status (running + pdfs-running both included; complete omitted) |
| `app/ada-audit/site/[id]/page.tsx` | Modify | Add `pdfs-running` to the running-state branch (route-fix) |
| `components/ada-audit/SiteAuditPoller.tsx` | Modify | Fetch `liveChildren` from poll, render `<LiveAuditTable>`. Show "Scanning PDFs…" copy when status === 'pdfs-running' |
| `components/ada-audit/LiveAuditTable.tsx` | Create | Table component rendering one row per child |

---

### Task 1: Branch + working tree

**Files:** none

- [ ] **Step 1: Pull latest main**

```bash
git checkout main && git pull origin main
```

- [ ] **Step 2: Create the feature branch**

```bash
git checkout -b feat/live-audit-page
```

---

### Task 2: Extract and export `parseScorecard` from site-audit-helpers

**Files:**
- Modify: `lib/ada-audit/site-audit-helpers.ts`
- Test: `lib/ada-audit/site-audit-helpers.test.ts`

**Why first:** the existing private `parseScorecard` already turns an axe result JSON string into an `AuditScorecard`. The new `buildLiveChildren` needs exactly that. Renaming + exporting is the smallest pre-step.

- [ ] **Step 1: Write the failing test**

Append to `lib/ada-audit/site-audit-helpers.test.ts`:

```typescript
import {
  // …existing imports…
  parseAxeScorecardFromResult,
} from '@/lib/ada-audit/site-audit-helpers'

describe('parseAxeScorecardFromResult', () => {
  it('returns null when input is null', () => {
    expect(parseAxeScorecardFromResult(null)).toBeNull()
  })

  it('returns null when input is not valid JSON', () => {
    expect(parseAxeScorecardFromResult('{not-json')).toBeNull()
  })

  it('counts violations by impact and includes passed/incomplete totals', () => {
    const json = JSON.stringify({
      violations: [
        { impact: 'critical' },
        { impact: 'critical' },
        { impact: 'serious' },
        { impact: 'moderate' },
        { impact: 'minor' },
      ],
      passes: [{ id: 'a' }, { id: 'b' }],
      incomplete: [{ id: 'c' }],
    })
    expect(parseAxeScorecardFromResult(json)).toEqual({
      critical: 2, serious: 1, moderate: 1, minor: 1,
      total: 5, passed: 2, incomplete: 1,
    })
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/site-audit-helpers.test.ts
```

Expected: FAIL — `parseAxeScorecardFromResult is not exported`.

- [ ] **Step 3: Rename and export**

In `site-audit-helpers.ts`, locate `function parseScorecard(result: string | null): AuditScorecard | null { … }`. Rename to `parseAxeScorecardFromResult` and add `export`:

```typescript
export function parseAxeScorecardFromResult(result: string | null): AuditScorecard | null {
  if (!result) return null
  try {
    const r = JSON.parse(result)
    const violations = Array.isArray(r?.violations) ? r.violations : []
    return {
      critical:   violations.filter((v: { impact: string }) => v.impact === 'critical').length,
      serious:    violations.filter((v: { impact: string }) => v.impact === 'serious').length,
      moderate:   violations.filter((v: { impact: string }) => v.impact === 'moderate').length,
      minor:      violations.filter((v: { impact: string }) => v.impact === 'minor').length,
      total:      violations.length,
      passed:     Array.isArray(r?.passes) ? r.passes.length : 0,
      incomplete: Array.isArray(r?.incomplete) ? r.incomplete.length : 0,
    }
  } catch {
    return null
  }
}
```

Update the internal call site inside `buildSiteAuditSummary`:

```typescript
const scorecard = child.status === 'complete' ? parseAxeScorecardFromResult(child.result) : null
```

- [ ] **Step 4: Run tests, verify all pass**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/site-audit-helpers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/site-audit-helpers.ts lib/ada-audit/site-audit-helpers.test.ts
git commit -m "refactor(ada-audit): export parseAxeScorecardFromResult for reuse"
```

---

### Task 3: Add `LiveAuditChild` type

**Files:**
- Modify: `lib/ada-audit/types.ts`

- [ ] **Step 1: Add the new interface**

Insert immediately after the existing `SitePageResult` interface (search for `interface SitePageResult` to locate):

```typescript
/**
 * One row in the live-children table rendered while a SiteAudit is in flight.
 * Computed at request time in buildLiveChildren() — never persisted.
 *
 * Note: no timestamp field. The route returns rows in createdAt desc order
 * already; client renders in that order. Exposing a timestamp under any name
 * would be misleading (the source column is the row's createdAt, not an
 * updatedAt — these rows never get re-written before they terminalize).
 */
export interface LiveAuditChild {
  adaAuditId: string
  url: string
  status: 'pending' | 'running' | 'complete' | 'error'
  scorecard: AuditScorecard | null  // null until status === 'complete'
  error: string | null              // populated when status === 'error'
}
```

- [ ] **Step 2: Extend `SiteAuditDetail`**

Locate the `SiteAuditDetail` interface in the same file and add the optional field:

```typescript
export interface SiteAuditDetail {
  // …existing fields, unchanged…
  liveChildren?: LiveAuditChild[]
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run lint
```

Expected: PASS — no callers yet, optional field is non-breaking.

- [ ] **Step 4: Commit**

```bash
git add lib/ada-audit/types.ts
git commit -m "feat(ada-audit): add LiveAuditChild type for live audit page"
```

---

### Task 4: Implement `buildLiveChildren()` — pure function (TDD)

**Files:**
- Modify: `lib/ada-audit/site-audit-helpers.ts`
- Test: `lib/ada-audit/site-audit-helpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `lib/ada-audit/site-audit-helpers.test.ts`:

```typescript
import { buildLiveChildren } from '@/lib/ada-audit/site-audit-helpers'

describe('buildLiveChildren', () => {
  it('returns an empty array for an empty input', () => {
    expect(buildLiveChildren([])).toEqual([])
  })

  it('produces a scorecard only for complete children; null for running/pending', () => {
    const rows = [
      { id: 'a', url: 'https://x/a', status: 'complete',
        result: JSON.stringify({ violations: [{ impact: 'critical' }], passes: [], incomplete: [] }),
        error: null },
      { id: 'b', url: 'https://x/b', status: 'running',  result: null, error: null },
      { id: 'c', url: 'https://x/c', status: 'pending',  result: null, error: null },
    ]
    const out = buildLiveChildren(rows)
    const byId = Object.fromEntries(out.map((r) => [r.adaAuditId, r]))
    expect(byId.a.status).toBe('complete')
    expect(byId.a.scorecard?.critical).toBe(1)
    expect(byId.b.status).toBe('running')
    expect(byId.b.scorecard).toBeNull()
    expect(byId.c.status).toBe('pending')
    expect(byId.c.scorecard).toBeNull()
  })

  it('passes through the error message for failed children', () => {
    const rows = [
      { id: 'a', url: 'https://x/a', status: 'error', result: null, error: 'HTTP 403 — Blocked' },
    ]
    const out = buildLiveChildren(rows)
    expect(out[0].status).toBe('error')
    expect(out[0].error).toBe('HTTP 403 — Blocked')
    expect(out[0].scorecard).toBeNull()
  })

  it('falls back to "pending" for unknown status values', () => {
    const rows = [
      { id: 'a', url: 'https://x/a', status: 'some-future-status', result: null, error: null },
    ]
    const out = buildLiveChildren(rows)
    expect(out[0].status).toBe('pending')
  })

  it('preserves input order (caller is responsible for sort)', () => {
    const rows = [
      { id: 'a', url: 'https://x/a', status: 'complete', result: '{}', error: null },
      { id: 'b', url: 'https://x/b', status: 'complete', result: '{}', error: null },
      { id: 'c', url: 'https://x/c', status: 'complete', result: '{}', error: null },
    ]
    expect(buildLiveChildren(rows).map((r) => r.adaAuditId)).toEqual(['a', 'b', 'c'])
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/site-audit-helpers.test.ts
```

Expected: FAIL — `buildLiveChildren is not exported`.

- [ ] **Step 3: Implement `buildLiveChildren` as a pure function**

Append to `lib/ada-audit/site-audit-helpers.ts`:

```typescript
import type { LiveAuditChild } from './types'

/** Row shape the route should pass to buildLiveChildren — pre-fetched AdaAudit selection. */
export interface LiveChildInputRow {
  id: string
  url: string
  status: string
  result: string | null
  error: string | null
}

/** Max rows the route should request before calling buildLiveChildren. The
 *  helper itself does no slicing — that's the caller's concern. */
export const LIVE_CHILDREN_LIMIT = 100

const LIVE_STATUSES = ['pending', 'running', 'complete', 'error'] as const
type LiveStatus = typeof LIVE_STATUSES[number]

function coerceStatus(s: string): LiveStatus {
  return (LIVE_STATUSES as readonly string[]).includes(s) ? (s as LiveStatus) : 'pending'
}

/**
 * Pure transform from pre-fetched AdaAudit rows to the wire shape for the
 * live-children table. No DB access — the caller (the route handler) is
 * responsible for the prisma query, ordering, and limit.
 */
export function buildLiveChildren(rows: LiveChildInputRow[]): LiveAuditChild[] {
  return rows.map((r) => ({
    adaAuditId: r.id,
    url: r.url,
    status: coerceStatus(r.status),
    scorecard: r.status === 'complete' ? parseAxeScorecardFromResult(r.result) : null,
    error: r.error,
  }))
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/site-audit-helpers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/site-audit-helpers.ts lib/ada-audit/site-audit-helpers.test.ts
git commit -m "feat(ada-audit): pure buildLiveChildren helper for live audit page"
```

---

### Task 5: Wire `liveChildren` into the GET endpoint (TDD)

**Files:**
- Modify: `app/api/site-audit/[id]/route.ts`
- Test: `app/api/site-audit/[id]/route.test.ts`

- [ ] **Step 1: Read the existing test file to understand its mock pattern**

```bash
cat app/api/site-audit/\[id\]/route.test.ts
```

If it already has `vi.mock('@/lib/db', …)`, extend that mock to add `adaAudit.findMany`. Otherwise add the mock.

- [ ] **Step 2: Write the failing tests**

Add to `app/api/site-audit/[id]/route.test.ts` (merging mocks with any existing setup):

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  prisma: {
    siteAudit: { findUnique: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    adaAudit: { findMany: vi.fn() },
  },
}))

const { prisma } = await import('@/lib/db')
const { GET } = await import('./route')

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.mocked(prisma.siteAudit.findUnique).mockReset()
  vi.mocked(prisma.siteAudit.count).mockReset()
  vi.mocked(prisma.siteAudit.findFirst).mockReset()
  vi.mocked(prisma.adaAudit.findMany).mockReset()
})

describe('GET /api/site-audit/[id] — liveChildren', () => {
  function siteAudit(status: string) {
    return {
      id: 'sa-1', domain: 'live.example', status,
      createdAt: new Date(), error: null, clientId: null, client: null,
      pagesTotal: 10, pagesComplete: 1, pagesError: 0,
      summary: status === 'complete' ? JSON.stringify({ aggregate: {}, pdfsAggregate: {}, pages: [] }) : null,
      pdfAudits: [],
      pdfsTotal: 0, pdfsComplete: 0, pdfsError: 0,
    } as never
  }

  it('includes liveChildren when SiteAudit status is running', async () => {
    vi.mocked(prisma.siteAudit.findUnique).mockResolvedValue(siteAudit('running'))
    vi.mocked(prisma.adaAudit.findMany).mockResolvedValue([
      { id: 'c1', url: 'https://live.example/a', status: 'complete',
        result: JSON.stringify({ violations: [], passes: [], incomplete: [] }),
        error: null },
    ] as never)

    const res = await GET(new NextRequest('http://localhost/api/site-audit/sa-1'), ctx('sa-1'))
    const json = await res.json()
    expect(json.liveChildren).toHaveLength(1)
    expect(json.liveChildren[0].adaAuditId).toBe('c1')
    expect(json.liveChildren[0].status).toBe('complete')
    expect(prisma.adaAudit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { siteAuditId: 'sa-1' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }))
  })

  it('includes liveChildren when SiteAudit status is pdfs-running', async () => {
    vi.mocked(prisma.siteAudit.findUnique).mockResolvedValue(siteAudit('pdfs-running'))
    vi.mocked(prisma.adaAudit.findMany).mockResolvedValue([] as never)

    const res = await GET(new NextRequest('http://localhost/api/site-audit/sa-1'), ctx('sa-1'))
    const json = await res.json()
    expect(json.liveChildren).toEqual([])
    expect(prisma.adaAudit.findMany).toHaveBeenCalled()
  })

  it('omits liveChildren when SiteAudit status is complete', async () => {
    vi.mocked(prisma.siteAudit.findUnique).mockResolvedValue(siteAudit('complete'))

    const res = await GET(new NextRequest('http://localhost/api/site-audit/sa-1'), ctx('sa-1'))
    const json = await res.json()
    expect(json.liveChildren).toBeUndefined()
    expect(prisma.adaAudit.findMany).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run, verify it fails**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run 'app/api/site-audit/[id]/route.test.ts'
```

Expected: FAIL — endpoint doesn't return `liveChildren` yet.

- [ ] **Step 4: Wire `liveChildren` into the GET handler**

Open `app/api/site-audit/[id]/route.ts`. At the top, add the import:

```typescript
import {
  buildLiveChildren,
  LIVE_CHILDREN_LIMIT,
} from '@/lib/ada-audit/site-audit-helpers'
```

Just before the final `return NextResponse.json({…})` block, add:

```typescript
const isRunning = audit.status === 'running' || audit.status === 'pdfs-running'
const liveChildren = isRunning
  ? buildLiveChildren(
      await prisma.adaAudit.findMany({
        where: { siteAuditId: audit.id },
        orderBy: { createdAt: 'desc' },
        take: LIVE_CHILDREN_LIMIT,
        select: { id: true, url: true, status: true, result: true, error: true },
      }),
    )
  : undefined
```

Include the field in the response with a conditional spread:

```typescript
return NextResponse.json({
  id: audit.id,
  // …existing fields, unchanged…
  queuePosition,
  activeAudit,
  ...(liveChildren ? { liveChildren } : {}),
})
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run 'app/api/site-audit/[id]/route.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Run the full suite**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run
```

Expected: PASS, +5 new tests from this PR so far (3 for parseAxeScorecardFromResult, 5 for buildLiveChildren, 3 for the route — though some count adjustment depending on the existing route test setup).

- [ ] **Step 7: Commit**

```bash
git add app/api/site-audit/\[id\]/route.ts app/api/site-audit/\[id\]/route.test.ts
git commit -m "feat(ada-audit): include liveChildren in /api/site-audit/[id] when running or pdfs-running"
```

---

### Task 6: Fix `pdfs-running` page routing

**Files:**
- Modify: `app/ada-audit/site/[id]/page.tsx`

**Why:** the page currently sends `queued`/`pending`/`running` to the `<SiteAuditPoller>` and routes everything else to either the `complete` summary or the error branch. `pdfs-running` falls into the complete branch but has no `summary` JSON yet → user sees "Result data is unavailable. Please run the audit again." This PR makes `pdfs-running` route to the poller alongside `running`.

- [ ] **Step 1: Locate the routing condition**

```bash
grep -n "audit.status ===" app/ada-audit/site/\[id\]/page.tsx
```

You should see a block like:

```typescript
if (audit.status === 'queued' || audit.status === 'pending' || audit.status === 'running') {
  return (
    // …SiteAuditPoller…
  )
}
```

- [ ] **Step 2: Add `pdfs-running` to the condition**

Update to:

```typescript
if (audit.status === 'queued' || audit.status === 'pending' || audit.status === 'running' || audit.status === 'pdfs-running') {
  return (
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      {breadcrumb}
      <SiteAuditPoller
        id={id}
        initialStatus={audit.status}
        initialPagesTotal={audit.pagesTotal}
        initialPagesComplete={audit.pagesComplete}
        initialPagesError={audit.pagesError}
      />
    </main>
  )
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/ada-audit/site/\[id\]/page.tsx
git commit -m "fix(ada-audit): route pdfs-running to SiteAuditPoller (was falling through to 'data unavailable')"
```

---

### Task 7: Build `<LiveAuditTable>` component

**Files:**
- Create: `components/ada-audit/LiveAuditTable.tsx`

No unit tests (no React testing stack). Verification in Task 9.

- [ ] **Step 1: Create the component**

```tsx
'use client'

import Link from 'next/link'
import type { LiveAuditChild } from '@/lib/ada-audit/types'

interface Props {
  children: LiveAuditChild[]
}

function StatusPill({ status }: { status: LiveAuditChild['status'] }) {
  const map: Record<LiveAuditChild['status'], string> = {
    complete: 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400',
    error:    'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400',
    running:  'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400',
    pending:  'bg-gray-100 dark:bg-navy-light text-gray-600 dark:text-white/60',
  }
  return (
    <span className={`text-[10px] font-body font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${map[status]}`}>
      {status}
    </span>
  )
}

function ImpactCounts({ child }: { child: LiveAuditChild }) {
  if (child.status !== 'complete' || !child.scorecard) {
    return <span className="text-navy/25 dark:text-white/25">—</span>
  }
  const sc = child.scorecard
  if (sc.total === 0) {
    return <span className="font-semibold text-green-600 dark:text-green-400 text-[11px]">Clean</span>
  }
  return (
    <span className="flex gap-2 text-[11px] font-body">
      {sc.critical > 0 && <span className="font-semibold text-red-600 dark:text-red-400">{sc.critical} crit</span>}
      {sc.serious  > 0 && <span className="font-semibold text-orange-600 dark:text-orange-400">{sc.serious} ser</span>}
      {sc.moderate > 0 && <span className="font-semibold text-yellow-600 dark:text-yellow-400">{sc.moderate} mod</span>}
      {sc.minor    > 0 && <span className="font-semibold text-blue-600 dark:text-blue-400">{sc.minor} min</span>}
    </span>
  )
}

export default function LiveAuditTable({ children }: Props) {
  if (children.length === 0) return null
  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden shadow-sm">
      <div className="px-6 py-3 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
        <h3 className="font-display font-bold text-[14px] text-navy dark:text-white">Pages so far</h3>
        <p className="text-[11px] font-body text-navy/50 dark:text-white/50">
          Updates as each page finishes. Click a row to open its full audit.
        </p>
      </div>
      <table className="w-full text-[13px] font-body">
        <thead>
          <tr className="text-left bg-gray-50/50 dark:bg-navy-deep/30 border-b border-gray-100 dark:border-navy-border">
            <th className="px-6 py-2 text-[11px] uppercase tracking-wider font-semibold text-navy/50 dark:text-white/50">URL</th>
            <th className="px-6 py-2 text-[11px] uppercase tracking-wider font-semibold text-navy/50 dark:text-white/50">Status</th>
            <th className="px-6 py-2 text-[11px] uppercase tracking-wider font-semibold text-navy/50 dark:text-white/50">Violations</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-navy-border">
          {children.map((c) => (
            <tr key={c.adaAuditId} className="hover:bg-gray-50 dark:hover:bg-navy-light">
              <td className="px-6 py-2.5">
                {c.status === 'complete' || c.status === 'error' ? (
                  <Link href={`/ada-audit/${c.adaAuditId}`} className="text-navy/80 dark:text-white/80 hover:text-orange transition-colors">
                    {c.url}
                  </Link>
                ) : (
                  <span className="text-navy/60 dark:text-white/60">{c.url}</span>
                )}
                {c.error && (
                  <div className="text-[11px] font-body text-red-600 dark:text-red-400 mt-0.5">{c.error}</div>
                )}
              </td>
              <td className="px-6 py-2.5"><StatusPill status={c.status} /></td>
              <td className="px-6 py-2.5"><ImpactCounts child={c} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/ada-audit/LiveAuditTable.tsx
git commit -m "feat(ada-audit): add LiveAuditTable component"
```

---

### Task 8: Wire table + pdfs-running copy into `<SiteAuditPoller>`

**Files:**
- Modify: `components/ada-audit/SiteAuditPoller.tsx`

- [ ] **Step 1: Extend `PollData`, import the new types/component**

At the top of `components/ada-audit/SiteAuditPoller.tsx`, add imports:

```typescript
import type { LiveAuditChild } from '@/lib/ada-audit/types'
import LiveAuditTable from './LiveAuditTable'
```

Update the `PollData` interface:

```typescript
interface PollData {
  status: string
  pagesTotal: number
  pagesComplete: number
  pagesError: number
  queuePosition: number | null
  activeAudit: {
    id: string
    domain: string
    pagesTotal: number
    pagesComplete: number
    pagesError: number
  } | null
  liveChildren?: LiveAuditChild[]
}
```

- [ ] **Step 2: Track `liveChildren` in state**

Inside the component, add next to the existing state hooks:

```typescript
const [liveChildren, setLiveChildren] = useState<LiveAuditChild[]>([])
```

In the polling effect, after `setActiveAudit(data.activeAudit)`, add:

```typescript
setLiveChildren(data.liveChildren ?? [])
```

- [ ] **Step 3: Add the `pdfs-running` copy branch**

Locate the running-state JSX. The line `const discovering = pagesTotal === 0 && status === 'running'`. Add immediately after it:

```typescript
const isPdfsRunning = status === 'pdfs-running'
```

In the running-state card, replace the headline / sub-text block so `pdfs-running` shows different copy:

```tsx
<p className="font-display font-bold text-[17px] text-navy dark:text-white">
  {isPdfsRunning ? 'Scanning PDFs…' : discovering ? 'Discovering pages…' : 'Scanning pages…'}
</p>
<p className="text-[12px] font-body text-navy/50 dark:text-white/50 mt-0.5">
  {isPdfsRunning
    ? 'All pages scanned. Working through the harvested PDF documents.'
    : discovering
      ? 'Fetching sitemap.xml to find pages to audit'
      : `${scanned} of ${pagesTotal} pages scanned${pagesError > 0 ? ` · ${pagesError} error${pagesError !== 1 ? 's' : ''}` : ''}`
  }
</p>
```

- [ ] **Step 4: Render `<LiveAuditTable>` below the running-state card**

Immediately before the closing `</div>` of the `!isQueued` block, add:

```tsx
{liveChildren.length > 0 && <LiveAuditTable children={liveChildren} />}
```

(Do not render the table in the queued state — `isQueued` shows queue position, not progress.)

- [ ] **Step 5: Typecheck**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/ada-audit/SiteAuditPoller.tsx
git commit -m "feat(ada-audit): render LiveAuditTable + pdfs-running copy in SiteAuditPoller"
```

---

### Task 9: Manual verification on a running audit

**Files:** none — runtime check.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Trigger a real audit**

In the browser, go to `http://localhost:3000/ada-audit`, queue a site audit for a small site (~10–30 pages).

- [ ] **Step 3: Open the detail page mid-flight**

While the audit is running, navigate to `/ada-audit/site/<id>`. Verify:

- The orange progress card still renders at the top
- Below it, the "Pages so far" table appears once at least one child page completes
- Rows show URL, Status pill, Violations (or `—` for running rows)
- Completed rows are clickable; clicking opens that page's individual audit
- The table updates every ~3 seconds without a full page reload

- [ ] **Step 4: Verify the `pdfs-running` transition**

If the audit harvests PDFs, near the end of the page-scan phase the headline should swap to "Scanning PDFs…" and the table should remain visible with all completed rows. The "Result data unavailable" message should never appear.

- [ ] **Step 5: Smoke the empty-state branch**

Open the detail page in the brief window between enqueue and first page completion. Verify the table is NOT visible, then appears once the first child finishes.

- [ ] **Step 6: Verify the terminal handoff**

Once the audit completes, the page should swap to the final `<SiteAuditResultsView>` cleanly — no transient blank state, no double-rendering of the live table.

---

### Task 10: Lint + full test suite + build

**Files:** none.

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 2: Full test suite**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run
```

Expected: PASS, with +11 new tests (3 for parseAxeScorecardFromResult, 5 for buildLiveChildren, 3 for the route extension).

- [ ] **Step 3: Production build**

```bash
rm -rf .next && npm run build
```

Expected: clean build.

---

### Task 11: Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/live-audit-page
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(ada-audit): live audit page during running + pdfs-running states" --body "$(cat <<'EOF'
## Summary
While a SiteAudit is in flight, the audit detail page now shows a live table of completed and in-flight child pages alongside the existing progress bar. Operators can click into any completed page's full audit the moment it finishes. Also fixes a pre-existing routing miss where `pdfs-running` audits showed "Result data is unavailable".

## What changed
- `GET /api/site-audit/[id]` returns an optional `liveChildren: LiveAuditChild[]` when status is `running` or `pdfs-running`. The route does the prisma query and feeds rows to a **pure** `buildLiveChildren(rows)` helper — `lib/ada-audit/site-audit-helpers.ts` stays I/O-free.
- New `<LiveAuditTable>` component rendered by `<SiteAuditPoller>` below the progress card when `liveChildren` is non-empty.
- `parseScorecard` extracted from `site-audit-helpers.ts` as exported `parseAxeScorecardFromResult` for reuse.
- New type `LiveAuditChild` on `SiteAuditDetail` (optional, backwards compatible). **No timestamp field** — the route returns rows in `createdAt desc` order, client renders that order.
- `app/ada-audit/site/[id]/page.tsx`: `pdfs-running` now routes to `<SiteAuditPoller>` (was falling through to the "data unavailable" branch).
- `<SiteAuditPoller>` shows "Scanning PDFs…" copy during `pdfs-running` instead of the misleading "Scanning pages…".

## Test plan
- [x] `parseAxeScorecardFromResult` unit tests: null input, invalid JSON, impact counting
- [x] `buildLiveChildren` pure-function tests: empty, mixed status, error pass-through, unknown-status fallback, order preservation
- [x] Route tests: `liveChildren` present when running, present when pdfs-running, absent when complete
- [x] Full test suite passes (+11 new)
- [x] Manual: live audit on local dev — rows appear/update over 3 s polling, click-through works, completion transition is clean, pdfs-running copy + table render correctly

## Out of scope
- Aggregate stats during running (sitemap tree, issue grouping, total score)
- Pagination of >100-page live views (full list returns after finalization)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return PR URL**

---

## Self-review checklist

- [x] **Spec coverage**: every spec section maps to a task. Pure-helper architecture → Task 4. API extension → Task 5. `pdfs-running` routing fix → Task 6. UI component → Task 7, wiring + pdfs copy → Task 8.
- [x] **No placeholders**: all code blocks contain working code.
- [x] **Type consistency**: `LiveAuditChild` shape used in Task 3 matches what `buildLiveChildren` returns (Task 4), what the route emits (Task 5), and what `<LiveAuditTable>` consumes (Task 7).
- [x] **No prisma in `site-audit-helpers.ts`**: Task 4 explicitly defines `buildLiveChildren` as a pure function taking row inputs. The prisma query is in the route handler (Task 5).
- [x] **No `updatedAt` leak**: Task 3 type omits any timestamp field. Server-side sort via `orderBy: { createdAt: 'desc' }` is the single source of truth for row order.
- [x] **`pdfs-running` covered**: page routing fixed (Task 6), API includes liveChildren for it (Task 5), poller copy updated (Task 8).
