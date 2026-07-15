# Prospect Scans Dashboard UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 2026-07-14 Prospect Scans Dashboard UX spec (`docs/superpowers/specs/2026-07-14-prospect-scans-dashboard-ux-design.md`): a real per-prospect progress bar with phase label + ETA on `/sales`, whole-card click-through to the public sales report in a new tab, and prospect scans jumping to the front of the site-audit queue — including all Codex fixes: ONE shared total queue ordering used by all four readers, `Job.priority = 1` on prospect discover jobs, `pagesRedirected` in the settled-pages math, phase-aware weight redistribution that never moves backward, `startedAt`-based hydration-safe ETA, nested-interactive-control-safe card activation with `opener = null` + popup-block fallback, and a shared sales-URL builder.

**Architecture:**
- `lib/ada-audit/queue-order.ts` (NEW) — the ONE home of the queue's total ordering `(prospect-owned first, createdAt ASC, id ASC)`: pure comparator `compareQueuedAudits`, promoter pick `findNextQueuedAudit()` (two cheap `findFirst`s), position count `queuedAheadCount()`, and the `PROSPECT_DISCOVER_PRIORITY = 1` constant. Imports **only** `@/lib/db`. It lives here (not inside `queue-manager.ts`) because two of the four readers — `listProspects()` and `GET /api/site-audit/[id]` — must import it, and importing `queue-manager` would drag its static graph (finalizer → findings writer → broken-link-verify handler chain) into the prospects service and every one of its tests. This is exactly the "tiny `lib/ada-audit/queue-order.ts` if import cycles demand" branch the spec allows.
- Four readers adopt it: `processNext()` (also stamps the discover-job priority), `getQueueStatus()` (JS-sorts the queued list with the comparator), `listProspects()` (`queuePosition`), `GET /api/site-audit/[id]` (queue-position count).
- `buildProspectSalesUrl(token)` moves into `lib/services/prospects.ts` (single home); the share route imports it. Import direction: route → service, no cycle (`prospects.ts` gains no new heavy imports; the dashboard component only ever does `import type` from it, which is erased at compile).
- `components/sales/intake/progress-math.ts` (NEW) — pure, client-safe, zero-import progress + ETA math (`computeAuditProgress`, `computeEtaLabel`), heavily unit-tested; the component stays thin.
- `ProspectDashboard.tsx` — restructured card rows: `role="link"` clickable region with `closest()` guard, progress block, 1 s post-mount ETA tick. Poll/SSE cadence untouched.
- Precedent note: `components/ada-audit/SiteAuditPoller.tsx` was checked for a progress-weighting precedent — it has **none** (it renders a pages-only percent, `(pagesComplete + pagesError) / pagesTotal`, and switches to raw PDF/LH counts per phase; it does not even count `pagesRedirected`). The weighted math here is new and deliberately lives in its own pure module.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind (class dark mode), Prisma + SQLite, vitest (DB-backed service tests against the local dev SQLite; jsdom component tests), durable job queue (`Job.priority` exists; worker claims `orderBy [{priority:'desc'},{createdAt:'asc'}]` — verified at `lib/jobs/worker.ts:96`; `EnqueueJobOptions.priority` exists at `lib/jobs/types.ts:57` and `enqueueJob` applies `opts.priority ?? 0` at `lib/jobs/queue.ts:25`).

## Global Constraints

- **Local gates only:** `npx tsc --noEmit` + `npx vitest run` are the ONLY type/test gates (in-build checks are disabled on the server). Never merge without both green.
- **NO schema change.** `SiteAudit.startedAt DateTime?` (schema line 180) and `pagesRedirected Int @default(0)` (line 182) already exist; `Job.priority Int @default(0)` (line 364) already exists. No migration in this PR.
- **Array-form `$transaction` only** (no interactive transactions) — this PR needs none; do not add any.
- **No preemption:** `Job.priority` affects which **unclaimed** job the worker picks. Never touch the discover handler's conditional claim, recovery, or the one-active-audit invariant.
- **Share URLs use `NEXT_PUBLIC_APP_URL`** (never request origin) — the shared builder keeps the existing `|| 'http://localhost:3000'` fallback byte-identical.
- **Poll cadence unchanged:** the ProspectDashboard's health-gated 8 s / 60 s bounded poll and `prospect-list` SSE subscription stay exactly as they are. The 1 s ETA tick is a local render tick only — no new fetches.
- **Settled-pages semantics** must match the finalizer exactly: `pagesComplete + pagesError + pagesRedirected >= pagesTotal` (`lib/ada-audit/site-audit-finalizer.ts:55`).
- **Branch:** `feat/prospect-dashboard-ux` off `main`.
- **Commits:** end every commit message with the house trailers:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and the `Claude-Session:` line for the executing session.
- **DB-backed test hygiene:** tests run against the shared local dev DB. Prefix all seeded domains, clean up in `beforeEach`/`afterAll`, and neutralize stray queued/transient rows exactly the way `lib/ada-audit/queue-manager.test.ts` `clearTestState()` does — position assertions are meaningless otherwise.

