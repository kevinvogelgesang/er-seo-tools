# Client Dashboard MVP (B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/clients/[id]` as a read-only client dashboard (header + scorecards with sparkline/delta + activity timeline) and `/clients` as a fleet table, entirely from existing scalar data.

**Architecture:** Two read services (`client-fleet`, `client-dashboard`) over shared pure helpers (`scorecard-shared`), called directly from server-component pages. Scores come ONLY from `CrawlRun.score`, legacy non-null `AdaAudit.score`, `PillarAnalysis.score`, and `Session` issue counts — never from `Session.result` / `SiteAudit.summary` / `AdaAudit.result` blobs. The existing CRUD page moves verbatim to `/clients/manage`.

**Tech Stack:** Next.js 15 App Router (server components), Prisma + SQLite, Recharts via `next/dynamic` `ssr:false`, vitest (DB-backed service tests + jsdom component tests).

**Spec:** `docs/superpowers/specs/2026-06-11-client-dashboard-mvp-design.md` — read it first.

**Conventions you must follow (from CLAUDE.md / handoff):**
- Local dev DB: prefix every `vitest`/`prisma` command with `DATABASE_URL="file:./local-dev.db"`.
- This feature is read-only — you should not need any `$transaction` at all. If you think you do, stop and re-read the spec.
- Dark mode: every `bg-white` gets `dark:bg-navy-card`, `text-gray-*` → `dark:text-white/*`, `border-gray-*` → `dark:border-navy-border`.
- DB-backed test files use their OWN unique id prefix + domain, and clean `CrawlRun` by domain BEFORE deleting origin rows (SetNull makes orphans unreachable via FK).
- Client components define LOCAL prop interfaces instead of importing from server-only service modules (see `components/clients/SeoHistoryView.tsx:6-8` for the stated convention). `import type` would compile fine, but follow the repo convention.

**Load-bearing data facts (verified 2026-06-11):**
- `SiteAudit.score` is not reliably persisted (the queue/finalizer never writes it) — site ADA scores exist as scalars ONLY on `CrawlRun.score` (post-A2).
- The standalone ADA completion path does not set `AdaAudit.score` either — but the column exists and SOME legacy rows may have it; treat non-null values as valid points.
- Keyword-research sessions DO get `CrawlRun` rows (the dual-write in `app/api/parse/[sessionId]/route.ts:253` runs for all workflows) — the SEO score series must exclude runs whose session has `workflow='keyword-research'`.
- `CrawlRun.status` is only `'complete' | 'partial'` — error alerts must come from origin-row statuses.
- `CrawlRun.completedAt` is nullable — every point date is `completedAt ?? createdAt`.

---

## File structure

```
lib/services/scorecard-shared.ts        NEW  pure helpers: ScorePoint/ScoreSeries, buildSeries,
                                             buildSeoSeries, buildAdaSeries, latestRunStatus,
                                             maxIso, computeAlerts, constants
lib/services/scorecard-shared.test.ts   NEW  pure unit tests
lib/services/client-fleet.ts            NEW  getClientFleet() — all clients, 6 batched queries
lib/services/client-fleet.test.ts       NEW  DB-backed
lib/services/client-dashboard.ts        NEW  getClientDashboard(id) — one client + timeline
lib/services/client-dashboard.test.ts   NEW  DB-backed
components/clients/Sparkline.tsx        NEW  tiny Recharts line ('use client')
components/clients/Scorecard.tsx        NEW  score + delta + sparkline card ('use client')
components/clients/Scorecard.test.tsx   NEW  jsdom smoke
components/clients/FleetTable.tsx       NEW  sortable fleet table ('use client')
components/clients/FleetTable.test.tsx  NEW  jsdom smoke
components/clients/ActivityTimeline.tsx NEW  server-renderable timeline list
components/clients/ActivityTimeline.test.tsx NEW jsdom smoke
components/clients/ClientHeader.tsx     NEW  server-renderable header
components/clients/IssueTrendCard.tsx   NEW  chart + compare link ('use client'; replaces SeoHistoryView)
components/clients/SeoHistoryView.tsx   DELETE (superseded; SeoHistoryChart.tsx is KEPT and reused)
app/clients/manage/page.tsx             MOVED from app/clients/page.tsx (git mv, content unchanged)
app/clients/page.tsx                    NEW  fleet page (server component)
app/clients/[id]/page.tsx               REWRITE dashboard page (server component)
components/nav.tsx                      MODIFY Clients entry gains a dropdown
components/ada-audit/SiteAuditForm.tsx        MODIFY /clients → /clients/manage (line ~359)
components/ada-audit/ClientsAuditSummary.tsx  MODIFY line ~271 → /clients/manage; line ~306 name link → /clients/${c.clientId}
components/ada-audit/BulkQueueModal.tsx       MODIFY line ~96 → /clients/manage
```

---

### Task 0: Branch

- [ ] **Step 0.1:**

```bash
git checkout main && git pull && git checkout -b feat/client-dashboard-mvp
```

---

### Task 1: `scorecard-shared.ts` — pure helpers

**Files:**
- Create: `lib/services/scorecard-shared.ts`
- Test: `lib/services/scorecard-shared.test.ts`

- [ ] **Step 1.1: Write the failing tests**

```ts
// lib/services/scorecard-shared.test.ts
import { describe, it, expect } from 'vitest'
import {
  buildSeries, buildSeoSeries, buildAdaSeries, computeAlerts, latestRunStatus, maxIso,
  EMPTY_SERIES, SPARKLINE_POINTS, SCORE_DROP_THRESHOLD, STALE_DAYS,
} from './scorecard-shared'

const D = (s: string) => new Date(s)
const NOW = D('2026-06-11T12:00:00.000Z')

describe('buildSeries', () => {
  it('returns EMPTY_SERIES for no points', () => {
    expect(buildSeries([])).toEqual(EMPTY_SERIES)
  })
  it('sorts ascending, computes latest/previous/delta/latestAt', () => {
    const s = buildSeries([
      { date: '2026-06-10T00:00:00.000Z', score: 90 },
      { date: '2026-06-01T00:00:00.000Z', score: 80 },
    ])
    expect(s.latest).toBe(90)
    expect(s.previous).toBe(80)
    expect(s.delta).toBe(10)
    expect(s.latestAt).toBe('2026-06-10T00:00:00.000Z')
    expect(s.points.map((p) => p.score)).toEqual([80, 90])
  })
  it('delta is null with a single point', () => {
    const s = buildSeries([{ date: '2026-06-10T00:00:00.000Z', score: 90 }])
    expect(s.latest).toBe(90)
    expect(s.delta).toBeNull()
    expect(s.previous).toBeNull()
  })
  it(`caps points at ${SPARKLINE_POINTS}, keeping the most recent`, () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, score: i,
    }))
    const s = buildSeries(pts)
    expect(s.points).toHaveLength(SPARKLINE_POINTS)
    expect(s.points[0].score).toBe(20 - SPARKLINE_POINTS)
    expect(s.points[s.points.length - 1].score).toBe(19)
  })
})

describe('buildSeoSeries', () => {
  it('uses completedAt ?? createdAt, skips null scores, builds latestHref from sessionId', () => {
    const { series, latestHref } = buildSeoSeries([
      { score: 80, completedAt: D('2026-06-01T00:00:00.000Z'), createdAt: D('2026-05-31T00:00:00.000Z'), sessionId: 'sess-a' },
      { score: null, completedAt: D('2026-06-05T00:00:00.000Z'), createdAt: D('2026-06-05T00:00:00.000Z'), sessionId: 'sess-skip' },
      { score: 90, completedAt: null, createdAt: D('2026-06-10T00:00:00.000Z'), sessionId: 'sess-b' },
    ])
    expect(series.latest).toBe(90)
    expect(series.delta).toBe(10)
    expect(latestHref).toBe('/seo-parser/results/sess-b')
  })
  it('latestHref is null when the latest run is an orphan (sessionId SetNull)', () => {
    const { latestHref } = buildSeoSeries([
      { score: 90, completedAt: D('2026-06-10T00:00:00.000Z'), createdAt: D('2026-06-10T00:00:00.000Z'), sessionId: null },
    ])
    expect(latestHref).toBeNull()
  })
})

describe('buildAdaSeries', () => {
  const siteRun = { source: 'site-audit' as const, score: 88, completedAt: D('2026-06-10T00:00:00.000Z'), createdAt: D('2026-06-10T00:00:00.000Z'), siteAuditId: 'sa-1', adaAuditId: null }
  const pageRun = { source: 'page-audit' as const, score: 75, completedAt: D('2026-06-09T00:00:00.000Z'), createdAt: D('2026-06-09T00:00:00.000Z'), siteAuditId: null, adaAuditId: 'ada-1' }
  const legacy = (id: string, score: number | null, date: string, status = 'complete') =>
    ({ id, status, score, completedAt: D(date), createdAt: D(date) })

  it('prefers site-audit runs when any exist (page runs ignored)', () => {
    const { series, source } = buildAdaSeries([siteRun, pageRun], [])
    expect(source).toBe('site')
    expect(series.latest).toBe(88)
    expect(series.points).toHaveLength(1)
  })
  it('falls back to page-audit runs merged with non-null legacy scores, deduped by origin id', () => {
    const { series, source, latestHref } = buildAdaSeries(
      [pageRun],
      [legacy('ada-1', 75, '2026-06-09T00:00:00.000Z'), legacy('ada-2', 60, '2026-06-01T00:00:00.000Z')],
    )
    expect(source).toBe('page')
    // ada-1 covered by the CrawlRun point; legacy ada-2 contributes the second point
    expect(series.points.map((p) => p.score)).toEqual([60, 75])
    expect(series.delta).toBe(15)
    expect(latestHref).toBe('/ada-audit/ada-1')
  })
  it('falls back to page audits when site-audit runs exist but none are scored', () => {
    const nullSiteRun = { ...siteRun, score: null }
    const { series, source } = buildAdaSeries([nullSiteRun, pageRun], [])
    expect(source).toBe('page')
    expect(series.latest).toBe(75)
  })
  it('ignores legacy rows with null score or non-complete status', () => {
    const { series, source } = buildAdaSeries([], [
      legacy('ada-3', null, '2026-06-01T00:00:00.000Z'),
      legacy('ada-4', 50, '2026-06-02T00:00:00.000Z', 'error'),
    ])
    expect(source).toBeNull()
    expect(series).toEqual(EMPTY_SERIES)
  })
  it('site latestHref points at the site audit', () => {
    const { latestHref } = buildAdaSeries([siteRun], [])
    expect(latestHref).toBe('/ada-audit/site/sa-1')
  })
})

describe('latestRunStatus', () => {
  it('returns the status of the most recent row by createdAt, null when empty', () => {
    expect(latestRunStatus([])).toBeNull()
    expect(latestRunStatus([
      { createdAt: D('2026-06-01T00:00:00.000Z'), status: 'error' },
      { createdAt: D('2026-06-10T00:00:00.000Z'), status: 'complete' },
    ])).toBe('complete')
  })
})

describe('maxIso', () => {
  it('returns the max ISO string, ignoring nulls; null when all null', () => {
    expect(maxIso([null, '2026-06-01T00:00:00.000Z', '2026-06-10T00:00:00.000Z'])).toBe('2026-06-10T00:00:00.000Z')
    expect(maxIso([null, null])).toBeNull()
    expect(maxIso([])).toBeNull()
  })
})

describe('computeAlerts', () => {
  const recent = '2026-06-10T00:00:00.000Z' // 1 day before NOW
  const base = { seo: EMPTY_SERIES, ada: EMPTY_SERIES, erroredTools: [], lastActivityAt: recent, now: NOW }

  it('no alerts for a healthy recent client', () => {
    expect(computeAlerts(base)).toEqual([])
  })
  it(`score-drop fires at delta <= -${SCORE_DROP_THRESHOLD}, not above`, () => {
    const drop = { ...EMPTY_SERIES, latest: 70, previous: 80, delta: -SCORE_DROP_THRESHOLD }
    expect(computeAlerts({ ...base, seo: drop }).some((a) => a.kind === 'score-drop')).toBe(true)
    const small = { ...EMPTY_SERIES, latest: 71, previous: 80, delta: -(SCORE_DROP_THRESHOLD - 1) }
    expect(computeAlerts({ ...base, seo: small })).toEqual([])
    expect(computeAlerts({ ...base, ada: drop }).some((a) => a.kind === 'score-drop')).toBe(true)
  })
  it('error alert per errored tool', () => {
    const alerts = computeAlerts({ ...base, erroredTools: ['SEO parse', 'site audit'] })
    expect(alerts.filter((a) => a.kind === 'error')).toHaveLength(2)
  })
  it(`stale fires when no activity in ${STALE_DAYS} days or ever`, () => {
    const old = new Date(NOW.getTime() - (STALE_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString()
    expect(computeAlerts({ ...base, lastActivityAt: old }).some((a) => a.kind === 'stale')).toBe(true)
    expect(computeAlerts({ ...base, lastActivityAt: null }).some((a) => a.kind === 'stale')).toBe(true)
    expect(computeAlerts({ ...base, lastActivityAt: recent })).toEqual([])
  })
})
```

