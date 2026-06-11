# Findings / Action Center (B2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cross-tool open-findings panel on `/clients/[id]` with type-level run-over-run trends, plus fleet-table Issues column and `regression` alerts — a pure read layer over the A2 `CrawlRun`/`Finding`/`Violation` tables.

**Architecture:** Pure selection/aggregation/diff helpers in `lib/services/findings-shared.ts` (no prisma); a dashboard read service `lib/services/client-findings.ts`; extensions to `client-fleet.ts` (Issues counts + regression alerts via `computeAlerts`) and `FleetTable`; new `FindingsPanel` client component rendered by the existing force-dynamic dashboard page. No schema changes, no write-path changes, zero blob reads.

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite, vitest (node env for services, jsdom for components), Tailwind with `dark:` variants.

**Spec:** `docs/superpowers/specs/2026-06-11-findings-action-center-design.md` (Codex ×5 fixes applied — multi-domain v1 limitation, three-state `affectedComplete`, fleet ADA max-severity collapse, previous-shape excludes severity, id-desc tie-breaker).

**Test command convention:** local dev `.env` points at a nonexistent path — always prefix:
`DATABASE_URL="file:./local-dev.db" npx vitest run <file>`

**DB-test hygiene (load-bearing):** unique `PREFIX`/`DOMAIN` per test file; clean `CrawlRun` by domain BEFORE origin rows (SetNull orphans them).

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `lib/services/findings-shared.ts` | Create | Pure: run selection (tie-broken, domain-matched previous), type aggregation/collapse, type diffing, severity rank, URL cap constant |
| `lib/services/findings-shared.test.ts` | Create | Unit tests, no DB |
| `lib/services/scorecard-shared.ts` | Modify | `computeAlerts` gains required `newCriticalTypes: string[]`; `AlertKind` gains `'regression'` |
| `lib/services/scorecard-shared.test.ts` | Modify | Regression alert cases + arg updates |
| `lib/services/client-findings.ts` | Create | Dashboard read service → `ClientFindings` |
| `lib/services/client-findings.test.ts` | Create | DB-backed end-to-end shape tests |
| `lib/services/client-fleet.ts` | Modify | select `id`+`domain`, Issues counts, regression alert wiring |
| `lib/services/client-fleet.test.ts` | Modify | Issues counts + regression cases |
| `components/clients/FindingsPanel.tsx` | Create | Dashboard panel (client component, local prop interfaces) |
| `components/clients/FindingsPanel.test.tsx` | Create | jsdom render tests |
| `components/clients/FleetTable.tsx` | Modify | Issues column (sortable), `regression` alert style |
| `components/clients/FleetTable.test.tsx` | Modify | Issues column + regression chip tests |
| `app/clients/[id]/page.tsx` | Modify | Third parallel call + render panel |

---

### Task 1: `findings-shared.ts` — pure helpers

**Files:**
- Create: `lib/services/findings-shared.ts`
- Test: `lib/services/findings-shared.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/services/findings-shared.test.ts
import { describe, it, expect } from 'vitest'
import {
  selectRuns, aggregateSeoTypes, aggregateAdaTypes, collapseTypeGroups,
  diffTypes, newCriticalTypes, toSeverity, SEVERITY_RANK, URLS_PER_FINDING,
  type RunRef, type TypeAggregate,
} from './findings-shared'

const d = (iso: string) => new Date(iso)

function run(over: Partial<RunRef>): RunRef {
  return {
    id: 'r1', tool: 'seo-parser', source: 'sf-upload', domain: 'a.example',
    completedAt: d('2026-06-01T00:00:00Z'), createdAt: d('2026-06-01T00:00:00Z'),
    sessionId: 's1', siteAuditId: null, adaAuditId: null, ...over,
  }
}

describe('selectRuns', () => {
  it('picks latest SEO run and domain-matched previous', () => {
    const runs = [
      run({ id: 'old', completedAt: d('2026-05-01T00:00:00Z') }),
      run({ id: 'new', completedAt: d('2026-06-01T00:00:00Z') }),
    ]
    const sel = selectRuns(runs, new Set())
    expect(sel.seo.current?.id).toBe('new')
    expect(sel.seo.previous?.id).toBe('old')
  })

  it('excludes keyword-research runs from SEO candidates', () => {
    const runs = [
      run({ id: 'tech', sessionId: 'tech-s', completedAt: d('2026-05-01T00:00:00Z') }),
      run({ id: 'kw', sessionId: 'kw-s', completedAt: d('2026-06-01T00:00:00Z') }),
    ]
    const sel = selectRuns(runs, new Set(['kw-s']))
    expect(sel.seo.current?.id).toBe('tech')
    expect(sel.seo.previous).toBeNull()
  })

  it('previous must match current domain; cross-domain runs are skipped', () => {
    const runs = [
      run({ id: 'b-old', domain: 'b.example', completedAt: d('2026-04-01T00:00:00Z') }),
      run({ id: 'a-old', domain: 'a.example', completedAt: d('2026-05-01T00:00:00Z') }),
      run({ id: 'b-new', domain: 'b.example', completedAt: d('2026-06-01T00:00:00Z') }),
    ]
    const sel = selectRuns(runs, new Set())
    expect(sel.seo.current?.id).toBe('b-new')
    expect(sel.seo.previous?.id).toBe('b-old') // a-old skipped (wrong domain)
  })

  it('null-domain current gets no previous', () => {
    const runs = [
      run({ id: 'old', domain: null, completedAt: d('2026-05-01T00:00:00Z') }),
      run({ id: 'new', domain: null, completedAt: d('2026-06-01T00:00:00Z') }),
    ]
    expect(selectRuns(runs, new Set()).seo.previous).toBeNull()
  })

  it('breaks timestamp ties by id desc, deterministically', () => {
    const t = d('2026-06-01T00:00:00Z')
    const runs = [
      run({ id: 'aaa', completedAt: t }),
      run({ id: 'zzz', completedAt: t }),
    ]
    expect(selectRuns(runs, new Set()).seo.current?.id).toBe('zzz')
  })

  it('falls back to createdAt when completedAt is null', () => {
    const runs = [
      run({ id: 'done', completedAt: d('2026-05-01T00:00:00Z') }),
      run({ id: 'undated', completedAt: null, createdAt: d('2026-06-01T00:00:00Z') }),
    ]
    expect(selectRuns(runs, new Set()).seo.current?.id).toBe('undated')
  })

  it('ADA: any site-audit run forces site class; page runs ignored', () => {
    const runs = [
      run({ id: 'page', tool: 'ada-audit', source: 'page-audit', adaAuditId: 'a1', sessionId: null, completedAt: d('2026-06-05T00:00:00Z') }),
      run({ id: 'site', tool: 'ada-audit', source: 'site-audit', siteAuditId: 'sa1', sessionId: null, completedAt: d('2026-06-01T00:00:00Z') }),
    ]
    const sel = selectRuns(runs, new Set())
    expect(sel.ada.sourceClass).toBe('site')
    expect(sel.ada.current?.id).toBe('site')
  })

  it('ADA page class never gets a previous (standalone audits not comparable)', () => {
    const runs = [
      run({ id: 'p1', tool: 'ada-audit', source: 'page-audit', adaAuditId: 'a1', sessionId: null, completedAt: d('2026-05-01T00:00:00Z') }),
      run({ id: 'p2', tool: 'ada-audit', source: 'page-audit', adaAuditId: 'a2', sessionId: null, completedAt: d('2026-06-01T00:00:00Z') }),
    ]
    const sel = selectRuns(runs, new Set())
    expect(sel.ada.sourceClass).toBe('page')
    expect(sel.ada.current?.id).toBe('p2')
    expect(sel.ada.previous).toBeNull()
  })

  it('no runs → all null', () => {
    const sel = selectRuns([], new Set())
    expect(sel.seo.current).toBeNull()
    expect(sel.ada.current).toBeNull()
    expect(sel.ada.sourceClass).toBeNull()
  })
})

describe('aggregation', () => {
  it('aggregateSeoTypes passes run-scope rows through with cast severity', () => {
    const out = aggregateSeoTypes([{ type: 'missing_title', severity: 'critical', count: 12 }])
    expect(out).toEqual([{ type: 'missing_title', severity: 'critical', count: 12 }])
  })

  it('unknown severities degrade to notice', () => {
    expect(toSeverity('bogus')).toBe('notice')
  })

  it('aggregateAdaTypes groups by type: count = rows, severity = max', () => {
    const out = aggregateAdaTypes([
      { type: 'color-contrast', severity: 'warning' },
      { type: 'color-contrast', severity: 'critical' },
      { type: 'image-alt', severity: 'critical' },
    ])
    const cc = out.find((a) => a.type === 'color-contrast')!
    expect(cc.count).toBe(2)
    expect(cc.severity).toBe('critical') // max across rows
  })

  it('collapseTypeGroups merges mixed-severity groups into one per type (Codex fix #3)', () => {
    const out = collapseTypeGroups([
      { type: 'color-contrast', severity: 'warning', count: 3 },
      { type: 'color-contrast', severity: 'critical', count: 2 },
    ])
    expect(out).toEqual([{ type: 'color-contrast', severity: 'critical', count: 5 }])
  })
})

describe('diffTypes', () => {
  const cur: TypeAggregate[] = [
    { type: 'a', severity: 'critical', count: 5 },
    { type: 'b', severity: 'warning', count: 2 },
  ]
  it('null previous → nothing new, nothing resolved, no deltas', () => {
    const diff = diffTypes(cur, null)
    expect(diff.newTypes.size).toBe(0)
    expect(diff.resolvedCount).toBe(0)
    expect(diff.countDelta.size).toBe(0)
  })
  it('computes new types, resolved count, and per-type deltas', () => {
    const diff = diffTypes(cur, [{ type: 'b', count: 5 }, { type: 'gone', count: 1 }])
    expect([...diff.newTypes]).toEqual(['a'])
    expect(diff.resolvedCount).toBe(1)
    expect(diff.countDelta.get('b')).toBe(-3)
    expect(diff.countDelta.has('a')).toBe(false) // new types have no delta
  })
})

describe('newCriticalTypes', () => {
  const cur: TypeAggregate[] = [
    { type: 'a', severity: 'critical', count: 5 },
    { type: 'b', severity: 'warning', count: 2 },
  ]
  it('null previous → empty (no baseline, no regression)', () => {
    expect(newCriticalTypes(cur, null)).toEqual([])
  })
  it('returns critical types absent from previous; warnings never alert', () => {
    expect(newCriticalTypes(cur, new Set())).toEqual(['a'])
    expect(newCriticalTypes(cur, new Set(['a']))).toEqual([])
  })
})

describe('constants', () => {
  it('exports rank and cap', () => {
    expect(SEVERITY_RANK.critical).toBeLessThan(SEVERITY_RANK.warning)
    expect(SEVERITY_RANK.warning).toBeLessThan(SEVERITY_RANK.notice)
    expect(URLS_PER_FINDING).toBe(25)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/findings-shared.test.ts`