**Spec-vs-code contradictions found (resolved in this plan, flagged for the record):**
1. The existing `ProspectDashboard.test.tsx` asserts the text "Report building…" (`/report building/i`); the spec's state is "Building report…". This plan adopts the spec wording and updates the assertion (Task 6).
2. `tsconfig.json` excludes `**/*.test.ts` AND `**/*.test.tsx`, so `tsc --noEmit` will NOT flag the stale `ProspectRow` fixtures in the component test — they are updated by hand in Task 6 (they'd fail at runtime otherwise).
3. Prisma cannot express "prospectId != null first, then createdAt" in a single `orderBy` without value-ordering by `prospectId` (which would break FIFO among prospects). The spec anticipated this ("two cheap `findFirst`s"); the count/comparator forms in `queue-order.ts` are the equivalent for the other readers.
4. Spec §1 says "One extra indexed count query for queued rows" — for a **non-prospect** queued audit the shared ordering needs two counts (all queued prospect-owned + earlier non-prospect). `listProspects` only ever computes positions for prospect-owned audits (one count each), so the spec's cost claim holds where it applies; the two-count branch exists only for `GET /api/site-audit/[id]` on client/scheduled audits.

---

## Task 1 — Shared queue-ordering helper + `processNext` adoption + prospect discover priority

**Files:**
- Create: `lib/ada-audit/queue-order.ts`
- Create: `lib/ada-audit/queue-order.test.ts`
- Modify: `lib/ada-audit/queue-manager.ts` (import block line 28; `processNext()` lines 54–66)
- Modify: `lib/ada-audit/queue-manager.test.ts` (append a new `describe`)

**Interfaces:**
```ts
// lib/ada-audit/queue-order.ts
export const PROSPECT_DISCOVER_PRIORITY = 1
export interface QueueOrderKey { id: string; createdAt: Date; prospectId: number | null }
export function compareQueuedAudits(a: QueueOrderKey, b: QueueOrderKey): number
export function findNextQueuedAudit(): Promise<{ id: string; prospectId: number | null } | null>
export function queuedAheadCount(audit: QueueOrderKey): Promise<number>
```

### Steps

- [ ] **1.1 Write the failing test file** `lib/ada-audit/queue-order.test.ts`:

```ts
// lib/ada-audit/queue-order.test.ts
// DB-backed against the local SQLite dev DB. House convention (copied from
// queue-manager.test.ts): PREFIX-scoped seeds + stray queued/transient
// neutralization, because position math over a shared DB is otherwise flaky.
import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import {
  PROSPECT_DISCOVER_PRIORITY,
  compareQueuedAudits,
  findNextQueuedAudit,
  queuedAheadCount,
} from './queue-order'

const PREFIX = 'pr3-order-'

async function clearTestState() {
  const prospects = await prisma.prospect.findMany({
    where: { domain: { startsWith: PREFIX } },
    select: { id: true },
  })
  await prisma.siteAudit.deleteMany({
    where: {
      OR: [
        { domain: { startsWith: PREFIX } },
        { prospectId: { in: prospects.map((p) => p.id) } },
      ],
    },
  })
  await prisma.prospect.deleteMany({ where: { id: { in: prospects.map((p) => p.id) } } })
  // Neutralize stray rows from other test files in the shared dev DB —
  // findNextQueuedAudit/queuedAheadCount scan ALL queued rows.
  await prisma.siteAudit.updateMany({
    where: { status: { in: ['running', 'pdfs-running', 'lighthouse-running'] } },
    data: { status: 'error', error: 'neutralized by queue-order.test.ts (one-active invariant)' },
  })
  await prisma.siteAudit.updateMany({
    where: { status: 'queued' },
    data: { status: 'cancelled' },
  })
}

async function seedQueued(name: string, opts: { prospectId?: number | null; createdAt?: Date } = {}) {
  return prisma.siteAudit.create({
    data: {
      domain: `${PREFIX}${name}`,
      status: 'queued',
      wcagLevel: 'wcag21aa',
      prospectId: opts.prospectId ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  })
}

async function seedProspect(name: string) {
  return prisma.prospect.create({ data: { name, domain: `${PREFIX}${name}.test` } })
}

describe('compareQueuedAudits — pure comparator', () => {
  const at = (ms: number) => new Date(ms)

  it('ranks prospect-owned ahead of non-prospect regardless of createdAt', () => {
    const prospect = { id: 'b', createdAt: at(2000), prospectId: 7 }
    const older = { id: 'a', createdAt: at(1000), prospectId: null }
    expect(compareQueuedAudits(prospect, older)).toBeLessThan(0)
    expect(compareQueuedAudits(older, prospect)).toBeGreaterThan(0)
  })

  it('within a class, orders by createdAt ASC then id ASC', () => {
    const a = { id: 'a', createdAt: at(1000), prospectId: null }
    const b = { id: 'b', createdAt: at(2000), prospectId: null }
    const tieA = { id: 'a', createdAt: at(1000), prospectId: 3 }
    const tieB = { id: 'b', createdAt: at(1000), prospectId: 4 }
    expect(compareQueuedAudits(a, b)).toBeLessThan(0)
    expect(compareQueuedAudits(tieA, tieB)).toBeLessThan(0)
    expect(compareQueuedAudits(tieA, tieA)).toBe(0)
  })
})

describe('findNextQueuedAudit', () => {
  beforeEach(clearTestState)

  it('returns null when nothing is queued', async () => {
    expect(await findNextQueuedAudit()).toBeNull()
  })

  it('picks a newer prospect-owned audit over an older non-prospect one', async () => {
    await seedQueued('older-client', { createdAt: new Date(Date.now() - 60_000) })
    const prospect = await seedProspect('next')
    const pAudit = await seedQueued('prospect', { prospectId: prospect.id })
    const next = await findNextQueuedAudit()
    expect(next?.id).toBe(pAudit.id)
    expect(next?.prospectId).toBe(prospect.id)
  })

  it('falls back to the oldest non-prospect audit when no prospect scan is queued', async () => {
    const older = await seedQueued('older', { createdAt: new Date(Date.now() - 60_000) })
    await seedQueued('newer')
    const next = await findNextQueuedAudit()
    expect(next?.id).toBe(older.id)
    expect(next?.prospectId).toBeNull()
  })
})

describe('queuedAheadCount — agrees with the comparator', () => {
  beforeEach(clearTestState)

  it('position (aheadCount + 1) matches the comparator-sorted index for a mixed queue', async () => {
    const now = Date.now()
    const p1 = await seedProspect('p1')
    const p2 = await seedProspect('p2')
    const rows = [
      await seedQueued('client-old', { createdAt: new Date(now - 300_000) }),
      await seedQueued('prospect-late', { prospectId: p2.id, createdAt: new Date(now - 50_000) }),
      await seedQueued('client-new', { createdAt: new Date(now - 100_000) }),
      await seedQueued('prospect-early', { prospectId: p1.id, createdAt: new Date(now - 200_000) }),
    ]
    const sorted = [...rows].sort(compareQueuedAudits)
    // Expected total order: prospect-early, prospect-late, client-old, client-new.
    expect(sorted.map((r) => r.domain)).toEqual([
      `${PREFIX}prospect-early`,
      `${PREFIX}prospect-late`,
      `${PREFIX}client-old`,
      `${PREFIX}client-new`,
    ])
    for (const [index, row] of sorted.entries()) {
      expect(await queuedAheadCount(row)).toBe(index)
    }
  })

  it('only counts queued rows (running/complete rows never rank ahead)', async () => {
    const target = await seedQueued('only-queued')
    await prisma.siteAudit.create({
      data: { domain: `${PREFIX}done`, status: 'complete', wcagLevel: 'wcag21aa', createdAt: new Date(Date.now() - 60_000) },
    })
    expect(await queuedAheadCount(target)).toBe(0)
  })
})

describe('PROSPECT_DISCOVER_PRIORITY', () => {
  it('is 1 (default Job.priority is 0 — higher claims first)', () => {
    expect(PROSPECT_DISCOVER_PRIORITY).toBe(1)
  })
})
```

- [ ] **1.2 Run it — expect FAIL** (module does not exist):
```
npx vitest run lib/ada-audit/queue-order.test.ts
```
Expected: FAIL — `Error: Failed to resolve import "./queue-order"` (or `Cannot find module`).

- [ ] **1.3 Create** `lib/ada-audit/queue-order.ts` (complete file):

```ts
// lib/ada-audit/queue-order.ts
//
// ONE home for the site-audit queue's total ordering (PR3, Codex fix 1):
//
//   prospect-owned first, then createdAt ASC, then id ASC.
//
// Reused by ALL FOUR readers — processNext()'s selection, getQueueStatus()'s
// queued list, listProspects()'s queuePosition, and GET /api/site-audit/[id]'s
// queue-position count. Never re-derive this ordering inline anywhere else.
//
// Lives outside queue-manager.ts on purpose: listProspects and the site-audit
// detail route need it, and queue-manager's static import graph pulls the
// finalizer → findings → broken-link-verify handler chain. This module
// imports ONLY the Prisma client.
//
// Job.priority companion (Codex fix 2): selection order alone cannot win when
// an older non-prospect discover job is ALREADY enqueued but unclaimed (both
// audits still queued, two discover jobs pending — the worker would claim the
// older one first). Prospect discover jobs are enqueued with
// PROSPECT_DISCOVER_PRIORITY; the worker claims by
// [{priority:'desc'},{createdAt:'asc'}] (lib/jobs/worker.ts claimNext).
// No preemption — priority only affects which UNCLAIMED job is picked.

import { prisma } from '@/lib/db'

/** Job.priority for a prospect-owned audit's site-audit-discover job. Everything else stays at the default 0. */
export const PROSPECT_DISCOVER_PRIORITY = 1

export interface QueueOrderKey {
  id: string
  createdAt: Date
  prospectId: number | null
}

/** Pure comparator implementing the shared total ordering (used to JS-sort small queued lists). */
export function compareQueuedAudits(a: QueueOrderKey, b: QueueOrderKey): number {
  const aProspect = a.prospectId !== null
  const bProspect = b.prospectId !== null
  if (aProspect !== bProspect) return aProspect ? -1 : 1
  const t = a.createdAt.getTime() - b.createdAt.getTime()
  if (t !== 0) return t
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * The promoter's pick under the shared ordering: first queued prospect-owned
 * audit (FIFO among prospects), else the oldest queued audit. Two cheap
 * findFirsts against the status index — the queued set is tiny, and Prisma
 * cannot express "non-null first, then createdAt" in one orderBy without
 * value-ordering by prospectId (which would break prospect FIFO).
 */
export async function findNextQueuedAudit(): Promise<{ id: string; prospectId: number | null } | null> {
  const prospectNext = await prisma.siteAudit.findFirst({
    where: { status: 'queued', prospectId: { not: null } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, prospectId: true },
  })
  if (prospectNext) return prospectNext
  return prisma.siteAudit.findFirst({
    where: { status: 'queued' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, prospectId: true },
  })
}

/**
 * How many queued audits rank AHEAD of `audit` under the shared ordering.
 * Position = queuedAheadCount(audit) + 1. `audit` itself must be queued.
 */
export async function queuedAheadCount(audit: QueueOrderKey): Promise<number> {
  const earlier = {
    OR: [
      { createdAt: { lt: audit.createdAt } },
      { createdAt: audit.createdAt, id: { lt: audit.id } },
    ],
  }
  if (audit.prospectId !== null) {
    // Only earlier prospect-owned audits rank ahead of a prospect-owned one.
    return prisma.siteAudit.count({
      where: { status: 'queued', prospectId: { not: null }, ...earlier },
    })
  }
  // ALL queued prospect-owned audits + earlier non-prospect ones rank ahead.
  const [prospectQueued, earlierNonProspect] = await Promise.all([
    prisma.siteAudit.count({ where: { status: 'queued', prospectId: { not: null } } }),
    prisma.siteAudit.count({ where: { status: 'queued', prospectId: null, ...earlier } }),
  ])
  return prospectQueued + earlierNonProspect
}
```

- [ ] **1.4 Run — expect PASS:**
```
npx vitest run lib/ada-audit/queue-order.test.ts
```
Expected: PASS — 8 tests.

- [ ] **1.5 Append the failing promoter tests** to `lib/ada-audit/queue-manager.test.ts` (bottom of the file; `seedSite`, `discoverJobsFor`, `clearTestState`, `PREFIX`, `prisma`, `processNext` are already in scope):

```ts
describe('processNext — prospect priority (PR3)', () => {
  beforeEach(async () => {
    await clearTestState()
  })

  it('promotes a prospect-owned queued audit over an older non-prospect one, at priority 1', async () => {
    const older = await seedSite('prio-client', 'queued', { createdAt: new Date(Date.now() - 60_000) })
    const prospect = await prisma.prospect.create({ data: { name: 'Prio', domain: `${PREFIX}prio.test` } })
    const pAudit = await seedSite('prio-prospect', 'queued', { prospectId: prospect.id })
    await processNext()
    expect(await discoverJobsFor(older.id)).toHaveLength(0)
    const jobs = await discoverJobsFor(pAudit.id)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].priority).toBe(1)
  })

  it('non-prospect discover jobs keep the default priority 0', async () => {
    const site = await seedSite('prio-plain', 'queued')
    await processNext()
    const jobs = await discoverJobsFor(site.id)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].priority).toBe(0)
  })

  it('Codex race: an already-enqueued non-prospect discover job is out-claimed by the later prospect job', async () => {
    // Step 1: a non-prospect audit is queued and ALREADY has an unclaimed
    // discover job (promoter ran while the queue was otherwise idle).
    const older = await seedSite('race-client', 'queued', { createdAt: new Date(Date.now() - 60_000) })
    await processNext()
    expect(await discoverJobsFor(older.id)).toHaveLength(1)

    // Step 2: a prospect scan is enqueued AFTER. Nothing is transient yet
    // (the older discover job is unclaimed), so the promoter runs again and
    // enqueues a SECOND discover job — the prospect's, at higher priority.
    const prospect = await prisma.prospect.create({ data: { name: 'Race', domain: `${PREFIX}race.test` } })
    const pAudit = await seedSite('race-prospect', 'queued', { prospectId: prospect.id })
    await processNext()
    expect(await discoverJobsFor(pAudit.id)).toHaveLength(1)

    // Step 3: replicate the worker's claim pick (lib/jobs/worker.ts claimNext:
    // orderBy [{priority:'desc'},{createdAt:'asc'}]) scoped to our two jobs —
    // the prospect's newer-but-higher-priority job must win.
    const nextClaim = await prisma.job.findFirst({
      where: {
        type: 'site-audit-discover',
        status: 'queued',
        groupKey: { in: [`site-audit:${older.id}`, `site-audit:${pAudit.id}`] },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    })
    expect(nextClaim?.groupKey).toBe(`site-audit:${pAudit.id}`)
  })
})
```

- [ ] **1.6 Run — expect FAIL** (promoter still picks the oldest queued row; priority never set):
```
npx vitest run lib/ada-audit/queue-manager.test.ts
```
Expected: 3 new tests FAIL — first: `expected [ …1 job… ] to have a length of 0` (discover enqueued for the older client audit); priority assertions fail with `expected 0 to be 1`. All pre-existing tests still pass.

- [ ] **1.7 Modify `lib/ada-audit/queue-manager.ts`.** Two edits.

Edit A — add the import. Existing line 28:
```ts
import { cancelJobsByGroup, countActiveJobsByGroup, enqueueJob } from '@/lib/jobs/queue'
```
becomes:
```ts
import { cancelJobsByGroup, countActiveJobsByGroup, enqueueJob } from '@/lib/jobs/queue'
import { findNextQueuedAudit, PROSPECT_DISCOVER_PRIORITY } from './queue-order'
```

Edit B — `processNext()` selection + priority. Existing lines 54–66:
```ts
    const next = await prisma.siteAudit.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (!next) return

    await enqueueJob({
      type: 'site-audit-discover',
      payload: { siteAuditId: next.id },
      dedupKey: `discover:${next.id}`,
      groupKey: `site-audit:${next.id}`,
    })
```
becomes:
```ts
    // PR3: shared total ordering (lib/ada-audit/queue-order.ts) — prospect
    // scans jump the queued line; a running audit always finishes first.
    const next = await findNextQueuedAudit()
    if (!next) return

    await enqueueJob({
      type: 'site-audit-discover',
      payload: { siteAuditId: next.id },
      dedupKey: `discover:${next.id}`,
      groupKey: `site-audit:${next.id}`,
      // Codex fix 2: beat an already-enqueued (unclaimed) non-prospect
      // discover job at the worker's [{priority:'desc'},{createdAt:'asc'}]
      // claim. Unclaimed jobs only — never a preemption.
      priority: next.prospectId !== null ? PROSPECT_DISCOVER_PRIORITY : 0,
    })
```
Also update the `processNext` doc comment (lines 39–45): replace the phrase `enqueue a discover job for the oldest queued audit` with `enqueue a discover job for the first queued audit under the shared queue-order.ts total ordering (prospect-owned first, then createdAt, then id)`. The "both pick the SAME oldest row" sentence stays true (the ordering is total and deterministic) — reword `oldest` to `first-ranked`.

- [ ] **1.8 Run — expect PASS:**
```
npx vitest run lib/ada-audit/queue-order.test.ts lib/ada-audit/queue-manager.test.ts
```
Expected: PASS — all tests in both files (8 + existing 22 + 3 new).

- [ ] **1.9 Commit:**
```
git add lib/ada-audit/queue-order.ts lib/ada-audit/queue-order.test.ts lib/ada-audit/queue-manager.ts lib/ada-audit/queue-manager.test.ts
git commit -m "feat(sales): shared queue total ordering + prospect discover-job priority

One home for (prospect-first, createdAt, id) in lib/ada-audit/queue-order.ts;
processNext adopts it and stamps Job.priority=1 on prospect discover jobs so
an already-enqueued unclaimed non-prospect discover job is out-claimed
(worker orders by priority desc). No preemption; no claim-logic change."
```

---

## Task 2 — `getQueueStatus()` + `GET /api/site-audit/[id]` adopt the shared ordering

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts` (`getQueueStatus()` lines 182–186)
- Modify: `app/api/site-audit/[id]/route.ts` (imports line ~12; queue-position block lines 65–72)
- Modify: `lib/ada-audit/queue-manager.test.ts` (append)
- Create: `app/api/site-audit/id-route.queue-position.test.ts`

**Interfaces:** none new — `getQueueStatus(): Promise<QueueStatusWithBatch>` and the route response shape (`queuePosition: number | null`) are unchanged; only the ordering/counting behind them changes.

### Steps

- [ ] **2.1 Append the failing `getQueueStatus` test** to `lib/ada-audit/queue-manager.test.ts` (add `getQueueStatus` to the existing queue-manager import on line 23):

```ts
const { processNext, recoverQueue, resetStaleAudits, failSiteAudit, getQueueStatus } = await import('./queue-manager')
```

```ts
describe('getQueueStatus — shared ordering (PR3)', () => {
  beforeEach(async () => {
    await clearTestState()
  })

  it('lists queued prospect-owned audits first, then non-prospect FIFO, positions 1..n', async () => {
    const now = Date.now()
    const older = await seedSite('gs-older', 'queued', { createdAt: new Date(now - 120_000) })
    const mid = await seedSite('gs-mid', 'queued', { createdAt: new Date(now - 60_000) })
    const prospect = await prisma.prospect.create({ data: { name: 'GS', domain: `${PREFIX}gs.test` } })
    const pAudit = await seedSite('gs-prospect', 'queued', { prospectId: prospect.id }) // newest row
    const status = await getQueueStatus()
    expect(status.queued.map((q) => q.id)).toEqual([pAudit.id, older.id, mid.id])
    expect(status.queued.map((q) => q.position)).toEqual([1, 2, 3])
  })
})
```

- [ ] **2.2 Run — expect FAIL:**
```
npx vitest run lib/ada-audit/queue-manager.test.ts
```
Expected: the new test FAILS — `expected [older.id, mid.id, pAudit.id] to deeply equal [pAudit.id, older.id, mid.id]` (current code orders by `createdAt` only).

- [ ] **2.3 Modify `getQueueStatus()`** in `lib/ada-audit/queue-manager.ts`. Existing lines 182–186:
```ts
  const queuedRows = await prisma.siteAudit.findMany({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, domain: true, clientId: true, seoOnly: true },
  })