- [ ] **Step 1.2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/scorecard-shared.test.ts`
Expected: FAIL — module `./scorecard-shared` not found.

- [ ] **Step 1.3: Implement**

```ts
// lib/services/scorecard-shared.ts
//
// Pure helpers shared by the client fleet and client dashboard services.
// Everything here is scalar-sourced (CrawlRun.score, legacy AdaAudit.score,
// PillarAnalysis.score, Session issue counts) — NEVER blob-derived. Adding a
// blob reader here would block the A2 PRUNE_ACTIVATED flips.

export const SPARKLINE_POINTS = 12
export const SCORE_DROP_THRESHOLD = 10
export const STALE_DAYS = 30

export interface ScorePoint {
  date: string // ISO
  score: number
}

export interface ScoreSeries {
  latest: number | null
  previous: number | null
  /** latest - previous; null when fewer than 2 points. */
  delta: number | null
  latestAt: string | null
  /** Ascending by date, capped at SPARKLINE_POINTS (most recent kept). */
  points: ScorePoint[]
}

export const EMPTY_SERIES: ScoreSeries = { latest: null, previous: null, delta: null, latestAt: null, points: [] }

export function buildSeries(points: ScorePoint[]): ScoreSeries {
  if (points.length === 0) return EMPTY_SERIES
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const latest = sorted[sorted.length - 1]
  const previous = sorted.length >= 2 ? sorted[sorted.length - 2] : null
  return {
    latest: latest.score,
    previous: previous ? previous.score : null,
    delta: previous ? latest.score - previous.score : null,
    latestAt: latest.date,
    points: sorted.slice(-SPARKLINE_POINTS),
  }
}

function pointDate(completedAt: Date | null, createdAt: Date): string {
  return (completedAt ?? createdAt).toISOString()
}

export interface SeoRunRow {
  score: number | null
  completedAt: Date | null
  createdAt: Date
  sessionId: string | null
}

export function buildSeoSeries(runs: SeoRunRow[]): { series: ScoreSeries; latestHref: string | null } {
  const scored = runs
    .filter((r): r is SeoRunRow & { score: number } => r.score !== null)
    .map((r) => ({ date: pointDate(r.completedAt, r.createdAt), score: r.score, href: r.sessionId ? `/seo-parser/results/${r.sessionId}` : null }))
    .sort((a, b) => a.date.localeCompare(b.date))
  return {
    series: buildSeries(scored),
    latestHref: scored.length ? scored[scored.length - 1].href : null,
  }
}

export interface AdaRunRow {
  source: string // 'site-audit' | 'page-audit'
  score: number | null
  completedAt: Date | null
  createdAt: Date
  siteAuditId: string | null
  adaAuditId: string | null
}

export interface LegacyAdaRow {
  id: string
  status: string
  score: number | null
  completedAt: Date | null
  createdAt: Date
}

export type AdaSeriesSource = 'site' | 'page' | null

/**
 * ADA series rule (spec): site-audit CrawlRuns when any SCORED site point
 * exists; otherwise page-audit CrawlRuns merged with non-null legacy
 * AdaAudit.score points, deduped by origin id (CrawlRun point wins).
 * Never mixed.
 */
