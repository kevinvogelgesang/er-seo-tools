# ADA Audit UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Clients section to `/ada-audit` showing each client's most recent site audit, and paginate the Recent Page Audits + Recent Site Audits sections (25/page, 10 visible, scrollable). Update existing API endpoints to a paginated response shape; add a new client-summary endpoint.

**Architecture:** Branches off `main` after PR 1 merges (no code dependency). Three sections on `/ada-audit` stack vertically: New Audit (unchanged) → Clients (new, scroll-only, no pagination) → Recent Page Audits (paginated) → Recent Site Audits (paginated). Both Recents endpoints return the new `{ items, totalCount, page, pageSize }` shape — this is a breaking change to the response, and both internal consumers update in the same PR (no external consumers exist). A shared `PaginatedSection` component owns the scroll container + page footer for the two Recents. Clients section reuses the scroll container but has no page footer.

**Tech Stack:** Next.js 15 App Router · TypeScript · React 19 · Tailwind · `useSearchParams` for URL state.

**Reference spec:** `docs/superpowers/specs/2026-05-12-ada-audit-ui-overhaul-design.md`

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `app/api/clients/audit-summary/route.ts` | GET — joins Client → latest complete SiteAudit per client |
| `components/ada-audit/ClientsAuditSummary.tsx` | The Clients section: search input, sortable columns, scroll container, row link / Run audit button, error states |
| `components/ada-audit/PaginatedSection.tsx` | Shared layout: section card + scroll container + page footer + error state |
| `lib/hooks/useDebouncedValue.ts` | 300ms debounce hook for search input → URL sync |
| `app/api/clients/audit-summary/route.test.ts` | Unit test for the audit-summary aggregation logic (via mocked Prisma where reasonable; otherwise smoke test) |
| `lib/hooks/useDebouncedValue.test.ts` | Unit test for the debounce hook |

### Modified files
| Path | Change |
|---|---|
| `app/api/site-audit/route.ts` | Accept `page` + `pageSize`. Return `{ items, totalCount, page, pageSize }`. |
| `app/api/ada-audit/route.ts` | Same. |
| `components/ada-audit/AuditHistory.tsx` | Use `PaginatedSection`. Read `items` from new response. URL state via `recentPagesPage`. |
| `components/ada-audit/SiteAuditHistory.tsx` | Same treatment. URL state via `recentSitesPage`. Smart-poll preserved. |
| `components/ada-audit/AuditIndexTabs.tsx` | Insert `<ClientsAuditSummary />` between New Audit card and Recents. Initialize `tab` from `?auditTab=` (and infer `site` when `?prefillDomain=` is set without an explicit `auditTab`). |
| `components/ada-audit/SiteAuditForm.tsx` | Read `prefillDomain` from `useSearchParams` on mount. |
| `lib/ada-audit/types.ts` | Add `ClientAuditSummary`, `PaginatedResponse<T>` types. |

---

## Phase 1: Foundation

### Task 1: Cut branch off latest main

- [ ] **Step 1: Verify PR 1 is merged and main is current**

```bash
git checkout main
git pull
git log --oneline -1
```

Expected: latest commit on main mentions PR 1 (runner enhancements) OR you're explicitly choosing to ship PR 2 before PR 1 merges. If the latter, confirm with the user.

- [ ] **Step 2: Create branch**

```bash
git checkout -b feat/ada-audit-ui-overhaul
```

Expected: `Switched to a new branch 'feat/ada-audit-ui-overhaul'`.

---

### Task 2: Shared types

**Files:**
- Modify: `lib/ada-audit/types.ts`

- [ ] **Step 1: Append new types to `lib/ada-audit/types.ts`**

At the bottom of the file:

```ts
// ── Pagination ─────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items: T[]
  totalCount: number
  page: number
  pageSize: number
}

// ── Client audit summary (Clients view on /ada-audit) ──────────────────────

export interface ClientAuditSummary {
  clientId: number
  clientName: string
  firstDomain: string | null
  latestSiteAudit: {
    id: string
    createdAt: string                 // ISO
    score: number | null
    pagesTotal: number
    pagesError: number
    summary: SiteAuditSummary | null
  } | null
}
```