```
becomes:
```ts
  // PR3: the queued list renders in the SAME total order the promoter will
  // drain it (queue-order.ts) — prospect-owned first, then createdAt, id.
  // JS sort: the queued set is tiny and Prisma can't order by "non-null
  // first" without value-ordering prospectId.
  const queuedRows = (
    await prisma.siteAudit.findMany({
      where: { status: 'queued' },
      select: { id: true, domain: true, clientId: true, seoOnly: true, prospectId: true, createdAt: true },
    })
  ).sort(compareQueuedAudits)
```
and extend the Task 1 import line:
```ts
import { compareQueuedAudits, findNextQueuedAudit, PROSPECT_DISCOVER_PRIORITY } from './queue-order'
```
The `queued: queuedRows.map((q, i) => ({ … position: i + 1 … }))` mapping (lines 213–219) is untouched — the extra selected fields are simply not copied into the response, so `QueueStatusWithBatch` needs no type change.

- [ ] **2.4 Write the failing route test** `app/api/site-audit/id-route.queue-position.test.ts` (sits beside the `[id]` directory — same placement convention as `app/api/sales/prospects/scan-route.test.ts`):

```ts
// app/api/site-audit/id-route.queue-position.test.ts
// PR3: GET /api/site-audit/[id] must report queuePosition under the SAME
// shared total ordering as processNext/getQueueStatus (queue-order.ts) —
// previously it counted all older queued audits by createdAt alone.
import { beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET } from './[id]/route'

const PREFIX = 'pr3-route-'

async function clearTestState() {
  const prospects = await prisma.prospect.findMany({
    where: { domain: { startsWith: PREFIX } },
    select: { id: true },
  })
  await prisma.siteAudit.deleteMany({
    where: {
      OR: [
        { domain: { startsWith: PREFIX } },
        { prospectId: { in: prospects.map((p) => p.id) } },
      ],
    },
  })
  await prisma.prospect.deleteMany({ where: { id: { in: prospects.map((p) => p.id) } } })
  await prisma.siteAudit.updateMany({
    where: { status: { in: ['running', 'pdfs-running', 'lighthouse-running'] } },
    data: { status: 'error', error: 'neutralized by id-route.queue-position.test.ts' },
  })
  await prisma.siteAudit.updateMany({ where: { status: 'queued' }, data: { status: 'cancelled' } })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const req = (id: string) => new NextRequest(`http://localhost:3000/api/site-audit/${id}`)

describe('GET /api/site-audit/[id] — queuePosition under the shared ordering (PR3)', () => {
  beforeEach(clearTestState)

  it('a newer prospect-owned queued audit is position 1; the older non-prospect audit is position 2', async () => {
    const older = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}older`, status: 'queued', wcagLevel: 'wcag21aa', createdAt: new Date(Date.now() - 60_000) },
    })
    const prospect = await prisma.prospect.create({ data: { name: 'RT', domain: `${PREFIX}rt.test` } })
    const pAudit = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}prospect`, status: 'queued', wcagLevel: 'wcag21aa', prospectId: prospect.id },
    })

    const rp = await GET(req(pAudit.id), params(pAudit.id))
    expect(rp.status).toBe(200)
    expect((await rp.json()).queuePosition).toBe(1)

    const ro = await GET(req(older.id), params(older.id))
    expect((await ro.json()).queuePosition).toBe(2)
  })

  it('non-queued audits report queuePosition null (unchanged behavior)', async () => {
    const done = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}done`, status: 'error', error: 'x', wcagLevel: 'wcag21aa' },
    })
    const r = await GET(req(done.id), params(done.id))
    expect((await r.json()).queuePosition).toBeNull()
  })
})
```

- [ ] **2.5 Run — expect FAIL:**
```
npx vitest run app/api/site-audit/id-route.queue-position.test.ts
```
Expected: first test FAILS — the older audit reports `queuePosition: 1` (old `createdAt`-only count) where 2 is expected, and the prospect audit reports 2 where 1 is expected. Second test passes.

- [ ] **2.6 Modify `app/api/site-audit/[id]/route.ts`.** Add the import after line 12:
```ts
import { queuedAheadCount } from '@/lib/ada-audit/queue-order'
```
Existing lines 65–72:
```ts
  // If queued, calculate position
  let queuePosition: number | null = null
  if (audit.status === 'queued') {
    const ahead = await prisma.siteAudit.count({
      where: { status: 'queued', createdAt: { lt: audit.createdAt } },
    })
    queuePosition = ahead + 1
  }
```
becomes:
```ts
  // If queued, calculate position under the shared total ordering (PR3:
  // prospect-owned first, then createdAt, id — queue-order.ts, the same
  // ordering processNext drains and getQueueStatus displays).
  let queuePosition: number | null = null
  if (audit.status === 'queued') {
    queuePosition = (await queuedAheadCount(audit)) + 1
  }
```
(`audit` comes from `findUnique` with `include`, so every scalar — `id`, `createdAt`, `prospectId` — is present and satisfies `QueueOrderKey`.)

- [ ] **2.7 Run — expect PASS:**
```
npx vitest run app/api/site-audit/id-route.queue-position.test.ts lib/ada-audit/queue-manager.test.ts
```
Expected: PASS — all tests.

- [ ] **2.8 Commit:**
```
git add lib/ada-audit/queue-manager.ts lib/ada-audit/queue-manager.test.ts app/api/site-audit/id-route.queue-position.test.ts app/api/site-audit/[id]/route.ts
git commit -m "feat(sales): getQueueStatus + site-audit queue-position adopt the shared ordering

All four queue readers now agree: promoter selection, queued-list positions,
and GET /api/site-audit/[id] queuePosition all derive from queue-order.ts."
```

---

## Task 3 — Shared sales-URL builder (extract from the share route)

**Files:**
- Modify: `lib/services/prospects.ts` (add export)
- Modify: `app/api/sales/prospects/[id]/share/route.ts` (lines 11–14 delete local builder; call sites lines 39, 55)
- Modify: `lib/services/prospects.test.ts` (append)

**Interfaces:**
```ts
// lib/services/prospects.ts
export function buildProspectSalesUrl(token: string): string
```

### Steps

- [ ] **3.1 Append the failing tests** to `lib/services/prospects.test.ts` (add `vi` to the vitest import and `buildProspectSalesUrl` to the service import):

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
```
```ts
import { buildProspectSalesUrl, createProspect, listProspects, normalizeProspectDomain } from './prospects'
```
```ts
describe('buildProspectSalesUrl — the ONE sales-URL home (Codex fix 5)', () => {
  it('builds from NEXT_PUBLIC_APP_URL in the exact share-route format', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tools.example.com')
    expect(buildProspectSalesUrl('tok-abc')).toBe('https://tools.example.com/sales/tok-abc')
    vi.unstubAllEnvs()
  })

  it('falls back to localhost when the env var is unset/empty (previous route behavior, byte-identical)', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    expect(buildProspectSalesUrl('tok-abc')).toBe('http://localhost:3000/sales/tok-abc')
    vi.unstubAllEnvs()
  })
})
```

- [ ] **3.2 Run — expect FAIL:**
```
npx vitest run lib/services/prospects.test.ts
```
Expected: FAIL — `buildProspectSalesUrl` is not exported (`SyntaxError: The requested module './prospects' does not provide an export named 'buildProspectSalesUrl'`).

- [ ] **3.3 Add the builder** to `lib/services/prospects.ts`, directly below `normalizeProspectDomain` (after line 14):

```ts
/**
 * ONE home for the public sales-report URL (PR3, Codex fix 5) — the share
 * route and listProspects build from here so the two can never drift.
 * NEXT_PUBLIC_APP_URL, never request origin (house rule); the localhost
 * fallback is byte-identical to the share route's previous local copy.
 */