export function buildAdaSeries(
  runs: AdaRunRow[],
  legacy: LegacyAdaRow[],
): { series: ScoreSeries; source: AdaSeriesSource; latestHref: string | null } {
  const sitePoints = runs
    .filter((r): r is AdaRunRow & { score: number } => r.source === 'site-audit' && r.score !== null)
    .map((r) => ({ date: pointDate(r.completedAt, r.createdAt), score: r.score, href: r.siteAuditId ? `/ada-audit/site/${r.siteAuditId}` : null }))
  if (sitePoints.length) {
    const sorted = sitePoints.sort((a, b) => a.date.localeCompare(b.date))
    return { series: buildSeries(sorted), source: 'site', latestHref: sorted[sorted.length - 1].href }
  }

  const pageRuns = runs.filter((r): r is AdaRunRow & { score: number } => r.source === 'page-audit' && r.score !== null)
  const covered = new Set(pageRuns.map((r) => r.adaAuditId).filter(Boolean))
  const pagePoints = [
    ...pageRuns.map((r) => ({ date: pointDate(r.completedAt, r.createdAt), score: r.score, href: r.adaAuditId ? `/ada-audit/${r.adaAuditId}` : null })),
    ...legacy
      .filter((l): l is LegacyAdaRow & { score: number } => l.status === 'complete' && l.score !== null && !covered.has(l.id))
      .map((l) => ({ date: pointDate(l.completedAt, l.createdAt), score: l.score, href: `/ada-audit/${l.id}` })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  if (pagePoints.length) {
    return { series: buildSeries(pagePoints), source: 'page', latestHref: pagePoints[pagePoints.length - 1].href }
  }
  return { series: EMPTY_SERIES, source: null, latestHref: null }
}

export function latestRunStatus(rows: { createdAt: Date; status: string }[]): string | null {
  if (rows.length === 0) return null
  let latest = rows[0]
  for (const r of rows) if (r.createdAt.getTime() > latest.createdAt.getTime()) latest = r
  return latest.status
}

export function maxIso(dates: (string | null)[]): string | null {
  let max: string | null = null
  for (const d of dates) if (d !== null && (max === null || d > max)) max = d
  return max
}

export type AlertKind = 'score-drop' | 'error' | 'stale'
export interface ClientAlert { kind: AlertKind; detail: string }

export function computeAlerts(args: {
  seo: ScoreSeries
  ada: ScoreSeries
  /** Tools whose most recent run (any status, from ORIGIN rows — never CrawlRun) errored. */
  erroredTools: string[]
  /** ISO date of the most recent completed run/memo of any kind. */
  lastActivityAt: string | null
  now: Date
}): ClientAlert[] {
  const alerts: ClientAlert[] = []
  for (const tool of args.erroredTools) alerts.push({ kind: 'error', detail: `${tool}: latest run failed` })
  if (args.seo.delta !== null && args.seo.delta <= -SCORE_DROP_THRESHOLD) {
    alerts.push({ kind: 'score-drop', detail: `SEO score dropped ${Math.abs(args.seo.delta)}` })
  }
  if (args.ada.delta !== null && args.ada.delta <= -SCORE_DROP_THRESHOLD) {
    alerts.push({ kind: 'score-drop', detail: `ADA score dropped ${Math.abs(args.ada.delta)}` })
  }
  const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000
  if (args.lastActivityAt === null || args.now.getTime() - new Date(args.lastActivityAt).getTime() > staleMs) {
    alerts.push({ kind: 'stale', detail: `no completed activity in ${STALE_DAYS}+ days` })
  }
  return alerts
}
```

- [ ] **Step 1.4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/scorecard-shared.test.ts`
Expected: PASS (all tests).

- [ ] **Step 1.5: Commit**

```bash
git add lib/services/scorecard-shared.ts lib/services/scorecard-shared.test.ts
git commit -m "feat(clients): scorecard-shared pure helpers (series, deltas, alerts)"
```

---

### Task 2: `client-fleet.ts` service

**Files:**
- Create: `lib/services/client-fleet.ts`
- Test: `lib/services/client-fleet.test.ts`

- [ ] **Step 2.1: Write the failing tests**

```ts
// lib/services/client-fleet.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { getClientFleet } from './client-fleet'
import { SCORE_DROP_THRESHOLD } from './scorecard-shared'

const PREFIX = 'test-fleet-'
const DOMAIN = 'client-fleet-test.example'
const NOW = new Date()
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

async function clearTestState() {
  // CrawlRuns by test domain FIRST (SetNull origins make some unreachable via FK).
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.pillarAnalysis.deleteMany({ where: { sessionId: { startsWith: PREFIX } } })
  await prisma.session.deleteMany({ where: { id: { startsWith: PREFIX } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}
beforeEach(clearTestState)
afterAll(clearTestState)

function makeClient(tag: string) {
  return prisma.client.create({
    data: { name: `${PREFIX}${tag}-${randomUUID().slice(0, 8)}`, domains: JSON.stringify([DOMAIN]) },
  })
}

function makeSession(clientId: number, opts: { status?: string; workflow?: string; createdAt?: Date } = {}) {
  return prisma.session.create({
    data: {
      id: PREFIX + randomUUID(),
      status: opts.status ?? 'complete',
      workflow: opts.workflow ?? 'technical',
      files: '[]',
      siteName: DOMAIN,
      clientId,
      createdAt: opts.createdAt ?? daysAgo(1),
    },
  })
}

function makeSeoRun(clientId: number, sessionId: string, score: number, completedAt: Date) {
  return prisma.crawlRun.create({
    data: {
      tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, clientId, sessionId,
      status: 'complete', score, pagesTotal: 1, completedAt, createdAt: completedAt,
    },
  })
}

describe('getClientFleet', () => {
  it('groups interleaved runs by client and computes deltas', async () => {
    const a = await makeClient('a')
    const b = await makeClient('b')
    const sa1 = await makeSession(a.id, { createdAt: daysAgo(10) })
    const sb1 = await makeSession(b.id, { createdAt: daysAgo(9) })
    const sa2 = await makeSession(a.id, { createdAt: daysAgo(2) })
    await makeSeoRun(a.id, sa1.id, 80, daysAgo(10))
    await makeSeoRun(b.id, sb1.id, 70, daysAgo(9))
    await makeSeoRun(a.id, sa2.id, 90, daysAgo(2))

    const rows = await getClientFleet(NOW)
    const rowA = rows.find((r) => r.id === a.id)!
    const rowB = rows.find((r) => r.id === b.id)!
    expect(rowA.seo.latest).toBe(90)
    expect(rowA.seo.delta).toBe(10)
    expect(rowB.seo.latest).toBe(70)
    expect(rowB.seo.delta).toBeNull()
    expect(rowA.firstDomain).toBe(DOMAIN)
  })

  it('excludes keyword-research sessions from the SEO series', async () => {
    const c = await makeClient('kw')
    const tech = await makeSession(c.id, { createdAt: daysAgo(5) })
    const kw = await makeSession(c.id, { workflow: 'keyword-research', createdAt: daysAgo(1) })
    await makeSeoRun(c.id, tech.id, 80, daysAgo(5))
    await makeSeoRun(c.id, kw.id, 99, daysAgo(1)) // keyword runs DO get CrawlRuns — must not pollute
    const row = (await getClientFleet(NOW)).find((r) => r.id === c.id)!
    expect(row.seo.latest).toBe(80)
    expect(row.seo.points).toHaveLength(1)
  })

  it('ADA: site-audit runs win; page fallback merges legacy non-null scores deduped by origin id', async () => {
    const siteClient = await makeClient('site')
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: siteClient.id, completedAt: daysAgo(1) } })
    await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'site-audit', domain: DOMAIN, clientId: siteClient.id, siteAuditId: sa.id, status: 'complete', score: 88, pagesTotal: 5, completedAt: daysAgo(1) },
    })

    const pageClient = await makeClient('page')
    const ada1 = await prisma.adaAudit.create({ data: { url: `https://${DOMAIN}/a`, status: 'complete', clientId: pageClient.id, score: 75, completedAt: daysAgo(2) } })
    await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'page-audit', domain: DOMAIN, clientId: pageClient.id, adaAuditId: ada1.id, status: 'complete', score: 75, pagesTotal: 1, completedAt: daysAgo(2) },
    })
    // legacy-only audit (no CrawlRun) with a persisted score
    await prisma.adaAudit.create({ data: { url: `https://${DOMAIN}/b`, status: 'complete', clientId: pageClient.id, score: 60, completedAt: daysAgo(8) } })

    const rows = await getClientFleet(NOW)
    const siteRow = rows.find((r) => r.id === siteClient.id)!
    expect(siteRow.adaSource).toBe('site')
    expect(siteRow.ada.latest).toBe(88)
    const pageRow = rows.find((r) => r.id === pageClient.id)!
    expect(pageRow.adaSource).toBe('page')
    expect(pageRow.ada.points.map((p) => p.score)).toEqual([60, 75]) // ada1 NOT double-counted
    expect(pageRow.ada.delta).toBe(15)
  })

  it('missing scores are null (not 0) and pillar comes from latest complete analysis', async () => {
    const c = await makeClient('empty')
    const row = (await getClientFleet(NOW)).find((r) => r.id === c.id)!
    expect(row.seo.latest).toBeNull()
    expect(row.ada.latest).toBeNull()
    expect(row.pillarScore).toBeNull()

    const p = await makeClient('pillar')
    const s1 = await makeSession(p.id, { createdAt: daysAgo(10) })
    const s2 = await makeSession(p.id, { createdAt: daysAgo(2) })
    await prisma.pillarAnalysis.create({ data: { sessionId: s1.id, status: 'complete', score: 4, createdAt: daysAgo(10) } })
    await prisma.pillarAnalysis.create({ data: { sessionId: s2.id, status: 'complete', score: 7, createdAt: daysAgo(2) } })
    const pRow = (await getClientFleet(NOW)).find((r) => r.id === p.id)!
    expect(pRow.pillarScore).toBe(7)
  })

  it('error alert comes from origin-row status; stale alert from inactivity', async () => {
    const err = await makeClient('err')
    await makeSession(err.id, { status: 'complete', createdAt: daysAgo(10) })
    await makeSession(err.id, { status: 'error', createdAt: daysAgo(1) }) // latest technical parse errored
    const errRow = (await getClientFleet(NOW)).find((r) => r.id === err.id)!
    expect(errRow.alerts.some((a) => a.kind === 'error')).toBe(true)

    const stale = await makeClient('stale')
    await makeSession(stale.id, { createdAt: daysAgo(45) })
    const staleRow = (await getClientFleet(NOW)).find((r) => r.id === stale.id)!
    expect(staleRow.alerts.some((a) => a.kind === 'stale')).toBe(true)

    const fresh = await makeClient('fresh')
    const fs = await makeSession(fresh.id, { createdAt: daysAgo(1) })
    await makeSeoRun(fresh.id, fs.id, 90, daysAgo(1))
    const freshRow = (await getClientFleet(NOW)).find((r) => r.id === fresh.id)!
    expect(freshRow.alerts).toEqual([])
  })

  it('score-drop alert fires on the SEO delta threshold', async () => {
    const c = await makeClient('drop')
    const s1 = await makeSession(c.id, { createdAt: daysAgo(10) })
    const s2 = await makeSession(c.id, { createdAt: daysAgo(1) })
    await makeSeoRun(c.id, s1.id, 90, daysAgo(10))
    await makeSeoRun(c.id, s2.id, 90 - SCORE_DROP_THRESHOLD, daysAgo(1))
    const row = (await getClientFleet(NOW)).find((r) => r.id === c.id)!
    expect(row.alerts.some((a) => a.kind === 'score-drop')).toBe(true)
  })
})
```

- [ ] **Step 2.2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/client-fleet.test.ts`
Expected: FAIL — module `./client-fleet` not found.

- [ ] **Step 2.3: Implement**