Expected: FAIL — module `./findings-shared` not found.

- [ ] **Step 3: Implement**

```ts
// lib/services/findings-shared.ts
//
// Pure helpers for the B2 findings/action center: current/previous run
// selection, type-level aggregation, and type-level diffing. No prisma —
// shared by client-findings (dashboard) and client-fleet. Everything reads
// normalized A2 tables upstream; nothing here touches blobs.

export type Severity = 'critical' | 'warning' | 'notice'
export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, notice: 2 }
export const URLS_PER_FINDING = 25

export function toSeverity(raw: string): Severity {
  return raw === 'critical' || raw === 'warning' || raw === 'notice' ? raw : 'notice'
}

export interface RunRef {
  id: string
  tool: string
  source: string
  domain: string | null
  completedAt: Date | null
  createdAt: Date
  sessionId: string | null
  siteAuditId: string | null
  adaAuditId: string | null
}

export interface SelectedRuns {
  seo: { current: RunRef | null; previous: RunRef | null }
  ada: { current: RunRef | null; previous: RunRef | null; sourceClass: 'site' | 'page' | null }
}

const runTime = (r: RunRef) => (r.completedAt ?? r.createdAt).getTime()

// Deterministic ordering (Codex fix #5): date desc, then id desc.
function sortRunsDesc(runs: RunRef[]): RunRef[] {
  return [...runs].sort((a, b) => runTime(b) - runTime(a) || b.id.localeCompare(a.id))
}

// Previous = most recent earlier run with the SAME non-null domain as current
// (cross-domain dedup/type diffs are garbage; multi-domain clients are a
// documented v1 limitation — see spec).
function domainMatchedPrevious(sorted: RunRef[], current: RunRef): RunRef | null {
  if (current.domain === null) return null
  for (const r of sorted) {
    if (r.id === current.id) continue
    if (runTime(r) > runTime(current)) continue
    if (runTime(r) === runTime(current) && r.id.localeCompare(current.id) > 0) continue
    if (r.domain === current.domain) return r
  }
  return null
}

export function selectRuns(runs: RunRef[], keywordSessionIds: Set<string>): SelectedRuns {
  const seoCandidates = sortRunsDesc(
    runs.filter((r) => r.tool === 'seo-parser' && !(r.sessionId && keywordSessionIds.has(r.sessionId))),
  )
  const seoCurrent = seoCandidates[0] ?? null

  const adaRuns = runs.filter((r) => r.tool === 'ada-audit')
  const siteRuns = sortRunsDesc(adaRuns.filter((r) => r.source === 'site-audit'))
  const pageRuns = sortRunsDesc(adaRuns.filter((r) => r.source === 'page-audit'))
  const sourceClass: 'site' | 'page' | null = siteRuns.length ? 'site' : pageRuns.length ? 'page' : null
  const adaCandidates = sourceClass === 'site' ? siteRuns : pageRuns
  const adaCurrent = adaCandidates[0] ?? null

  return {
    seo: {
      current: seoCurrent,
      previous: seoCurrent ? domainMatchedPrevious(seoCandidates, seoCurrent) : null,
    },
    ada: {
      current: adaCurrent,
      // Standalone page audits of different URLs aren't comparable — no previous.
      previous: sourceClass === 'site' && adaCurrent ? domainMatchedPrevious(siteRuns, adaCurrent) : null,
      sourceClass,
    },
  }
}

export interface TypeAggregate {
  type: string
  severity: Severity
  count: number
}

export function aggregateSeoTypes(rows: { type: string; severity: string; count: number }[]): TypeAggregate[] {
  return rows.map((r) => ({ type: r.type, severity: toSeverity(r.severity), count: r.count }))
}

// One aggregate per type from pre-counted groups: severity = max, count = sum
// (Codex fix #3 — mixed-severity types must not double-count).
export function collapseTypeGroups(rows: { type: string; severity: string; count: number }[]): TypeAggregate[] {
  const byType = new Map<string, TypeAggregate>()
  for (const r of rows) {
    const sev = toSeverity(r.severity)
    const cur = byType.get(r.type)
    if (!cur) byType.set(r.type, { type: r.type, severity: sev, count: r.count })
    else {
      cur.count += r.count
      if (SEVERITY_RANK[sev] < SEVERITY_RANK[cur.severity]) cur.severity = sev
    }
  }
  return [...byType.values()]
}

// ADA page-scope rows are unique per (type, url) — row count IS the URL count.
export function aggregateAdaTypes(rows: { type: string; severity: string }[]): TypeAggregate[] {
  return collapseTypeGroups(rows.map((r) => ({ type: r.type, severity: r.severity, count: 1 })))
}

export interface TypeDiff {
  newTypes: Set<string>
  resolvedCount: number
  /** current − previous, only for types present in BOTH runs. */
  countDelta: Map<string, number>
}

// Previous shape is type+count only — severity intentionally absent
// (Codex fix #4); severity always comes from the current run.
export function diffTypes(current: TypeAggregate[], previous: { type: string; count: number }[] | null): TypeDiff {
  if (previous === null) return { newTypes: new Set(), resolvedCount: 0, countDelta: new Map() }
  const prevByType = new Map(previous.map((p) => [p.type, p.count]))
  const newTypes = new Set<string>()
  const countDelta = new Map<string, number>()
  for (const c of current) {
    const prev = prevByType.get(c.type)
    if (prev === undefined) newTypes.add(c.type)
    else countDelta.set(c.type, c.count - prev)
  }
  const currentTypes = new Set(current.map((c) => c.type))
  const resolvedCount = previous.filter((p) => !currentTypes.has(p.type)).length
  return { newTypes, resolvedCount, countDelta }
}

export function newCriticalTypes(current: TypeAggregate[], previousTypes: Set<string> | null): string[] {
  if (previousTypes === null) return []
  return current.filter((c) => c.severity === 'critical' && !previousTypes.has(c.type)).map((c) => c.type)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/findings-shared.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add lib/services/findings-shared.ts lib/services/findings-shared.test.ts
git commit -m "feat(clients): pure run-selection/aggregation/diff helpers for B2 findings center"
```