`SiteAuditSummary` is already exported earlier in this same file (`lib/ada-audit/types.ts`, around line 73 — verify with `grep -n "export.*SiteAuditSummary" lib/ada-audit/types.ts`). Reference it directly; do **not** use `import('./types').SiteAuditSummary`, which is a circular self-import inside the same module.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/ada-audit/types.ts
git commit -m "feat(ada-audit): add PaginatedResponse + ClientAuditSummary types"
```

---

## Phase 2: Backend — paginated Recents endpoints

### Task 3: Paginate `GET /api/site-audit`

**Files:**
- Modify: `app/api/site-audit/route.ts`

- [ ] **Step 1: Read the file**

Locate the existing `GET` handler. It currently returns a bare array.

- [ ] **Step 2: Replace the GET handler with paginated version**

```ts
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const pageSizeRaw = parseInt(url.searchParams.get('pageSize') ?? '25', 10) || 25
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw))

  // Preserve the existing ?clientId= filter (used by the per-client view)
  const clientIdParam = url.searchParams.get('clientId')
  const where = clientIdParam ? { clientId: parseInt(clientIdParam, 10) } : {}

  const [items, totalCount] = await Promise.all([
    prisma.siteAudit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { client: { select: { name: true } } },
    }),
    prisma.siteAudit.count({ where }),
  ])

  const formatted = items.map((a) => {
    // The current handler computes score from summary.aggregate via
    // `computeScoreFromCounts` (exported from lib/ada-audit/scoring.ts:28)
    // because SiteAudit.score is not persisted by the queue. Preserve that
    // behavior verbatim — do NOT switch to `a.score ?? null`, which would
    // always be null on freshly-completed audits. See the existing
    // transform in app/api/site-audit/route.ts:88-97.
    let summary: unknown = null
    let score: number | null = null
    if (a.status === 'complete' && a.summary) {
      try {
        summary = JSON.parse(a.summary)
        const agg = (summary as { aggregate?: unknown } | null)?.aggregate
        if (agg) score = computeScoreFromCounts(agg as never, a.wcagLevel).score
      } catch { /* leave summary/score null */ }
    }
    return {
      id: a.id,
      createdAt: a.createdAt.toISOString(),
      domain: a.domain,
      status: a.status,
      error: a.error ?? null,
      clientId: a.clientId ?? null,
      clientName: a.client?.name ?? null,
      pagesTotal: a.pagesTotal,
      pagesComplete: a.pagesComplete,
      pagesError: a.pagesError,
      summary,
      score,
      wcagLevel: a.wcagLevel,
    }
  })

  return NextResponse.json({ items: formatted, totalCount, page, pageSize })
}
```

**Critical:** read the existing handler first and copy its `summary` + `score` derivation verbatim. The current handler at `app/api/site-audit/route.ts:88-97` derives score from `summary.aggregate` via `computeScoreFromCounts()` — `SiteAudit.score` is not persisted at queue completion time, so a literal `a.score ?? null` would silently null out scores in the Recents view.

- [ ] **Step 3: Smoke test the endpoint**

```bash
npm run dev &
sleep 5
curl -s 'http://localhost:3000/api/site-audit?page=1&pageSize=5' | head -c 500
echo
curl -s 'http://localhost:3000/api/site-audit' | head -c 500
kill %1
```

Expected: both responses are JSON objects with `items: [...], totalCount, page, pageSize`. Default (no params) returns the first 25.

- [ ] **Step 4: Commit**

```bash
git add app/api/site-audit/route.ts
git commit -m "feat(ada-audit): paginate GET /api/site-audit (BREAKING: response now wrapped)"
```

---

### Task 4: Paginate `GET /api/ada-audit`

**Files:**
- Modify: `app/api/ada-audit/route.ts`

- [ ] **Step 1: Apply the same pattern as Task 3**

Replace the GET handler with:

```ts
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const pageSizeRaw = parseInt(url.searchParams.get('pageSize') ?? '25', 10) || 25
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw))

  // Preserve the existing ?clientId= filter alongside the
  // "standalone audits only" filter (site-audit children appear under
  // /api/site-audit, not here).
  const clientIdParam = url.searchParams.get('clientId')
  const where: { siteAuditId: null; clientId?: number } = { siteAuditId: null }
  if (clientIdParam) where.clientId = parseInt(clientIdParam, 10)

  const [items, totalCount] = await Promise.all([
    prisma.adaAudit.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { client: { select: { name: true } } },
      where,
    }),
    prisma.adaAudit.count({ where }),
  ])

  const formatted = items.map((a) => {
    // Preserve any existing transformation logic from the original handler
    return {
      id: a.id,
      createdAt: a.createdAt.toISOString(),
      url: a.url,
      status: a.status,
      error: a.error ?? null,
      score: a.score ?? null,
      wcagLevel: a.wcagLevel,
      clientId: a.clientId ?? null,
      clientName: a.client?.name ?? null,
      // Add counts from result JSON if the previous handler did so — read original first
    }
  })

  return NextResponse.json({ items: formatted, totalCount, page, pageSize })
}
```

**Critical:** read the existing handler to copy any result-JSON parsing it did (e.g. for issue counts). Preserve that logic inside the `formatted` map.

- [ ] **Step 2: Smoke test**

```bash
npm run dev &
sleep 5
curl -s 'http://localhost:3000/api/ada-audit?page=1&pageSize=5' | head -c 500
kill %1
```

Expected: wrapped JSON with `items`, etc.

- [ ] **Step 3: Commit**

```bash
git add app/api/ada-audit/route.ts
git commit -m "feat(ada-audit): paginate GET /api/ada-audit (BREAKING: response now wrapped)"
```

---

## Phase 3: New client-summary endpoint

### Task 5: `GET /api/clients/audit-summary`

**Files:**
- Create: `app/api/clients/audit-summary/route.ts`

- [ ] **Step 1: Write the endpoint**

```ts
// app/api/clients/audit-summary/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { ClientAuditSummary } from '@/lib/ada-audit/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Fetch all clients
  const clients = await prisma.client.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, domains: true },
  })

  // For each client, get their most recent complete SiteAudit in one query
  // SQLite: simplest correct approach is a per-client findFirst. With ~30 clients
  // and an index on (clientId, createdAt), this is fast enough.
  const summaries: ClientAuditSummary[] = await Promise.all(
    clients.map(async (c) => {
      const latest = await prisma.siteAudit.findFirst({
        where: { clientId: c.id, status: 'complete' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          pagesTotal: true,
          pagesError: true,
          wcagLevel: true,
          summary: true,
        },
      })

      let domains: string[] = []
      try { domains = JSON.parse(c.domains) } catch { /* keep [] */ }

      // Score is derived from summary.aggregate the same way /api/site-audit
      // does it — SiteAudit.score is not persisted by the queue, so reading
      // it would always be null on freshly completed audits. Keep the
      // derivation in lockstep with app/api/site-audit/route.ts (or, even
      // better, factor `deriveScoreFromSummary(summary, wcagLevel)` into
      // lib/ada-audit/site-audit-helpers.ts and call it from both places).
      let parsedSummary: SiteAuditSummary | null = null
      let score: number | null = null
      if (latest?.summary) {
        try {
          parsedSummary = JSON.parse(latest.summary) as SiteAuditSummary
          const agg = (parsedSummary as { aggregate?: unknown } | null)?.aggregate
          if (agg) score = computeScoreFromCounts(agg as never, latest.wcagLevel).score
        } catch { parsedSummary = null }
      }

      return {
        clientId: c.id,
        clientName: c.name,
        firstDomain: domains[0] ?? null,
        latestSiteAudit: latest ? {
          id: latest.id,
          createdAt: latest.createdAt.toISOString(),
          score,
          pagesTotal: latest.pagesTotal,
          pagesError: latest.pagesError,
          summary: parsedSummary,
        } : null,
      }
    }),
  )

  return NextResponse.json(summaries)
}
```

Imports:

```ts
import type { ClientAuditSummary, SiteAuditSummary } from '@/lib/ada-audit/types'
import { computeScoreFromCounts } from '@/lib/ada-audit/scoring'
```

(`computeScoreFromCounts` is exported from `lib/ada-audit/scoring.ts:28`, not from `site-audit-helpers.ts`.) Both this endpoint and `app/api/site-audit/route.ts` should call the same helper; if you find the derivation duplicated, extract `deriveScoreFromSummary(summary, wcagLevel)` into `lib/ada-audit/scoring.ts` (or `site-audit-helpers.ts`) and call it from both places.

- [ ] **Step 2: Smoke test**

```bash
npm run dev &
sleep 5
curl -s 'http://localhost:3000/api/clients/audit-summary' | head -c 1000
kill %1
```

Expected: JSON array of objects, each with `clientId`, `clientName`, `firstDomain`, `latestSiteAudit` (object or null).

- [ ] **Step 3: Commit**

```bash
git add app/api/clients/audit-summary/route.ts
git commit -m "feat(ada-audit): GET /api/clients/audit-summary endpoint"
```

---

## Phase 4: Debounce hook

### Task 6: `useDebouncedValue` hook with test

**Files:**
- Create: `lib/hooks/useDebouncedValue.ts`
- Create: `lib/hooks/useDebouncedValue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/hooks/useDebouncedValue.test.ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedValue } from './useDebouncedValue'

