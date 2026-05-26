# ADA Audit UX Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ADA Queue + Recents discoverable in the nav, turn Recents into a team-wide view with a Mine toggle shared between the home page and the full page, make batch rows expand-on-click with inline operator names, and render all user-visible timestamps in the viewer's browser timezone.

**Architecture:** A new `RecentsTable` client component (driven by a new `/api/ada-audit/recents` endpoint) replaces `MyRecentsCard` and powers both the home dashboard and the full Recents page. A new `ClientDate` component + `formatInBrowserTZ` helper render timestamps client-side. Batch rows split the expand and rename affordances into sibling buttons, and the batch API returns operator summaries plus nullable labels.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-26-ada-ux-bundle-design.md`

---

## File Structure

- `lib/ada-audit/format-date.ts` — **create.** Non-client `formatInBrowserTZ` string helper + formatter table (so server-imported modules like `duration.ts` can use it without pulling in `'use client'`).
- `components/ClientDate.tsx` — **create.** `ClientDate` component; re-exports `formatInBrowserTZ` from `format-date.ts`.
- `lib/ada-audit/recents-query.ts` — **modify.** Add `fetchAllRecents`, change timestamps to ISO strings, derive scores from blobs.
- `app/api/ada-audit/recents/route.ts` — **create.** GET endpoint with limit clamp + cookie-based scope.
- `components/ada-audit/RecentsTable.tsx` — **create.** Shared table for home + full views, with scope toggle + stale-response guard.
- `components/ada-audit/MyRecentsCard.tsx` — **delete.**
- `app/ada-audit/recents/page.tsx` — **modify.** Use `RecentsTable` (variant=full).
- `components/ada-audit/AuditIndexTabs.tsx` — **modify.** Swap `MyRecentsCard` → `RecentsTable` (variant=home).
- `app/ada-audit/page.tsx` — **modify.** Pass both scope datasets / operator.
- `components/nav.tsx` — **modify.** Add ADA dropdown, fix mobile `V{i+1}` bug, drop numeric badge. (Note: file is lowercase `nav.tsx`; `app/layout.tsx` imports `@/components/nav`.)
- `lib/ada-audit/types.ts` — **modify.** `AuditBatchSummary.operatorSummary`, `label: string | null`, `AuditBatchMember.requestedBy`.
- `app/api/audit-batches/route.ts` — **modify.** Select `requestedBy`, add `summarizeOperators`, return nullable label.
- `app/api/audit-batches/[id]/route.ts` — **modify.** Return `requestedBy` per member, nullable label.
- `lib/ada-audit/audit-batch-helpers.ts` — **modify.** Add a "is custom label?" helper so the API can return `null` for auto-labels.
- `components/ada-audit/QueueBatchRow.tsx` — **modify.** Sibling expand/rename buttons, operator inline, client-rendered auto-label + dates.
- `components/ada-audit/QueueMemberRow.tsx` — **modify.** `ClientDate` for dates.
- Various date callsites (Task 9).

---

## Task 0: Enable React component tests in Vitest + tsconfig

**Why:** `vitest.config.ts` uses `environment: 'node'` and `include: ['**/*.test.ts']`, so `.test.tsx` files (this plan's React tests) are neither included nor given a DOM. `tsconfig.json` excludes `**/*.test.ts` but not `.test.tsx`, so those would get type-checked. `@testing-library/react` + `jsdom` are already in `package.json`.

**Files:**
- Modify: `vitest.config.ts`
- Modify: `tsconfig.json`

- [ ] **Step 1: Include `.test.tsx` in Vitest**

In `vitest.config.ts`, change `include: ['**/*.test.ts']` to `include: ['**/*.test.ts', '**/*.test.tsx']`. Leave `environment: 'node'` as the default — React tests opt into jsdom per-file (Step 3 below) so the DB-backed node tests are unaffected.

- [ ] **Step 2: Exclude `.test.tsx` from tsc**

In `tsconfig.json`, change `"exclude": ["node_modules", "**/*.test.ts"]` to `"exclude": ["node_modules", "**/*.test.ts", "**/*.test.tsx"]`.

- [ ] **Step 3: Convention for React tests**

Every `.test.tsx` file in this plan MUST begin with this line so it gets a DOM:

```tsx
// @vitest-environment jsdom
```

- [ ] **Step 4: Sanity check**

Run: `npx vitest run` — expect existing suite still passes (no `.test.tsx` exists yet, so behavior is unchanged).

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts tsconfig.json
git commit -m "test: enable jsdom React component tests (.test.tsx)"
```

---

## Task 1: format-date helper + ClientDate component

**Files:**
- Create: `lib/ada-audit/format-date.ts`
- Create: `components/ClientDate.tsx`
- Test: `lib/ada-audit/format-date.test.ts`
- Test: `components/ClientDate.test.tsx`

- [ ] **Step 1: Write the failing test for the helper (node env)**

```ts
// lib/ada-audit/format-date.test.ts
import { describe, it, expect } from 'vitest'
import { formatInBrowserTZ } from './format-date'