export function buildProspectSalesUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${base}/sales/${token}`
}
```

- [ ] **3.4 Refactor the share route** `app/api/sales/prospects/[id]/share/route.ts`. Existing lines 11–14:
```ts
function buildSalesUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${base}/sales/${token}`
}
```
Delete them, and add to the imports (after line 4):
```ts
import { buildProspectSalesUrl } from '@/lib/services/prospects'
```
Replace the two call sites — line 39:
```ts
  return NextResponse.json({ salesUrl: buildSalesUrl(token), expiresAt: expiresAt.toISOString() })
```
becomes
```ts
  return NextResponse.json({ salesUrl: buildProspectSalesUrl(token), expiresAt: expiresAt.toISOString() })
```
and line 55:
```ts
    salesUrl: buildSalesUrl(prospect.salesToken),
```
becomes
```ts
    salesUrl: buildProspectSalesUrl(prospect.salesToken),
```
(The stale comment about "Not exported: route files may only export HTTP handlers" above the deleted function should shrink to cover only `SALES_TTL_MS`.)

- [ ] **3.5 Run — expect PASS:**
```
npx vitest run lib/services/prospects.test.ts
npx tsc --noEmit
```
Expected: PASS — all prospects tests; tsc clean.

- [ ] **3.6 Commit:**
```
git add lib/services/prospects.ts lib/services/prospects.test.ts "app/api/sales/prospects/[id]/share/route.ts"
git commit -m "refactor(sales): extract buildProspectSalesUrl into lib/services/prospects

Single home for the /sales/[token] URL; the share route now imports it, so
listProspects (next commit) can emit the same URL without drift."
```

---

## Task 4 — `listProspects` extension: counters, `startedAt`, `queuePosition`, `salesUrl`

**Files:**
- Modify: `lib/services/prospects.ts` (`ProspectRow` lines 16–29 + `listProspects` lines 54–91)
- Modify: `lib/services/prospects.test.ts` (cleanup helper + new tests)

**Interfaces:**
```ts
export interface ProspectRow {
  id: number
  name: string
  domain: string
  createdAt: string
  salesTokenActive: boolean
  salesUrl: string | null            // active token only, via buildProspectSalesUrl
  latestAudit: null | {
    id: string
    status: string
    completedAt: string | null
    adaScore: number | null
    reportable: boolean
    pagesTotal: number
    pagesComplete: number
    pagesError: number
    pagesRedirected: number
    pdfsTotal: number
    pdfsComplete: number
    pdfsError: number
    pdfsSkipped: number
    lighthouseTotal: number
    lighthouseComplete: number
    lighthouseError: number
    startedAt: string | null         // Codex fix 4: NOT createdAt — queue wait excluded from the ETA
    queuePosition: number | null     // shared-ordering position for 'queued' audits; null otherwise
  }
}
```

### Steps

- [ ] **4.1 Update the test cleanup + append the failing tests** in `lib/services/prospects.test.ts`. First widen `cleanup()` (lines 8–13) so the non-prospect queued seed below is removed too:

```ts
async function cleanup() {
  const rows = await prisma.prospect.findMany({ where: { domain: { startsWith: PREFIX } }, select: { id: true } })
  const ids = rows.map((r) => r.id)
  await prisma.siteAudit.deleteMany({
    where: { OR: [{ prospectId: { in: ids } }, { domain: { startsWith: PREFIX } }] },
  })
  await prisma.prospect.deleteMany({ where: { id: { in: ids } } })
}
```

Then append:

```ts
describe('listProspects — PR3 progress + queue + sales-URL fields', () => {
  it('surfaces progress counters, startedAt, and salesUrl on the row', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tools.example.com')
    const created = await createProspect({ name: 'Counters', domain: `${PREFIX}counters.test` })
    if (created.kind === 'invalid') throw new Error('seed failed')
    await prisma.prospect.update({
      where: { id: created.prospect.id },
      data: { salesToken: 'tok-counters', salesTokenExpiresAt: new Date(Date.now() + 86_400_000) },
    })
    const startedAt = new Date('2026-07-14T10:00:00.000Z')
    await prisma.siteAudit.create({
      data: {
        domain: `${PREFIX}counters.test`, wcagLevel: 'wcag21aa', status: 'running',
        prospectId: created.prospect.id, startedAt,
        pagesTotal: 10, pagesComplete: 4, pagesError: 1, pagesRedirected: 2,
        pdfsTotal: 3, pdfsComplete: 1, lighthouseTotal: 5, lighthouseComplete: 2,
      },
    })
    const row = (await listProspects()).find((r) => r.id === created.prospect.id)
    expect(row?.salesUrl).toBe('https://tools.example.com/sales/tok-counters')
    expect(row?.latestAudit).toMatchObject({
      pagesTotal: 10, pagesComplete: 4, pagesError: 1, pagesRedirected: 2,
      pdfsTotal: 3, pdfsComplete: 1, pdfsError: 0, pdfsSkipped: 0,
      lighthouseTotal: 5, lighthouseComplete: 2, lighthouseError: 0,
      startedAt: startedAt.toISOString(),
      queuePosition: null, // running, not queued
    })
    vi.unstubAllEnvs()
  })

  it('salesUrl is null when the token is absent or expired', async () => {
    const fresh = await createProspect({ name: 'NoTok', domain: `${PREFIX}notok.test` })
    if (fresh.kind === 'invalid') throw new Error('seed failed')
    const expired = await createProspect({ name: 'Expired', domain: `${PREFIX}expired.test` })
    if (expired.kind === 'invalid') throw new Error('seed failed')
    await prisma.prospect.update({
      where: { id: expired.prospect.id },
      data: { salesToken: 'tok-old', salesTokenExpiresAt: new Date(Date.now() - 1000) },
    })
    const rows = await listProspects()
    expect(rows.find((r) => r.id === fresh.prospect.id)?.salesUrl).toBeNull()
    expect(rows.find((r) => r.id === expired.prospect.id)?.salesUrl).toBeNull()
  })

  it('queuePosition follows the shared ordering (prospect-owned first)', async () => {
    // Neutralize stray queued rows in the shared dev DB — positions are
    // meaningless otherwise (queue-manager.test.ts precedent).
    await prisma.siteAudit.updateMany({ where: { status: 'queued' }, data: { status: 'cancelled' } })
    await prisma.siteAudit.create({
      data: {
        domain: `${PREFIX}client-q.test`, wcagLevel: 'wcag21aa', status: 'queued',
        createdAt: new Date(Date.now() - 60_000), // older, but NOT prospect-owned
      },
    })
    const created = await createProspect({ name: 'Queue', domain: `${PREFIX}queue.test` })
    if (created.kind === 'invalid') throw new Error('seed failed')
    await prisma.siteAudit.create({
      data: {
        domain: `${PREFIX}queue.test`, wcagLevel: 'wcag21aa', status: 'queued',
        prospectId: created.prospect.id,
      },
    })
    const row = (await listProspects()).find((r) => r.id === created.prospect.id)
    expect(row?.latestAudit?.queuePosition).toBe(1) // jumps the older non-prospect audit
  })
})
```

- [ ] **4.2 Run — expect FAIL:**
```
npx vitest run lib/services/prospects.test.ts
```
Expected: the three new tests FAIL — `salesUrl` / counter fields / `queuePosition` are `undefined` on the current row shape.

- [ ] **4.3 Rewrite `ProspectRow` + `listProspects`** in `lib/services/prospects.ts`. Replace the interface (lines 16–29) with the shape in **Interfaces** above, add the import:
```ts
import { queuedAheadCount } from '@/lib/ada-audit/queue-order'
```
(safe: `queue-order.ts` imports only `@/lib/db`; the dashboard component's `import type { ProspectRow }` is type-only and erased at compile, so no server code leaks client-ward), and replace `listProspects` (lines 54–91) with:

```ts
export async function listProspects(): Promise<ProspectRow[]> {
  const now = new Date()
  const prospects = await prisma.prospect.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, domain: true, createdAt: true, salesToken: true, salesTokenExpiresAt: true },
  })
  const audits = await prisma.siteAudit.findMany({
    where: { prospectId: { in: prospects.map((p) => p.id) } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, prospectId: true, status: true, completedAt: true,
      // PR3 progress + ETA scalars (spec §1). startedAt NOT createdAt — the
      // ETA must exclude queue wait (Codex fix 4). createdAt is selected for
      // the queue-position key, not surfaced.
      createdAt: true, startedAt: true,
      pagesTotal: true, pagesComplete: true, pagesError: true, pagesRedirected: true,
      pdfsTotal: true, pdfsComplete: true, pdfsError: true, pdfsSkipped: true,
      lighthouseTotal: true, lighthouseComplete: true, lighthouseError: true,
      crawlRuns: { select: { tool: true, score: true } },
    },
  })
  const latestByProspect = new Map<number, (typeof audits)[number]>()
  for (const a of audits) {
    if (a.prospectId !== null && !latestByProspect.has(a.prospectId)) latestByProspect.set(a.prospectId, a)
  }
  // PR3: shared-ordering queue position for queued latest audits (one indexed
  // count per queued row — rare: at most a handful of prospects queue at once).
  const queuePositions = new Map<string, number>()
  for (const a of latestByProspect.values()) {
    if (a.status === 'queued') {
      queuePositions.set(a.id, (await queuedAheadCount(a)) + 1)
    }
  }
  return prospects.map((p) => {
    const a = latestByProspect.get(p.id) ?? null
    const tokenActive = !!p.salesToken && !!p.salesTokenExpiresAt && p.salesTokenExpiresAt > now
    return {
      id: p.id,
      name: p.name,
      domain: p.domain,
      createdAt: p.createdAt.toISOString(),
      salesTokenActive: tokenActive,
      salesUrl: tokenActive && p.salesToken ? buildProspectSalesUrl(p.salesToken) : null,
      latestAudit: a
        ? {
            id: a.id,
            status: a.status,
            completedAt: a.completedAt?.toISOString() ?? null,
            adaScore: a.crawlRuns.find((r) => r.tool === 'ada-audit')?.score ?? null,
            reportable: a.status === 'complete' && a.crawlRuns.some((r) => r.tool === 'seo-parser'),
            pagesTotal: a.pagesTotal,
            pagesComplete: a.pagesComplete,
            pagesError: a.pagesError,
            pagesRedirected: a.pagesRedirected,
            pdfsTotal: a.pdfsTotal,
            pdfsComplete: a.pdfsComplete,
            pdfsError: a.pdfsError,
            pdfsSkipped: a.pdfsSkipped,
            lighthouseTotal: a.lighthouseTotal,
            lighthouseComplete: a.lighthouseComplete,
            lighthouseError: a.lighthouseError,
            startedAt: a.startedAt?.toISOString() ?? null,
            queuePosition: queuePositions.get(a.id) ?? null,
          }
        : null,
    }
  })
}
```

- [ ] **4.4 Run — expect PASS:**
```
npx vitest run lib/services/prospects.test.ts
npx tsc --noEmit
```
Expected: all prospects tests PASS; tsc clean (the GET route at `app/api/sales/prospects/route.ts` just serializes `listProspects()` — no change needed; the component is updated in Task 6).

- [ ] **4.5 Commit:**
```
git add lib/services/prospects.ts lib/services/prospects.test.ts
git commit -m "feat(sales): listProspects carries progress counters, startedAt, queuePosition, salesUrl