```ts
// lib/services/client-fleet.ts
//
// Fleet view: every client × latest scores × alerts, from scalar columns only.
// Fixed query count (6 findMany, batched) — aggregation happens in JS.
// ~30 clients × a few hundred rows total; well inside SQLite comfort.

import { prisma } from '@/lib/db'
import {
  buildAdaSeries, buildSeoSeries, computeAlerts, latestRunStatus, maxIso,
  type AdaSeriesSource, type ClientAlert, type ScoreSeries,
} from './scorecard-shared'

export interface FleetRow {
  id: number
  name: string
  firstDomain: string | null
  seo: ScoreSeries
  ada: ScoreSeries
  adaSource: AdaSeriesSource
  pillarScore: number | null
  pillarAt: string | null
  lastActivityAt: string | null
  alerts: ClientAlert[]
}

function parseFirstDomain(domains: string): string | null {
  try {
    const arr = JSON.parse(domains)
    return Array.isArray(arr) && typeof arr[0] === 'string' ? arr[0] : null
  } catch {
    return null
  }
}

export async function getClientFleet(now: Date = new Date()): Promise<FleetRow[]> {
  const [clients, sessions, crawlRuns, standaloneAda, siteAudits, pillars] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, domains: true } }),
    prisma.session.findMany({
      where: { clientId: { not: null } },
      select: { id: true, clientId: true, status: true, workflow: true, createdAt: true },
    }),
    prisma.crawlRun.findMany({
      where: { clientId: { not: null } },
      select: {
        clientId: true, tool: true, source: true, score: true, completedAt: true,
        createdAt: true, sessionId: true, siteAuditId: true, adaAuditId: true,
      },
    }),
    prisma.adaAudit.findMany({
      where: { clientId: { not: null }, siteAuditId: null },
      select: { id: true, clientId: true, status: true, score: true, completedAt: true, createdAt: true },
    }),
    prisma.siteAudit.findMany({
      where: { clientId: { not: null } },
      select: { clientId: true, status: true, completedAt: true, createdAt: true },
    }),
    prisma.pillarAnalysis.findMany({
      where: { session: { clientId: { not: null } } },
      select: { score: true, status: true, createdAt: true, session: { select: { clientId: true } } },
    }),
  ])

  // Keyword-research sessions get CrawlRuns too (the dual-write runs for all
  // workflows) — they must not pollute the SEO health series. Accepted gap
  // (spec): once a keyword session EXPIRES, its orphaned run (sessionId null)
  // is indistinguishable from an orphaned technical run and joins the series;
  // CrawlRun has no workflow column and orphan technical points matter more.
  const keywordSessionIds = new Set(sessions.filter((s) => s.workflow === 'keyword-research').map((s) => s.id))

  return clients.map((c) => {
    const mySessions = sessions.filter((s) => s.clientId === c.id)
    const myRuns = crawlRuns.filter((r) => r.clientId === c.id)
    const myAda = standaloneAda.filter((a) => a.clientId === c.id)
    const mySiteAudits = siteAudits.filter((a) => a.clientId === c.id)
    const myPillars = pillars.filter((p) => p.session?.clientId === c.id)

    const { series: seo } = buildSeoSeries(
      myRuns.filter((r) => r.tool === 'seo-parser' && !(r.sessionId && keywordSessionIds.has(r.sessionId))),
    )
    const { series: ada, source: adaSource } = buildAdaSeries(
      myRuns.filter((r) => r.tool === 'ada-audit'),
      myAda,
    )

    const completePillars = myPillars
      .filter((p) => p.status === 'complete' && p.score !== null)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    const latestPillar = completePillars.length ? completePillars[completePillars.length - 1] : null

    // Staleness = completed runs + pillar analyses (spec: memo/roadmap
    // generation is session-attached; sessions are the activity proxy).
    const lastActivityAt = maxIso([
      ...mySessions.filter((s) => s.status === 'complete').map((s) => s.createdAt.toISOString()),
      ...mySiteAudits.filter((a) => a.status === 'complete').map((a) => (a.completedAt ?? a.createdAt).toISOString()),
      ...myAda.filter((a) => a.status === 'complete').map((a) => (a.completedAt ?? a.createdAt).toISOString()),
      ...completePillars.map((p) => p.createdAt.toISOString()),
    ])

    const erroredTools: string[] = []
    if (latestRunStatus(mySessions.filter((s) => s.workflow === 'technical')) === 'error') erroredTools.push('SEO parse')
    if (latestRunStatus(mySessions.filter((s) => s.workflow === 'keyword-research')) === 'error') erroredTools.push('keyword research')
    if (latestRunStatus(mySiteAudits) === 'error') erroredTools.push('site audit')
    if (latestRunStatus(myAda) === 'error') erroredTools.push('ADA audit')
    if (latestRunStatus(myPillars) === 'error') erroredTools.push('pillar analysis')

    return {
      id: c.id,
      name: c.name,
      firstDomain: parseFirstDomain(c.domains),
      seo,
      ada,
      adaSource,
      pillarScore: latestPillar ? latestPillar.score : null,
      pillarAt: latestPillar ? latestPillar.createdAt.toISOString() : null,
      lastActivityAt,
      alerts: computeAlerts({ seo, ada, erroredTools, lastActivityAt, now }),
    }
  })
}
```

- [ ] **Step 2.4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/client-fleet.test.ts`
Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add lib/services/client-fleet.ts lib/services/client-fleet.test.ts
git commit -m "feat(clients): getClientFleet service — scalar-only fleet rows with alerts"
```

---

### Task 3: `client-dashboard.ts` service

**Files:**
- Create: `lib/services/client-dashboard.ts`
- Test: `lib/services/client-dashboard.test.ts`

- [ ] **Step 3.1: Write the failing tests**

```ts
// lib/services/client-dashboard.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { getClientDashboard, TIMELINE_CAP } from './client-dashboard'

const PREFIX = 'test-dash-'
const DOMAIN = 'client-dash-test.example'
const NOW = new Date()
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

async function clearTestState() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.seoRoadmap.deleteMany({ where: { sessionId: { startsWith: PREFIX } } })
  await prisma.keywordResearchSession.deleteMany({ where: { sessionId: { startsWith: PREFIX } } })
  await prisma.pillarAnalysis.deleteMany({ where: { sessionId: { startsWith: PREFIX } } })
  await prisma.session.deleteMany({ where: { id: { startsWith: PREFIX } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  await prisma.schedule.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}
beforeEach(clearTestState)
afterAll(clearTestState)

function makeClient() {
  return prisma.client.create({
    data: {
      name: `${PREFIX}${randomUUID().slice(0, 8)}`,
      domains: JSON.stringify([DOMAIN, 'alt.example']),
      seedUrls: JSON.stringify([`https://${DOMAIN}/`]),
      teamworkTasklistId: 'tw-123',
    },
  })
}

describe('getClientDashboard', () => {
  it('returns null client for unknown id', async () => {
    const d = await getClientDashboard(99999999, NOW)
    expect(d.client).toBeNull()
  })

  it('empty client yields a valid empty shape', async () => {
    const c = await makeClient()
    const d = await getClientDashboard(c.id, NOW)
    expect(d.client!.name).toBe(c.name)
    expect(d.client!.domains).toEqual([DOMAIN, 'alt.example'])
    expect(d.client!.teamworkTasklistId).toBe('tw-123')
    expect(d.seo.series.latest).toBeNull()
    expect(d.ada.series.latest).toBeNull()
    expect(d.pillar.series.latest).toBeNull()
    expect(d.seoCounts).toBeNull()
    expect(d.timeline).toEqual([])
    expect(d.schedules).toEqual([])
  })

  it('builds all six timeline item types with correct hrefs, newest first', async () => {
    const c = await makeClient()
    const tech = await prisma.session.create({
      data: {
        id: PREFIX + randomUUID(), status: 'complete', workflow: 'technical', files: '[]',
        siteName: DOMAIN, clientId: c.id, createdAt: daysAgo(6),
        totalUrls: 100, criticalCount: 5, warningCount: 10, noticeCount: 20,
      },
    })
    const kw = await prisma.session.create({
      data: {
        id: PREFIX + randomUUID(), status: 'complete', workflow: 'keyword-research', files: '[]',
        siteName: DOMAIN, clientId: c.id, createdAt: daysAgo(5),
      },
    })
    await prisma.pillarAnalysis.create({ data: { sessionId: tech.id, status: 'complete', score: 7, createdAt: daysAgo(4) } })
    await prisma.seoRoadmap.create({ data: { sessionId: tech.id, status: 'complete', createdAt: daysAgo(3) } })
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: c.id, pagesTotal: 23, createdAt: daysAgo(2), completedAt: daysAgo(2) } })
    const ada = await prisma.adaAudit.create({ data: { url: `https://${DOMAIN}/x`, status: 'complete', clientId: c.id, score: 91, createdAt: daysAgo(1), completedAt: daysAgo(1) } })

    const d = await getClientDashboard(c.id, NOW)
    const types = d.timeline.map((t) => t.type)
    expect(types).toEqual(['ada-audit', 'site-audit', 'seo-roadmap', 'pillar-analysis', 'keyword-research', 'seo-parse'])
    const byType = Object.fromEntries(d.timeline.map((t) => [t.type, t]))
    expect(byType['seo-parse'].href).toBe(`/seo-parser/results/${tech.id}`)
    expect(byType['keyword-research'].href).toBe(`/keyword-research/${kw.id}`)
    expect(byType['site-audit'].href).toBe(`/ada-audit/site/${sa.id}`)
    expect(byType['ada-audit'].href).toBe(`/ada-audit/${ada.id}`)
    expect(byType['seo-roadmap'].href).toBe(`/seo-parser/results/${tech.id}`)
    expect(byType['pillar-analysis'].href).toMatch(/^\/pillar-analysis\//)
    expect(byType['site-audit'].stat).toBe('23 pages')
  })

  it(`caps the timeline at ${TIMELINE_CAP}`, async () => {
    const c = await makeClient()
    for (let i = 0; i < TIMELINE_CAP + 5; i++) {
      await prisma.adaAudit.create({
        data: { url: `https://${DOMAIN}/p${i}`, status: 'complete', clientId: c.id, createdAt: daysAgo(i) },
      })
    }
    const d = await getClientDashboard(c.id, NOW)
    expect(d.timeline).toHaveLength(TIMELINE_CAP)
  })

  it('orphaned CrawlRun contributes a score point but no timeline row; latestHref null', async () => {
    const c = await makeClient()
    const s = await prisma.session.create({
      data: { id: PREFIX + randomUUID(), status: 'complete', workflow: 'technical', files: '[]', siteName: DOMAIN, clientId: c.id, createdAt: daysAgo(2) },
    })
    await prisma.crawlRun.create({
      data: { tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, clientId: c.id, sessionId: s.id, status: 'complete', score: 85, pagesTotal: 1, completedAt: daysAgo(2) },
    })
    await prisma.session.delete({ where: { id: s.id } }) // SetNull → orphan run keeps clientId

    const d = await getClientDashboard(c.id, NOW)
    expect(d.seo.series.latest).toBe(85)
    expect(d.seo.latestHref).toBeNull()
    expect(d.timeline.filter((t) => t.type === 'seo-parse')).toHaveLength(0)
  })

  it('standalone ADA timeline stat prefers the CrawlRun score over the (usually null) legacy column', async () => {
    const c = await makeClient()
    const ada = await prisma.adaAudit.create({
      data: { url: `https://${DOMAIN}/scored`, status: 'complete', clientId: c.id, score: null, createdAt: daysAgo(1), completedAt: daysAgo(1) },
    })
    await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'page-audit', domain: DOMAIN, clientId: c.id, adaAuditId: ada.id, status: 'complete', score: 77, pagesTotal: 1, completedAt: daysAgo(1) },
    })
    const d = await getClientDashboard(c.id, NOW)
    expect(d.timeline.find((t) => t.type === 'ada-audit')!.stat).toBe('Score 77')
  })

  it('seoCounts from the latest complete technical session with counts; schedules listed', async () => {
    const c = await makeClient()
    await prisma.session.create({
      data: {
        id: PREFIX + randomUUID(), status: 'complete', workflow: 'technical', files: '[]',
        siteName: DOMAIN, clientId: c.id, createdAt: daysAgo(1),
        totalUrls: 200, criticalCount: 3, warningCount: 7, noticeCount: 9,
      },
    })
    await prisma.schedule.create({
      data: { jobType: 'site-audit-discover', cadence: 'weekly:1@09:00', nextRunAt: daysAgo(-7), clientId: c.id },
    })
    const d = await getClientDashboard(c.id, NOW)
    expect(d.seoCounts).toEqual({ totalUrls: 200, criticalCount: 3, warningCount: 7, noticeCount: 9, at: expect.any(String) })
    expect(d.schedules).toHaveLength(1)
    expect(d.schedules[0].cadence).toBe('weekly:1@09:00')
  })
})
```

- [ ] **Step 3.2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/client-dashboard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement**

```ts
// lib/services/client-dashboard.ts
//
// One client's dashboard: header info, three scorecards (scalar-only score
// series + deep link to the latest source run), schedules, and a reverse-chron
// activity timeline built from ORIGIN rows (deep links never dangle; orphaned
// CrawlRuns contribute score points but no timeline rows).