describe('useDebouncedValue', () => {
  it('returns the latest value only after the delay', async () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: 'a' },
    })
    expect(result.current).toBe('a')

    rerender({ v: 'ab' })
    rerender({ v: 'abc' })
    expect(result.current).toBe('a')          // not yet — debounced

    await act(async () => { vi.advanceTimersByTime(299) })
    expect(result.current).toBe('a')

    await act(async () => { vi.advanceTimersByTime(2) })
    expect(result.current).toBe('abc')

    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Install React testing library if not already present**

```bash
npm list @testing-library/react 2>&1 | head -2
```

If missing:
```bash
npm install --save-dev @testing-library/react @testing-library/dom jsdom
```

**Do not switch the global Vitest environment to `jsdom`.** The current `vitest.config.ts` uses `environment: 'node'` (see `vitest.config.ts:5`), and existing server-side tests (parsers, runner helpers, queue manager, etc.) rely on Node globals and would break under jsdom. Instead, opt this single hook test into jsdom with a per-file directive — add it as the **first line** of `lib/hooks/useDebouncedValue.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedValue } from './useDebouncedValue'
// …rest of the test from Step 1
```

This keeps the global default at `node` and gives React Testing Library a DOM for just this file. If you add more hook/component tests later, repeat the directive per file (or add a vitest project / glob-scoped `environmentMatchGlobs` entry in `vitest.config.ts` — but that is out of scope for this PR).

- [ ] **Step 3: Run, verify fail**

```bash
npm test -- useDebouncedValue
```

Expected: FAIL (module not found).

- [ ] **Step 4: Implement `useDebouncedValue.ts`**

```ts
// lib/hooks/useDebouncedValue.ts
import { useEffect, useState } from 'react'

/**
 * Returns `value` delayed by `delayMs`. While the input changes rapidly,
 * the returned value stays at its previous setting until the input stops
 * changing for `delayMs`. Typical use: debouncing a search input before
 * writing to the URL or firing a network request.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])

  return debounced
}
```

- [ ] **Step 5: Run, verify pass**