queuePosition uses the shared queue-order helper; salesUrl only for active
tokens via buildProspectSalesUrl. No new endpoints — the existing list poll
and SSE invalidation carry the fields."
```

---

## Task 5 — `progress-math.ts`: pure weighted progress + ETA module

**Files:**
- Create: `components/sales/intake/progress-math.ts`
- Create: `components/sales/intake/progress-math.test.ts`

**Interfaces:**
```ts
export const PHASE_WEIGHTS: { readonly pages: 0.7; readonly pdfs: 0.15; readonly lighthouse: 0.15 }
export interface AuditProgressInput {
  status: string; reportable: boolean
  pagesTotal: number; pagesComplete: number; pagesError: number; pagesRedirected: number
  pdfsTotal: number; pdfsComplete: number; pdfsError: number; pdfsSkipped: number
  lighthouseTotal: number; lighthouseComplete: number; lighthouseError: number
}
export type AuditProgress =
  | { kind: 'queued' }
  | { kind: 'discovering' }
  | { kind: 'progress'; fraction: number; phaseLabel: string }
  | { kind: 'building-report'; fraction: 1 }
  | { kind: 'none' }
export function computeAuditProgress(input: AuditProgressInput): AuditProgress
export function computeEtaLabel(args: { fraction: number; startedAt: string | null; now: number }): string | null
```

### Steps

- [ ] **5.1 Write the failing test file** `components/sales/intake/progress-math.test.ts`:

```ts
// components/sales/intake/progress-math.test.ts
// Pure math — no jsdom, no timers, no DB. The monotonicity fixtures here are
// the contract: the bar must NEVER move backward as denominators appear.
import { describe, expect, it } from 'vitest'
import { computeAuditProgress, computeEtaLabel, type AuditProgressInput } from './progress-math'

const ZERO: AuditProgressInput = {
  status: 'running', reportable: false,
  pagesTotal: 0, pagesComplete: 0, pagesError: 0, pagesRedirected: 0,
  pdfsTotal: 0, pdfsComplete: 0, pdfsError: 0, pdfsSkipped: 0,
  lighthouseTotal: 0, lighthouseComplete: 0, lighthouseError: 0,
}
const input = (over: Partial<AuditProgressInput>): AuditProgressInput => ({ ...ZERO, ...over })

function fractionOf(p: ReturnType<typeof computeAuditProgress>): number {
  if (p.kind !== 'progress' && p.kind !== 'building-report') throw new Error(`no fraction on kind=${p.kind}`)
  return p.fraction
}

describe('computeAuditProgress — states', () => {
  it('queued → kind queued', () => {
    expect(computeAuditProgress(input({ status: 'queued' }))).toEqual({ kind: 'queued' })
  })

  it('running with pagesTotal 0 → discovering (indeterminate, no ETA)', () => {
    expect(computeAuditProgress(input({ status: 'running' }))).toEqual({ kind: 'discovering' })
  })

  it('complete && !reportable → building-report at fraction 1 (verifier window)', () => {
    expect(computeAuditProgress(input({ status: 'complete', reportable: false, pagesTotal: 5, pagesComplete: 5 })))
      .toEqual({ kind: 'building-report', fraction: 1 })
  })

  it('complete && reportable → none; error → none; cancelled → none', () => {
    expect(computeAuditProgress(input({ status: 'complete', reportable: true, pagesTotal: 5, pagesComplete: 5 })).kind).toBe('none')
    expect(computeAuditProgress(input({ status: 'error' })).kind).toBe('none')
    expect(computeAuditProgress(input({ status: 'cancelled' })).kind).toBe('none')
  })
})

describe('computeAuditProgress — weighted fraction (pages 70 / pdfs 15 / lh 15)', () => {
  it('mid-pages: f = 0.7 × settled/total, with pagesRedirected counted as settled (finalizer semantics)', () => {
    const p = computeAuditProgress(input({
      status: 'running', pagesTotal: 10, pagesComplete: 2, pagesError: 1, pagesRedirected: 1,
    }))
    expect(p.kind).toBe('progress')
    expect(fractionOf(p)).toBeCloseTo(0.7 * 0.4, 10)
    if (p.kind === 'progress') expect(p.phaseLabel).toBe('Scanning pages (4/10)')
  })

  it('mid-pages: PDF/LH weights are RESERVED — growing pdf totals never move the bar', () => {
    const before = computeAuditProgress(input({
      status: 'running', pagesTotal: 10, pagesComplete: 4, pdfsTotal: 5, pdfsComplete: 2,
    }))
    const after = computeAuditProgress(input({
      status: 'running', pagesTotal: 10, pagesComplete: 4, pdfsTotal: 10, pdfsComplete: 2,
    }))
    expect(fractionOf(before)).toBeCloseTo(0.28, 10)
    expect(fractionOf(after)).toBeCloseTo(0.28, 10) // denominator grew, fraction did not move
  })

  it('pages done: pdf phase contributes, skipped counts as settled', () => {
    const p = computeAuditProgress(input({
      status: 'pdfs-running', pagesTotal: 10, pagesComplete: 6, pagesError: 2, pagesRedirected: 2,
      pdfsTotal: 4, pdfsComplete: 1, pdfsError: 0, pdfsSkipped: 1,
      lighthouseTotal: 10, lighthouseComplete: 0,
    }))
    // active weight 1.0 → 0.7 + 0.15×(2/4) + 0.15×0
    expect(fractionOf(p)).toBeCloseTo(0.775, 10)
    if (p.kind === 'progress') expect(p.phaseLabel).toBe('Scanning PDFs (2/4)')
  })

  it('zero-total phase redistributes its weight ONLY once pages are done', () => {
    const p = computeAuditProgress(input({
      status: 'lighthouse-running', pagesTotal: 10, pagesComplete: 10,
      pdfsTotal: 0, lighthouseTotal: 8, lighthouseComplete: 4,
    }))
    // pdf weight folds away: (0.7 + 0.15×0.5) / 0.85
    expect(fractionOf(p)).toBeCloseTo(0.775 / 0.85, 10)
    if (p.kind === 'progress') expect(p.phaseLabel).toBe('Running Lighthouse (4/8)')
  })

  it('pages done with BOTH follow-up phases empty → fraction 1 (finalizer about to flip)', () => {
    const p = computeAuditProgress(input({ status: 'running', pagesTotal: 10, pagesComplete: 10 }))
    expect(fractionOf(p)).toBe(1)
    if (p.kind === 'progress') expect(p.phaseLabel).toBe('Finishing up…')
  })

  it('never moves backward across the pages→pdfs transition', () => {
    const preDone = computeAuditProgress(input({
      status: 'running', pagesTotal: 10, pagesComplete: 9, pdfsTotal: 6, pdfsComplete: 6,
    }))
    const postDone = computeAuditProgress(input({
      status: 'pdfs-running', pagesTotal: 10, pagesComplete: 10, pdfsTotal: 6, pdfsComplete: 6,
      lighthouseTotal: 5, lighthouseComplete: 0,
    }))
    expect(fractionOf(preDone)).toBeLessThanOrEqual(0.7)
    expect(fractionOf(postDone)).toBeGreaterThanOrEqual(0.7)
    expect(fractionOf(postDone)).toBeGreaterThanOrEqual(fractionOf(preDone))
  })

  it('clamps over-settled counters to 1 per phase', () => {
    const p = computeAuditProgress(input({
      status: 'running', pagesTotal: 10, pagesComplete: 9, pagesError: 2, pagesRedirected: 1, // 12 settled of 10
    }))
    expect(fractionOf(p)).toBeLessThanOrEqual(1)
  })
})