import { prisma } from '@/lib/db'
import {
  buildAdaSeries, buildSeries, buildSeoSeries,
  type AdaSeriesSource, type ScoreSeries,
} from './scorecard-shared'

export const TIMELINE_CAP = 50

export type TimelineType =
  | 'seo-parse' | 'keyword-research' | 'site-audit' | 'ada-audit' | 'pillar-analysis' | 'seo-roadmap'

export interface TimelineItem {
  type: TimelineType
  id: string
  title: string
  status: string
  date: string // ISO
  href: string
  stat: string | null
}

export interface ScorecardData {
  series: ScoreSeries
  latestHref: string | null
}

export interface ClientDashboard {
  client: {
    id: number
    name: string
    domains: string[]
    seedUrls: string[]
    teamworkTasklistId: string | null
    createdAt: string
  } | null
  seo: ScorecardData
  seoCounts: { totalUrls: number | null; criticalCount: number; warningCount: number; noticeCount: number; at: string } | null
  ada: ScorecardData
  adaSource: AdaSeriesSource
  pillar: ScorecardData
  schedules: { jobType: string; cadence: string; nextRunAt: string }[]
  timeline: TimelineItem[]
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const EMPTY: Omit<ClientDashboard, 'client'> = {
  seo: { series: buildSeries([]), latestHref: null },
  seoCounts: null,
  ada: { series: buildSeries([]), latestHref: null },
  adaSource: null,
  pillar: { series: buildSeries([]), latestHref: null },
  schedules: [],
  timeline: [],
}

export async function getClientDashboard(clientId: number, _now: Date = new Date()): Promise<ClientDashboard> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, domains: true, seedUrls: true, teamworkTasklistId: true, createdAt: true },
  })
  if (!client) return { client: null, ...EMPTY }

  const [sessions, siteAudits, standaloneAda, crawlRuns, schedules] = await Promise.all([
    prisma.session.findMany({
      where: { clientId },
      select: {
        id: true, status: true, workflow: true, createdAt: true, siteName: true,
        totalUrls: true, criticalCount: true, warningCount: true, noticeCount: true,
        pillarAnalyses: { select: { id: true, status: true, score: true, createdAt: true } },
        seoRoadmap: { select: { id: true, status: true, createdAt: true } },
      },
    }),
    prisma.siteAudit.findMany({
      where: { clientId },
      select: { id: true, domain: true, status: true, pagesTotal: true, createdAt: true, completedAt: true },
    }),
    prisma.adaAudit.findMany({
      where: { clientId, siteAuditId: null },
      select: { id: true, url: true, status: true, score: true, createdAt: true, completedAt: true },
    }),
    prisma.crawlRun.findMany({
      where: { clientId },
      select: {
        tool: true, source: true, score: true, completedAt: true, createdAt: true,
        sessionId: true, siteAuditId: true, adaAuditId: true,
      },
    }),
    prisma.schedule.findMany({
      where: { clientId, enabled: true },
      select: { jobType: true, cadence: true, nextRunAt: true },
    }),
  ])

  const keywordSessionIds = new Set(sessions.filter((s) => s.workflow === 'keyword-research').map((s) => s.id))
  const seo = buildSeoSeries(
    crawlRuns.filter((r) => r.tool === 'seo-parser' && !(r.sessionId && keywordSessionIds.has(r.sessionId))),
  )
  const adaResult = buildAdaSeries(crawlRuns.filter((r) => r.tool === 'ada-audit'), standaloneAda)

  const completePillars = sessions
    .flatMap((s) => s.pillarAnalyses)
    .filter((p) => p.status === 'complete' && p.score !== null)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const pillar: ScorecardData = {
    series: buildSeries(completePillars.map((p) => ({ date: p.createdAt.toISOString(), score: p.score as number }))),
    latestHref: completePillars.length ? `/pillar-analysis/${completePillars[completePillars.length - 1].id}` : null,
  }

  const latestTechWithCounts = sessions
    .filter((s) => s.workflow === 'technical' && s.status === 'complete' && s.criticalCount !== null)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .pop()
  const seoCounts = latestTechWithCounts
    ? {
        totalUrls: latestTechWithCounts.totalUrls,
        criticalCount: latestTechWithCounts.criticalCount as number,
        warningCount: latestTechWithCounts.warningCount ?? 0,
        noticeCount: latestTechWithCounts.noticeCount ?? 0,
        at: latestTechWithCounts.createdAt.toISOString(),
      }
    : null

  const timeline: TimelineItem[] = []
  for (const s of sessions) {
    if (s.workflow === 'keyword-research') {
      timeline.push({
        type: 'keyword-research', id: s.id, title: s.siteName ?? s.id, status: s.status,
        date: s.createdAt.toISOString(), href: `/keyword-research/${s.id}`,
        stat: s.totalUrls !== null ? `${s.totalUrls} URLs` : null,
      })
    } else {
      timeline.push({
        type: 'seo-parse', id: s.id, title: s.siteName ?? s.id, status: s.status,
        date: s.createdAt.toISOString(), href: `/seo-parser/results/${s.id}`,
        stat: s.totalUrls !== null ? `${s.totalUrls} URLs · ${s.criticalCount ?? 0} critical` : null,
      })
    }
    for (const p of s.pillarAnalyses) {
      timeline.push({
        type: 'pillar-analysis', id: p.id, title: s.siteName ?? s.id, status: p.status,
        date: p.createdAt.toISOString(), href: `/pillar-analysis/${p.id}`,
        stat: p.score !== null ? `Score ${p.score}/10` : null,
      })
    }
    if (s.seoRoadmap) {
      timeline.push({
        type: 'seo-roadmap', id: s.seoRoadmap.id, title: s.siteName ?? s.id, status: s.seoRoadmap.status,
        date: s.seoRoadmap.createdAt.toISOString(), href: `/seo-parser/results/${s.id}`, stat: null,
      })
    }
  }
  for (const a of siteAudits) {
    timeline.push({
      type: 'site-audit', id: a.id, title: a.domain, status: a.status,
      date: a.createdAt.toISOString(), href: `/ada-audit/site/${a.id}`,
      stat: a.pagesTotal > 0 ? `${a.pagesTotal} pages` : null,
    })
  }
  // Standalone AdaAudit.score is rarely persisted (the completion path doesn't
  // set it) — prefer the A2 CrawlRun score, fall back to the legacy column.
  const pageRunScores = new Map(
    crawlRuns
      .filter((r) => r.tool === 'ada-audit' && r.source === 'page-audit' && r.adaAuditId && r.score !== null)
      .map((r) => [r.adaAuditId as string, r.score as number]),
  )
  for (const a of standaloneAda) {
    const score = pageRunScores.get(a.id) ?? a.score
    timeline.push({
      type: 'ada-audit', id: a.id, title: a.url, status: a.status,
      date: a.createdAt.toISOString(), href: `/ada-audit/${a.id}`,
      stat: score !== null ? `Score ${score}` : null,
    })
  }
  timeline.sort((a, b) => b.date.localeCompare(a.date))

  return {
    client: {
      id: client.id,
      name: client.name,
      domains: parseJsonArray(client.domains),
      seedUrls: parseJsonArray(client.seedUrls),
      teamworkTasklistId: client.teamworkTasklistId,
      createdAt: client.createdAt.toISOString(),
    },
    seo,
    seoCounts,
    ada: { series: adaResult.series, latestHref: adaResult.latestHref },
    adaSource: adaResult.source,
    pillar,
    schedules: schedules.map((s) => ({ jobType: s.jobType, cadence: s.cadence, nextRunAt: s.nextRunAt.toISOString() })),
    timeline: timeline.slice(0, TIMELINE_CAP),
  }
}
```

Note: `_now` keeps signature symmetry with `getClientFleet` (the tests pass it);
alerts are fleet-only so it is intentionally unused — the underscore prefix
satisfies the linter.

- [ ] **Step 3.4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/client-dashboard.test.ts`
Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
git add lib/services/client-dashboard.ts lib/services/client-dashboard.test.ts
git commit -m "feat(clients): getClientDashboard service — scorecards + origin-row timeline"
```

---

### Task 4: `Sparkline` + `Scorecard` components

**Files:**
- Create: `components/clients/Sparkline.tsx`
- Create: `components/clients/Scorecard.tsx`
- Test: `components/clients/Scorecard.test.tsx`

- [ ] **Step 4.1: Implement `Sparkline.tsx`** (no test of its own — covered by Scorecard smoke + dynamic import is ssr:false)

```tsx
'use client'

// components/clients/Sparkline.tsx
// Minimal score sparkline. Loaded via next/dynamic ssr:false from Scorecard.

import { LineChart, Line, YAxis, ResponsiveContainer } from 'recharts'

export interface SparklinePoint { date: string; score: number }