---

### Task 2: `computeAlerts` regression extension

**Files:**
- Modify: `lib/services/scorecard-shared.ts` (the `AlertKind`/`computeAlerts` block at the bottom)
- Modify: `lib/services/scorecard-shared.test.ts` (existing `computeAlerts` call sites + new cases)

- [ ] **Step 1: Write the failing tests** — in `lib/services/scorecard-shared.test.ts`, the `computeAlerts` describe block (line ~123) already has
`const base = { seo: EMPTY_SERIES, ada: EMPTY_SERIES, erroredTools: [], lastActivityAt: recent, now: NOW }`.
Change that line to include `newCriticalTypes: []`:

```ts
  const base = { seo: EMPTY_SERIES, ada: EMPTY_SERIES, erroredTools: [], newCriticalTypes: [], lastActivityAt: recent, now: NOW }
```

then append inside the same describe block:

```ts
  it('regression alert fires when newCriticalTypes is non-empty, with count grammar', () => {
    expect(computeAlerts({ ...base, newCriticalTypes: ['broken_pages', 'missing_title'] }))
      .toContainEqual({ kind: 'regression', detail: '2 new critical issue types' })
    expect(computeAlerts({ ...base, newCriticalTypes: ['x'] }))
      .toContainEqual({ kind: 'regression', detail: '1 new critical issue type' })
    expect(computeAlerts({ ...base, newCriticalTypes: [] }).some((a) => a.kind === 'regression')).toBe(false)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/scorecard-shared.test.ts`
Expected: FAIL — TS error: `newCriticalTypes` not in args type (and at runtime no regression alert).

- [ ] **Step 3: Implement** — in `lib/services/scorecard-shared.ts`:

```ts
export type AlertKind = 'score-drop' | 'error' | 'stale' | 'regression'
```

and in `computeAlerts`, add to the args interface:

```ts
  /** Critical issue types present in a current run but absent from that
   *  tool's previous comparable run (B2). Empty when no previous run. */
  newCriticalTypes: string[]
```

and after the `erroredTools` loop:

```ts
  if (args.newCriticalTypes.length > 0) {
    const n = args.newCriticalTypes.length
    alerts.push({ kind: 'regression', detail: `${n} new critical issue type${n === 1 ? '' : 's'}` })
  }
```

Then fix every existing `computeAlerts` call site (the compiler finds them): existing tests in `scorecard-shared.test.ts` and the call in `client-fleet.ts` get `newCriticalTypes: []` for now (Task 4 wires the real value).

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/scorecard-shared.test.ts lib/services/client-fleet.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/services/scorecard-shared.ts lib/services/scorecard-shared.test.ts lib/services/client-fleet.ts
git commit -m "feat(clients): regression AlertKind + newCriticalTypes input on computeAlerts"
```

---

### Task 3: `client-findings.ts` dashboard service

**Files:**
- Create: `lib/services/client-findings.ts`
- Test: `lib/services/client-findings.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/services/client-findings.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { getClientFindings } from './client-findings'
import { URLS_PER_FINDING } from './findings-shared'

const PREFIX = 'test-cfind-'
const DOMAIN = 'client-findings-test.example'
const NOW = new Date()
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

async function clearTestState() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
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

async function makeSeoRun(clientId: number, opts: {
  completedAt: Date
  withSession?: boolean
  findings?: {
    runScope: { type: string; severity: string; count: number; detail?: string; affectedComplete?: boolean | null }[]
    pageScope?: { type: string; url: string }[]
  }
}) {
  let sessionId: string | null = null
  if (opts.withSession !== false) {
    const s = await prisma.session.create({
      data: { id: PREFIX + randomUUID(), status: 'complete', workflow: 'technical', files: '[]', siteName: DOMAIN, clientId },
    })
    sessionId = s.id
  }
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, clientId, sessionId,
      status: 'complete', score: 80, pagesTotal: 1, completedAt: opts.completedAt, createdAt: opts.completedAt,
    },
  })
  for (const f of opts.findings?.runScope ?? []) {
    await prisma.finding.create({
      data: {
        runId: run.id, scope: 'run', type: f.type, severity: f.severity, count: f.count,
        detail: f.detail ?? null, affectedComplete: f.affectedComplete === undefined ? null : f.affectedComplete,
        dedupKey: randomUUID(),
      },
    })
  }
  for (const p of opts.findings?.pageScope ?? []) {
    await prisma.finding.create({
      data: { runId: run.id, scope: 'page', type: p.type, severity: 'warning', url: p.url, dedupKey: randomUUID() },
    })
  }
  return run
}

async function makeAdaSiteRun(clientId: number, opts: {
  completedAt: Date
  violations?: { type: string; severity: string; url: string; impact?: string; help?: string }[]
}) {
  const sa = await prisma.siteAudit.create({
    data: { domain: DOMAIN, status: 'complete', clientId, completedAt: opts.completedAt },
  })
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'ada-audit', source: 'site-audit', domain: DOMAIN, clientId, siteAuditId: sa.id,
      status: 'complete', score: 85, pagesTotal: 3, completedAt: opts.completedAt, createdAt: opts.completedAt,
    },
  })
  for (const v of opts.violations ?? []) {
    const page = await prisma.crawlPage.create({
      data: { runId: run.id, url: v.url + '#' + randomUUID().slice(0, 6), status: 'complete' },
    })
    const f = await prisma.finding.create({
      data: { runId: run.id, pageId: page.id, scope: 'page', type: v.type, severity: v.severity, url: v.url, dedupKey: randomUUID() },
    })
    await prisma.violation.create({
      data: {
        findingId: f.id, runId: run.id, pageId: page.id, ruleId: v.type,
        impact: v.impact ?? 'serious', wcagTags: '[]', help: v.help ?? null, nodeCount: 1,
      },
    })
  }
  return { run, siteAuditId: sa.id }
}