describe('computeEtaLabel — elapsed × (1−f)/f from startedAt', () => {
  const T0 = Date.parse('2026-07-14T10:00:00.000Z')
  const started = '2026-07-14T10:00:00.000Z'

  it('null while startedAt is null (long queue wait: never estimate from queue time)', () => {
    expect(computeEtaLabel({ fraction: 0.5, startedAt: null, now: T0 + 600_000 })).toBeNull()
  })

  it('null at fraction 1 (nothing remaining)', () => {
    expect(computeEtaLabel({ fraction: 1, startedAt: started, now: T0 + 600_000 })).toBeNull()
  })

  it('"estimating…" below the f≥0.05 gate', () => {
    expect(computeEtaLabel({ fraction: 0.04, startedAt: started, now: T0 + 60_000 })).toBe('estimating…')
  })

  it('"estimating…" below the 20 s elapsed gate', () => {
    expect(computeEtaLabel({ fraction: 0.5, startedAt: started, now: T0 + 19_000 })).toBe('estimating…')
  })

  it('formats "~N min remaining" (f=0.5 after 10 min → ~10 min)', () => {
    expect(computeEtaLabel({ fraction: 0.5, startedAt: started, now: T0 + 600_000 })).toBe('~10 min remaining')
  })

  it('floors at "~1 min remaining"', () => {
    // f=0.9 after 5 min → remaining ≈ 33 s
    expect(computeEtaLabel({ fraction: 0.9, startedAt: started, now: T0 + 300_000 })).toBe('~1 min remaining')
  })

  it('caps at "> 30 min remaining"', () => {
    // f=0.05 after 2 min → remaining = 38 min
    expect(computeEtaLabel({ fraction: 0.05, startedAt: started, now: T0 + 120_000 })).toBe('> 30 min remaining')
  })

  it('null on an unparseable startedAt (defensive)', () => {
    expect(computeEtaLabel({ fraction: 0.5, startedAt: 'not-a-date', now: T0 })).toBeNull()
  })
})
```

- [ ] **5.2 Run — expect FAIL:**
```
npx vitest run components/sales/intake/progress-math.test.ts
```
Expected: FAIL — `Failed to resolve import "./progress-math"`.

- [ ] **5.3 Create** `components/sales/intake/progress-math.ts` (complete file):

```ts
// components/sales/intake/progress-math.ts
//
// Pure, client-safe progress + ETA math for the /sales prospect dashboard
// (PR3). NO imports, NO Date.now()/timers — callers inject `now`. Heavily
// unit-tested so ProspectDashboard.tsx stays thin.
//
// Weighted phases: pages 70% / PDFs 15% / Lighthouse 15%.
// Settled pages = pagesComplete + pagesError + pagesRedirected — the
// finalizer's EXACT drain semantics (site-audit-finalizer.ts, Codex fix 3).
//
// Monotonicity contract (Codex fix 3): while pages are still settling, the
// PDF/Lighthouse totals are still GROWING (each page job dispatches PDFs and
// PSI as it settles), so their fractions have unstable denominators — a
// growing total would move the bar backward. Until the pages phase is done,
// the PDF/LH weights are RESERVED (contribute 0, shown as pending); once
// pages are done the totals are final, and any phase with total 0 folds its
// weight away (renormalized denominator). The fraction never decreases:
// pre-transition f ≤ 0.70; post-transition f = (0.70 + …)/activeWeight ≥ 0.70.

export const PHASE_WEIGHTS = { pages: 0.7, pdfs: 0.15, lighthouse: 0.15 } as const

export interface AuditProgressInput {
  status: string
  reportable: boolean
  pagesTotal: number
  pagesComplete: number
  pagesError: number
  pagesRedirected: number
  pdfsTotal: number
  pdfsComplete: number
  pdfsError: number
  pdfsSkipped: number
  lighthouseTotal: number
  lighthouseComplete: number
  lighthouseError: number
}

export type AuditProgress =
  | { kind: 'queued' }
  | { kind: 'discovering' }
  | { kind: 'progress'; fraction: number; phaseLabel: string }
  | { kind: 'building-report'; fraction: 1 }
  | { kind: 'none' }

const TRANSIENT_STATUSES = new Set(['running', 'pdfs-running', 'lighthouse-running'])

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

export function computeAuditProgress(input: AuditProgressInput): AuditProgress {
  if (input.status === 'queued') return { kind: 'queued' }

  // The broken-link-verify window: parent complete, live-scan run not yet
  // written — full bar, "Building report…" (spec §2).
  if (input.status === 'complete' && !input.reportable) {
    return { kind: 'building-report', fraction: 1 }
  }

  if (!TRANSIENT_STATUSES.has(input.status)) return { kind: 'none' }

  // pagesTotal === 0 while transient = discovery still in flight —
  // indeterminate bar, no ETA (spec Error handling).
  if (input.pagesTotal === 0) return { kind: 'discovering' }

  const pagesSettled = input.pagesComplete + input.pagesError + input.pagesRedirected
  const pagesFraction = clamp01(pagesSettled / input.pagesTotal)
  const pagesDone = pagesSettled >= input.pagesTotal

  if (!pagesDone) {
    // PDF/LH weights reserved — see the monotonicity contract above.
    return {
      kind: 'progress',
      fraction: PHASE_WEIGHTS.pages * pagesFraction,
      phaseLabel: `Scanning pages (${Math.min(pagesSettled, input.pagesTotal)}/${input.pagesTotal})`,
    }
  }

  // Pages done → PDF/LH totals are final. Zero-total phases fold their
  // weight away via the renormalized denominator.
  const pdfsSettled = input.pdfsComplete + input.pdfsError + input.pdfsSkipped
  const lhSettled = input.lighthouseComplete + input.lighthouseError
  const pdfsFraction = input.pdfsTotal > 0 ? clamp01(pdfsSettled / input.pdfsTotal) : 0
  const lhFraction = input.lighthouseTotal > 0 ? clamp01(lhSettled / input.lighthouseTotal) : 0
  const activeWeight =
    PHASE_WEIGHTS.pages +
    (input.pdfsTotal > 0 ? PHASE_WEIGHTS.pdfs : 0) +
    (input.lighthouseTotal > 0 ? PHASE_WEIGHTS.lighthouse : 0)
  const fraction = clamp01(
    (PHASE_WEIGHTS.pages +
      (input.pdfsTotal > 0 ? PHASE_WEIGHTS.pdfs * pdfsFraction : 0) +
      (input.lighthouseTotal > 0 ? PHASE_WEIGHTS.lighthouse * lhFraction : 0)) /
      activeWeight,
  )

  const phaseLabel =
    input.status === 'pdfs-running'
      ? `Scanning PDFs (${Math.min(pdfsSettled, input.pdfsTotal)}/${input.pdfsTotal})`
      : input.status === 'lighthouse-running'
        ? `Running Lighthouse (${Math.min(lhSettled, input.lighthouseTotal)}/${input.lighthouseTotal})`
        : 'Finishing up…' // status still 'running' with pages drained — finalizer flip imminent

  return { kind: 'progress', fraction, phaseLabel }
}

/**
 * ETA = elapsed × (1 − f) / f, elapsed from SiteAudit.startedAt (stamped by
 * the discover claim — queue wait excluded, Codex fix 4). Presentation-only.
 * Gates: no ETA at all while startedAt is null; "estimating…" until
 * f ≥ 0.05 AND elapsed ≥ 20 s. Format "~N min remaining" (floor ~1 min,
 * cap "> 30 min remaining").
 */
export function computeEtaLabel(args: {
  fraction: number
  startedAt: string | null
  now: number
}): string | null {
  const { fraction, startedAt, now } = args
  if (startedAt === null) return null
  if (fraction >= 1) return null
  const startedMs = Date.parse(startedAt)
  if (Number.isNaN(startedMs)) return null
  const elapsed = now - startedMs
  // f ≤ 0 falls into this gate too — never divide by a non-positive fraction.
  if (fraction < 0.05 || elapsed < 20_000) return 'estimating…'
  const remainingMs = (elapsed * (1 - fraction)) / fraction
  if (remainingMs > 30 * 60_000) return '> 30 min remaining'
  const minutes = Math.round(remainingMs / 60_000)
  if (minutes <= 1) return '~1 min remaining'
  return `~${minutes} min remaining`
}
```

- [ ] **5.4 Run — expect PASS:**
```
npx vitest run components/sales/intake/progress-math.test.ts
```
Expected: PASS — 20 tests.

- [ ] **5.5 Commit:**
```
git add components/sales/intake/progress-math.ts components/sales/intake/progress-math.test.ts
git commit -m "feat(sales): pure progress + ETA math module for the prospect dashboard

Weighted 70/15/15 fraction with pagesRedirected in settled pages, reserved
PDF/LH weights until the pages phase completes (monotone under growing
denominators), and startedAt-based ETA with the 5%/20s estimating gate."
```

---

## Task 6 — ProspectDashboard rebuild: progress bar, ETA tick, clickable cards

**Files:**
- Modify: `components/sales/intake/ProspectDashboard.tsx` (full component rewrite below — list-row section restructured, form + poll/SSE effects byte-identical)
- Modify: `components/sales/intake/ProspectDashboard.test.tsx` (fixtures + one assertion + new describe)

**Interfaces:** component props unchanged (`{ initialProspects: ProspectRow[] }`). New module-private `ProgressBlock({ p, nowMs })` render helper.

### Steps

- [ ] **6.1 Update the existing test file's fixtures and stale assertion** in `components/sales/intake/ProspectDashboard.test.tsx`. The `ProspectRow` fixtures no longer satisfy the Task 4 type (tsconfig excludes test files from `tsc`, so this is a hand-fix — contradiction #2). Replace the fixture block (lines 55–75) with:

```ts
const AUDIT_DEFAULTS = {
  pagesTotal: 0, pagesComplete: 0, pagesError: 0, pagesRedirected: 0,
  pdfsTotal: 0, pdfsComplete: 0, pdfsError: 0, pdfsSkipped: 0,
  lighthouseTotal: 0, lighthouseComplete: 0, lighthouseError: 0,
  startedAt: null as string | null, queuePosition: null as number | null,
}