```bash
npm test -- useDebouncedValue
```

Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add lib/hooks/useDebouncedValue.ts lib/hooks/useDebouncedValue.test.ts package.json package-lock.json
git commit -m "feat(hooks): useDebouncedValue with test"
```

---

## Phase 5: Shared PaginatedSection component

### Task 7: `PaginatedSection` shared layout

**Files:**
- Create: `components/ada-audit/PaginatedSection.tsx`

This is the shared scroll container + page footer + error state. The Clients section reuses the scroll container but hides the footer.

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { ReactNode, useEffect } from 'react'
import { Spinner } from '@/components/Spinner'

interface Props {
  title: string
  icon?: ReactNode
  trailing?: ReactNode                 // optional element rendered next to the title (e.g., search input)
  rowCount: number                     // total rows after filtering (for "Page X of N" math)
  pageSize?: number                    // if undefined, no pagination footer (scroll-only mode)
  page?: number                        // current page, 1-indexed. Required when pageSize is set.
  onPageChange?: (next: number) => void
  loading?: boolean                    // user-initiated load — dims content. Polling should NOT pass true.
  error?: string | null                // when no data and fetch failed
  onRetry?: () => void                 // shown alongside error
  empty?: ReactNode                    // shown when rowCount === 0 and no error and not loading
  children: ReactNode                  // the table rows
}

const ROW_PX = 56                       // approximate row height; container fits ~10
const CONTAINER_MAX = ROW_PX * 10

export default function PaginatedSection({
  title, icon, trailing,
  rowCount, pageSize, page, onPageChange,
  loading, error, onRetry, empty, children,
}: Props) {
  const totalPages = pageSize && rowCount > 0 ? Math.max(1, Math.ceil(rowCount / pageSize)) : 1
  const currentPage = page ?? 1

  // Auto-fallback if currentPage exceeds totalPages (e.g. deletion shrank the
  // data). The parent owns page state; we only fire onPageChange so it can
  // correct. Side-effects must NOT run in render under React 19 (Strict Mode
  // would queueMicrotask twice; `router.replace` during render is a hard
  // warning) — schedule the correction in an effect instead.
  useEffect(() => {
    if (pageSize && currentPage > totalPages && onPageChange) {
      onPageChange(totalPages)
    }
  }, [pageSize, currentPage, totalPages, onPageChange])

  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
        {icon && <div className="w-8 h-8 rounded-lg bg-orange/15 flex items-center justify-center flex-shrink-0">{icon}</div>}
        <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">{title}</h2>
        {trailing && <div className="ml-auto">{trailing}</div>}
      </div>

      <div
        className={`relative overflow-y-auto transition-opacity duration-150 ${loading ? 'opacity-50' : ''}`}
        style={{ maxHeight: CONTAINER_MAX }}
      >
        {error && rowCount === 0 ? (
          <div className="p-6 text-center">
            <p className="text-[13px] font-body text-red-700 dark:text-red-400 mb-3">Failed to load {title.toLowerCase()}. {error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="text-[12px] font-body font-semibold text-orange hover:underline"
              >
                Retry
              </button>
            )}
          </div>
        ) : rowCount === 0 && empty ? (
          <div className="p-6 text-center text-[13px] font-body text-navy/50 dark:text-white/50">{empty}</div>
        ) : (
          children
        )}
      </div>

      {pageSize && rowCount > pageSize && onPageChange && (
        <div className="flex items-center justify-center gap-4 px-6 py-3 border-t border-gray-100 dark:border-navy-border bg-gray-50/50 dark:bg-navy-deep/50">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
            className="text-[12px] font-body font-semibold text-navy/70 dark:text-white/70 disabled:opacity-30 disabled:cursor-not-allowed hover:text-orange"
          >
            ← Prev
          </button>
          <span className="text-[12px] font-body text-navy/60 dark:text-white/60">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            className="text-[12px] font-body font-semibold text-navy/70 dark:text-white/70 disabled:opacity-30 disabled:cursor-not-allowed hover:text-orange"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add components/ada-audit/PaginatedSection.tsx
git commit -m "feat(ada-audit): shared PaginatedSection layout component"
```

---

## Phase 6: Refactor Recents to use the new shape

### Task 8: Update `AuditHistory.tsx` to use paginated response + PaginatedSection

**Files:**
- Modify: `components/ada-audit/AuditHistory.tsx`

- [ ] **Step 1: Read the file in full**

```bash
wc -l components/ada-audit/AuditHistory.tsx
```

Read the entire file. Identify:
- Where the fetch is made (currently `fetch('/api/ada-audit')`)
- Where `audits` state is set
- Where the rows are rendered
- Whether polling exists

- [ ] **Step 2: Refactor to use paginated response and URL page state**

Replace the data fetch + state with:

```tsx
import { useSearchParams, useRouter } from 'next/navigation'
import PaginatedSection from './PaginatedSection'
import type { PaginatedResponse, AuditListItem } from '@/lib/ada-audit/types'

const PAGE_SIZE = 25

export default function AuditHistory() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const page = Math.max(1, parseInt(searchParams.get('recentPagesPage') ?? '1', 10) || 1)

  const [data, setData] = useState<PaginatedResponse<AuditListItem> | null>(null)
  const [loading, setLoading] = useState(false)        // user-initiated only
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const fetchPage = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch(`/api/ada-audit?page=${page}&pageSize=${PAGE_SIZE}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: PaginatedResponse<AuditListItem> = await res.json()
      setData(json)
      setError(null)
    } catch (e) {
      if (data === null) setError(e instanceof Error ? e.message : 'Failed to load history')
      // Silent failure when we have data — keep last good, log only
      else console.warn('[AuditHistory] poll failed:', e)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [page, data])

  // Initial fetch + on page change
  useEffect(() => { void fetchPage(false) }, [page])
  // Polling (silent) — every 8s
  useEffect(() => {
    const id = setInterval(() => void fetchPage(true), 8000)
    return () => clearInterval(id)
  }, [fetchPage])

  const setPage = useCallback((next: number) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 1) params.delete('recentPagesPage')
    else params.set('recentPagesPage', String(next))
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [router, searchParams])

  const items = data?.items ?? []
  const totalCount = data?.totalCount ?? 0

  return (
    <PaginatedSection
      title="Recent Page Audits"
      icon={<svg className="w-4 h-4 text-orange" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>}
      rowCount={totalCount}
      pageSize={PAGE_SIZE}
      page={page}
      onPageChange={setPage}
      loading={loading}
      error={error}
      onRetry={() => void fetchPage(false)}
      empty="No page audits yet."
    >
      {/* Render the existing table rows here — keep whatever JSX previously rendered the rows */}
      <table className="w-full">
        <tbody>
          {items.map((a) => (
            /* existing row JSX, unchanged */
            null
          ))}
        </tbody>
      </table>
    </PaginatedSection>
  )
}
```

**Important:** preserve the original delete-confirmation UI and row JSX. The skeleton above shows only the structure; the table body, action buttons, status badges, score badges, issue counts, etc. all come from the original component.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Smoke test in browser**

```bash
npm run dev
```

Visit `/ada-audit`. Verify:
- Recent Page Audits section renders rows correctly
- Pagination footer shows if total > 25
- Prev/Next move between pages, URL updates with `?recentPagesPage=2`
- Hard refresh on page 2 stays on page 2
- Loading dim appears briefly on prev/next click, not on background poll

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/AuditHistory.tsx
git commit -m "refactor(ada-audit): AuditHistory uses paginated response + PaginatedSection"
```

---

### Task 9: Update `SiteAuditHistory.tsx` same pattern

**Files:**
- Modify: `components/ada-audit/SiteAuditHistory.tsx`

Apply the same pattern as Task 8. Three things differ:

| Concern | Task 8 (AuditHistory) | Task 9 (SiteAuditHistory) |
|---|---|---|
| Endpoint | `/api/ada-audit` | `/api/site-audit` |
| URL page param | `recentPagesPage` | `recentSitesPage` |
| Section title | "Recent Page Audits" | "Recent Site Audits" |
| Polling | Plain 8s interval | **Smart-poll**: 8s when any row's status is in `['running','pending','queued','pages-running']`, otherwise idle |

- [ ] **Step 1: Implement**

Copy the Task 8 structure verbatim, then change endpoint/param/title. Replace the unconditional polling effect with a smart-poll:

```tsx
useEffect(() => {
  if (!data) return
  const hasActive = data.items.some((a) => ['queued', 'pending', 'running', 'pages-running'].includes(a.status))
  if (!hasActive) return
  const id = setInterval(() => void fetchPage(true), 8000)
  return () => clearInterval(id)
}, [data, fetchPage])
```

(`'pages-running'` is included to cover the PR 1 state where pages are done but PDFs are still being scanned — if PR 1 chose a different progress-message-based approach, drop that string and rely on the existing four statuses.)

Preserve the existing delete-confirmation UI, status badges, score badges, and any other row-level JSX from the original `SiteAuditHistory.tsx`.

- [ ] **Step 2: Type-check + browser smoke**

```bash
npx tsc --noEmit && npm run dev
```

Verify same pagination behavior as Task 8, plus that the smart-poll still triggers (start a site audit, watch the page progress tick without manual refresh).

- [ ] **Step 3: Commit**

```bash
git add components/ada-audit/SiteAuditHistory.tsx
git commit -m "refactor(ada-audit): SiteAuditHistory paginated, smart-poll preserved"
```

---

## Phase 7: Clients section

### Task 10: `ClientsAuditSummary` component