describe('formatInBrowserTZ', () => {
  it('returns em dash for null/undefined/invalid', () => {
    expect(formatInBrowserTZ(null)).toBe('—')
    expect(formatInBrowserTZ(undefined)).toBe('—')
    expect(formatInBrowserTZ('not-a-date')).toBe('—')
  })
  it('formats a valid ISO string (contains a year)', () => {
    expect(formatInBrowserTZ('2026-05-13T19:15:00.000Z', 'date')).toMatch(/\d{4}/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ada-audit/format-date.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the non-client helper**

```ts
// lib/ada-audit/format-date.ts
export type DateVariant = 'date' | 'dateTime' | 'dateTimeShort'

export const dateFormatters: Record<DateVariant, Intl.DateTimeFormatOptions> = {
  date:          { year: 'numeric', month: 'short', day: 'numeric' },
  dateTime:      { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  dateTimeShort: { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
}

export function formatInBrowserTZ(iso: string | null | undefined, variant: DateVariant = 'date'): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-US', dateFormatters[variant])
}
```

This file has **no** `'use client'` directive and no React import, so server components (e.g. `duration.ts`, which `app/ada-audit/recents/page.tsx` imports — verified) can use it safely.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ada-audit/format-date.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the ClientDate test (jsdom)**

```tsx
// components/ClientDate.test.tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { ClientDate } from './ClientDate'

describe('ClientDate', () => {
  it('renders em dash for null iso', () => {
    const { container } = render(<ClientDate iso={null} />)
    expect(container.textContent).toBe('—')
  })
  it('SSR output shows the ISO date slice (pre-mount fallback)', () => {
    // renderToString never runs effects, so this captures the pre-mount branch
    // deterministically (testing-library would flush the effect during act()).
    const html = renderToString(<ClientDate iso="2026-05-13T19:15:00.000Z" />)
    expect(html).toContain('2026-05-13')
  })
})
```

- [ ] **Step 6: Run it (fails — no component yet)**

Run: `npx vitest run components/ClientDate.test.tsx`
Expected: FAIL — `./ClientDate` not found.

- [ ] **Step 7: Implement ClientDate (re-exports the helper)**

```tsx
// components/ClientDate.tsx
'use client'
import { useEffect, useState } from 'react'
import { dateFormatters, formatInBrowserTZ, type DateVariant } from '@/lib/ada-audit/format-date'

export { formatInBrowserTZ }

export function ClientDate({ iso, variant = 'date' }: { iso: string | null | undefined; variant?: DateVariant }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (!iso) return <>—</>
  if (!mounted) return <span suppressHydrationWarning>{iso.slice(0, 10)}</span>

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return <>—</>
  return <span>{date.toLocaleString('en-US', dateFormatters[variant])}</span>
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run components/ClientDate.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/ada-audit/format-date.ts lib/ada-audit/format-date.test.ts components/ClientDate.tsx components/ClientDate.test.tsx
git commit -m "feat(ada): add format-date helper + ClientDate browser-tz component"
```

---

## Task 2: Recents query — ISO timestamps + derived scores + fetchAllRecents

**Files:**
- Modify: `lib/ada-audit/recents-query.ts`
- Test: `lib/ada-audit/recents-query.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ada-audit/recents-query.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findManyAda = vi.fn()
const findManySite = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    adaAudit: { findMany: (...a: unknown[]) => findManyAda(...a) },
    siteAudit: { findMany: (...a: unknown[]) => findManySite(...a) },
  },
}))

const { fetchAllRecents } = await import('./recents-query')

beforeEach(() => { findManyAda.mockReset(); findManySite.mockReset() })

describe('fetchAllRecents', () => {
  it('returns ISO strings and derives page score from result blob', async () => {
    findManyAda.mockResolvedValue([{
      id: 'a1', createdAt: new Date('2026-05-13T00:00:00Z'),
      url: 'https://x.com', status: 'complete', wcagLevel: 'wcag21aa',
      result: JSON.stringify({ violations: [] }),
      startedAt: new Date('2026-05-13T00:00:00Z'),
      completedAt: new Date('2026-05-13T00:01:00Z'),
      client: { name: 'Acme' }, requestedBy: 'Alice',
    }])
    findManySite.mockResolvedValue([])
    const items = await fetchAllRecents(10)
    expect(items).toHaveLength(1)
    expect(typeof items[0].createdAt).toBe('string')
    expect(items[0].createdAt).toBe('2026-05-13T00:00:00.000Z')
    expect(items[0].score).toBe(100) // empty violations → perfect
    expect(items[0].requestedBy).toBe('Alice')
  })

  it('leaves score null for incomplete rows', async () => {
    findManyAda.mockResolvedValue([{
      id: 'a2', createdAt: new Date('2026-05-13T00:00:00Z'),
      url: 'https://y.com', status: 'running', wcagLevel: 'wcag21aa',
      result: null, startedAt: null, completedAt: null,
      client: null, requestedBy: null,
    }])
    findManySite.mockResolvedValue([])
    const items = await fetchAllRecents(10)
    expect(items[0].score).toBeNull()
    expect(items[0].startedAt).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ada-audit/recents-query.test.ts`
Expected: FAIL — `fetchAllRecents` not exported.

- [ ] **Step 3: Update the `RecentItem` type to ISO strings**

In `lib/ada-audit/recents-query.ts`, change the three `Date` fields on both union members to `string` (createdAt) and `string | null` (startedAt, completedAt). Add a private score-derivation helper and `fetchAllRecents`. Update `fetchRecentsForOperator` to emit ISO strings + derived scores too (it currently reads the unwritten `score` column).

```ts
import { prisma } from '@/lib/db'
import { computeScore, computeScoreFromCounts } from '@/lib/ada-audit/scoring'
import type { AxeViolation } from '@/lib/ada-audit/types'

export type RecentItem =
  | { type: 'page'; id: string; createdAt: string; url: string; status: string
      score: number | null; startedAt: string | null; completedAt: string | null
      clientName: string | null; requestedBy: string | null }
  | { type: 'site'; id: string; createdAt: string; domain: string; status: string
      score: number | null; startedAt: string | null; completedAt: string | null
      clientName: string | null; requestedBy: string | null }

function pageScore(status: string, result: string | null, wcagLevel: string): number | null {
  if (status !== 'complete' || !result) return null
  try {
    const parsed = JSON.parse(result) as { violations?: AxeViolation[] }
    return computeScore(parsed.violations ?? [], wcagLevel).score
  } catch { return null }
}

function siteScore(status: string, summary: string | null, wcagLevel: string): number | null {
  if (status !== 'complete' || !summary) return null
  try {
    const parsed = JSON.parse(summary) as { aggregate?: unknown } | null
    if (!parsed?.aggregate) return null
    return computeScoreFromCounts(parsed.aggregate as never, wcagLevel).score
  } catch { return null }
}
```

The select must now include `result` (page) / `summary` (site) and `wcagLevel`.

```ts
export async function fetchAllRecents(limit = 100, operator?: string): Promise<RecentItem[]> {
  const pageWhere = operator ? { requestedBy: operator, siteAuditId: null } : { siteAuditId: null }
  const siteWhere = operator ? { requestedBy: operator } : {}
  const [pages, sites] = await Promise.all([
    prisma.adaAudit.findMany({
      where: pageWhere, orderBy: { createdAt: 'desc' }, take: limit,
      select: {
        id: true, createdAt: true, url: true, status: true, wcagLevel: true,
        result: true, startedAt: true, completedAt: true, requestedBy: true,
        client: { select: { name: true } },
      },
    }),
    prisma.siteAudit.findMany({
      where: siteWhere, orderBy: { createdAt: 'desc' }, take: limit,
      select: {
        id: true, createdAt: true, domain: true, status: true, wcagLevel: true,
        summary: true, startedAt: true, completedAt: true, requestedBy: true,
        client: { select: { name: true } },
      },
    }),
  ])

  const items: RecentItem[] = [
    ...pages.map((p): RecentItem => ({
      type: 'page', id: p.id, createdAt: p.createdAt.toISOString(), url: p.url,
      status: p.status, score: pageScore(p.status, p.result, p.wcagLevel),
      startedAt: p.startedAt?.toISOString() ?? null,
      completedAt: p.completedAt?.toISOString() ?? null,
      clientName: p.client?.name ?? null, requestedBy: p.requestedBy,
    })),
    ...sites.map((s): RecentItem => ({
      type: 'site', id: s.id, createdAt: s.createdAt.toISOString(), domain: s.domain,
      status: s.status, score: siteScore(s.status, s.summary, s.wcagLevel),
      startedAt: s.startedAt?.toISOString() ?? null,
      completedAt: s.completedAt?.toISOString() ?? null,
      clientName: s.client?.name ?? null, requestedBy: s.requestedBy,
    })),
  ]
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return items.slice(0, limit)
}
```

Refactor `fetchRecentsForOperator(operator, limit)` to `return fetchAllRecents(limit, operator)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ada-audit/recents-query.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify `formatDuration` still accepts the new types**

`lib/ada-audit/duration.ts` `formatDuration(startedAt, completedAt)` is called with the recents fields. It now receives `string | null` instead of `Date | null`. Check its signature; if it expects `Date`, widen it to accept `string | Date | null` (parse with `new Date()` internally). Run `npx tsc --noEmit` to confirm.

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/recents-query.ts lib/ada-audit/recents-query.test.ts lib/ada-audit/duration.ts
git commit -m "feat(ada): add fetchAllRecents with ISO timestamps and derived scores"
```

---

## Task 3: /api/ada-audit/recents endpoint

**Files:**
- Create: `app/api/ada-audit/recents/route.ts`
- Test: `app/api/ada-audit/recents/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/api/ada-audit/recents/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchAllRecents = vi.fn()
vi.mock('@/lib/ada-audit/recents-query', () => ({ fetchAllRecents: (...a: unknown[]) => fetchAllRecents(...a) }))
const cookieGet = vi.fn()
vi.mock('next/headers', () => ({ cookies: async () => ({ get: cookieGet }) }))
vi.mock('@/lib/auth', () => ({
  OPERATOR_NAME_COOKIE_NAME: 'er-operator-name',
  sanitizeOperatorName: (v?: string) => (v ? v.trim() : null),
}))

const { GET } = await import('./route')
beforeEach(() => { fetchAllRecents.mockReset().mockResolvedValue([]); cookieGet.mockReset() })

function req(qs: string) { return new Request(`http://t/api/ada-audit/recents${qs}`) }

describe('GET /api/ada-audit/recents', () => {
  it('clamps limit to 1..100', async () => {
    await GET(req('?limit=9999'))
    expect(fetchAllRecents).toHaveBeenCalledWith(100, undefined)
    await GET(req('?limit=0'))
    expect(fetchAllRecents).toHaveBeenCalledWith(1, undefined)
  })
  it('scope=mine uses cookie operator, ignores any operator param', async () => {
    cookieGet.mockReturnValue({ value: 'Alice' })
    await GET(req('?scope=mine&operator=Bob&limit=10'))
    expect(fetchAllRecents).toHaveBeenCalledWith(10, 'Alice')
  })
  it('scope=mine with no cookie returns empty without querying', async () => {
    cookieGet.mockReturnValue(undefined)
    const res = await GET(req('?scope=mine'))
    expect(await res.json()).toEqual({ items: [] })
    expect(fetchAllRecents).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/ada-audit/recents/route.test.ts`
Expected: FAIL — `./route` not found.

- [ ] **Step 3: Implement the endpoint**

```ts
// app/api/ada-audit/recents/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OPERATOR_NAME_COOKIE_NAME, sanitizeOperatorName } from '@/lib/auth'
import { fetchAllRecents } from '@/lib/ada-audit/recents-query'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const scope = url.searchParams.get('scope') === 'mine' ? 'mine' : 'all'
  const rawLimit = parseInt(url.searchParams.get('limit') ?? '100', 10) || 100
  const limit = Math.min(100, Math.max(1, rawLimit))

  if (scope === 'mine') {
    const operator = sanitizeOperatorName((await cookies()).get(OPERATOR_NAME_COOKIE_NAME)?.value)
    if (!operator) return NextResponse.json({ items: [] })
    return NextResponse.json({ items: await fetchAllRecents(limit, operator) })
  }
  return NextResponse.json({ items: await fetchAllRecents(limit, undefined) })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/ada-audit/recents/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/ada-audit/recents/route.ts app/api/ada-audit/recents/route.test.ts
git commit -m "feat(ada): add /api/ada-audit/recents endpoint with limit clamp + cookie scope"
```

---

## Task 4: RecentsTable shared component

**Files:**
- Create: `components/ada-audit/RecentsTable.tsx`
- Test: `components/ada-audit/RecentsTable.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// components/ada-audit/RecentsTable.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import RecentsTable from './RecentsTable'
import type { RecentItem } from '@/lib/ada-audit/recents-query'

const item: RecentItem = {
  type: 'page', id: 'a1', createdAt: '2026-05-13T00:00:00.000Z', url: 'https://x.com',
  status: 'complete', score: 90, startedAt: '2026-05-13T00:00:00.000Z',
  completedAt: '2026-05-13T00:01:00.000Z', clientName: 'Acme', requestedBy: 'Alice',
}

describe('RecentsTable', () => {
  it('renders an Operator column with the requestedBy value', () => {
    render(<RecentsTable initialItems={[item]} initialScope="all" operator="Alice" variant="full" />)
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('Operator')).toBeTruthy()
  })
  it('home variant shows the See all footer link', () => {
    render(<RecentsTable initialItems={[item]} initialScope="mine" operator="Alice" variant="home" />)
    expect(screen.getByText(/See all recents/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/ada-audit/RecentsTable.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// components/ada-audit/RecentsTable.tsx
'use client'
import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import type { RecentItem } from '@/lib/ada-audit/recents-query'
import { ClientDate } from '@/components/ClientDate'
import { formatDuration, formatDurationHover } from '@/lib/ada-audit/duration'

type Scope = 'all' | 'mine'
interface Props {
  initialItems: RecentItem[]
  initialScope: Scope
  operator: string | null
  variant: 'home' | 'full'
}

const HOME_LIMIT = 10

export default function RecentsTable({ initialItems, initialScope, operator, variant }: Props) {
  const [items, setItems] = useState(initialItems)
  const [scope, setScope] = useState<Scope>(initialScope)
  const [loading, setLoading] = useState(false)
  const seqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const changeScope = useCallback(async (next: Scope) => {
    if (next === scope) return
    setScope(next)
    setLoading(true)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    const seq = ++seqRef.current
    const limit = variant === 'home' ? HOME_LIMIT : 100
    try {
      const res = await fetch(`/api/ada-audit/recents?scope=${next}&limit=${limit}`, { signal: ac.signal })
      const json = await res.json() as { items: RecentItem[] }
      if (seq === seqRef.current) setItems(json.items)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.warn('[RecentsTable] fetch failed:', e)
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [scope, variant])

  const rows = variant === 'home' ? items.slice(0, HOME_LIMIT) : items
  const mineDisabled = !operator

  return (
    <section className={variant === 'home' ? 'rounded-2xl border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card p-5' : ''}>
      <div className="flex items-center justify-between mb-3">
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-navy-border overflow-hidden text-[12px] font-body">
          <button type="button" onClick={() => void changeScope('all')}
            className={`px-3 py-1 ${scope === 'all' ? 'bg-orange text-white' : 'text-navy/60 dark:text-white/60'}`}>All</button>
          <button type="button" disabled={mineDisabled} onClick={() => void changeScope('mine')}
            title={mineDisabled ? 'Set your operator on the dashboard' : undefined}
            className={`px-3 py-1 ${scope === 'mine' ? 'bg-orange text-white' : 'text-navy/60 dark:text-white/60'} ${mineDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}>Mine</button>
        </div>
        {variant === 'home' && (
          <Link href="/ada-audit/recents" className="text-[12px] font-body text-orange hover:underline">See all recents →</Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-[12px] font-body text-navy/50 dark:text-white/50">{loading ? 'Loading…' : 'No recents yet.'}</p>
      ) : (
        <table className="w-full text-[13px] font-body">
          <thead>
            <tr className="border-b border-gray-200 dark:border-navy-border text-left text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">
              <th className="pb-2 pr-4">Type</th><th className="pb-2 pr-4">URL / Domain</th>
              <th className="pb-2 pr-4">Client</th><th className="pb-2 pr-4">Operator</th>
              <th className="pb-2 pr-4">Status</th><th className="pb-2 pr-4">Score</th>
              <th className="pb-2 pr-4">Duration</th><th className="pb-2 pr-4">Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it) => {
              const href = it.type === 'page' ? `/ada-audit/${it.id}` : `/ada-audit/site/${it.id}`
              const label = it.type === 'page' ? it.url : it.domain
              return (
                <tr key={`${it.type}-${it.id}`} className="border-b border-gray-100 dark:border-navy-border">
                  <td className="py-2.5 pr-4">
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${it.type === 'page' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300'}`}>{it.type}</span>
                  </td>
                  <td className="py-2.5 pr-4 max-w-[280px] truncate"><Link href={href} className="text-orange hover:underline">{label}</Link></td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">{it.clientName ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">{it.requestedBy ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">{it.status}</td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">{it.score ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-navy/40 dark:text-white/40 whitespace-nowrap" title={formatDurationHover(it.startedAt, it.completedAt) ?? ''}>{formatDuration(it.startedAt, it.completedAt) ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-navy/40 dark:text-white/40 whitespace-nowrap"><ClientDate iso={it.createdAt} variant="date" /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/ada-audit/RecentsTable.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/RecentsTable.tsx components/ada-audit/RecentsTable.test.tsx
git commit -m "feat(ada): add shared RecentsTable with scope toggle + stale-response guard"
```

---

## Task 5: Wire RecentsTable into the recents page + home, delete MyRecentsCard

**Files:**
- Modify: `app/ada-audit/recents/page.tsx`
- Modify: `components/ada-audit/AuditIndexTabs.tsx`
- Modify: `app/ada-audit/page.tsx`
- Delete: `components/ada-audit/MyRecentsCard.tsx`

- [ ] **Step 1: Rewrite the recents page (variant=full, default all)**

```tsx
// app/ada-audit/recents/page.tsx
import { cookies } from 'next/headers'
import { OPERATOR_NAME_COOKIE_NAME, sanitizeOperatorName } from '@/lib/auth'
import { fetchAllRecents } from '@/lib/ada-audit/recents-query'
import RecentsTable from '@/components/ada-audit/RecentsTable'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Recents — ADA Audit' }

export default async function RecentsPage() {
  const operator = sanitizeOperatorName((await cookies()).get(OPERATOR_NAME_COOKIE_NAME)?.value)
  const items = await fetchAllRecents(100) // scope=all
  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="font-display font-bold text-[24px] text-navy dark:text-white mb-6">Recents</h1>
      <RecentsTable initialItems={items} initialScope="all" operator={operator} variant="full" />
    </main>
  )
}
```

- [ ] **Step 2: Update the home page to provide initial scope/items**

In `app/ada-audit/page.tsx`, the home recents default to `mine` if an operator cookie exists, else `all`:

```tsx
const operator = sanitizeOperatorName((await cookies()).get(OPERATOR_NAME_COOKIE_NAME)?.value)
const initialScope = operator ? 'mine' : 'all'
const recentItems = await fetchAllRecents(10, operator ?? undefined)
```

Pass `recentItems`, `operator`, and `initialScope` into `AuditIndexTabs`.

- [ ] **Step 3: Swap MyRecentsCard for RecentsTable in AuditIndexTabs**

In `components/ada-audit/AuditIndexTabs.tsx`: remove the `MyRecentsCard` import, add `import RecentsTable from './RecentsTable'`, extend `Props` with `initialScope: 'all' | 'mine'`, and render:

```tsx
<RecentsTable initialItems={recentItems} initialScope={initialScope} operator={operator} variant="home" />
```

- [ ] **Step 4: Delete MyRecentsCard**

```bash
git rm components/ada-audit/MyRecentsCard.tsx
```

Run `npx tsc --noEmit` and grep to confirm no other references: `grep -rn MyRecentsCard components app` → no results.

- [ ] **Step 5: Manual check**

Run `npm run dev`. Visit `/ada-audit` (home card shows Mine by default if your cookie is set, All otherwise; toggle works; "See all recents →" navigates). Visit `/ada-audit/recents` (defaults to All; Mine disabled-with-tooltip when no cookie). Rapidly toggle All/Mine and confirm no stale flash.

- [ ] **Step 6: Commit**

```bash
git add app/ada-audit/recents/page.tsx app/ada-audit/page.tsx components/ada-audit/AuditIndexTabs.tsx
git commit -m "feat(ada): use RecentsTable on home + recents pages, drop MyRecentsCard"
```

---

## Task 6: Nav dropdown + mobile bug fix

**Files:**
- Modify: `components/nav.tsx` (lowercase filename)

- [ ] **Step 1: Add the ADA dropdown**

Replace the `{ name: 'ADA Audit', href: '/ada-audit' }` entry in the `tools` array:

```ts
{
  name: 'ADA Audit',
  href: '/ada-audit',
  dropdown: [
    { name: 'ADA Audit', href: '/ada-audit', description: 'Run an audit' },
    { name: 'Audit Queue', href: '/ada-audit/queue' },
    { name: 'Recents', href: '/ada-audit/recents' },
  ],
},
```

- [ ] **Step 2: Fix the mobile `V{i+1}` bug**

In the mobile drawer block (~line 288), replace `V{i + 1}` with `{item.name}`. Since the items are now meaningful names, also change `tool.dropdown.slice(1).map((item, i) => ...)` to render names directly (the slice(1) skips the leading self-link, keep that).

- [ ] **Step 3: Drop the desktop numeric badge**

In the desktop dropdown (~lines 197-208), remove the `i === 0 ? ... : (badge + name)` branch and render just `<span className="font-body">{item.name}</span>` for every item. Keep the `i === 1` divider.

- [ ] **Step 4: Manual check**

Run `npm run dev`. Desktop: hover ADA Audit → dropdown shows "ADA Audit / Audit Queue / Recents" with no numeric badges. Mobile (narrow the viewport): the drawer shows real names, not `V1`/`V2`. Click each — routes correctly. Confirm SEO Parser dropdown still reads fine.

- [ ] **Step 5: Commit**

```bash
git add components/nav.tsx
git commit -m "feat(ada): add Queue/Recents nav dropdown; fix mobile V1/V2 label bug"
```

---

## Task 7: Batch API — operator summary + nullable label

**Files:**
- Modify: `lib/ada-audit/types.ts`
- Modify: `lib/ada-audit/audit-batch-helpers.ts`
- Modify: `app/api/audit-batches/route.ts`
- Modify: `app/api/audit-batches/[id]/route.ts`
- Test: `lib/ada-audit/audit-batch-helpers.test.ts`

- [ ] **Step 1: Write the failing test for summarizeOperators**

Add `summarizeOperators` to `lib/ada-audit/audit-batch-helpers.ts` (export it) and test:

```ts
// lib/ada-audit/audit-batch-helpers.test.ts (add/extend)
import { describe, it, expect } from 'vitest'
import { summarizeOperators } from './audit-batch-helpers'

describe('summarizeOperators', () => {
  it('returns unknown for empty', () => expect(summarizeOperators([])).toBe('unknown'))
  it('returns the single operator', () =>
    expect(summarizeOperators([{ requestedBy: 'Alice' }])).toBe('Alice'))
  it('all null → unknown', () =>
    expect(summarizeOperators([{ requestedBy: null }, { requestedBy: '  ' }])).toBe('unknown'))
  it('lead by count, deterministic tie-break by name asc', () =>
    expect(summarizeOperators([
      { requestedBy: 'Bob' }, { requestedBy: 'Alice' },
    ])).toBe('Alice +1'))
  it('unknown sorts last on tie', () =>
    expect(summarizeOperators([
      { requestedBy: null }, { requestedBy: 'Alice' },
    ])).toBe('Alice +1'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ada-audit/audit-batch-helpers.test.ts`
Expected: FAIL — `summarizeOperators` not exported.

- [ ] **Step 3: Implement summarizeOperators + isCustomLabel**

```ts
// lib/ada-audit/audit-batch-helpers.ts (add)
export function summarizeOperators(siteAudits: { requestedBy: string | null }[]): string {
  const counts = new Map<string, number>()
  for (const s of siteAudits) {
    const name = s.requestedBy?.trim() || 'unknown'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    if (a[0] === 'unknown') return 1
    if (b[0] === 'unknown') return -1
    return a[0].localeCompare(b[0])
  })
  if (sorted.length === 0) return 'unknown'
  if (sorted.length === 1) return sorted[0][0]
  return `${sorted[0][0]} +${sorted.length - 1}`
}
```

Also add a tiny helper so the API can return `null` for auto-labels (replacing the place that calls `resolveBatchLabel`): `export function customLabelOrNull(batch: { label: string | null }): string | null { return batch.label?.trim() ? batch.label : null }`.

- [ ] **Step 4: Update types**

In `lib/ada-audit/types.ts`: `AuditBatchSummary` — change `label: string` → `label: string | null`, add `operatorSummary: string`. `AuditBatchDetail` — `label: string | null`. `AuditBatchMember` — add `requestedBy: string | null`.

- [ ] **Step 5: Update /api/audit-batches/route.ts**

Add `requestedBy: true` to the `siteAudits` select. In the map, set `label: customLabelOrNull(b)` and `operatorSummary: summarizeOperators(b.siteAudits)`.

- [ ] **Step 6: Update /api/audit-batches/[id]/route.ts**

Add `requestedBy` to each member object. Set `label: customLabelOrNull(batch)`. The PATCH response: when label cleared, return `{ label: null }`.

- [ ] **Step 7: Run tests + tsc**

Run: `npx vitest run lib/ada-audit/audit-batch-helpers.test.ts && npx tsc --noEmit`
Expected: PASS / no type errors.

- [ ] **Step 8: Commit**

```bash
git add lib/ada-audit/types.ts lib/ada-audit/audit-batch-helpers.ts lib/ada-audit/audit-batch-helpers.test.ts app/api/audit-batches/route.ts "app/api/audit-batches/[id]/route.ts"
git commit -m "feat(ada): batch API returns operatorSummary + nullable label"
```

---

## Task 8: QueueBatchRow — sibling expand/rename + operator + client dates

**Files:**
- Modify: `components/ada-audit/QueueBatchRow.tsx`

- [ ] **Step 1: Restructure the row into a flex container with sibling buttons**

Replace the row markup so the container is a `<div className="flex items-center gap-3 px-6 py-3">` holding:
1. An **expand button** `<button type="button" onClick={expand} aria-expanded={expanded} aria-controls={`batch-panel-${batch.id}`} className="flex-1 flex items-center gap-3 text-left min-w-0">` containing the caret, the label (or auto-label), and the metadata line.
2. A sibling **rename button** `<button type="button" aria-label="Rename batch" onClick={() => { setEditing(true); setLabelDraft(displayLabel) }} className="opacity-0 group-hover:opacity-100 text-navy/40 hover:text-orange">✎</button>` (add `group` to the container).
3. The right-aligned audit-count summary.

When `editing` is true, render the inline `<input>` in place of the label inside the expand button's label slot (the input itself is not a button, so it can live there; but to avoid nested-interactive issues, render the input as a sibling that visually replaces the label region and set the expand button to `disabled` while editing).

- [ ] **Step 2: Render label + auto-label + dates client-side**

`batch.label` is now `string | null`. Compute the display label:

```tsx
const displayLabel = labelDisplay ?? null // labelDisplay state initialized from batch.label
// in render:
{displayLabel ? displayLabel : <>Batch — <ClientDate iso={batch.startedAt} variant="dateTime" /></>}
```

Replace the local `formatTime()` calls with `<ClientDate iso={batch.startedAt} variant="dateTime" />` and `<ClientDate iso={batch.closedAt} variant="dateTime" />`. Keep the existing `formatDuration(startedAt, closedAt)`.

Append the operator to the metadata line: `· by {batch.operatorSummary}`.

- [ ] **Step 2b: Fix nullable-label state (Codex)**

`batch.label` is now `string | null`. The existing state at `QueueBatchRow.tsx:22` and the `labelDraft.trim()` at `:37` assume a non-null string. Initialize `const [labelDraft, setLabelDraft] = useState(batch.label ?? '')` and type `labelDisplay` as `string | null` (`useState<string | null>(batch.label)`). All `.trim()` calls operate on `labelDraft` (always a string) — never on `labelDisplay`.

- [ ] **Step 3: Guard Escape-then-blur from PATCHing**

Add `const escapedRef = useRef(false)`. On `Escape`: `escapedRef.current = true; setEditing(false); setLabelDraft(displayLabel ?? '')`. In `saveLabel` (the blur/Enter handler): `if (escapedRef.current) { escapedRef.current = false; return }` at the top. On `Enter`: set `escapedRef.current = false` then save.

- [ ] **Step 4: Simplify the clear-label round-trip**

Since the API now returns `label: null` for cleared labels and the client renders the auto-label itself, remove the post-clear re-fetch in `saveLabel`. After a successful PATCH with empty input, set `labelDisplay` state to `null` (which triggers the auto-label render).

- [ ] **Step 5: Add the panel id**

The expanded panel `<div>` gets `id={`batch-panel-${batch.id}`}` to match `aria-controls`.

- [ ] **Step 6: Manual check**

Run `npm run dev`, go to `/ada-audit/queue` → Past batches. Click anywhere on a row → expands (caret flips, members load). Hover → pencil appears; click pencil → rename input (row does not expand from that click). Type + Enter → saves. Open rename, press Escape, click away → no PATCH fires (check Network tab). Clear the name + Enter → reverts to auto-label in browser TZ. Operator shows after the timestamps. Tab through: expand button, then pencil.

- [ ] **Step 7: Commit**

```bash
git add components/ada-audit/QueueBatchRow.tsx
git commit -m "feat(ada): batch rows expand on click with sibling rename + inline operator"
```

---

## Task 9: Remaining date callsites → ClientDate

**Files:**
- Modify: `components/ada-audit/QueueMemberRow.tsx`
- Modify: `components/ada-audit/ClientsAuditSummary.tsx:309`
- Modify: `components/ada-audit/AuditResultsView.tsx:125`
- Modify: `components/ada-audit/SiteAuditResultsView.tsx:324`
- Modify: `lib/ada-audit/duration.ts` (hover-title formatting)
- Modify: `components/ada-audit/AuditPoller.tsx`, `components/ada-audit/SiteAuditPoller.tsx` (visible timestamps, if any)
- Modify: `app/ada-audit/[id]/page.tsx` and the site detail header (if they render created/started dates)
- Investigate: `components/ada-audit/AuditHistory.tsx`, `components/ada-audit/SiteAuditHistory.tsx`

- [ ] **Step 1: QueueMemberRow + the three blob callsites**

Replace each `new Date(x).toLocaleString()` / `.toLocaleDateString()` with `<ClientDate iso={x} variant="dateTime" />` (or `variant="date"` where only a date was shown). These callsites already have ISO strings from the APIs — confirm the prop is a string; if it's a `Date`, call `.toISOString()` first.

- [ ] **Step 2: duration.ts hover title**

`formatDurationHover` returns a string used in a `title=` attribute. Change its internal date formatting to import `formatInBrowserTZ` from `@/lib/ada-audit/format-date` (the non-client module created in Task 1 — **not** from `@/components/ClientDate`, which is `'use client'`). `duration.ts` is imported by the server component `app/ada-audit/recents/page.tsx` (verified), so the import must stay server-safe. No `'use client'` leaks this way.

- [ ] **Step 3: Detail headers + pollers**

Grep `grep -rn "toLocaleString\|toLocaleDateString" app/ada-audit components/ada-audit` and swap any remaining user-visible audit timestamps. Leave `<title>`/metadata server-side.

- [ ] **Step 4: AuditHistory / SiteAuditHistory dead-code check**

Run `grep -rn "AuditHistory\|SiteAuditHistory" app components | grep -v "Queue\|test\|//"`. If they are only referenced in comments (no JSX/import), `git rm` both files. If reachable, swap their date cells like Step 1.

- [ ] **Step 5: tsc + manual**

Run `npx tsc --noEmit`. Then `npm run dev`: change your OS timezone (or use browser devtools sensors → location/timezone override), reload an audit detail page and the queue, confirm timestamps shift. Test a timestamp near midnight UTC.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ada): render remaining audit timestamps in browser timezone"
```

---

## Task 10: Full type-check, build, and lint

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run the full unit suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds (catches RSC/client-boundary issues, e.g. importing a `'use client'` helper into a server component — see Task 9 Step 2).

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore(ada): type-check + build fixes for UX bundle"
```

---

## Self-Review Notes

- **Spec coverage:** Nav dropdown (T6) + mobile bug (T6), recents-all + Mine toggle (T2/T3/T4/T5), home consistency via shared RecentsTable (T4/T5), batch expand + pencil + operator (T7/T8), client-side TZ incl. all Codex callsites + batch label (T1/T8/T9). Score-derivation fix (T2). Endpoint hardening (T3). Operator determinism (T7).
- **Type consistency:** `RecentItem` ISO strings flow through T2→T3→T4. `AuditBatchSummary.operatorSummary` / `label: string | null` defined T7, consumed T8 (nullable-label state fixed in T8 Step 2b). `formatInBrowserTZ` lives in non-client `lib/ada-audit/format-date.ts` (T1), re-exported by `ClientDate.tsx`, and imported server-safely by `duration.ts` (T9 Step 2).
- **Test infra:** `.test.tsx` files require the T0 vitest/tsconfig changes and a `// @vitest-environment jsdom` header (ClientDate, RecentsTable tests).
- **Placeholder scan:** none.
- **Casing:** the nav file is `components/nav.tsx` (lowercase) — all references use that.