const REPORTABLE_ROW: ProspectRow = {
  id: 1, name: 'Acme College', domain: 'acme.test', createdAt: '2026-07-09T00:00:00.000Z',
  salesTokenActive: true, salesUrl: 'https://app.test/sales/tok-1',
  latestAudit: {
    id: 'a1', status: 'complete', completedAt: '2026-07-09T01:00:00.000Z', adaScore: 62, reportable: true,
    ...AUDIT_DEFAULTS, pagesTotal: 10, pagesComplete: 10,
  },
}
const RUNNING_ROW: ProspectRow = {
  id: 2, name: 'Running U', domain: 'running.test', createdAt: '2026-07-09T00:00:00.000Z',
  salesTokenActive: false, salesUrl: null,
  latestAudit: {
    id: 'a2', status: 'running', completedAt: null, adaScore: null, reportable: false,
    ...AUDIT_DEFAULTS, pagesTotal: 12, pagesComplete: 3, startedAt: '2026-07-09T00:59:00.000Z',
  },
}
const VERIFYING_ROW: ProspectRow = {
  id: 3, name: 'Verifying U', domain: 'verifying.test', createdAt: '2026-07-09T00:00:00.000Z',
  salesTokenActive: false, salesUrl: null,
  // parent complete but live-scan run not written yet → "Building report…"
  latestAudit: {
    id: 'a3', status: 'complete', completedAt: '2026-07-09T01:00:00.000Z', adaScore: null, reportable: false,
    ...AUDIT_DEFAULTS, pagesTotal: 10, pagesComplete: 10,
  },
}
const FRESH_ROW: ProspectRow = {
  id: 4, name: 'Fresh', domain: 'fresh.test', createdAt: '2026-07-09T00:00:00.000Z',
  salesTokenActive: false, salesUrl: null, latestAudit: null,
}
```

In the first test (`renders form, list states, and per-state actions`), change the stale assertion (contradiction #1) —
```ts
    expect(screen.getByText(/report building/i)).toBeTruthy() // complete-but-not-reportable row
```
becomes
```ts
    expect(screen.getByText(/building report/i)).toBeTruthy() // complete-but-not-reportable row (spec wording)
```
(the `/scanning/i` assertion still matches the new "Scanning pages (3/12)" label — leave it).

- [ ] **6.2 Append the new failing describe** to `ProspectDashboard.test.tsx`. Add `fireEvent` to the testing-library import:
```ts
import { cleanup, render, screen, act, fireEvent } from '@testing-library/react'
```
then append:

```tsx
describe('ProspectDashboard — PR3 progress + clickable cards', () => {
  type FakeTab = { opener: unknown; close: ReturnType<typeof vi.fn>; location: { href: string } }
  let openMock: ReturnType<typeof vi.fn>
  let fakeTab: FakeTab

  function stubOpen(returnsTab = true) {
    fakeTab = { opener: {}, close: vi.fn(), location: { href: '' } }
    openMock = vi.fn(() => (returnsTab ? (fakeTab as unknown as Window) : null))
    vi.stubGlobal('open', openMock)
  }

  function routeFetchWithShare(prospectsBody: unknown, opts: { shareOk?: boolean; salesUrl?: string } = {}) {
    const { shareOk = true, salesUrl = 'https://app.test/sales/tok-new' } = opts
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === '/api/sales/prospects') return jsonResponse({ prospects: prospectsBody })
      if (/^\/api\/sales\/prospects\/\d+\/share$/.test(url) && init?.method === 'POST') {
        return jsonResponse({ salesUrl }, shareOk)
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
  }

  const card = () => screen.getByRole('link', { name: /acme college/i })

  it('renders a progress bar with the phase label for a running audit', () => {
    routeFetch([RUNNING_ROW])
    render(<ProspectDashboard initialProspects={[RUNNING_ROW]} />)
    expect(screen.getByText(/scanning pages \(3\/12\)/i)).toBeTruthy()
  })

  it('renders the queue position for a queued audit', () => {
    const queued: ProspectRow = {
      ...RUNNING_ROW,
      latestAudit: { ...RUNNING_ROW.latestAudit!, status: 'queued', queuePosition: 2, startedAt: null },
    }
    routeFetch([queued])
    render(<ProspectDashboard initialProspects={[queued]} />)
    expect(screen.getByText(/queued — position 2/i)).toBeTruthy()
  })

  it('renders "Queued — next in line" at position 1', () => {
    const queued: ProspectRow = {
      ...RUNNING_ROW,
      latestAudit: { ...RUNNING_ROW.latestAudit!, status: 'queued', queuePosition: 1, startedAt: null },
    }
    routeFetch([queued])
    render(<ProspectDashboard initialProspects={[queued]} />)
    expect(screen.getByText(/queued — next in line/i)).toBeTruthy()
  })

  it('shows the ETA after the post-mount tick (hydration-safe)', async () => {
    // startedAt 25 min before "now"; 3+9 of 12 settled → f = 0.7 × 0.25 … use
    // counters that pass the ≥5% / ≥20s gates deterministically.
    const row: ProspectRow = {
      ...RUNNING_ROW,
      latestAudit: {
        ...RUNNING_ROW.latestAudit!,
        pagesTotal: 10, pagesComplete: 5, pagesError: 0, pagesRedirected: 0,
        startedAt: new Date(Date.now() - 10 * 60_000).toISOString(), // f=0.35, elapsed 10 min
      },
    }
    routeFetch([row])
    render(<ProspectDashboard initialProspects={[row]} />)
    // Before the tick effect runs there is no ETA text; advance the 1s tick.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByText(/min remaining/i)).toBeTruthy()
  })

  it('card click opens salesUrl in a new tab with the opener nulled', async () => {
    stubOpen()
    routeFetch([REPORTABLE_ROW])
    render(<ProspectDashboard initialProspects={[REPORTABLE_ROW]} />)
    await act(async () => { fireEvent.click(card()); await flushAsync() })
    expect(openMock).toHaveBeenCalledWith('https://app.test/sales/tok-1', '_blank')
    expect(fakeTab.opener).toBeNull()
  })

  it('Enter activates the card like a click', async () => {
    stubOpen()
    routeFetch([REPORTABLE_ROW])
    render(<ProspectDashboard initialProspects={[REPORTABLE_ROW]} />)
    await act(async () => { fireEvent.keyDown(card(), { key: 'Enter' }); await flushAsync() })
    expect(openMock).toHaveBeenCalledWith('https://app.test/sales/tok-1', '_blank')
  })

  it('clicks on nested interactive controls never activate the card', async () => {
    stubOpen()
    vi.stubGlobal('confirm', vi.fn(() => false)) // Delete short-circuits, no fetch
    routeFetch([REPORTABLE_ROW])
    render(<ProspectDashboard initialProspects={[REPORTABLE_ROW]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /delete/i })); await flushAsync() })
    expect(openMock).not.toHaveBeenCalled()
  })

  it('without an active token: pre-opens about:blank, mints via share POST, then navigates the tab', async () => {
    stubOpen()
    routeFetchWithShare([VERIFYING_ROW])
    render(<ProspectDashboard initialProspects={[VERIFYING_ROW]} />)
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /verifying u/i })); await flushAsync() })
    expect(openMock).toHaveBeenCalledWith('about:blank', '_blank')
    expect(fakeTab.opener).toBeNull()
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/sales/prospects/3/share')).toBe(true)
    expect(fakeTab.location.href).toBe('https://app.test/sales/tok-new')
  })

  it('popup blocked (window.open null) → notice with the link, no crash', async () => {
    stubOpen(false)
    routeFetchWithShare([VERIFYING_ROW])
    render(<ProspectDashboard initialProspects={[VERIFYING_ROW]} />)
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /verifying u/i })); await flushAsync() })
    expect(screen.getByText(/popup blocked/i).textContent).toContain('https://app.test/sales/tok-new')
  })

  it('failed share POST closes the pre-opened tab and shows a notice', async () => {
    stubOpen()
    routeFetchWithShare([VERIFYING_ROW], { shareOk: false })
    render(<ProspectDashboard initialProspects={[VERIFYING_ROW]} />)
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /verifying u/i })); await flushAsync() })
    expect(fakeTab.close).toHaveBeenCalled()
    expect(screen.getByText(/could not open the sales report/i)).toBeTruthy()
  })
})
```

- [ ] **6.3 Run — expect FAIL:**
```
npx vitest run components/sales/intake/ProspectDashboard.test.tsx
```
Expected: the new describe FAILS throughout (`getByRole('link')` finds nothing — cards are plain divs; no progress text). The updated first test also FAILS on `/building report/i` until the rewrite lands.

- [ ] **6.4 Rewrite `components/sales/intake/ProspectDashboard.tsx`** (complete file):

```tsx
'use client'
// C14 intake + PR3 dashboard UX (2026-07-14 spec): phase-labeled progress bar
// with a startedAt-based ETA, whole-card click-through to the public sales
// report (new tab, opener nulled), and queue-position display.
//
// Poll/SSE cadence is UNCHANGED from A5 Task 19: mount-scoped `prospect-list`
// subscription + health-gated bounded poll (8s fast while SSE absent/
// unhealthy, 60s safety once healthy; only polls at all while some prospect
// is transient/not-yet-reportable). The 1s ETA tick below is a local render
// tick over last-fetched counters — it never fetches.
import { useCallback, useEffect, useState } from 'react'
import type { ProspectRow } from '@/lib/services/prospects'
import { subscribeTopic, subscribeHealth } from '@/lib/events/client'
import { prospectListTopic } from '@/lib/events/topics'
import { computeAuditProgress, computeEtaLabel } from './progress-math'

const TRANSIENT = new Set(['queued', 'running', 'pdfs-running', 'lighthouse-running'])
const FAST_MS = 8000
const SAFETY_MS = 60_000

// Module-private render helper — all math lives in progress-math.ts.
function ProgressBlock({ p, nowMs }: { p: ProspectRow; nowMs: number | null }) {
  const a = p.latestAudit
  if (!a) {
    return <p className="text-[12px] font-body text-navy/50 dark:text-white/50">Not scanned yet</p>
  }
  const progress = computeAuditProgress({
    status: a.status,
    reportable: a.reportable,
    pagesTotal: a.pagesTotal,
    pagesComplete: a.pagesComplete,
    pagesError: a.pagesError,
    pagesRedirected: a.pagesRedirected,
    pdfsTotal: a.pdfsTotal,
    pdfsComplete: a.pdfsComplete,
    pdfsError: a.pdfsError,
    pdfsSkipped: a.pdfsSkipped,
    lighthouseTotal: a.lighthouseTotal,
    lighthouseComplete: a.lighthouseComplete,
    lighthouseError: a.lighthouseError,
  })

  if (progress.kind === 'none') {
    return (
      <p className="text-[12px] font-body text-navy/50 dark:text-white/50">
        {a.status === 'complete' ? 'Report ready' : `Scan ${a.status}`}
        {a.adaScore != null && ` · ADA ${a.adaScore}/100`}
      </p>
    )
  }

  if (progress.kind === 'queued') {
    return (
      <p className="text-[12px] font-body text-amber-600 dark:text-amber-400">
        {a.queuePosition == null || a.queuePosition === 1
          ? 'Queued — next in line'
          : `Queued — position ${a.queuePosition}`}
      </p>
    )
  }

  if (progress.kind === 'discovering') {
    return (
      <div className="space-y-1">
        <div className="w-full bg-gray-100 dark:bg-navy-light rounded-full h-1.5 overflow-hidden">
          <div className="bg-blue-400 dark:bg-blue-500 h-1.5 w-1/3 rounded-full animate-pulse" />
        </div>
        <p className="text-[11px] font-body text-navy/50 dark:text-white/50">Discovering pages…</p>
      </div>
    )
  }

  const fraction = progress.fraction
  const label = progress.kind === 'building-report' ? 'Building report…' : progress.phaseLabel
  // ETA renders only after the post-mount tick primes nowMs — the server
  // render and first client render agree (hydration-safe, Codex fix 4).
  const eta =
    nowMs !== null && progress.kind === 'progress'
      ? computeEtaLabel({ fraction, startedAt: a.startedAt, now: nowMs })
      : null

  return (
    <div className="space-y-1">
      <div className="w-full bg-gray-100 dark:bg-navy-light rounded-full h-1.5 overflow-hidden">
        <div
          className="bg-orange h-1.5 rounded-full transition-all duration-500"
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
      <p className="text-[11px] font-body text-navy/50 dark:text-white/50">
        {label}
        {eta && ` · ${eta}`}
      </p>
    </div>
  )
}