**Files:**
- Create: `components/ada-audit/ClientsAuditSummary.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import PaginatedSection from './PaginatedSection'
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue'
import type { ClientAuditSummary } from '@/lib/ada-audit/types'

type SortKey = 'name-asc' | 'name-desc' | 'date-asc' | 'date-desc' | 'score-asc' | 'score-desc'
const DEFAULT_SORT: SortKey = 'date-desc'

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-navy/25 dark:text-white/25">—</span>
  const color = score >= 80
    ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400'
    : score >= 50
      ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
      : 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400'
  return <span className={`text-[11px] font-body font-semibold px-2 py-0.5 rounded ${color}`}>{score}</span>
}

function compareDateDesc(a: ClientAuditSummary, b: ClientAuditSummary): number {
  // Never-scanned always sort to bottom regardless of asc/desc
  if (!a.latestSiteAudit && !b.latestSiteAudit) return a.clientName.localeCompare(b.clientName)
  if (!a.latestSiteAudit) return 1
  if (!b.latestSiteAudit) return -1
  return b.latestSiteAudit.createdAt.localeCompare(a.latestSiteAudit.createdAt)
}

function compareDateAsc(a: ClientAuditSummary, b: ClientAuditSummary): number {
  if (!a.latestSiteAudit && !b.latestSiteAudit) return a.clientName.localeCompare(b.clientName)
  if (!a.latestSiteAudit) return 1
  if (!b.latestSiteAudit) return -1
  return a.latestSiteAudit.createdAt.localeCompare(b.latestSiteAudit.createdAt)
}

function compareScore(asc: boolean) {
  return (a: ClientAuditSummary, b: ClientAuditSummary): number => {
    const av = a.latestSiteAudit?.score
    const bv = b.latestSiteAudit?.score
    if (av == null && bv == null) return a.clientName.localeCompare(b.clientName)
    if (av == null) return 1
    if (bv == null) return -1
    return asc ? av - bv : bv - av
  }
}

function sortClients(rows: ClientAuditSummary[], sort: SortKey): ClientAuditSummary[] {
  const out = [...rows]
  switch (sort) {
    case 'name-asc':   return out.sort((a, b) => a.clientName.localeCompare(b.clientName))
    case 'name-desc':  return out.sort((a, b) => b.clientName.localeCompare(a.clientName))
    case 'date-asc':   return out.sort(compareDateAsc)
    case 'date-desc':  return out.sort(compareDateDesc)
    case 'score-asc':  return out.sort(compareScore(true))
    case 'score-desc': return out.sort(compareScore(false))
  }
}

export default function ClientsAuditSummary() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [data, setData] = useState<ClientAuditSummary[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Local search input (instant) + debounced URL sync
  const [searchInput, setSearchInput] = useState(searchParams.get('clientsSearch') ?? '')
  const debouncedSearch = useDebouncedValue(searchInput, 300)
  const sort: SortKey = (searchParams.get('clientsSort') as SortKey) || DEFAULT_SORT

  const fetchClients = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch('/api/clients/audit-summary')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: ClientAuditSummary[] = await res.json()
      setData(json)
      setError(null)
    } catch (e) {
      if (data === null) setError(e instanceof Error ? e.message : 'Failed to load clients')
      else console.warn('[ClientsAuditSummary] poll failed:', e)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [data])

  useEffect(() => { void fetchClients(false) }, [])
  useEffect(() => {
    const id = setInterval(() => void fetchClients(true), 30_000)
    return () => clearInterval(id)
  }, [fetchClients])

  // Debounced URL sync for search
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (debouncedSearch) params.set('clientsSearch', debouncedSearch)
    else params.delete('clientsSearch')
    router.replace(`?${params.toString()}`, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  const setSort = (next: SortKey) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === DEFAULT_SORT) params.delete('clientsSort')
    else params.set('clientsSort', next)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  const view = useMemo(() => {
    const rows = data ?? []
    const filtered = searchInput.trim()
      ? rows.filter((r) => r.clientName.toLowerCase().includes(searchInput.trim().toLowerCase()))
      : rows
    return sortClients(filtered, sort)
  }, [data, searchInput, sort])

  const filtered = !!searchInput.trim()
  const filterCount = `Filtered to ${view.length} of ${data?.length ?? 0} clients`

  const SortHeader = ({ label, ascKey, descKey, currentSort }: { label: string; ascKey: SortKey; descKey: SortKey; currentSort: SortKey }) => {
    const isActive = currentSort === ascKey || currentSort === descKey
    const isAsc = currentSort === ascKey
    return (
      <button
        type="button"
        onClick={() => setSort(isActive && !isAsc ? ascKey : descKey)}
        className={`text-[11px] uppercase tracking-wider font-body font-semibold flex items-center gap-1 ${isActive ? 'text-orange' : 'text-navy/50 dark:text-white/50'} hover:text-orange`}
      >
        {label}
        {isActive && <span aria-hidden>{isAsc ? '↑' : '↓'}</span>}
      </button>
    )
  }

  const trailing = (
    <input
      type="text"
      value={searchInput}
      onChange={(e) => setSearchInput(e.target.value)}
      placeholder="Search clients by name"
      className="bg-white dark:bg-navy-deep border border-gray-200 dark:border-navy-border rounded-md px-3 py-1.5 text-[12px] font-body w-56"
    />
  )

  return (
    <PaginatedSection
      title="Clients"
      icon={<svg className="w-4 h-4 text-orange" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-5.13a4 4 0 11-8 0 4 4 0 018 0zM21 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>}
      trailing={trailing}
      rowCount={view.length}
      loading={loading}
      error={error}
      onRetry={() => void fetchClients(false)}
      empty={data && data.length === 0
        ? <>No clients yet — add some at <Link href="/clients" className="text-orange hover:underline">/clients</Link>.</>
        : filtered ? `No clients match "${searchInput}".` : 'No clients.'}
    >
      <table className="w-full">
        <thead className="sticky top-0 bg-gray-50 dark:bg-navy-deep">
          <tr className="border-b border-gray-100 dark:border-navy-border">
            <th className="text-left px-6 py-2"><SortHeader label="Client"     ascKey="name-asc" descKey="name-desc" currentSort={sort} /></th>
            <th className="text-left px-6 py-2"><SortHeader label="Last audit" ascKey="date-asc" descKey="date-desc" currentSort={sort} /></th>
            <th className="text-left px-6 py-2"><SortHeader label="Score"      ascKey="score-asc" descKey="score-desc" currentSort={sort} /></th>
            <th className="text-right px-6 py-2 text-[11px] uppercase tracking-wider font-body font-semibold text-navy/50 dark:text-white/50">Action</th>
          </tr>
          {filtered && (
            <tr>
              <td colSpan={4} className="px-6 py-1 text-[11px] font-body text-navy/40 dark:text-white/40">{filterCount}</td>
            </tr>
          )}
        </thead>
        <tbody>
          {view.map((c) => {
            const la = c.latestSiteAudit
            return (
              <tr key={c.clientId} className="border-b border-gray-50 dark:border-navy-border/50 hover:bg-gray-50/50 dark:hover:bg-navy-deep/30">
                <td className="px-6 py-3 font-body text-[13px] text-navy dark:text-white">
                  {la ? (
                    <Link href={`/ada-audit/site/${la.id}`} className="hover:text-orange">{c.clientName}</Link>
                  ) : (
                    <Link href="/clients" className="hover:text-orange">{c.clientName}</Link>
                  )}
                </td>
                <td className="px-6 py-3 font-body text-[12px] text-navy/60 dark:text-white/60">
                  {la ? new Date(la.createdAt).toLocaleDateString() : '—'}
                </td>
                <td className="px-6 py-3"><ScoreBadge score={la?.score ?? null} /></td>
                <td className="px-6 py-3 text-right">
                  {la ? (
                    <Link href={`/ada-audit/site/${la.id}`} className="text-[12px] text-orange hover:underline">View →</Link>
                  ) : c.firstDomain ? (
                    // Include auditTab=site so AuditIndexTabs opens on the
                    // Full Site tab (its default state is 'single'). Without
                    // this param the prefilled domain would be invisible to
                    // the user until they manually click Full Site.
                    <Link href={`/ada-audit/?auditTab=site&prefillDomain=${encodeURIComponent(c.firstDomain)}`} className="text-[12px] text-orange hover:underline">Run audit</Link>
                  ) : (
                    <button
                      type="button"
                      disabled
                      title="Add a domain on the Clients page to enable audits."
                      className="text-[12px] text-navy/30 dark:text-white/30 cursor-not-allowed"
                    >
                      Run audit
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </PaginatedSection>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add components/ada-audit/ClientsAuditSummary.tsx
git commit -m "feat(ada-audit): ClientsAuditSummary component"
```