export function Sparkline({ points, color = '#f5a623' }: { points: SparklinePoint[]; color?: string }) {
  if (points.length < 2) return <div className="h-10" aria-hidden="true" />
  return (
    <div className="h-10">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line type="monotone" dataKey="score" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
```

- [ ] **Step 4.2: Write the failing Scorecard test**

```tsx
// @vitest-environment jsdom
// components/clients/Scorecard.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Scorecard } from './Scorecard'

describe('Scorecard', () => {
  it('renders the score, max and an up-delta', () => {
    render(<Scorecard label="SEO Health" score={90} max={100} delta={5} asOf="2026-06-10T00:00:00.000Z" href="/seo-parser/results/x" points={[]} />)
    expect(screen.getByText('90')).toBeTruthy()
    expect(screen.getByText('▲ 5')).toBeTruthy()
    expect(screen.getByText('SEO Health')).toBeTruthy()
  })
  it('renders a down-delta', () => {
    render(<Scorecard label="ADA" score={60} max={100} delta={-12} asOf={null} href={null} points={[]} />)
    expect(screen.getByText('▼ 12')).toBeTruthy()
  })
  it('renders the empty state when score is null', () => {
    render(<Scorecard label="Pillar" score={null} max={10} delta={null} asOf={null} href={null} points={[]} />)
    expect(screen.getByText('No runs yet')).toBeTruthy()
  })
  it('shows the source note when provided', () => {
    render(<Scorecard label="ADA" score={75} max={100} delta={null} asOf={null} href={null} points={[]} sourceNote="page audits" />)
    expect(screen.getByText('page audits')).toBeTruthy()
  })
})
```

- [ ] **Step 4.3: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/Scorecard.test.tsx`
Expected: FAIL — module `./Scorecard` not found.

- [ ] **Step 4.4: Implement `Scorecard.tsx`**

```tsx
'use client'

// components/clients/Scorecard.tsx
//
// One dashboard scorecard: big score + delta vs previous run + sparkline +
// "as of" link to the source run. Client component because the sparkline is a
// dynamic ssr:false import (Recharts).

import dynamic from 'next/dynamic'
import { RelativeTime } from '@/app/pillar-analysis/[id]/components/RelativeTime'
import type { ReactNode } from 'react'

const Sparkline = dynamic(() => import('./Sparkline').then((m) => ({ default: m.Sparkline })), { ssr: false })

export interface ScorecardProps {
  label: string
  score: number | null
  max: 100 | 10
  delta: number | null
  asOf: string | null // ISO of the latest point
  href: string | null // detail view of the latest source run
  points: { date: string; score: number }[]
  sourceNote?: string // e.g. "page audits" for the standalone-ADA fallback
  children?: ReactNode // extra chips (SEO issue counts)
}

function scoreColor(score: number, max: 100 | 10): string {
  const [green, amber] = max === 100 ? [90, 70] : [8, 5]
  if (score >= green) return 'text-green-600 dark:text-green-400'
  if (score >= amber) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

export function Scorecard({ label, score, max, delta, asOf, href, points, sourceNote, children }: ScorecardProps) {
  return (
    <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-white/40">{label}</h3>
        {sourceNote && (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60">
            {sourceNote}
          </span>
        )}
      </div>
      {score === null ? (
        <p className="mt-4 text-sm text-gray-400 dark:text-white/40">No runs yet</p>
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-5xl font-display font-bold ${scoreColor(score, max)}`}>{score}</span>
            <span className="text-sm text-gray-400 dark:text-white/40">/{max}</span>
            {delta !== null && delta !== 0 && (
              <span
                className={`px-1.5 py-0.5 rounded text-[11px] font-semibold tabular-nums ${
                  delta > 0
                    ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
                    : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
                }`}
              >
                {delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`}
              </span>
            )}
          </div>
          <Sparkline points={points} />
          {asOf && (
            <p className="mt-1 text-[11px] text-gray-400 dark:text-white/40">
              as of <RelativeTime value={asOf} className="text-gray-500 dark:text-white/60" />
              {href && (
                <>
                  {' · '}
                  <a href={href} className="text-[#f5a623] hover:text-[#e09415] font-semibold">View →</a>
                </>
              )}
            </p>
          )}
          {children}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4.5: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/Scorecard.test.tsx`
Expected: PASS. (If jsdom complains about `next/dynamic` + ssr:false, the dynamic
import resolves client-side in jsdom and renders the empty `h-10` div for <2
points — no mock needed. If it still fails, mock `./Sparkline` with
`vi.mock('./Sparkline', () => ({ Sparkline: () => null }))` at the top of the test.)

- [ ] **Step 4.6: Commit**

```bash
git add components/clients/Sparkline.tsx components/clients/Scorecard.tsx components/clients/Scorecard.test.tsx
git commit -m "feat(clients): Scorecard + Sparkline components"
```

---

### Task 5: `FleetTable` component

**Files:**
- Create: `components/clients/FleetTable.tsx`
- Test: `components/clients/FleetTable.test.tsx`

- [ ] **Step 5.1: Write the failing test**

```tsx
// @vitest-environment jsdom
// components/clients/FleetTable.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { FleetTable, type FleetTableRow } from './FleetTable'

const series = (latest: number | null, delta: number | null) => ({
  latest, previous: null, delta, latestAt: latest !== null ? '2026-06-10T00:00:00.000Z' : null, points: [],
})

const row = (over: Partial<FleetTableRow>): FleetTableRow => ({
  id: 1, name: 'Acme College', firstDomain: 'acme.example',
  seo: series(90, 5), ada: series(80, null), adaSource: 'site',
  pillarScore: 7, pillarAt: '2026-06-01T00:00:00.000Z',
  lastActivityAt: '2026-06-10T00:00:00.000Z', alerts: [], ...over,
})

describe('FleetTable', () => {
  it('renders client rows with scores and dashboard links', () => {
    render(<FleetTable rows={[row({})]} />)
    expect(screen.getByText('Acme College')).toBeTruthy()
    expect(screen.getByText('90')).toBeTruthy()
    const link = screen.getByText('Acme College').closest('a')
    expect(link?.getAttribute('href')).toBe('/clients/1')
  })
  it('renders em-dash for missing scores, never 0', () => {
    render(<FleetTable rows={[row({ id: 2, name: 'Empty Co', seo: series(null, null), ada: series(null, null), adaSource: null, pillarScore: null })]} />)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })
  it('renders alert chips', () => {
    render(<FleetTable rows={[row({ id: 3, name: 'Bad Co', alerts: [{ kind: 'error', detail: 'SEO parse: latest run failed' }, { kind: 'stale', detail: 'no completed activity in 30+ days' }] })]} />)
    expect(screen.getByText('error')).toBeTruthy()
    expect(screen.getByText('stale')).toBeTruthy()
  })
  it('shows the page-audit suffix on the ADA cell', () => {
    render(<FleetTable rows={[row({ id: 4, name: 'Page Co', adaSource: 'page', ada: series(75, null) })]} />)
    expect(screen.getByText('page')).toBeTruthy()
  })
  it('renders the empty state with a manage link', () => {
    render(<FleetTable rows={[]} />)
    expect(screen.getByText(/No clients yet/)).toBeTruthy()
  })
})
```

- [ ] **Step 5.2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/FleetTable.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement `FleetTable.tsx`**

```tsx
'use client'

// components/clients/FleetTable.tsx
//
// The "Monday morning" fleet table: all clients × latest scores × alerts.
// Client component for client-side sorting over server-passed props. Local
// prop interfaces (repo convention: don't import from server-only services).

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { RelativeTime } from '@/app/pillar-analysis/[id]/components/RelativeTime'

interface SeriesProp {
  latest: number | null
  previous: number | null
  delta: number | null
  latestAt: string | null
  points: { date: string; score: number }[]
}

export interface FleetTableRow {
  id: number
  name: string
  firstDomain: string | null
  seo: SeriesProp
  ada: SeriesProp
  adaSource: 'site' | 'page' | null
  pillarScore: number | null
  pillarAt: string | null
  lastActivityAt: string | null
  alerts: { kind: 'score-drop' | 'error' | 'stale'; detail: string }[]
}

type SortKey = 'default' | 'name' | 'seo' | 'ada' | 'pillar' | 'activity'

const ALERT_CLASSES: Record<FleetTableRow['alerts'][number]['kind'], string> = {
  error: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  'score-drop': 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  stale: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60',
}

function DeltaChip({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return null
  return (
    <span
      className={`ml-1.5 px-1 py-0.5 rounded text-[10px] font-semibold tabular-nums ${
        delta > 0
          ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
          : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
      }`}
    >
      {delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
    </span>
  )
}

function ScoreCell({ series, suffix }: { series: SeriesProp; suffix?: string }) {
  if (series.latest === null) return <span className="text-gray-300 dark:text-white/20">—</span>
  return (
    <span className="tabular-nums">
      <span className="font-semibold text-[#1c2d4a] dark:text-white">{series.latest}</span>
      {suffix && (
        <span className="ml-1 px-1 py-0.5 rounded text-[10px] font-semibold uppercase bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50">
          {suffix}
        </span>
      )}
      <DeltaChip delta={series.delta} />
    </span>
  )
}

export function FleetTable({ rows }: { rows: FleetTableRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('default')
  const [asc, setAsc] = useState(false)

  const sorted = useMemo(() => {
    const copy = [...rows]
    const num = (v: number | null) => (v === null ? -1 : v)
    const str = (v: string | null) => v ?? ''
    switch (sortKey) {
      case 'name':
        copy.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'seo':
        copy.sort((a, b) => num(b.seo.latest) - num(a.seo.latest))
        break
      case 'ada':
        copy.sort((a, b) => num(b.ada.latest) - num(a.ada.latest))
        break
      case 'pillar':
        copy.sort((a, b) => num(b.pillarScore) - num(a.pillarScore))
        break
      case 'activity':
        copy.sort((a, b) => str(b.lastActivityAt).localeCompare(str(a.lastActivityAt)))
        break
      default:
        // Alerts first (most alerts at top), then name.
        copy.sort((a, b) => b.alerts.length - a.alerts.length || a.name.localeCompare(b.name))
    }
    if (asc && sortKey !== 'default') copy.reverse()
    return copy
  }, [rows, sortKey, asc])

  function clickSort(key: SortKey) {
    if (key === sortKey) setAsc(!asc)
    else {
      setSortKey(key)
      setAsc(false)
    }
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-10 text-center">
        <p className="text-sm text-gray-500 dark:text-white/60">
          No clients yet —{' '}
          <Link href="/clients/manage" className="text-[#f5a623] hover:text-[#e09415] font-semibold">add one →</Link>
        </p>
      </div>
    )
  }

  const header = (label: string, key: SortKey, align: 'left' | 'right' = 'left') => (
    // Full class literals (not `text-${align}`) so Tailwind's scanner sees them.
    <th className={`px-5 py-3 font-semibold ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => clickSort(key)}
        className={`uppercase tracking-wide text-xs ${sortKey === key ? 'text-[#f5a623]' : 'text-gray-400 dark:text-white/40'} hover:text-[#f5a623]`}
      >
        {label}{sortKey === key ? (asc ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  )

  return (
    <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-navy-border text-left">
              {header('Client', 'name')}
              {header('SEO', 'seo', 'right')}
              {header('ADA', 'ada', 'right')}
              {header('Pillar', 'pillar', 'right')}
              {header('Last activity', 'activity')}
              <th className="px-5 py-3 font-semibold text-left text-xs uppercase tracking-wide text-gray-400 dark:text-white/40">Alerts</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="border-b border-gray-50 dark:border-navy-border/50 last:border-0 hover:bg-gray-50 dark:hover:bg-navy-light/40 transition-colors">
                <td className="px-5 py-3">
                  <Link href={`/clients/${r.id}`} className="font-semibold text-[#1c2d4a] dark:text-white hover:text-[#f5a623] dark:hover:text-[#f5a623] transition-colors">
                    {r.name}
                  </Link>
                  {r.firstDomain && <div className="text-[11px] text-gray-400 dark:text-white/40">{r.firstDomain}</div>}
                </td>
                <td className="px-5 py-3 text-right"><ScoreCell series={r.seo} /></td>
                <td className="px-5 py-3 text-right"><ScoreCell series={r.ada} suffix={r.adaSource === 'page' ? 'page' : undefined} /></td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {r.pillarScore === null
                    ? <span className="text-gray-300 dark:text-white/20">—</span>
                    : <span className="font-semibold text-[#1c2d4a] dark:text-white">{r.pillarScore}<span className="text-gray-400 dark:text-white/40 font-normal">/10</span></span>}
                </td>
                <td className="px-5 py-3 text-gray-500 dark:text-white/60">
                  {r.lastActivityAt ? <RelativeTime value={r.lastActivityAt} /> : <span className="text-gray-300 dark:text-white/20">—</span>}
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-1">
                    {r.alerts.map((a, i) => (
                      <span key={i} title={a.detail} className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${ALERT_CLASSES[a.kind]}`}>
                        {a.kind === 'score-drop' ? 'drop' : a.kind}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 5.4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/FleetTable.test.tsx`
Expected: PASS. (Note: `RelativeTime` renders null pre-mount; tests don't assert on it.)

- [ ] **Step 5.5: Commit**

```bash
git add components/clients/FleetTable.tsx components/clients/FleetTable.test.tsx
git commit -m "feat(clients): FleetTable component with sort + alert chips"
```

---

### Task 6: `ActivityTimeline`, `ClientHeader`, `IssueTrendCard`

**Files:**
- Create: `components/clients/ActivityTimeline.tsx`
- Create: `components/clients/ClientHeader.tsx`
- Create: `components/clients/IssueTrendCard.tsx`
- Test: `components/clients/ActivityTimeline.test.tsx`

- [ ] **Step 6.1: Write the failing timeline test**

```tsx
// @vitest-environment jsdom
// components/clients/ActivityTimeline.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ActivityTimeline, type ActivityTimelineItem } from './ActivityTimeline'

const item = (over: Partial<ActivityTimelineItem>): ActivityTimelineItem => ({
  type: 'seo-parse', id: 'x1', title: 'acme.example', status: 'complete',
  date: '2026-06-10T00:00:00.000Z', href: '/seo-parser/results/x1', stat: '100 URLs · 5 critical', ...over,
})

describe('ActivityTimeline', () => {
  it('renders tool badge, status badge, stat and link', () => {
    render(<ActivityTimeline items={[item({})]} />)
    expect(screen.getByText('SEO Parse')).toBeTruthy()
    expect(screen.getByText('complete')).toBeTruthy()
    expect(screen.getByText('100 URLs · 5 critical')).toBeTruthy()
    expect(screen.getByText('acme.example').closest('a')?.getAttribute('href')).toBe('/seo-parser/results/x1')
  })
  it('error status gets the red badge classes', () => {
    render(<ActivityTimeline items={[item({ id: 'x2', status: 'error' })]} />)
    expect(screen.getByText('error').className).toContain('red')
  })
  it('renders the empty state', () => {
    render(<ActivityTimeline items={[]} />)
    expect(screen.getByText(/No activity yet/)).toBeTruthy()
  })
})
```

- [ ] **Step 6.2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/ActivityTimeline.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement `ActivityTimeline.tsx`** (server-renderable — no 'use client')

```tsx
// components/clients/ActivityTimeline.tsx
//
// Reverse-chron activity list for one client. Server-renderable; RelativeTime
// is the only client leaf. Local item interface (repo convention).

import { RelativeTime } from '@/app/pillar-analysis/[id]/components/RelativeTime'

export interface ActivityTimelineItem {
  type: 'seo-parse' | 'keyword-research' | 'site-audit' | 'ada-audit' | 'pillar-analysis' | 'seo-roadmap'
  id: string
  title: string
  status: string
  date: string
  href: string
  stat: string | null
}

const TYPE_LABELS: Record<ActivityTimelineItem['type'], string> = {
  'seo-parse': 'SEO Parse',
  'keyword-research': 'Keywords',
  'site-audit': 'Site Audit',
  'ada-audit': 'ADA Page',
  'pillar-analysis': 'Pillar',
  'seo-roadmap': 'Roadmap',
}

const TYPE_CLASSES: Record<ActivityTimelineItem['type'], string> = {
  'seo-parse': 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  'keyword-research': 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  'site-audit': 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
  'ada-audit': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
  'pillar-analysis': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  'seo-roadmap': 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
}

function statusClasses(status: string): string {
  if (status === 'complete') return 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300'
  if (status === 'error') return 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
  if (status === 'cancelled') return 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60'
  return 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' // in-flight
}

export function ActivityTimeline({ items }: { items: ActivityTimelineItem[] }) {
  if (items.length === 0) {
    return (
      <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-10 text-center">
        <p className="text-sm text-gray-500 dark:text-white/60">No activity yet for this client.</p>
      </div>
    )
  }
  return (
    <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border overflow-hidden">
      <ul className="divide-y divide-gray-50 dark:divide-navy-border/50">
        {items.map((it) => (
          <li key={`${it.type}-${it.id}`} className="px-5 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-gray-50 dark:hover:bg-navy-light/40 transition-colors">
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase whitespace-nowrap ${TYPE_CLASSES[it.type]}`}>
              {TYPE_LABELS[it.type]}
            </span>
            <a href={it.href} className="font-semibold text-sm text-[#1c2d4a] dark:text-white hover:text-[#f5a623] dark:hover:text-[#f5a623] transition-colors truncate max-w-[280px]">
              {it.title}
            </a>
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${statusClasses(it.status)}`}>{it.status}</span>
            {it.stat && <span className="text-xs text-gray-500 dark:text-white/60 tabular-nums">{it.stat}</span>}
            <span className="ml-auto text-xs text-gray-400 dark:text-white/40 whitespace-nowrap">
              <RelativeTime value={it.date} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 6.4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/ActivityTimeline.test.tsx`
Expected: PASS.

- [ ] **Step 6.5: Implement `ClientHeader.tsx`** (server-renderable, no test — pure markup)

```tsx
// components/clients/ClientHeader.tsx
//
// Dashboard header: name, domain chips, seed-URL count, Teamwork link,
// scheduled-scan line, Edit link. Read-only (Phase 1a) — editing lives at
// /clients/manage.

export interface ClientHeaderProps {
  name: string
  domains: string[]
  seedUrls: string[]
  teamworkTasklistId: string | null
  schedules: { jobType: string; cadence: string; nextRunAt: string }[]
}

export function ClientHeader({ name, domains, seedUrls, teamworkTasklistId, schedules }: ClientHeaderProps) {
  return (
    <div className="mb-8">
      <a href="/clients" className="text-xs text-gray-400 dark:text-white/40 hover:text-[#f5a623] transition-colors">
        ← Clients
      </a>
      <div className="flex flex-wrap items-center justify-between gap-3 mt-1">
        <h1 className="text-3xl font-display font-bold text-[#1c2d4a] dark:text-white">{name}</h1>
        <a
          href="/clients/manage"
          className="text-sm font-semibold text-[#f5a623] hover:text-[#e09415] transition-colors"
        >
          Edit client →
        </a>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {domains.map((d) => (
          <span key={d} className="px-2 py-0.5 rounded bg-gray-100 dark:bg-white/10 text-xs text-gray-600 dark:text-white/60">
            {d}
          </span>
        ))}
        {seedUrls.length > 0 && (
          <span title={seedUrls.join('\n')} className="text-xs text-gray-400 dark:text-white/40">
            {seedUrls.length} seed URL{seedUrls.length === 1 ? '' : 's'}
          </span>
        )}
        {teamworkTasklistId && (
          <a
            href={`https://enrollmentresources.teamwork.com/app/tasklists/${teamworkTasklistId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-[#f5a623] hover:text-[#e09415]"
          >
            Teamwork ↗
          </a>
        )}
      </div>
      <p className="mt-1.5 text-xs text-gray-400 dark:text-white/40">
        {schedules.length === 0
          ? 'No scheduled scans'
          : `Scheduled: ${schedules.map((s) => `${s.jobType} (${s.cadence})`).join(' · ')}`}
      </p>
    </div>
  )
}
```

- [ ] **Step 6.6: Implement `IssueTrendCard.tsx`** (replaces SeoHistoryView: chart + compare link, NO session table — the timeline covers per-run rows)

```tsx
'use client'

// components/clients/IssueTrendCard.tsx
//
// Issue-count trend (full session history — covers pre-A2 runs that have no
// score) + the compare-latest-two link. Extracted from the retired
// SeoHistoryView; reuses SeoHistoryChart unchanged.

import dynamic from 'next/dynamic'

interface SeoHistorySession {
  id: string
  createdAt: string
  siteName: string | null
  siteHost: string | null
  totalUrls: number | null
  criticalCount: number | null
  warningCount: number | null
  noticeCount: number | null
}

const SeoHistoryChart = dynamic(
  () => import('./SeoHistoryChart').then((m) => ({ default: m.SeoHistoryChart })),
  { ssr: false },
)

export function IssueTrendCard({ sessions, latestTwo }: { sessions: SeoHistorySession[]; latestTwo: [string, string] | null }) {
  if (sessions.length === 0) return null
  return (
    <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold text-[#1c2d4a] dark:text-white uppercase tracking-wide">Issue Trend</h3>
        {latestTwo && (
          <a
            href={`/seo-parser/diff?a=${latestTwo[0]}&b=${latestTwo[1]}`}
            className="text-xs font-semibold text-[#f5a623] hover:text-[#e09415] transition-colors"
          >
            Compare latest two crawls →
          </a>
        )}
      </div>
      <SeoHistoryChart sessions={sessions} />
    </div>
  )
}
```

- [ ] **Step 6.7: Commit**

```bash
git add components/clients/ActivityTimeline.tsx components/clients/ActivityTimeline.test.tsx components/clients/ClientHeader.tsx components/clients/IssueTrendCard.tsx
git commit -m "feat(clients): ActivityTimeline, ClientHeader, IssueTrendCard components"
```

---

### Task 7: Move CRUD to `/clients/manage`, retarget links, nav dropdown

**Files:**
- Move: `app/clients/page.tsx` → `app/clients/manage/page.tsx`
- Modify: `components/nav.tsx:42`
- Modify: `components/ada-audit/SiteAuditForm.tsx:359`
- Modify: `components/ada-audit/ClientsAuditSummary.tsx:271,306`
- Modify: `components/ada-audit/BulkQueueModal.tsx:96`

- [ ] **Step 7.1: Move the CRUD page**

```bash
git mv app/clients/page.tsx app/clients/manage/page.tsx
```

Then open `app/clients/manage/page.tsx` and make exactly two content tweaks:
1. If the page has an exported `metadata` or visible `<h1>` title "Clients", change the visible heading to "Manage Clients" and add a small back link to `/clients` ("← Fleet") above the heading, following the back-link style in `app/clients/[id]/page.tsx:28-33`. Touch nothing else.
2. Search the file for `href="/clients/` self-links (there are none expected; verify).

- [ ] **Step 7.2: Nav dropdown** — in `components/nav.tsx`, replace line 42:

```ts
  { name: 'Clients', href: '/clients' },
```

with:

```ts
  {
    name: 'Clients',
    href: '/clients',
    dropdown: [
      { name: 'Fleet', href: '/clients', description: 'Scores and activity' },
      { name: 'Manage clients', href: '/clients/manage' },
    ],
  },
```

- [ ] **Step 7.3: Retarget manage-intent links**

- `components/ada-audit/SiteAuditForm.tsx:359`: `href="/clients"` → `href="/clients/manage"` (the "Add one →" link).
- `components/ada-audit/ClientsAuditSummary.tsx:271`: `href="/clients"` → `href="/clients/manage"`, and update the visible text `/clients` → `/clients/manage`.
- `components/ada-audit/ClientsAuditSummary.tsx:306`: the client-NAME link (no site audit yet) → `href={`/clients/${c.clientId}`}` (the dashboard is now the right target for a client name).
- `components/ada-audit/BulkQueueModal.tsx:96`: `href={`/clients`}` → `href="/clients/manage"` (the "fix missing domain" list).
- Then sweep for stragglers: `grep -rn 'href="/clients"' app components` and `grep -rn 'href={`/clients`}' app components` — every hit must be either intentionally the fleet page or retargeted. The back link in `app/clients/[id]/page.tsx` ("← Clients") correctly stays `/clients`.

- [ ] **Step 7.4: Verify dev render**

Run: `DATABASE_URL="file:./local-dev.db" npx next build 2>&1 | tail -20` — `/clients/manage` must compile. (Full verification happens in Task 9.)

- [ ] **Step 7.5: Commit**

```bash
git add -A
git commit -m "feat(clients): move CRUD page to /clients/manage, retarget links, nav dropdown"
```

---

### Task 8: New `/clients` (fleet) and `/clients/[id]` (dashboard) pages

**Files:**
- Create: `app/clients/page.tsx`
- Rewrite: `app/clients/[id]/page.tsx`
- Delete: `components/clients/SeoHistoryView.tsx`

- [ ] **Step 8.1: Create the fleet page** `app/clients/page.tsx`:

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { getClientFleet } from '@/lib/services/client-fleet'
import { FleetTable } from '@/components/clients/FleetTable'

export const dynamic = 'force-dynamic' // DB read per request; never prerender at build

export const metadata: Metadata = { title: 'Clients — ER SEO Tools' }

export default async function ClientsFleetPage() {
  const rows = await getClientFleet()
  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-display font-bold text-[#1c2d4a] dark:text-white">Clients</h1>
            <p className="text-sm text-gray-500 dark:text-white/60 mt-1">
              Latest scores and activity across every client.
            </p>
          </div>
          <Link
            href="/clients/manage"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1c2d4a] hover:bg-[#0f1d30] text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Add / manage clients →
          </Link>
        </div>
        <FleetTable rows={rows} />
      </div>
    </div>
  )
}
```

(`FleetRow` from the service and `FleetTableRow` in the component are
structurally identical — TypeScript checks this structurally at the call site;
no import needed.)

- [ ] **Step 8.2: Rewrite the dashboard page** `app/clients/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getClientDashboard } from '@/lib/services/client-dashboard'
import { getClientSeoHistory } from '@/lib/services/client-seo-history'
import { ClientHeader } from '@/components/clients/ClientHeader'
import { Scorecard } from '@/components/clients/Scorecard'
import { ActivityTimeline } from '@/components/clients/ActivityTimeline'
import { IssueTrendCard } from '@/components/clients/IssueTrendCard'

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const clientId = Number(id)
  if (!Number.isInteger(clientId) || clientId <= 0) return { title: 'Client — ER SEO Tools' }
  const data = await getClientDashboard(clientId)
  return { title: data.client ? `${data.client.name} — Client Dashboard` : 'Client — ER SEO Tools' }
}

export default async function ClientDashboardPage({ params }: Props) {
  const { id } = await params
  const clientId = Number(id)
  if (!Number.isInteger(clientId) || clientId <= 0) notFound()

  const [dash, history] = await Promise.all([
    getClientDashboard(clientId),
    getClientSeoHistory(clientId),
  ])
  if (!dash.client) notFound()

  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <ClientHeader
          name={dash.client.name}
          domains={dash.client.domains}
          seedUrls={dash.client.seedUrls}
          teamworkTasklistId={dash.client.teamworkTasklistId}
          schedules={dash.schedules}
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <Scorecard
            label="SEO Health"
            score={dash.seo.series.latest}
            max={100}
            delta={dash.seo.series.delta}
            asOf={dash.seo.series.latestAt}
            href={dash.seo.latestHref}
            points={dash.seo.series.points}
          >
            {dash.seoCounts && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold tabular-nums">
                <span className="px-2 py-0.5 rounded bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400">
                  {dash.seoCounts.criticalCount} critical
                </span>
                <span className="px-2 py-0.5 rounded bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400">
                  {dash.seoCounts.warningCount} warnings
                </span>
                <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400">
                  {dash.seoCounts.noticeCount} notices
                </span>
              </div>
            )}
          </Scorecard>
          <Scorecard
            label="ADA"
            score={dash.ada.series.latest}
            max={100}
            delta={dash.ada.series.delta}
            asOf={dash.ada.series.latestAt}
            href={dash.ada.latestHref}
            points={dash.ada.series.points}
            sourceNote={dash.adaSource === 'page' ? 'page audits' : undefined}
          />
          <Scorecard
            label="Pillar"
            score={dash.pillar.series.latest}
            max={10}
            delta={dash.pillar.series.delta}
            asOf={dash.pillar.series.latestAt}
            href={dash.pillar.latestHref}
            points={dash.pillar.series.points}
          />
        </div>

        <div className="space-y-6">
          <IssueTrendCard sessions={history.sessions} latestTwo={history.latestTwo} />
          <div>
            <h2 className="text-sm font-semibold text-[#1c2d4a] dark:text-white uppercase tracking-wide mb-3">
              Activity
            </h2>
            <ActivityTimeline items={dash.timeline} />
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 8.3: Delete the superseded view**

```bash
git rm components/clients/SeoHistoryView.tsx
grep -rn "SeoHistoryView" app components lib   # must return nothing
```

- [ ] **Step 8.4: Commit**

```bash
git add -A
git commit -m "feat(clients): fleet page + client dashboard page (B1)"
```

---

### Task 9: Full verification + PR

- [ ] **Step 9.1: Types, suite, build**

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npx vitest run
DATABASE_URL="file:./local-dev.db" npx next build
```

Expected: zero type errors; full suite green (~1,800 + ~30 new); build succeeds
with `/clients` marked dynamic (ƒ).

- [ ] **Step 9.2: Manual smoke (dev server)**

```bash
DATABASE_URL="file:./local-dev.db" npx next dev
```

Visit `/clients` (fleet renders, sort toggles work, row click → dashboard),
`/clients/<id>` (header, three scorecards, trend, timeline links resolve),
`/clients/manage` (CRUD unchanged: add/rename/domains all work), nav dropdown.
Check dark mode on all three pages.

- [ ] **Step 9.3: Blob-reader audit (spec hard constraint)**

```bash
grep -n "result\|summary" lib/services/client-fleet.ts lib/services/client-dashboard.ts lib/services/scorecard-shared.ts
```

Expected: no Prisma selects of `Session.result`, `SiteAudit.summary`, or
`AdaAudit.result` (comments mentioning them are fine).

- [ ] **Step 9.4: Push + PR**

```bash
git push -u origin feat/client-dashboard-mvp
gh pr create --title "feat(clients): B1 client dashboard MVP — fleet table + client command center" --body "..."
```

PR body: link the spec, list the routes changed, call out the scalar-only
constraint and the `/clients/manage` move. End with the standard generated-with
footer.

---

## Post-merge production checks (from the spec)

After deploy (`ssh seo@144.126.213.242 "~/deploy.sh"`):

1. `/clients` renders all ~30 clients with scores for post-A2 runs.
2. Count non-null legacy standalone scores (calibrates the fallback's value):
   run from `/home/seo/webapps/seo-tools` via node + Prisma:
   `prisma.adaAudit.count({ where: { siteAuditId: null, status: 'complete', score: { not: null } } })`.
3. Confirm a recent standalone audit shows a page-audit `CrawlRun` point.
4. Spot-check one client dashboard against its tool pages (scores match the
   `CrawlRun` values; timeline links resolve).