describe('getClientFindings', () => {
  it('returns both empty-state shapes', async () => {
    const noRuns = await makeClient('none')
    const a = await getClientFindings(noRuns.id)
    expect(a.rows).toEqual([])
    expect(a.seo).toBeNull()
    expect(a.ada).toBeNull()

    const clean = await makeClient('clean')
    await makeSeoRun(clean.id, { completedAt: daysAgo(1) }) // run, zero findings
    const b = await getClientFindings(clean.id)
    expect(b.rows).toEqual([])
    expect(b.seo).not.toBeNull()
  })

  it('builds SEO rows from run-scope findings with page-scope URLs, three-state sample flag', async () => {
    const c = await makeClient('seo')
    await makeSeoRun(c.id, {
      completedAt: daysAgo(1),
      findings: {
        runScope: [
          { type: 'missing_title', severity: 'critical', count: 12, detail: JSON.stringify({ description: 'Pages without titles' }), affectedComplete: true },
          { type: 'thin_content', severity: 'warning', count: 30, affectedComplete: null }, // null → sample (Codex fix #2)
        ],
        pageScope: [
          { type: 'missing_title', url: `https://${DOMAIN}/p1` },
          { type: 'missing_title', url: `https://${DOMAIN}/p2` },
        ],
      },
    })
    const out = await getClientFindings(c.id)
    const mt = out.rows.find((r) => r.type === 'missing_title')!
    expect(mt.tool).toBe('seo')
    expect(mt.count).toBe(12)            // run-scope count is authoritative
    expect(mt.totalUrls).toBe(2)
    expect(mt.urls).toHaveLength(2)
    expect(mt.isSample).toBe(false)      // explicit true
    expect(mt.description).toBe('Pages without titles')
    expect(mt.href).toMatch(/^\/seo-parser\/results\//)
    const tc = out.rows.find((r) => r.type === 'thin_content')!
    expect(tc.isSample).toBe(true)       // null affectedComplete → sample
    expect(out.rows[0].type).toBe('missing_title') // critical sorts first
  })

  it('builds ADA rows grouped by rule with Violation help and max severity', async () => {
    const c = await makeClient('ada')
    const { siteAuditId } = await makeAdaSiteRun(c.id, {
      completedAt: daysAgo(1),
      violations: [
        { type: 'color-contrast', severity: 'warning', url: `https://${DOMAIN}/a`, help: 'Elements must meet contrast' },
        { type: 'color-contrast', severity: 'critical', url: `https://${DOMAIN}/b`, help: 'Elements must meet contrast' },
      ],
    })
    const out = await getClientFindings(c.id)
    expect(out.rows).toHaveLength(1)
    const cc = out.rows[0]
    expect(cc.tool).toBe('ada')
    expect(cc.count).toBe(2)
    expect(cc.totalUrls).toBe(2)
    expect(cc.severity).toBe('critical') // max across rows
    expect(cc.description).toBe('Elements must meet contrast')
    expect(cc.href).toBe(`/ada-audit/site/${siteAuditId}`)
    expect(out.ada?.sourceClass).toBe('site')
  })

  it('diffs against the previous domain-matched run: NEW badge, count delta, resolved count', async () => {
    const c = await makeClient('diff')
    await makeSeoRun(c.id, {
      completedAt: daysAgo(10),
      findings: { runScope: [
        { type: 'thin_content', severity: 'warning', count: 30 },
        { type: 'gone_issue', severity: 'notice', count: 3 },
      ] },
    })
    await makeSeoRun(c.id, {
      completedAt: daysAgo(1),
      findings: { runScope: [
        { type: 'thin_content', severity: 'warning', count: 22 },
        { type: 'broken_pages', severity: 'critical', count: 4 },
      ] },
    })
    const out = await getClientFindings(c.id)
    const bp = out.rows.find((r) => r.type === 'broken_pages')!
    expect(bp.isNew).toBe(true)
    expect(bp.countDelta).toBeNull()
    const tc = out.rows.find((r) => r.type === 'thin_content')!
    expect(tc.isNew).toBe(false)
    expect(tc.countDelta).toBe(-8)
    expect(out.seo?.hasPrevious).toBe(true)
    expect(out.seo?.newTypeCount).toBe(1)
    expect(out.seo?.resolvedTypeCount).toBe(1)
  })

  it('no previous run → no badges, hasPrevious false', async () => {
    const c = await makeClient('noprev')
    await makeSeoRun(c.id, {
      completedAt: daysAgo(1),
      findings: { runScope: [{ type: 'broken_pages', severity: 'critical', count: 4 }] },
    })
    const out = await getClientFindings(c.id)
    expect(out.rows[0].isNew).toBe(false)
    expect(out.rows[0].countDelta).toBeNull()
    expect(out.seo?.hasPrevious).toBe(false)
  })

  it('caps urls at URLS_PER_FINDING but reports full totalUrls', async () => {
    const c = await makeClient('cap')
    await makeSeoRun(c.id, {
      completedAt: daysAgo(1),
      findings: {
        runScope: [{ type: 'missing_alt_text', severity: 'warning', count: 40, affectedComplete: true }],
        pageScope: Array.from({ length: 30 }, (_, i) => ({ type: 'missing_alt_text', url: `https://${DOMAIN}/img-${i}` })),
      },
    })
    const row = (await getClientFindings(c.id)).rows[0]
    expect(row.urls).toHaveLength(URLS_PER_FINDING)
    expect(row.totalUrls).toBe(30)
    expect(row.urls).toEqual([...row.urls].sort()) // deterministic sample (sorted)
  })

  it('expired origin (null sessionId) renders rows with null href', async () => {
    const c = await makeClient('orphan')
    await makeSeoRun(c.id, {
      completedAt: daysAgo(1), withSession: false,
      findings: { runScope: [{ type: 'broken_pages', severity: 'critical', count: 2 }] },
    })
    const out = await getClientFindings(c.id)
    expect(out.rows[0].href).toBeNull()
    expect(out.seo?.href).toBeNull()
  })

  it('keyword-research runs are not findings sources', async () => {
    const c = await makeClient('kw')
    const s = await prisma.session.create({
      data: { id: PREFIX + randomUUID(), status: 'complete', workflow: 'keyword-research', files: '[]', siteName: DOMAIN, clientId: c.id },
    })
    const run = await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, clientId: c.id, sessionId: s.id,
        status: 'complete', score: 99, pagesTotal: 1, completedAt: daysAgo(1), createdAt: daysAgo(1),
      },
    })
    await prisma.finding.create({
      data: { runId: run.id, scope: 'run', type: 'kw_noise', severity: 'critical', count: 1, dedupKey: randomUUID() },
    })
    const out = await getClientFindings(c.id)
    expect(out.seo).toBeNull()
    expect(out.rows).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/client-findings.test.ts`
Expected: FAIL — module `./client-findings` not found.

- [ ] **Step 3: Implement**

```ts
// lib/services/client-findings.ts
//
// B2 read service: one client's open findings (latest runs per tool) with
// type-level run-over-run trends. Reads CrawlRun/Finding/Violation + scalar
// session columns ONLY — never origin blobs (A2 retention invariant).

import { prisma } from '@/lib/db'
import {
  aggregateAdaTypes, aggregateSeoTypes, diffTypes, selectRuns,
  SEVERITY_RANK, URLS_PER_FINDING,
  type RunRef, type Severity, type TypeAggregate, type TypeDiff,
} from './findings-shared'

export interface OpenFindingRow {
  tool: 'seo' | 'ada'
  type: string
  severity: Severity
  count: number
  countDelta: number | null
  isNew: boolean
  description: string | null
  helpUrl: string | null
  urls: string[]
  totalUrls: number
  isSample: boolean
  href: string | null
}

export interface SourceRunMeta {
  runAt: string
  href: string | null
  domain: string | null
  hasPrevious: boolean
  newTypeCount: number
  resolvedTypeCount: number
}

export interface ClientFindings {
  rows: OpenFindingRow[]
  seo: SourceRunMeta | null
  ada: (SourceRunMeta & { sourceClass: 'site' | 'page' }) | null
}

function parseDescription(detail: string | null): string | null {
  if (!detail) return null
  try {
    const obj = JSON.parse(detail)
    return typeof obj?.description === 'string' && obj.description ? obj.description : null
  } catch {
    return null
  }
}

function runHref(run: RunRef): string | null {
  if (run.tool === 'seo-parser') return run.sessionId ? `/seo-parser/results/${run.sessionId}` : null
  if (run.source === 'site-audit') return run.siteAuditId ? `/ada-audit/site/${run.siteAuditId}` : null
  return run.adaAuditId ? `/ada-audit/${run.adaAuditId}` : null
}

function meta(run: RunRef, diff: TypeDiff, hasPrevious: boolean): SourceRunMeta {
  return {
    runAt: (run.completedAt ?? run.createdAt).toISOString(),
    href: runHref(run),
    domain: run.domain,
    hasPrevious,
    newTypeCount: diff.newTypes.size,
    resolvedTypeCount: diff.resolvedCount,
  }
}

function buildRows(args: {
  tool: 'seo' | 'ada'
  aggregates: TypeAggregate[]
  diff: TypeDiff
  hasPrevious: boolean
  urlsByType: Map<string, string[]>
  descriptions: Map<string, { description: string | null; helpUrl: string | null }>
  sampleByType: Map<string, boolean>
  href: string | null
}): OpenFindingRow[] {
  return args.aggregates.map((a) => {
    // Deterministic visible sample (Codex plan-fix #3): dedupe + sort before the cap.
    const urls = [...new Set(args.urlsByType.get(a.type) ?? [])].sort()
    const d = args.descriptions.get(a.type)
    return {
      tool: args.tool,
      type: a.type,
      severity: a.severity,
      count: a.count,
      countDelta: args.hasPrevious ? (args.diff.countDelta.get(a.type) ?? null) : null,
      isNew: args.hasPrevious && args.diff.newTypes.has(a.type),
      description: d?.description ?? null,
      helpUrl: d?.helpUrl ?? null,
      urls: urls.slice(0, URLS_PER_FINDING),
      totalUrls: urls.length,
      isSample: args.sampleByType.get(a.type) ?? false,
      href: args.href,
    }
  })
}

export async function getClientFindings(clientId: number): Promise<ClientFindings> {
  const [sessions, crawlRuns] = await Promise.all([
    prisma.session.findMany({ where: { clientId }, select: { id: true, workflow: true } }),
    prisma.crawlRun.findMany({
      where: { clientId },
      select: {
        id: true, tool: true, source: true, domain: true, completedAt: true, createdAt: true,
        sessionId: true, siteAuditId: true, adaAuditId: true,
      },
    }),
  ])
  const keywordSessionIds = new Set(sessions.filter((s) => s.workflow === 'keyword-research').map((s) => s.id))
  const sel = selectRuns(crawlRuns, keywordSessionIds)

  const currentIds = [sel.seo.current?.id, sel.ada.current?.id].filter((x): x is string => !!x)
  if (currentIds.length === 0) return { rows: [], seo: null, ada: null }

  const [currentFindings, prevSeoRows, prevAdaGroups, adaHelp] = await Promise.all([
    prisma.finding.findMany({
      where: { runId: { in: currentIds } },
      select: {
        runId: true, scope: true, type: true, severity: true, url: true,
        count: true, detail: true, affectedComplete: true,
      },
    }),
    sel.seo.previous
      ? prisma.finding.findMany({
          where: { runId: sel.seo.previous.id, scope: 'run' },
          select: { type: true, count: true },
        })
      : Promise.resolve(null),
    // Previous-run shape is type+count only — severity intentionally absent (Codex fix #4).
    sel.ada.previous
      ? prisma.finding.groupBy({
          by: ['type'],
          // scope guard (Codex plan-fix #1): ADA findings are page-scope today,
          // but future run-scope rows must never pollute the diff baseline.
          where: { runId: sel.ada.previous.id, scope: 'page' },
          _count: { _all: true },
        })
      : Promise.resolve(null),
    sel.ada.current
      ? prisma.violation.findMany({
          where: { runId: sel.ada.current.id },
          select: { ruleId: true, help: true, helpUrl: true },
          distinct: ['ruleId'],
        })
      : Promise.resolve([]),
  ])

  const rows: OpenFindingRow[] = []
  let seoMeta: SourceRunMeta | null = null
  let adaMeta: (SourceRunMeta & { sourceClass: 'site' | 'page' }) | null = null

  if (sel.seo.current) {
    const cur = sel.seo.current
    const mine = currentFindings.filter((f) => f.runId === cur.id)
    const runScope = mine.filter((f) => f.scope === 'run')
    const pageScope = mine.filter((f) => f.scope === 'page' && f.url !== null)
    const aggregates = aggregateSeoTypes(runScope)
    const diff = diffTypes(aggregates, prevSeoRows)
    const urlsByType = new Map<string, string[]>()
    for (const p of pageScope) {
      const list = urlsByType.get(p.type) ?? []
      list.push(p.url as string)
      urlsByType.set(p.type, list)
    }
    const descriptions = new Map(runScope.map((f) => [f.type, { description: parseDescription(f.detail), helpUrl: null }]))
    // Three-state completeness (Codex fix #2): only explicit true is complete.
    const sampleByType = new Map(runScope.map((f) => [f.type, f.affectedComplete !== true]))
    rows.push(...buildRows({
      tool: 'seo', aggregates, diff, hasPrevious: sel.seo.previous !== null,
      urlsByType, descriptions, sampleByType, href: runHref(cur),
    }))
    seoMeta = meta(cur, diff, sel.seo.previous !== null)
  }

  if (sel.ada.current && sel.ada.sourceClass) {
    const cur = sel.ada.current
    const pageScope = currentFindings.filter((f) => f.runId === cur.id && f.scope === 'page')
    const aggregates = aggregateAdaTypes(pageScope)
    const prev = prevAdaGroups ? prevAdaGroups.map((g) => ({ type: g.type, count: g._count._all })) : null
    const diff = diffTypes(aggregates, prev)
    const urlsByType = new Map<string, string[]>()
    for (const p of pageScope) {
      if (p.url === null) continue
      const list = urlsByType.get(p.type) ?? []
      list.push(p.url)
      urlsByType.set(p.type, list)
    }
    const descriptions = new Map(adaHelp.map((v) => [v.ruleId, { description: v.help, helpUrl: v.helpUrl }]))
    const sampleByType = new Map<string, boolean>() // ADA URL lists are always complete
    rows.push(...buildRows({
      tool: 'ada', aggregates, diff, hasPrevious: sel.ada.previous !== null,
      urlsByType, descriptions, sampleByType, href: runHref(cur),
    }))
    adaMeta = { ...meta(cur, diff, sel.ada.previous !== null), sourceClass: sel.ada.sourceClass }
  }

  rows.sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count || a.type.localeCompare(b.type),
  )

  return { rows, seo: seoMeta, ada: adaMeta }
}
```

Note: `severity` casting happens inside `aggregateSeoTypes`/`aggregateAdaTypes` via `toSeverity`; the raw `f.severity` strings never reach the output unchecked. SEO run-scope `count` may exceed the page-scope URL-row count for sampled types — `count` is always the displayed number; `isSample` drives the URL-list labeling.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/client-findings.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/client-findings.ts lib/services/client-findings.test.ts
git commit -m "feat(clients): client-findings read service (open findings + type-level trends)"
```

---

### Task 4: fleet integration — Issues counts + regression alerts

**Files:**
- Modify: `lib/services/client-fleet.ts`
- Modify: `lib/services/client-fleet.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `lib/services/client-fleet.test.ts`:

```ts
  it('Issues counts: distinct types by severity across both tools; null without runs', async () => {
    const c = await makeClient('issues')
    const s = await makeSession(c.id, { createdAt: daysAgo(1) })
    const seoRun = await makeSeoRun(c.id, s.id, 80, daysAgo(1))
    await prisma.finding.create({
      data: { runId: seoRun.id, scope: 'run', type: 'broken_pages', severity: 'critical', count: 9, dedupKey: randomUUID() },
    })
    await prisma.finding.create({
      data: { runId: seoRun.id, scope: 'run', type: 'thin_content', severity: 'warning', count: 30, dedupKey: randomUUID() },
    })
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: c.id, completedAt: daysAgo(1) } })
    const adaRun = await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'site-audit', domain: DOMAIN, clientId: c.id, siteAuditId: sa.id, status: 'complete', score: 85, pagesTotal: 2, completedAt: daysAgo(1) },
    })
    // mixed severities on ONE rule — must collapse to a single critical type (Codex fix #3)
    await prisma.finding.create({
      data: { runId: adaRun.id, scope: 'page', type: 'color-contrast', severity: 'warning', url: `https://${DOMAIN}/a`, dedupKey: randomUUID() },
    })
    await prisma.finding.create({
      data: { runId: adaRun.id, scope: 'page', type: 'color-contrast', severity: 'critical', url: `https://${DOMAIN}/b`, dedupKey: randomUUID() },
    })
    // Hypothetical run-scope ADA row must be ignored by the scope guard (Codex plan-fix #4)
    await prisma.finding.create({
      data: { runId: adaRun.id, scope: 'run', type: 'phantom-rule', severity: 'critical', count: 1, dedupKey: randomUUID() },
    })

    const row = (await getClientFleet(NOW)).find((r) => r.id === c.id)!
    expect(row.openCritical).toBe(2)  // broken_pages + color-contrast (collapsed); phantom-rule ignored
    expect(row.openWarning).toBe(1)   // thin_content

    const empty = await makeClient('noissues')
    const emptyRow = (await getClientFleet(NOW)).find((r) => r.id === empty.id)!
    expect(emptyRow.openCritical).toBeNull()
    expect(emptyRow.openWarning).toBeNull()
  })

  it('regression alert: new critical type vs previous run fires; no previous → never fires', async () => {
    const reg = await makeClient('reg')
    const s1 = await makeSession(reg.id, { createdAt: daysAgo(10) })
    const r1 = await makeSeoRun(reg.id, s1.id, 85, daysAgo(10))
    await prisma.finding.create({
      data: { runId: r1.id, scope: 'run', type: 'thin_content', severity: 'warning', count: 5, dedupKey: randomUUID() },
    })
    const s2 = await makeSession(reg.id, { createdAt: daysAgo(1) })
    const r2 = await makeSeoRun(reg.id, s2.id, 84, daysAgo(1))
    await prisma.finding.create({
      data: { runId: r2.id, scope: 'run', type: 'broken_pages', severity: 'critical', count: 3, dedupKey: randomUUID() },
    })
    const regRow = (await getClientFleet(NOW)).find((r) => r.id === reg.id)!
    expect(regRow.alerts.some((a) => a.kind === 'regression')).toBe(true)

    const first = await makeClient('first')
    const fs = await makeSession(first.id, { createdAt: daysAgo(1) })
    const fr = await makeSeoRun(first.id, fs.id, 84, daysAgo(1))
    await prisma.finding.create({
      data: { runId: fr.id, scope: 'run', type: 'broken_pages', severity: 'critical', count: 3, dedupKey: randomUUID() },
    })
    const firstRow = (await getClientFleet(NOW)).find((r) => r.id === first.id)!
    expect(firstRow.alerts.some((a) => a.kind === 'regression')).toBe(false)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/client-fleet.test.ts`
Expected: FAIL — `openCritical` not on `FleetRow` (TS) / regression alert absent.

- [ ] **Step 3: Implement** — in `lib/services/client-fleet.ts`:

1. Imports:

```ts
import { collapseTypeGroups, newCriticalTypes, selectRuns, type TypeAggregate } from './findings-shared'
```

2. `FleetRow` gains:

```ts
  /** Distinct open critical/warning issue types across both tools' current
   *  runs; null when the client has no current findings-bearing runs. */
  openCritical: number | null
  openWarning: number | null
```

3. The `crawlRun.findMany` select gains `id: true, domain: true`.

4. After the six batched loads (before the `clients.map`), add the findings aggregation (two more batched queries — total 8):

```ts
  const keywordSessionIds = new Set(sessions.filter((s) => s.workflow === 'keyword-research').map((s) => s.id))

  // B2: current+previous run selection per client, then type-level aggregates
  // for Issues counts and regression alerts. Type-level only — no URLs.
  const selByClient = new Map(
    clients.map((c) => [
      c.id,
      selectRuns(crawlRuns.filter((r) => r.clientId === c.id), keywordSessionIds),
    ]),
  )
  const seoRunIds: string[] = []
  const adaRunIds: string[] = []
  for (const sel of selByClient.values()) {
    for (const r of [sel.seo.current, sel.seo.previous]) if (r) seoRunIds.push(r.id)
    for (const r of [sel.ada.current, sel.ada.previous]) if (r) adaRunIds.push(r.id)
  }
  const [seoTypeRows, adaTypeGroups] = await Promise.all([
    seoRunIds.length
      ? prisma.finding.findMany({
          where: { runId: { in: seoRunIds }, scope: 'run' },
          select: { runId: true, type: true, severity: true, count: true },
        })
      : Promise.resolve([]),
    adaRunIds.length
      ? prisma.finding.groupBy({
          by: ['runId', 'type', 'severity'],
          // scope guard (Codex plan-fix #1): see client-findings.ts.
          where: { runId: { in: adaRunIds }, scope: 'page' },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ])
  // Collapse ADA to ONE aggregate per (runId, type), max severity (Codex fix #3).
  const aggByRun = new Map<string, TypeAggregate[]>()
  for (const id of seoRunIds) {
    aggByRun.set(id, collapseTypeGroups(seoTypeRows.filter((f) => f.runId === id)))
  }
  for (const id of adaRunIds) {
    aggByRun.set(
      id,
      collapseTypeGroups(
        adaTypeGroups.filter((g) => g.runId === id).map((g) => ({ type: g.type, severity: g.severity, count: g._count._all })),
      ),
    )
  }
```

(The existing `keywordSessionIds` declaration inside the function moves up to this block — keep exactly one.)

5. Inside the `clients.map`, before the `return`:

```ts
    const sel = selByClient.get(c.id)!
    const currentAggs = [
      ...(sel.seo.current ? aggByRun.get(sel.seo.current.id) ?? [] : []),
      ...(sel.ada.current ? aggByRun.get(sel.ada.current.id) ?? [] : []),
    ]
    const hasFindingsRuns = sel.seo.current !== null || sel.ada.current !== null
    const openCritical = hasFindingsRuns ? currentAggs.filter((a) => a.severity === 'critical').length : null
    const openWarning = hasFindingsRuns ? currentAggs.filter((a) => a.severity === 'warning').length : null
    const regressionTypes = [
      ...newCriticalTypes(
        sel.seo.current ? aggByRun.get(sel.seo.current.id) ?? [] : [],
        sel.seo.previous ? new Set((aggByRun.get(sel.seo.previous.id) ?? []).map((a) => a.type)) : null,
      ),
      ...newCriticalTypes(
        sel.ada.current ? aggByRun.get(sel.ada.current.id) ?? [] : [],
        sel.ada.previous ? new Set((aggByRun.get(sel.ada.previous.id) ?? []).map((a) => a.type)) : null,
      ),
    ]
```

6. The `return` gains `openCritical, openWarning,` and the `computeAlerts` call's `newCriticalTypes: []` (from Task 2) becomes `newCriticalTypes: regressionTypes`.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/client-fleet.test.ts && npx tsc --noEmit`
Expected: PASS (9 tests), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/services/client-fleet.ts lib/services/client-fleet.test.ts
git commit -m "feat(clients): fleet Issues counts + regression alerts from findings tables"
```

---

### Task 5: `FindingsPanel` component

**Files:**
- Create: `components/clients/FindingsPanel.tsx`
- Test: `components/clients/FindingsPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
// components/clients/FindingsPanel.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { FindingsPanel, type FindingRowProp, type SourceMetaProp } from './FindingsPanel'

const meta = (over: Partial<SourceMetaProp> = {}): SourceMetaProp => ({
  runAt: '2026-06-10T00:00:00.000Z', href: '/seo-parser/results/s1', domain: 'acme.example',
  hasPrevious: true, newTypeCount: 0, resolvedTypeCount: 0, ...over,
})

const row = (over: Partial<FindingRowProp> = {}): FindingRowProp => ({
  tool: 'seo', type: 'broken_pages', severity: 'critical', count: 4,
  countDelta: null, isNew: false, description: 'Broken pages found', helpUrl: null,
  urls: ['https://acme.example/a', 'https://acme.example/b'], totalUrls: 2,
  isSample: false, href: '/seo-parser/results/s1', ...over,
})

describe('FindingsPanel', () => {
  it('renders humanized type, severity, count, and tool badge', () => {
    render(<FindingsPanel rows={[row()]} seo={meta()} ada={null} />)
    expect(screen.getByText('Broken pages')).toBeTruthy()
    expect(screen.getByText('critical')).toBeTruthy()
    expect(screen.getByText('SEO')).toBeTruthy()
    expect(screen.getByText(/4 URLs?/)).toBeTruthy()
  })

  it('shows NEW badge and worse-is-red delta', () => {
    render(
      <FindingsPanel
        rows={[
          row({ type: 'a_new', isNew: true }),
          row({ type: 'b_up', countDelta: 3 }),
          row({ type: 'c_down', countDelta: -2 }),
        ]}
        seo={meta({ newTypeCount: 1 })}
        ada={null}
      />,
    )
    expect(screen.getByText('NEW')).toBeTruthy()
    expect(screen.getByText('▲ +3')).toBeTruthy()
    expect(screen.getByText('▼ −2')).toBeTruthy()
  })

  it('expands affected URLs on click; sample annotation when isSample', () => {
    render(<FindingsPanel rows={[row({ isSample: true })]} seo={meta()} ada={null} />)
    expect(screen.queryByText('https://acme.example/a')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Broken pages/ }))
    expect(screen.getByText('https://acme.example/a')).toBeTruthy()
    expect(screen.getAllByText(/sample/i).length).toBeGreaterThanOrEqual(1)
  })

  it('sampled row with ZERO urls still shows the sample badge (Codex plan-fix #2)', () => {
    render(<FindingsPanel rows={[row({ isSample: true, urls: [], totalUrls: 0 })]} seo={meta()} ada={null} />)
    expect(screen.getByText('sample')).toBeTruthy()
  })

  it('shows capped-list footer link when totalUrls exceeds shown urls', () => {
    render(
      <FindingsPanel
        rows={[row({ urls: ['https://acme.example/a'], totalUrls: 40 })]}
        seo={meta()}
        ada={null}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Broken pages/ }))
    expect(screen.getByText(/Showing 1 of 40/)).toBeTruthy()
  })

  it('renders both empty states', () => {
    const { rerender } = render(<FindingsPanel rows={[]} seo={null} ada={null} />)
    expect(screen.getByText(/No findings data yet/)).toBeTruthy()
    rerender(<FindingsPanel rows={[]} seo={meta()} ada={null} />)
    expect(screen.getByText(/No open findings/)).toBeTruthy()
  })

  it('header shows source meta with new/resolved counts', () => {
    render(<FindingsPanel rows={[row()]} seo={meta({ newTypeCount: 2, resolvedTypeCount: 1 })} ada={null} />)
    expect(screen.getByText(/\+2 new/)).toBeTruthy()
    expect(screen.getByText(/1 resolved/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/FindingsPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
'use client'

// components/clients/FindingsPanel.tsx
//
// B2 open-findings panel: cross-tool issue list from the client's latest
// runs, with type-level trend badges and expandable affected-URL lists.
// Local prop interfaces (repo convention: never import server-only services).

import Link from 'next/link'
import { useState } from 'react'
import { RelativeTime } from '@/app/pillar-analysis/[id]/components/RelativeTime'

export interface FindingRowProp {
  tool: 'seo' | 'ada'
  type: string
  severity: 'critical' | 'warning' | 'notice'
  count: number
  countDelta: number | null
  isNew: boolean
  description: string | null
  helpUrl: string | null
  urls: string[]
  totalUrls: number
  isSample: boolean
  href: string | null
}

export interface SourceMetaProp {
  runAt: string
  href: string | null
  domain: string | null
  hasPrevious: boolean
  newTypeCount: number
  resolvedTypeCount: number
  sourceClass?: 'site' | 'page'
}

const SEV_CHIP: Record<FindingRowProp['severity'], string> = {
  critical: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  warning: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400',
  notice: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
}

function humanize(type: string): string {
  const s = type.replace(/[_-]/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function SourceLine({ label, m }: { label: string; m: SourceMetaProp }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-gray-400 dark:text-white/40">
      <span className="font-semibold uppercase">{label}</span>
      {m.sourceClass === 'page' && <span>(page audit)</span>}
      {m.domain && <span>{m.domain}</span>}
      <span>·</span>
      <RelativeTime value={m.runAt} />
      {m.hasPrevious && (
        <span>
          · <span className={m.newTypeCount > 0 ? 'text-red-600 dark:text-red-400' : ''}>+{m.newTypeCount} new</span>
          {' / '}
          <span className={m.resolvedTypeCount > 0 ? 'text-green-600 dark:text-green-400' : ''}>{m.resolvedTypeCount} resolved</span>
        </span>
      )}
      {m.href && (
        <Link href={m.href} className="text-[#f5a623] hover:text-[#e09415] font-semibold">
          full report →
        </Link>
      )}
    </div>
  )
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return null
  // Worse is red: count going UP is bad (inverse of score deltas).
  return (
    <span
      className={`px-1 py-0.5 rounded text-[10px] font-semibold tabular-nums ${
        delta > 0
          ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
          : 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
      }`}
    >
      {delta > 0 ? `▲ +${delta}` : `▼ −${Math.abs(delta)}`}
    </span>
  )
}

function FindingRow({ row }: { row: FindingRowProp }) {
  const [open, setOpen] = useState(false)
  const expandable = row.urls.length > 0
  return (
    <li className="border-b border-gray-100 dark:border-navy-border last:border-0">
      <button
        type="button"
        onClick={() => expandable && setOpen(!open)}
        className={`w-full flex items-center gap-2 py-2.5 px-1 text-left ${expandable ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-navy-light/40' : 'cursor-default'}`}
      >
        <span className={`shrink-0 text-gray-400 dark:text-white/40 text-xs w-3 ${expandable ? '' : 'invisible'}`}>
          {open ? '▾' : '▸'}
        </span>
        <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold ${SEV_CHIP[row.severity]}`}>
          {row.severity}
        </span>
        <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50">
          {row.tool === 'seo' ? 'SEO' : 'ADA'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-sm font-medium text-[#1c2d4a] dark:text-white">{humanize(row.type)}</span>
          {row.description && (
            <span className="block text-xs text-gray-500 dark:text-white/50 truncate">{row.description}</span>
          )}
        </span>
        {row.isNew && (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white">NEW</span>
        )}
        {/* Codex plan-fix #2: sample badge on the COLLAPSED row — a sampled,
            zero-URL finding is not expandable and must not look complete. */}
        {row.isSample && (
          <span
            className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50"
            title="URL list is a sample/partial — the count is authoritative"
          >
            sample
          </span>
        )}
        <DeltaBadge delta={row.countDelta} />
        <span className="shrink-0 text-xs text-gray-400 dark:text-white/40 tabular-nums">
          {row.count} URL{row.count === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div className="pl-10 pr-3 pb-3">
          <ul className="space-y-0.5">
            {row.urls.map((u) => (
              <li key={u} className="text-xs text-gray-600 dark:text-white/60 break-all">{u}</li>
            ))}
          </ul>
          <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-gray-400 dark:text-white/40">
            {row.isSample && <span>sample/partial URL list — count is authoritative</span>}
            {row.totalUrls > row.urls.length && (
              <span>
                Showing {row.urls.length} of {row.totalUrls}
                {row.href && (
                  <>
                    {' — '}
                    <Link href={row.href} className="text-[#f5a623] hover:text-[#e09415] font-semibold">view full report →</Link>
                  </>
                )}
              </span>
            )}
            {row.helpUrl && (
              <a href={row.helpUrl} target="_blank" rel="noopener noreferrer" className="text-[#f5a623] hover:text-[#e09415] font-semibold">
                how to fix →
              </a>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

export function FindingsPanel({ rows, seo, ada }: {
  rows: FindingRowProp[]
  seo: SourceMetaProp | null
  ada: SourceMetaProp | null
}) {
  const hasRuns = seo !== null || ada !== null
  return (
    <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-[#1c2d4a] dark:text-white uppercase tracking-wide">Open Findings</h2>
        <div className="space-y-0.5 text-right">
          {seo && <SourceLine label="SEO" m={seo} />}
          {ada && <SourceLine label="ADA" m={ada} />}
        </div>
      </div>
      {!hasRuns ? (
        <p className="text-sm text-gray-500 dark:text-white/60 py-4">
          No findings data yet — findings populate from runs after 2026-06-10. Run a parse or audit to see issues here.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-green-700 dark:text-green-400 py-4 font-medium">
          No open findings — the latest runs came back clean.
        </p>
      ) : (
        <ul>
          {rows.map((r) => (
            <FindingRow key={`${r.tool}:${r.type}`} row={r} />
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/FindingsPanel.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add components/clients/FindingsPanel.tsx components/clients/FindingsPanel.test.tsx
git commit -m "feat(clients): FindingsPanel component (cross-tool open findings + drill-downs)"
```

---

### Task 6: FleetTable — Issues column + regression chip

**Files:**
- Modify: `components/clients/FleetTable.tsx`
- Modify: `components/clients/FleetTable.test.tsx`

- [ ] **Step 1: Write the failing tests** — in `FleetTable.test.tsx`, extend the `row()` factory with `openCritical: null, openWarning: null,` defaults, then add:

```tsx
  it('renders Issues column chips and em-dash when null', () => {
    render(<FleetTable rows={[
      row({ id: 3, name: 'Issue Co', openCritical: 3, openWarning: 7 }),
      row({ id: 4, name: 'NoData Co' }),
    ]} />)
    expect(screen.getByText('3C')).toBeTruthy()
    expect(screen.getByText('7W')).toBeTruthy()
  })

  it('renders regression alert chip', () => {
    render(<FleetTable rows={[row({ id: 5, alerts: [{ kind: 'regression', detail: '1 new critical issue type' }] })]} />)
    expect(screen.getByText('regression')).toBeTruthy()
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/FleetTable.test.tsx`
Expected: FAIL — `openCritical` not on `FleetTableRow` / `regression` not in alert-kind union.

- [ ] **Step 3: Implement** — in `FleetTable.tsx`:

1. `FleetTableRow` gains `openCritical: number | null` and `openWarning: number | null`; its `alerts` kind union gains `'regression'`.
2. `ALERT_CLASSES` gains:

```ts
  regression: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
```

3. `SortKey` gains `'issues'`; the sort switch gains:

```ts
      case 'issues':
        copy.sort((a, b) => num(b.openCritical) - num(a.openCritical) || num(b.openWarning) - num(a.openWarning))
        break
```

4. Header row: insert `{header('Issues', 'issues', 'right')}` between Pillar and Last activity.
5. Body row: insert between the pillar `<td>` and last-activity `<td>`:

```tsx
                <td className="px-5 py-3 text-right">
                  {r.openCritical === null ? (
                    <span className="text-gray-300 dark:text-white/20">—</span>
                  ) : (
                    <span className="inline-flex gap-1 tabular-nums">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${r.openCritical > 0 ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400' : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50'}`} title="open critical issue types">
                        {r.openCritical}C
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${(r.openWarning ?? 0) > 0 ? 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400' : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50'}`} title="open warning issue types">
                        {r.openWarning ?? 0}W
                      </span>
                    </span>
                  )}
                </td>
```

6. The alert chip label line `{a.kind === 'score-drop' ? 'drop' : a.kind}` already renders `regression` as-is — no change needed.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/FleetTable.test.tsx && npx tsc --noEmit`
Expected: PASS, tsc clean (`getClientFleet` already returns the new fields from Task 4).

- [ ] **Step 5: Commit**

```bash
git add components/clients/FleetTable.tsx components/clients/FleetTable.test.tsx
git commit -m "feat(clients): fleet Issues column + regression alert chip"
```

---

### Task 7: dashboard page integration + full verification

**Files:**
- Modify: `app/clients/[id]/page.tsx`

- [ ] **Step 1: Wire the panel** — in `app/clients/[id]/page.tsx`:

1. Imports:

```tsx
import { getClientFindings } from '@/lib/services/client-findings'
import { FindingsPanel } from '@/components/clients/FindingsPanel'
```

2. Extend the parallel load:

```tsx
  const [dash, history, findings] = await Promise.all([
    getClientDashboard(clientId),
    getClientSeoHistory(clientId),
    getClientFindings(clientId),
  ])
```

3. In the JSX, inside the `space-y-6` div, ABOVE `<IssueTrendCard …/>`:

```tsx
          <FindingsPanel rows={findings.rows} seo={findings.seo} ada={findings.ada} />
```

(The service's `OpenFindingRow`/`SourceRunMeta` shapes are structurally identical to the panel's local `FindingRowProp`/`SourceMetaProp` — TypeScript checks structurally; no imports between them.)

- [ ] **Step 2: Full verification**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run
npx tsc --noEmit
npm run build
```

Expected: full suite green (1,843 + new ≈ 1,870+), tsc clean, build clean.

- [ ] **Step 3: Smoke-check locally (optional but recommended)**

`DATABASE_URL="file:./local-dev.db" npm run dev` → open `/clients` (Issues column renders) and a client dashboard (panel renders with the local DB's seeded runs, or its empty state).

- [ ] **Step 4: Commit**

```bash
git add app/clients/[id]/page.tsx
git commit -m "feat(clients): render FindingsPanel on the client dashboard (B2)"
```

---

### Task 8: branch, PR, deploy, production verify

- [ ] **Step 1:** All work happens on branch `feat/findings-action-center` (create it before Task 1 if executing inline: `git checkout -b feat/findings-action-center`).
- [ ] **Step 2:** Push + PR:

```bash
git push -u origin feat/findings-action-center
gh pr create --title "feat(clients): B2 findings/action center" --body "$(cat <<'EOF'
Open-findings panel on /clients/[id] (cross-tool, type-level trends, URL drill-downs) + fleet Issues column and regression alerts. Pure read layer over A2 tables — no schema/write changes, zero blob reads.

Spec: docs/superpowers/specs/2026-06-11-findings-action-center-design.md (Codex ×5)
Plan: docs/superpowers/plans/2026-06-11-findings-action-center.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3:** Merge after CI, then deploy: `ssh seo@144.126.213.242 "~/deploy.sh"` (push first — server pulls from GitHub).
- [ ] **Step 4:** Production verification:
  - Boot log clean (`/home/seo/logs/`).
  - Authenticated `curl` (cookie-jar login per handoff): `/clients` 200 and contains the Issues header; `/clients/30` (or another client with recent runs) 200 and contains "Open Findings".
  - Cross-check one client's panel against its latest run's report page: same issue types, counts match the run-scope rows (`node` + Prisma from `/home/seo/webapps/seo-tools` — no sqlite3 CLI on the server).
  - A client with pre-A2 data only shows the "No findings data yet" empty state.

---

## Self-review checklist (run after writing, before execution)

- Spec coverage: panel (Task 5+7), trends (Tasks 1, 3), fleet Issues + regression (Tasks 2, 4, 6), empty states (Tasks 3, 5), caps (Tasks 1, 3, 5), three-state sample (Tasks 1, 3), tie-breaker (Task 1), ADA collapse (Tasks 1, 4), previous-shape-no-severity (Task 3). Multi-domain limitation needs no code — documented in spec.
- Types consistent: `RunRef`/`SelectedRuns`/`TypeAggregate`/`TypeDiff` (Task 1) used by Tasks 3–4; `OpenFindingRow`/`SourceRunMeta` (Task 3) mirror `FindingRowProp`/`SourceMetaProp` (Task 5) structurally; `openCritical`/`openWarning` named identically in `FleetRow` (Task 4) and `FleetTableRow` (Task 6).