---

### Task 11: Wire `ClientsAuditSummary` into the page

**Files:**
- Modify: `components/ada-audit/AuditIndexTabs.tsx`

- [ ] **Step 1: Insert the new section between New Audit and Recents, and switch the tab on `?auditTab=site`**

In `AuditIndexTabs.tsx`, locate the `<div className="space-y-8">` wrapper. After the New Audit card and before the Recent Page Audits card, insert `<ClientsAuditSummary />`. Also wire up tab initialization from URL params so that links from `ClientsAuditSummary` (which use `?auditTab=site&prefillDomain=...`) open on the Full Site tab.

The current component defaults `tab` to `'single'` via `useState<Tab>('single')`. Replace that with URL-derived initial state plus a sync effect:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import AuditForm from './AuditForm'
import SiteAuditForm from './SiteAuditForm'
import AuditHistory from './AuditHistory'
import SiteAuditHistory from './SiteAuditHistory'
import ClientsAuditSummary from './ClientsAuditSummary'

type Tab = 'single' | 'site'

function parseTab(value: string | null): Tab {
  return value === 'site' ? 'site' : 'single'
}

export default function AuditIndexTabs() {
  const searchParams = useSearchParams()
  // Initial value derived from URL so SSR + first paint match. Also infer
  // from prefillDomain (no auditTab) since a prefill is only meaningful on
  // the site tab today.
  const [tab, setTab] = useState<Tab>(() => {
    const explicit = searchParams.get('auditTab')
    if (explicit) return parseTab(explicit)
    if (searchParams.get('prefillDomain')) return 'site'
    return 'single'
  })

  // If the URL changes while the page is mounted (e.g., user clicks a
  // Clients "Run audit" link from another section in the same page),
  // honor it. Don't run this when the user has manually clicked a tab —
  // only react to the search-param value itself changing.
  useEffect(() => {
    const explicit = searchParams.get('auditTab')
    if (explicit) setTab(parseTab(explicit))
    else if (searchParams.get('prefillDomain')) setTab('site')
  }, [searchParams])

  // …rest of the existing component, with <ClientsAuditSummary /> inserted
  // between the New Audit card and the Recent Page Audits card.
}
```

Then, inside the existing layout JSX, insert the new section between the New Audit card and the Recent Page Audits card:

```tsx
<ClientsAuditSummary />
```

- [ ] **Step 2: Type-check + smoke test**

```bash
npx tsc --noEmit && npm run dev
```

Visit `/ada-audit`. Verify the Clients section renders between New Audit and Recents, with rows for each client. Test:
- Sort by clicking each column header
- Search by typing — list filters instantly, URL updates after 300ms
- Hard refresh with `?clientsSort=score-desc&clientsSearch=foo` — state restored
- Click a client name → goes to their latest site audit
- Click "Run audit" on a never-scanned client with domain → audit form gets prefilled
- Disabled "Run audit" for clients with no domains shows the tooltip

- [ ] **Step 3: Commit**

```bash
git add components/ada-audit/AuditIndexTabs.tsx
git commit -m "feat(ada-audit): wire Clients section into /ada-audit"
```

---

### Task 12: `SiteAuditForm` reads `prefillDomain`

**Files:**
- Modify: `components/ada-audit/SiteAuditForm.tsx`

- [ ] **Step 1: Read the file** to confirm the current domain-input state name (it should be `domain`, per the existing code).

- [ ] **Step 2: Add prefill from URL search params**

At the top of `SiteAuditForm`, after the existing `useRouter()` line, add:

```tsx
import { useSearchParams } from 'next/navigation'