export function ProspectDashboard(props: { initialProspects: ProspectRow[] }) {
  const [prospects, setProspects] = useState(props.initialProspects)
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/sales/prospects')
      if (res.ok) setProspects((await res.json()).prospects)
    } catch { /* transient poll failure — keep last state */ }
  }, [])

  const anyInFlight = prospects.some(
    (p) => p.latestAudit && (TRANSIENT.has(p.latestAudit.status) || (p.latestAudit.status === 'complete' && !p.latestAudit.reportable)),
  )

  // ETA tick: started AFTER mount so SSR markup and the first client render
  // agree (no hydration mismatch). Recomputes the ETA from last-fetched
  // counters every second; never fetches.
  useEffect(() => {
    setNowMs(Date.now())
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // SSE: prospect-list invalidate → immediate refetch, unconditionally — a
  // prospect created/deleted/settled elsewhere must be picked up even when
  // nothing in this component's currently-rendered list is transient.
  useEffect(() => {
    return subscribeTopic(prospectListTopic(), () => void refresh())
  }, [refresh])

  // Poll while any prospect is transient/not-yet-reportable (bounded-poll
  // semantics preserved); cadence is health-gated: 8s fast while SSE is
  // absent/unhealthy, demoting to the 60s safety cadence once SSE is
  // confirmed healthy.
  useEffect(() => {
    if (!anyInFlight) return
    let timer: ReturnType<typeof setInterval> | null = null
    const restartTimer = (healthy: boolean) => {
      if (timer) clearInterval(timer)
      timer = setInterval(() => void refresh(), healthy ? SAFETY_MS : FAST_MS)
    }
    restartTimer(false)
    const unsubHealth = subscribeHealth((h) => {
      restartTimer(h)
      if (h) void refresh()
    })
    return () => {
      if (timer) clearInterval(timer)
      unsubHealth()
    }
  }, [anyInFlight, refresh])

  async function submitNewScan(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setNotice(null)
    try {
      const createRes = await fetch('/api/sales/prospects', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, domain }),
      })
      const created = await createRes.json()
      if (!createRes.ok) { setNotice(created.error ?? 'Could not create prospect'); return }
      if (created.existing) setNotice(`Using existing prospect for ${created.prospect.domain} — re-scanning.`)
      await startScan(created.prospect.id)
      setName(''); setDomain('')
    } finally {
      setBusy(false)
    }
  }

  async function startScan(id: number) {
    const res = await fetch(`/api/sales/prospects/${id}/scan`, { method: 'POST' })
    if (res.status === 409) setNotice('A scan is already running for this prospect.')
    else if (!res.ok) setNotice('Could not start the scan.')
    await refresh()
  }

  async function copyLink(id: number) {
    const res = await fetch(`/api/sales/prospects/${id}/share`, { method: 'POST' })
    if (!res.ok) { setNotice('Could not create the sales link.'); return }
    const { salesUrl } = await res.json()
    await navigator.clipboard.writeText(salesUrl)
    setNotice('Sales link copied — valid for 30 days.')
  }

  async function remove(id: number) {
    if (!window.confirm('Delete this prospect? Its sales link stops working.')) return
    await fetch(`/api/sales/prospects/${id}`, { method: 'DELETE' })
    await refresh()
  }

  // PR3 card click-through (Codex fix 5). Opens the public sales report in a
  // new tab with opener nulled. window.open MUST run synchronously in the
  // click task (popup-blocker-safe); the share mint happens after, into the
  // pre-opened tab. NEVER pass 'noopener' as a feature — it makes window.open
  // return null, killing the blocked-popup fallback; nulling opener by hand
  // is equivalent.
  async function openReport(p: ProspectRow) {
    if (p.salesUrl) {
      const tab = window.open(p.salesUrl, '_blank')
      if (tab) tab.opener = null
      else setNotice(`Popup blocked — open the report at ${p.salesUrl}`)
      return
    }
    const pre = window.open('about:blank', '_blank')
    if (pre) pre.opener = null
    try {
      const res = await fetch(`/api/sales/prospects/${p.id}/share`, { method: 'POST' })
      if (!res.ok) throw new Error('share failed')
      const { salesUrl } = await res.json()
      if (pre) pre.location.href = salesUrl
      else setNotice(`Popup blocked — open the report at ${salesUrl}`)
      void refresh() // salesTokenActive/salesUrl now set server-side
    } catch {
      pre?.close()
      setNotice('Could not open the sales report.')
    }
  }

  function activateCard(
    e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>,
    p: ProspectRow,
  ) {
    // Ignore activations originating inside nested interactive controls —
    // belt (this closest() guard) AND suspenders (the buttons' own
    // stopPropagation). Codex fix 5.
    const target = e.target as HTMLElement | null
    if (target && target.closest('button, a, input, [role="button"]')) return
    void openReport(p)
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submitNewScan} className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6 space-y-4">
        <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white">New prospect scan</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[12px] font-body text-navy/60 dark:text-white/60">Prospect name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required aria-label="Prospect name"
              className="mt-1 w-full rounded-lg border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-deep px-3 py-2 text-[13px] font-body text-navy dark:text-white" placeholder="Acme College" />
          </label>
          <label className="block">
            <span className="text-[12px] font-body text-navy/60 dark:text-white/60">Domain</span>
            <input value={domain} onChange={(e) => setDomain(e.target.value)} required aria-label="Domain"
              className="mt-1 w-full rounded-lg border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-deep px-3 py-2 text-[13px] font-body text-navy dark:text-white" placeholder="acmecollege.edu" />
          </label>
        </div>
        <button type="submit" disabled={busy}
          className="rounded-lg bg-blue-700 px-4 py-2 text-[13px] font-heading font-semibold text-white disabled:opacity-50">
          {busy ? 'Starting…' : 'Scan'}
        </button>
        {notice && <p className="text-[12px] font-body text-navy/60 dark:text-white/60">{notice}</p>}
      </form>

      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm divide-y divide-gray-100 dark:divide-navy-border">
        {prospects.length === 0 && (
          <p className="p-6 text-[13px] font-body text-navy/50 dark:text-white/50">No prospects yet — run your first scan above.</p>
        )}
        {prospects.map((p) => (
          <div
            key={p.id}
            role="link"
            tabIndex={0}
            aria-label={`Open sales report for ${p.name} in a new tab`}
            onClick={(e) => activateCard(e, p)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                activateCard(e, p)
              }
            }}
            className="p-5 flex flex-wrap items-center gap-x-4 gap-y-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-navy-deep/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 first:rounded-t-2xl last:rounded-b-2xl"
          >
            <div className="min-w-[180px]">
              <p className="text-[14px] font-heading font-semibold text-navy dark:text-white">{p.name}</p>
              <p className="text-[12px] font-body text-navy/50 dark:text-white/50">{p.domain}</p>
            </div>
            <div className="flex-1 basis-full sm:basis-auto min-w-[220px]">
              <ProgressBlock p={p} nowMs={nowMs} />
            </div>
            <div className="flex gap-2 ml-auto">
              {p.latestAudit?.reportable && (
                <button onClick={(e) => { e.stopPropagation(); void copyLink(p.id) }}
                  className="rounded-lg border border-gray-200 dark:border-navy-border px-3 py-1.5 text-[12px] font-heading font-semibold text-navy dark:text-white">
                  Copy sales link
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); void startScan(p.id) }}
                className="rounded-lg border border-gray-200 dark:border-navy-border px-3 py-1.5 text-[12px] font-heading font-semibold text-navy dark:text-white">
                {p.latestAudit ? 'Re-scan' : 'Scan now'}
              </button>
              <button onClick={(e) => { e.stopPropagation(); void remove(p.id) }}
                className="rounded-lg px-3 py-1.5 text-[12px] font-heading font-semibold text-red-600 dark:text-red-400">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **6.5 Run — expect PASS:**
```
npx vitest run components/sales/intake/ProspectDashboard.test.tsx
```
Expected: PASS — all tests (7 pre-existing + 10 new).

- [ ] **6.6 Commit:**
```
git add components/sales/intake/ProspectDashboard.tsx components/sales/intake/ProspectDashboard.test.tsx
git commit -m "feat(sales): prospect dashboard progress bar, ETA, clickable report cards

Phase-labeled weighted bar + startedAt ETA on a post-mount 1s tick
(hydration-safe); whole-card role=link activation with closest() guard,
opener=null, synchronous pre-open for the mint path, popup-block and
share-failure fallbacks. Poll/SSE cadence unchanged."
```

---

## Task 7 — Full gates

- [ ] **7.1 Type gate:**
```
npx tsc --noEmit
```
Expected: exit 0, no output. (Remember: this is the ONLY type gate — in-build checks are disabled.)

- [ ] **7.2 Full test suite:**
```
npx vitest run
```
Expected: exit 0. If pre-existing failures unrelated to this branch appear, verify they fail identically on `main` before dismissing them (`git stash && npx vitest run <file> && git stash pop`).

- [ ] **7.3 Commit anything outstanding, then hand off** per `superpowers:finishing-a-development-branch` (PR to `main`; do NOT deploy without Kevin's go — house change-control).

---

## Out of scope (spec non-goals — do not touch)

- No SiteAudit/Job schema changes, no migrations.
- No new poll endpoints; no cadence changes.
- No changes to the discover handler's conditional claim, recovery paths, or the one-active-audit invariant.
- `SiteAuditPoller.tsx` keeps its existing pages-only percent — adopting the weighted math there is a separate (unplanned) improvement.