// inside the component:
const searchParams = useSearchParams()

useEffect(() => {
  const prefill = searchParams.get('prefillDomain')
  if (prefill && !domain) {
    setDomain(prefill)
    setDomainTouched(true)
  }
  // Only run on mount; subsequent param changes are user-driven via the form itself
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

- [ ] **Step 3: Type-check + smoke test**

```bash
npx tsc --noEmit && npm run dev
```

Visit `/ada-audit?prefillDomain=example.com`. Verify:
- The Full Site tab's domain input is pre-filled with "example.com"
- If you navigate from `/ada-audit` to `/ada-audit?prefillDomain=...`, the domain populates

- [ ] **Step 4: Commit**

```bash
git add components/ada-audit/SiteAuditForm.tsx
git commit -m "feat(ada-audit): SiteAuditForm reads prefillDomain from URL"
```

---

## Phase 8: Acceptance and ship

### Task 13: Full acceptance pass

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 2: Type-check + lint + build**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

Expected: all pass.

- [ ] **Step 3: Manual acceptance — full UI sweep**

```bash
npm run dev
```

Visit `/ada-audit`. Verify all spec acceptance criteria:

1. **Clients section** renders between New Audit and Recents.
2. **Default sort** is latest audit date descending. Never-scanned clients pinned at the bottom.
3. **Column header click** toggles asc/desc with arrow indicator.
4. **Search input**: typing stays responsive (no jank); URL param updates after ~300ms of typing stops.
5. **Filter count** shows "Filtered to X of N clients" when filtering.
6. **No pagination footer** on Clients section. Internal scroll only.
7. **Recents pagination footer**: prev/next disable correctly at boundaries; Page X of N math correct.
8. **Scroll position preserved** across polling refresh (verify by scrolling inside Recents, waiting 8s, watching scroll stay put).
9. **Hard refresh restoration**: visit `/ada-audit?recentSitesPage=2&clientsSort=score-asc&clientsSearch=test`; reload; state intact.
10. **Run audit prefill**: click an empty client's Run audit → URL has `?auditTab=site&prefillDomain=...`, the **Full Site tab is selected**, and the domain input is pre-filled.
11. **Disabled Run audit tooltip** appears on hover for clients without domains.
12. **Filter + sort survive poll**: filter to "foo" + sort by score; wait 30s; the filter and sort do not visually reset.
13. **Initial load failure**: stop the dev server briefly to provoke a 500 or kill mid-load → section shows "Failed to load … [Retry]".
14. **Polling failure stays silent**: stop the dev server while the page is open; verify the last loaded data stays visible (check the Network panel for failed requests but no UI change).
15. **User-page-change loading dim** appears on prev/next click, NOT on background poll.
16. **Page out-of-range fallback**: visit `/ada-audit?recentSitesPage=999` → falls back to the highest valid page.

- [ ] **Step 4: Push branch**

```bash
git push -u origin feat/ada-audit-ui-overhaul
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --title "feat(ada-audit): UI overhaul — Clients view + paginated Recents" --body "$(cat <<'EOF'
## Summary
- New **Clients** section on `/ada-audit` between New Audit and Recents. One row per client with latest complete site audit (score, date). Sortable columns, name search (debounced 300ms), scroll-only — no pagination needed for ~30 rows.
- **Recents paginated**: 25 rows per page, scroll container shows ~10. Prev/Next footer. URL state preserved across refresh.
- **API breaking change**: `GET /api/site-audit` and `GET /api/ada-audit` now return `{ items, totalCount, page, pageSize }` instead of bare arrays. Both internal consumers updated atomically; no external consumers exist.
- New endpoint: `GET /api/clients/audit-summary`.
- Shared `PaginatedSection` component owns scroll container + page footer + error states.
- `SiteAuditForm` reads `?prefillDomain=` from URL.
- Polling refreshes are silent — only user-initiated fetches dim the container.

## Test plan
- [ ] Clients view sorts and filters as expected
- [ ] Filter + sort survive the 30s background poll
- [ ] Recents pagination works, URL state restored on refresh
- [ ] Initial-load failures show inline retry; polling failures stay silent
- [ ] Run audit pre-fills the form correctly

Spec: `docs/superpowers/specs/2026-05-12-ada-audit-ui-overhaul-design.md`
Plan: `docs/superpowers/plans/2026-05-12-ada-audit-ui-overhaul.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: After review/merge, deploy**

```bash
ssh seo@144.126.213.242 "~/deploy.sh"
```

Verify on prod: hit `/ada-audit`, exercise the same 16 manual checks from Step 3 against real client data.

---

## Reference: URL Search Params Introduced

| Param | Used by | Notes |
|---|---|---|
| `recentPagesPage` | `AuditHistory` | Current page of Recent Page Audits (omitted = 1) |
| `recentSitesPage` | `SiteAuditHistory` | Current page of Recent Site Audits (omitted = 1) |
| `clientsSort` | `ClientsAuditSummary` | `name-asc | name-desc | date-asc | date-desc | score-asc | score-desc`. Omitted = default `date-desc` |
| `clientsSearch` | `ClientsAuditSummary` | Active name filter (omitted = no filter) |
| `prefillDomain` | `SiteAuditForm` | One-shot domain seed for the audit form |
| `auditTab` | `AuditIndexTabs` | `single \| site`. Omitted = `single` unless `prefillDomain` is also present, in which case it defaults to `site`. |
