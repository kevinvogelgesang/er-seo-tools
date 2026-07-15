# C14 Prospect Sales Audit View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sales self-serve full site audits on prospect domains via a minimal `/sales` intake, producing a stable token-gated public report page (`/sales/[token]`) with progressive-disclosure Accessibility / SEO / Performance / GEO sections and curated real evidence.

**Architecture:** Purpose-built sales layer (spec Approach A): new `Prospect` model + `SiteAudit.prospectId`, a `components/sales/` presentational layer that reuses the DATA layer only (findings runs, summary/fallback, per-page Lighthouse rows, new `CrawlRun.schemaTypesJson`), server-side curated-example selection as the safety boundary, and a token-validated screenshot route. Spec: `docs/superpowers/specs/2026-07-09-prospect-sales-audit-view-design.md` (Codex ×9 applied).

**Tech Stack:** Next.js 15 App Router (server components), Prisma + SQLite, Tailwind (class dark mode), vitest (+ jsdom per-file pragma for components).

## Global Constraints

- Array-form `$transaction([...])` ONLY — never interactive transactions.
- New API routes use `withRoute` (`@/lib/api/with-route`) + `parseJsonBody` (`@/lib/api/body`) + `HttpError` (`@/lib/api/errors`).
- New presentational components: server components (NO `'use client'`), `<details>/<summary>` for collapse, house card classes (`bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6`), `font-heading`/`font-body`, every color has a `dark:` variant.
- Component tests: `// @vitest-environment jsdom` pragma + `@testing-library/react`; DB tests hit the real local SQLite — prefix seeded domains and clean up in `beforeAll`/`afterAll` (house pattern).
- Tests: `npx vitest run <path>`; gates: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.
- **C18 is being implemented concurrently.** Do NOT modify: `components/ada-audit/SiteAuditResultsView.tsx`, `components/ada-audit/CommonIssueCallout.tsx`, `app/(app)/ada-audit/site/[id]/page.tsx`, `app/(public)/ada-audit/site/share/[token]/page.tsx`, or triage routes. Work in a worktree (`superpowers:using-git-worktrees`).
- Never scan external/third-party sites in dev — all verification uses seeded synthetic rows (Task 13).
- Section copy must never claim "WCAG compliant" or "Core Web Vitals pass" — performance data is Lighthouse *lab* data (no INP, TBT is a proxy); accessibility shows score + counts, not compliance claims.
- Public page + screenshot route: zero cookie-gated fetches; the sales token is the only authorization.

---

### Task 1: Schema migration — Prospect model, SiteAudit.prospectId, CrawlRun.schemaTypesJson

**Files:**
- Modify: `prisma/schema.prisma` (SiteAudit model ~lines 121–177; CrawlRun model ~lines 358–393; new Prospect model next to Client)
- Modify: `lib/findings/types.ts` (CrawlRunInput, ~lines 32–53)
- Create: migration via `npx prisma migrate dev` (auto-generated)

**Interfaces:**
- Produces: `Prospect` prisma model (`id Int`, `name`, `domain`, `notes?`, `createdBy?`, `salesToken? @unique`, `salesTokenExpiresAt?`, timestamps, `siteAudits[]`); `SiteAudit.prospectId Int?` + `prospect` relation; `CrawlRun.schemaTypesJson String?`; `CrawlRunInput.schemaTypesJson?: string | null`.

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Add the Prospect model (place after the Client model):

```prisma
model Prospect {
  id                  Int         @id @default(autoincrement())
  name                String
  domain              String
  notes               String?
  createdBy           String?
  salesToken          String?     @unique
  salesTokenExpiresAt DateTime?
  createdAt           DateTime    @default(now())
  updatedAt           DateTime    @updatedAt
  siteAudits          SiteAudit[]

  @@index([domain])
  @@index([salesTokenExpiresAt])
}
```

In `model SiteAudit`, add below the `schedule` relation (mirrors `clientId`/`scheduleId` shape):

```prisma
  prospectId    Int?
  prospect      Prospect?  @relation(fields: [prospectId], references: [id], onDelete: SetNull)
```

and with the other `@@index` lines:

```prisma
  @@index([prospectId])
```

In `model CrawlRun`, add below `contentSimilarityJson`:

```prisma
  schemaTypesJson       String?
```

- [ ] **Step 2: Run the migration**

Run: `npx prisma migrate dev --name prospect_sales_view`
Expected: new folder `prisma/migrations/<timestamp>_prospect_sales_view/` with `CREATE TABLE "Prospect"`, `ALTER TABLE "SiteAudit" ADD COLUMN "prospectId" INTEGER`, `ALTER TABLE "CrawlRun" ADD COLUMN "schemaTypesJson" TEXT`, indexes; client regenerated.

- [ ] **Step 3: Add the field to `CrawlRunInput`**

In `lib/findings/types.ts`, next to `contentSimilarityJson?: string | null`:

```ts
  schemaTypesJson?: string | null       // C14: aggregate schema-type histogram (live-scan runs only)
```

(`writer.ts` spreads `...run` into `prisma.crawlRun.create` — no writer change needed.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/findings/types.ts
git commit -m "feat(c14): Prospect model + SiteAudit.prospectId + CrawlRun.schemaTypesJson"
```

---

### Task 2: Thread `prospectId` through the enqueue path

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts` (`EnqueueAuditOptions` ~72–83, destructure ~99, create data block ~112–127)
- Modify: `lib/ada-audit/queue-request.ts` (`QueueRequestInput` ~23–37, `enqueueAudit` call ~81–88)
- Test: `lib/ada-audit/queue-manager.prospect.test.ts`

**Interfaces:**
- Consumes: `Prospect` model (Task 1).
- Produces: `EnqueueAuditOptions.prospectId?: number | null`; `QueueRequestInput.prospectId?: number | null` — Task 6's scan route passes it.

- [ ] **Step 1: Write the failing test**

```ts
// lib/ada-audit/queue-manager.prospect.test.ts
// DB-backed: real local SQLite. enqueueAudit creates the row; it may also
// fire-and-forget the promoter, so discover Jobs can appear AFTER row
// creation — afterAll cleans them by dedupKey once all ids are known.
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { enqueueAudit } from './queue-manager'

const DOMAIN = 'c14-enq-prospect.test'
const created: string[] = []

afterAll(async () => {
  await prisma.job.deleteMany({ where: { dedupKey: { in: created.map((id) => `discover:${id}`) } } })
  await prisma.siteAudit.deleteMany({ where: { id: { in: created } } })
  await prisma.prospect.deleteMany({ where: { domain: DOMAIN } })
})

describe('enqueueAudit prospectId threading', () => {
  it('persists prospectId on the created SiteAudit', async () => {
    const prospect = await prisma.prospect.create({ data: { name: 'Acme College', domain: DOMAIN } })
    const { id } = await enqueueAudit(DOMAIN, null, 'wcag21aa', {
      preDiscoveredUrls: [`https://${DOMAIN}/`],
      prospectId: prospect.id,
    })
    created.push(id)
    const row = await prisma.siteAudit.findUnique({ where: { id }, select: { prospectId: true, clientId: true } })
    expect(row?.prospectId).toBe(prospect.id)
    expect(row?.clientId).toBeNull()
  })

  it('defaults prospectId to null when omitted', async () => {
    const { id } = await enqueueAudit(DOMAIN, null, 'wcag21aa', { preDiscoveredUrls: [`https://${DOMAIN}/`] })
    created.push(id)
    const row = await prisma.siteAudit.findUnique({ where: { id }, select: { prospectId: true } })
    expect(row?.prospectId).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ada-audit/queue-manager.prospect.test.ts`
Expected: FAIL — `prospectId` not a known option / row value undefined-mismatch (TS error surfaces first: object literal may only specify known properties).

- [ ] **Step 3: Implement**

In `lib/ada-audit/queue-manager.ts`: add to `EnqueueAuditOptions`:

```ts
  prospectId?: number | null
```

Add `prospectId` to the destructure at the top of `enqueueAudit`, and to the `prisma.siteAudit.create({ data: { ... } })` block:

```ts
      prospectId: prospectId ?? null,
```

In `lib/ada-audit/queue-request.ts`: add to `QueueRequestInput`:

```ts
  prospectId?: number | null
```

and in the `enqueueAudit(...)` call block:

```ts
  prospectId: input.prospectId ?? null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ada-audit/queue-manager.prospect.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/queue-manager.ts lib/ada-audit/queue-request.ts lib/ada-audit/queue-manager.prospect.test.ts
git commit -m "feat(c14): thread prospectId through enqueueAudit + queueSiteAuditRequest"
```

---

### Task 3: Schema-type histogram — pure aggregator + builder wire-in

**Files:**
- Create: `lib/ada-audit/seo/schema-types.ts`
- Test: `lib/ada-audit/seo/schema-types.test.ts`
- Modify: `lib/jobs/handlers/broken-link-verify.ts` (next to the contentSimilarity seam, ~lines 478–505)
- Modify: `lib/jobs/handlers/broken-link-verify.test.ts` (extend the happy-path run-write assertion)

**Interfaces:**
- Produces: `SchemaTypesSummary { v: 1; observedPages: number; pagesWithSchema: number; types: { type: string; pages: number }[] }`; `aggregateSchemaTypes(rows: { schemaCount: number | null; detailsJson: string | null }[]): SchemaTypesSummary`. Task 8 reads `CrawlRun.schemaTypesJson` and parses this shape.

- [ ] **Step 1: Write the failing test**

```ts
// lib/ada-audit/seo/schema-types.test.ts
import { describe, expect, it } from 'vitest'
import { aggregateSchemaTypes } from './schema-types'

const row = (types: string[] | null) => ({
  schemaCount: types ? types.length : null,
  detailsJson: types ? JSON.stringify({ schemaTypes: types, hreflang: [] }) : null,
})

describe('aggregateSchemaTypes', () => {
  it('counts pages per type with denominators', () => {
    const out = aggregateSchemaTypes([
      row(['Organization', 'WebPage']),
      row(['Organization']),
      row([]),
      row(null), // unparseable/absent details → observed but schema-less
    ])
    expect(out).toEqual({
      v: 1,
      observedPages: 4,
      pagesWithSchema: 2,
      types: [
        { type: 'Organization', pages: 2 },
        { type: 'WebPage', pages: 1 },
      ],
    })
  })

  it('tolerates malformed detailsJson', () => {
    const out = aggregateSchemaTypes([{ schemaCount: 1, detailsJson: '{not json' }])
    expect(out.observedPages).toBe(1)
    expect(out.pagesWithSchema).toBe(1) // schemaCount scalar is authoritative for the denominator
    expect(out.types).toEqual([])
  })

  it('caps at top 20 types by page count', () => {
    const rows = [row(Array.from({ length: 30 }, (_, i) => `Type${i}`))]
    expect(aggregateSchemaTypes(rows).types).toHaveLength(20)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ada-audit/seo/schema-types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/ada-audit/seo/schema-types.ts
// C14: aggregate JSON-LD @type histogram across harvested pages, computed by
// the live-scan builder BEFORE the transient HarvestedPageSeo rows are
// deleted. Durable home: CrawlRun.schemaTypesJson.

export interface SchemaTypesSummary {
  v: 1
  observedPages: number
  pagesWithSchema: number
  types: { type: string; pages: number }[]
}

const MAX_TYPES = 20

export function aggregateSchemaTypes(
  rows: { schemaCount: number | null; detailsJson: string | null }[],
): SchemaTypesSummary {
  const counts = new Map<string, number>()
  let pagesWithSchema = 0
  for (const r of rows) {
    if ((r.schemaCount ?? 0) > 0) pagesWithSchema++
    if (!r.detailsJson) continue
    let types: unknown
    try {
      types = (JSON.parse(r.detailsJson) as { schemaTypes?: unknown }).schemaTypes
    } catch {
      continue
    }
    if (!Array.isArray(types)) continue
    for (const t of new Set(types.filter((x): x is string => typeof x === 'string'))) {
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }
  const types = [...counts.entries()]
    .map(([type, pages]) => ({ type, pages }))
    .sort((a, b) => b.pages - a.pages || a.type.localeCompare(b.type))
    .slice(0, MAX_TYPES)
  return { v: 1, observedPages: rows.length, pagesWithSchema, types }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ada-audit/seo/schema-types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into the builder**

In `lib/jobs/handlers/broken-link-verify.ts`, import:

```ts
import { aggregateSchemaTypes } from '@/lib/ada-audit/seo/schema-types'
```

Directly above the `contentSimilarityJson` block (the `seoRows` query already selects `schemaCount` + `detailsJson`), add — fail-to-null, never fails the run write:

```ts
let schemaTypesJson: string | null = null
try {
  schemaTypesJson = JSON.stringify(aggregateSchemaTypes(seoRows))
} catch (e) {
  console.error('[live-seo] schema-type aggregation failed', e)
}
```

Add to the `bundle.run` object literal, next to `contentSimilarityJson`:

```ts
    schemaTypesJson,
```

- [ ] **Step 6: Extend the builder test**

In `lib/jobs/handlers/broken-link-verify.test.ts`, the target is the existing test **"writes ONE live-scan run carrying on-page + broken-link findings"** (the file has multiple happy paths — use this one, per Codex plan-review fix #5). Ensure at least one seeded `HarvestedPageSeo` row's `detailsJson` is `JSON.stringify({ schemaTypes: ['Organization'], hreflang: [] })` (with `schemaCount: 1`), then extend the run assertion:

```ts
const run = await prisma.crawlRun.findUnique({
  where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
  select: { schemaTypesJson: true },
})
const schema = JSON.parse(run!.schemaTypesJson!)
expect(schema.v).toBe(1)
expect(schema.pagesWithSchema).toBeGreaterThanOrEqual(1)
expect(schema.types).toContainEqual({ type: 'Organization', pages: 1 })
```

- [ ] **Step 7: Run the builder tests**

Run: `npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: PASS (all existing + extended assertions).

- [ ] **Step 8: Commit**

```bash
git add lib/ada-audit/seo/schema-types.ts lib/ada-audit/seo/schema-types.test.ts lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.test.ts
git commit -m "feat(c14): aggregate schema-type histogram into CrawlRun.schemaTypesJson"
```

---

### Task 4: Pure performance roll-up (`cwv-aggregate`)

**Files:**
- Create: `lib/sales/cwv-aggregate.ts`
- Test: `lib/sales/cwv-aggregate.test.ts`

**Interfaces:**
- Consumes: `LighthouseSummary` from `@/lib/ada-audit/lighthouse-types` (`scores.performance` 0–100; `cwv.{lcp,cls,tbt}` + `{lcp,cls,tbt}Status: 'pass'|'needs-improvement'|'fail'`).
- Produces: `PerformanceRollup` + `aggregatePerformance(rows: { url: string; summary: LighthouseSummary }[]): PerformanceRollup | null` (null below `MIN_MEASURED_PAGES = 3`). Task 8 calls it; Task 9's PerformanceSection renders it.

- [ ] **Step 1: Write the failing test**

```ts
// lib/sales/cwv-aggregate.test.ts
import { describe, expect, it } from 'vitest'
import { aggregatePerformance, MIN_MEASURED_PAGES } from './cwv-aggregate'
import type { LighthouseSummary } from '@/lib/ada-audit/lighthouse-types'

function summary(perf: number, lcp: number, pass: boolean): LighthouseSummary {
  const status = pass ? 'pass' : 'fail'
  return {
    scores: { performance: perf, accessibility: 90, bestPractices: 90 },
    cwv: { lcp, cls: 0.05, tbt: 100, lcpStatus: status, clsStatus: 'pass', tbtStatus: 'pass' },
    topFailures: [],
  }
}

describe('aggregatePerformance', () => {
  it('returns null below the minimum sample', () => {
    const rows = Array.from({ length: MIN_MEASURED_PAGES - 1 }, (_, i) => ({
      url: `https://x.test/${i}`, summary: summary(90, 2000, true),
    }))
    expect(aggregatePerformance(rows)).toBeNull()
  })

  it('computes p75, pass %, buckets, and worst pages', () => {
    const rows = [
      { url: 'https://x.test/a', summary: summary(95, 1000, true) },
      { url: 'https://x.test/b', summary: summary(80, 2000, true) },
      { url: 'https://x.test/c', summary: summary(55, 3000, false) },
      { url: 'https://x.test/d', summary: summary(30, 4000, false) },
    ]
    const out = aggregatePerformance(rows)!
    expect(out.measuredPages).toBe(4)
    expect(out.p75LcpMs).toBe(3000) // ceil(0.75*4)-1 = index 2 of sorted [1000,2000,3000,4000]
    expect(out.pctPassing).toBe(50) // a,b pass all three statuses
    expect(out.scoreBuckets).toEqual({ good: 1, fair: 2, poor: 1 }) // ≥90 / 50–89 / <50
    expect(out.worstPages).toEqual([
      { url: 'https://x.test/d', performance: 30 },
      { url: 'https://x.test/c', performance: 55 },
      { url: 'https://x.test/b', performance: 80 },
    ])
    expect(out.medianPerformance).toBe(68) // round((80+55)/2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/sales/cwv-aggregate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/sales/cwv-aggregate.ts
// C14: pure site-wide roll-up of per-page Lighthouse summaries. LAB data —
// TBT proxy, no INP, not CrUX. Copy in the UI must say "Lighthouse-measured".
import type { LighthouseSummary } from '@/lib/ada-audit/lighthouse-types'

export const MIN_MEASURED_PAGES = 3

export interface PerformanceRollup {
  measuredPages: number
  medianPerformance: number
  p75LcpMs: number
  p75Cls: number
  p75TbtMs: number
  pctPassing: number // % of measured pages with all three statuses 'pass'
  scoreBuckets: { good: number; fair: number; poor: number }
  worstPages: { url: string; performance: number }[] // up to 3, ascending score
}

function p75(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(0.75 * sorted.length) - 1)]
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

export function aggregatePerformance(
  rows: { url: string; summary: LighthouseSummary }[],
): PerformanceRollup | null {
  if (rows.length < MIN_MEASURED_PAGES) return null
  const perf = rows.map((r) => r.summary.scores.performance)
  const passing = rows.filter(
    (r) => r.summary.cwv.lcpStatus === 'pass' && r.summary.cwv.clsStatus === 'pass' && r.summary.cwv.tbtStatus === 'pass',
  ).length
  return {
    measuredPages: rows.length,
    medianPerformance: median(perf),
    p75LcpMs: p75(rows.map((r) => r.summary.cwv.lcp)),
    p75Cls: p75(rows.map((r) => r.summary.cwv.cls)),
    p75TbtMs: p75(rows.map((r) => r.summary.cwv.tbt)),
    pctPassing: Math.round((passing / rows.length) * 100),
    scoreBuckets: {
      good: perf.filter((s) => s >= 90).length,
      fair: perf.filter((s) => s >= 50 && s < 90).length,
      poor: perf.filter((s) => s < 50).length,
    },
    worstPages: rows
      .map((r) => ({ url: r.url, performance: r.summary.scores.performance }))
      .sort((a, b) => a.performance - b.performance)
      .slice(0, 3),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/sales/cwv-aggregate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/sales/cwv-aggregate.ts lib/sales/cwv-aggregate.test.ts
git commit -m "feat(c14): pure Lighthouse performance roll-up for the sales view"
```

---

### Task 5: Prospect service — create (dedupe by domain), list, delete helpers

**Files:**
- Create: `lib/services/prospects.ts`
- Test: `lib/services/prospects.test.ts`

**Interfaces:**
- Consumes: `Prospect`/`SiteAudit.prospectId` (Task 1).
- Produces (Tasks 6, 11 consume):

```ts
normalizeProspectDomain(input: string): string
createProspect(input: { name: string; domain: string; notes?: string | null; createdBy?: string | null }):
  Promise<{ kind: 'created' | 'existing'; prospect: { id: number; name: string; domain: string } } | { kind: 'invalid'; reason: string }>
listProspects(): Promise<ProspectRow[]>
// ProspectRow: { id: number; name: string; domain: string; createdAt: string;
//   salesTokenActive: boolean;
//   latestAudit: null | { id: string; status: string; completedAt: string | null;
//     adaScore: number | null; reportable: boolean } }
```

- [ ] **Step 1: Write the failing test**

```ts
// lib/services/prospects.test.ts
// DB-backed against local SQLite.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { createProspect, listProspects, normalizeProspectDomain } from './prospects'

const PREFIX = 'c14-svc-'
async function cleanup() {
  const rows = await prisma.prospect.findMany({ where: { domain: { startsWith: PREFIX } }, select: { id: true } })
  const ids = rows.map((r) => r.id)
  await prisma.siteAudit.deleteMany({ where: { prospectId: { in: ids } } })
  await prisma.prospect.deleteMany({ where: { id: { in: ids } } })
}
beforeAll(cleanup)
afterAll(cleanup)

describe('normalizeProspectDomain', () => {
  it('strips scheme, www, path, trailing dots and lowercases', () => {
    expect(normalizeProspectDomain('HTTPS://WWW.Acme-College.EDU/programs/')).toBe('acme-college.edu')
    expect(normalizeProspectDomain('acme.edu.')).toBe('acme.edu')
  })
})

describe('createProspect', () => {
  it('creates, then returns existing on same normalized domain', async () => {
    const a = await createProspect({ name: 'Acme', domain: `https://www.${PREFIX}acme.test/` })
    expect(a.kind).toBe('created')
    const b = await createProspect({ name: 'Acme again', domain: `${PREFIX}acme.test` })
    expect(b.kind).toBe('existing')
    if (a.kind !== 'invalid' && b.kind !== 'invalid') expect(b.prospect.id).toBe(a.prospect.id)
  })

  it('rejects an empty name or unusable domain', async () => {
    expect((await createProspect({ name: '  ', domain: `${PREFIX}x.test` })).kind).toBe('invalid')
    expect((await createProspect({ name: 'X', domain: 'not a domain' })).kind).toBe('invalid')
  })
})

describe('listProspects', () => {
  it('joins the latest audit with reportable flag', async () => {
    const created = await createProspect({ name: 'ListMe', domain: `${PREFIX}list.test` })
    if (created.kind === 'invalid') throw new Error('seed failed')
    const audit = await prisma.siteAudit.create({
      data: {
        domain: `${PREFIX}list.test`, wcagLevel: 'wcag21aa', status: 'complete',
        prospectId: created.prospect.id, completedAt: new Date(),
      },
    })
    // no seo-parser CrawlRun → complete but NOT reportable
    const rows = await listProspects()
    const mine = rows.find((r) => r.id === created.prospect.id)
    expect(mine?.latestAudit?.id).toBe(audit.id)
    expect(mine?.latestAudit?.reportable).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/services/prospects.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/services/prospects.ts
// C14: prospect CRUD for the /sales intake. One prospect per normalized
// domain, best-effort app-level (client-schedules precedent, no DB unique).
import { prisma } from '@/lib/db'

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

export function normalizeProspectDomain(input: string): string {
  let d = input.trim().toLowerCase()
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme
  d = d.split('/')[0].split('?')[0].split('#')[0]
  d = d.replace(/^www\./, '').replace(/\.+$/, '')
  return d
}

export interface ProspectRow {
  id: number
  name: string
  domain: string
  createdAt: string
  salesTokenActive: boolean
  latestAudit: null | {
    id: string
    status: string
    completedAt: string | null
    adaScore: number | null
    reportable: boolean
  }
}

export async function createProspect(input: {
  name: string
  domain: string
  notes?: string | null
  createdBy?: string | null
}): Promise<
  | { kind: 'created' | 'existing'; prospect: { id: number; name: string; domain: string } }
  | { kind: 'invalid'; reason: string }
> {
  const name = input.name.trim()
  if (!name) return { kind: 'invalid', reason: 'name required' }
  const domain = normalizeProspectDomain(input.domain)
  if (!domain || !DOMAIN_RE.test(domain)) return { kind: 'invalid', reason: 'domain invalid' }

  const existing = await prisma.prospect.findFirst({ where: { domain }, orderBy: { id: 'asc' } })
  if (existing) return { kind: 'existing', prospect: { id: existing.id, name: existing.name, domain: existing.domain } }

  const created = await prisma.prospect.create({
    data: { name, domain, notes: input.notes ?? null, createdBy: input.createdBy ?? null },
  })
  return { kind: 'created', prospect: { id: created.id, name: created.name, domain: created.domain } }
}

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
      crawlRuns: { select: { tool: true, score: true } },
    },
  })
  const latestByProspect = new Map<number, (typeof audits)[number]>()
  for (const a of audits) {
    if (a.prospectId !== null && !latestByProspect.has(a.prospectId)) latestByProspect.set(a.prospectId, a)
  }
  return prospects.map((p) => {
    const a = latestByProspect.get(p.id) ?? null
    return {
      id: p.id,
      name: p.name,
      domain: p.domain,
      createdAt: p.createdAt.toISOString(),
      salesTokenActive: !!p.salesToken && !!p.salesTokenExpiresAt && p.salesTokenExpiresAt > now,
      latestAudit: a
        ? {
            id: a.id,
            status: a.status,
            completedAt: a.completedAt?.toISOString() ?? null,
            adaScore: a.crawlRuns.find((r) => r.tool === 'ada-audit')?.score ?? null,
            reportable: a.status === 'complete' && a.crawlRuns.some((r) => r.tool === 'seo-parser'),
          }
        : null,
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/services/prospects.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/prospects.ts lib/services/prospects.test.ts
git commit -m "feat(c14): prospect service — create w/ domain dedupe, list w/ reportable flag"
```

---

### Task 6: Intake API routes + share token + cleanup sweep

**Files:**
- Create: `app/api/sales/prospects/route.ts` (GET list / POST create)
- Create: `app/api/sales/prospects/[id]/route.ts` (DELETE)
- Create: `app/api/sales/prospects/[id]/scan/route.ts` (POST)
- Create: `app/api/sales/prospects/[id]/share/route.ts` (POST extend-or-rotate / GET read-only)
- Modify: `lib/cleanup.ts` (new sweep + register in `runCleanup()`'s `Promise.allSettled([...])`)
- Test: `app/api/sales/prospects/routes.test.ts`, `app/api/sales/prospects/scan-route.test.ts`

**Interfaces:**
- Consumes: `createProspect`/`listProspects` (Task 5), `queueSiteAuditRequest` + `prospectId` (Task 2), `getOperatorLabel`/`AUTH_COOKIE_NAME`/`OPERATOR_NAME_COOKIE_NAME` from `@/lib/auth`.
- Produces: `SALES_TTL_MS`, `buildSalesUrl(token)`; share POST body `{ salesUrl, expiresAt }`; scan POST 202 `{ auditId }`; create POST 201 `{ prospect }` / 200 `{ prospect, existing: true }`. `cleanExpiredProspectSalesTokens()`.

- [ ] **Step 1: Write the failing route tests**

```ts
// app/api/sales/prospects/routes.test.ts
// DB-backed; handlers called directly (house pattern from the C4 share route test).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET as listGet, POST as createPost } from './route'
import { DELETE as prospectDelete } from './[id]/route'
import { GET as shareGet, POST as sharePost } from './[id]/share/route'

const PREFIX = 'c14-rt-'
async function cleanup() {
  const rows = await prisma.prospect.findMany({ where: { domain: { startsWith: PREFIX } }, select: { id: true } })
  await prisma.siteAudit.deleteMany({ where: { prospectId: { in: rows.map((r) => r.id) } } })
  await prisma.prospect.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } })
}
beforeAll(cleanup)
afterAll(cleanup)

const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost:3000${url}`, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) })

describe('POST /api/sales/prospects', () => {
  it('creates then reports existing on duplicate domain', async () => {
    const r1 = await createPost(req('/api/sales/prospects', 'POST', { name: 'Acme', domain: `${PREFIX}dup.test` }))
    expect(r1.status).toBe(201)
    const r2 = await createPost(req('/api/sales/prospects', 'POST', { name: 'Acme 2', domain: `www.${PREFIX}dup.test` }))
    expect(r2.status).toBe(200)
    expect((await r2.json()).existing).toBe(true)
  })
  it('400s on invalid input', async () => {
    const r = await createPost(req('/api/sales/prospects', 'POST', { name: '', domain: 'x' }))
    expect(r.status).toBe(400)
  })
})

describe('GET /api/sales/prospects', () => {
  it('lists prospects', async () => {
    const r = await listGet()
    expect(r.status).toBe(200)
    expect(Array.isArray((await r.json()).prospects)).toBe(true)
  })
})

describe('share route', () => {
  it('404s without a reportable audit? No — token issuance requires only the prospect; POST rotates, GET reads', async () => {
    const p = await prisma.prospect.create({ data: { name: 'Share', domain: `${PREFIX}share.test` } })
    const g0 = await shareGet(req(`/api/sales/prospects/${p.id}/share`, 'GET'), params(p.id))
    expect((await g0.json()).salesToken).toBeNull()
    const r = await sharePost(req(`/api/sales/prospects/${p.id}/share`, 'POST'), params(p.id))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.salesUrl).toContain('/sales/')
    const row = await prisma.prospect.findUnique({ where: { id: p.id } })
    expect(row?.salesToken).toBeTruthy()
    expect(row?.salesTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now())
    // GET must NOT mutate expiry
    const before = row?.salesTokenExpiresAt!.getTime()
    await shareGet(req(`/api/sales/prospects/${p.id}/share`, 'GET'), params(p.id))
    const after = (await prisma.prospect.findUnique({ where: { id: p.id } }))?.salesTokenExpiresAt!.getTime()
    expect(after).toBe(before)
  })
})

describe('DELETE /api/sales/prospects/[id]', () => {
  it('deletes and SetNulls audits', async () => {
    const p = await prisma.prospect.create({ data: { name: 'Del', domain: `${PREFIX}del.test` } })
    const a = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}del.test`, wcagLevel: 'wcag21aa', status: 'complete', prospectId: p.id },
    })
    const r = await prospectDelete(req(`/api/sales/prospects/${p.id}`, 'DELETE'), params(p.id))
    expect(r.status).toBe(200)
    expect((await prisma.siteAudit.findUnique({ where: { id: a.id } }))?.prospectId).toBeNull()
    // cleanup of the orphaned audit
    await prisma.siteAudit.delete({ where: { id: a.id } })
  })
})
```

```ts
// app/api/sales/prospects/scan-route.test.ts
// Mocks queueSiteAuditRequest (C15 precedent: the real path fires
// fire-and-forget processNext which can promote unrelated queued audits).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

vi.mock('@/lib/ada-audit/queue-request', () => ({
  queueSiteAuditRequest: vi.fn(async () => ({ kind: 'queued', id: 'audit-mock-1' })),
}))
import { queueSiteAuditRequest } from '@/lib/ada-audit/queue-request'
import { POST as scanPost } from './[id]/scan/route'

const PREFIX = 'c14-scan-'
async function cleanup() {
  await prisma.prospect.deleteMany({ where: { domain: { startsWith: PREFIX } } })
}
beforeAll(cleanup)
afterAll(cleanup)

const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) })

describe('POST /api/sales/prospects/[id]/scan', () => {
  it('queues a full audit with prospectId and null clientId', async () => {
    const p = await prisma.prospect.create({ data: { name: 'Scan', domain: `${PREFIX}scan.test` } })
    const r = await scanPost(new NextRequest(`http://localhost:3000/api/sales/prospects/${p.id}/scan`, { method: 'POST' }), params(p.id))
    expect(r.status).toBe(202)
    expect((await r.json()).auditId).toBe('audit-mock-1')
    expect(queueSiteAuditRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: `${PREFIX}scan.test`,
        clientId: null,
        prospectId: p.id,
        wcagLevel: 'wcag21aa',
        seoOnly: false,
      }),
    )
  })
  it('404s on unknown prospect', async () => {
    const r = await scanPost(new NextRequest('http://localhost:3000/api/sales/prospects/999999/scan', { method: 'POST' }), params(999999))
    expect(r.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/sales/prospects`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the routes**

```ts
// app/api/sales/prospects/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { AUTH_COOKIE_NAME, OPERATOR_NAME_COOKIE_NAME, getOperatorLabel } from '@/lib/auth'
import { createProspect, listProspects } from '@/lib/services/prospects'

export const GET = withRoute(async () => {
  return NextResponse.json({ prospects: await listProspects() })
})

export const POST = withRoute(async (request: NextRequest) => {
  const body = await parseJsonBody<{ name?: unknown; domain?: unknown; notes?: unknown }>(request)
  const name = typeof body?.name === 'string' ? body.name : ''
  const domain = typeof body?.domain === 'string' ? body.domain : ''
  const notes = typeof body?.notes === 'string' ? body.notes : null
  const createdBy = await getOperatorLabel(
    request.cookies.get(AUTH_COOKIE_NAME)?.value,
    request.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value,
  )
  const result = await createProspect({ name, domain, notes, createdBy })
  if (result.kind === 'invalid') return NextResponse.json({ error: result.reason }, { status: 400 })
  if (result.kind === 'existing') return NextResponse.json({ prospect: result.prospect, existing: true })
  return NextResponse.json({ prospect: result.prospect }, { status: 201 })
})
```

```ts
// app/api/sales/prospects/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { prisma } from '@/lib/db'

function parseId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

export const DELETE = withRoute(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const id = parseId((await params).id)
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const existing = await prisma.prospect.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })
  await prisma.prospect.delete({ where: { id } }) // SiteAudit.prospectId SetNulls via relation
  return NextResponse.json({ ok: true })
})
```

```ts
// app/api/sales/prospects/[id]/scan/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { prisma } from '@/lib/db'
import { AUTH_COOKIE_NAME, OPERATOR_NAME_COOKIE_NAME, getOperatorLabel } from '@/lib/auth'
import { queueSiteAuditRequest } from '@/lib/ada-audit/queue-request'

export const POST = withRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const prospect = await prisma.prospect.findUnique({ where: { id }, select: { id: true, domain: true } })
  if (!prospect) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const requestedBy = await getOperatorLabel(
    request.cookies.get(AUTH_COOKIE_NAME)?.value,
    request.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value,
  )
  // FULL audit — Accessibility + Performance sections need axe + PSI (never seoOnly).
  const result = await queueSiteAuditRequest({
    domain: prospect.domain,
    clientId: null,
    prospectId: prospect.id,
    wcagLevel: 'wcag21aa',
    requestedBy,
    seoOnly: false,
  })
  if (result.kind === 'invalid') return NextResponse.json({ error: result.reason }, { status: 400 })
  if (result.kind === 'duplicate') return NextResponse.json({ error: 'audit already in flight', auditId: result.existingId }, { status: 409 })
  return NextResponse.json({ auditId: result.id }, { status: 202 })
})
```

```ts
// app/api/sales/prospects/[id]/share/route.ts
// POST extends-or-rotates (mirror of app/api/site-audit/[id]/share); GET is read-only.
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { prisma } from '@/lib/db'

export const SALES_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function buildSalesUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${base}/sales/${token}`
}

function parseId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

export const POST = withRoute(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const id = parseId((await params).id)
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const prospect = await prisma.prospect.findUnique({
    where: { id },
    select: { salesToken: true, salesTokenExpiresAt: true },
  })
  if (!prospect) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const now = new Date()
  const expiresAt = new Date(now.getTime() + SALES_TTL_MS)
  let token = prospect.salesToken
  if (!token || !prospect.salesTokenExpiresAt || prospect.salesTokenExpiresAt <= now) {
    token = crypto.randomUUID()
    await prisma.prospect.update({ where: { id }, data: { salesToken: token, salesTokenExpiresAt: expiresAt } })
  } else {
    await prisma.prospect.update({ where: { id }, data: { salesTokenExpiresAt: expiresAt } })
  }
  return NextResponse.json({ salesUrl: buildSalesUrl(token), expiresAt: expiresAt.toISOString() })
})

export const GET = withRoute(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const id = parseId((await params).id)
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const prospect = await prisma.prospect.findUnique({
    where: { id },
    select: { salesToken: true, salesTokenExpiresAt: true },
  })
  if (!prospect) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!prospect.salesToken || !prospect.salesTokenExpiresAt || prospect.salesTokenExpiresAt <= new Date()) {
    return NextResponse.json({ salesToken: null })
  }
  return NextResponse.json({
    salesToken: prospect.salesToken,
    salesUrl: buildSalesUrl(prospect.salesToken),
    expiresAt: prospect.salesTokenExpiresAt.toISOString(),
  })
})
```

- [ ] **Step 4: Add the cleanup sweep**

In `lib/cleanup.ts`, next to `cleanExpiredSiteAuditShareTokens` (~line 158):

```ts
/** C14: clear expired Prospect sales tokens (mirror of the share-token sweeps). */
export async function cleanExpiredProspectSalesTokens(): Promise<void> {
  await prisma.prospect.updateMany({
    where: { salesTokenExpiresAt: { lt: new Date() } },
    data: { salesToken: null, salesTokenExpiresAt: null },
  })
}
```

and add `cleanExpiredProspectSalesTokens()` to the `Promise.allSettled([...])` array in `runCleanup()`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run app/api/sales/prospects`
Expected: PASS (all tests in both files).

- [ ] **Step 6: Commit**

```bash
git add app/api/sales lib/cleanup.ts
git commit -m "feat(c14): prospect intake API — create/list/scan/share/delete + token sweep"
```

---

### Task 7: Reportable-audit resolution + curated accessibility examples

**Files:**
- Create: `lib/sales/representative-examples.ts`
- Test: `lib/sales/representative-examples.test.ts`

**Interfaces:**
- Consumes: `CommonIssue`, `StoredAxeResults`, `AxeNode` from `@/lib/ada-audit/types`; `buildArchivedAxeResults(adaAuditId: string): Promise<StoredAxeResults | null>` from `@/lib/ada-audit/findings-fallback`.
- Produces (Task 8 consumes):

```ts
interface CuratedExample { html: string; selector: string | null; screenshotFile: string | null; adaAuditId: string | null; pageUrl: string | null }
loadRepresentativeExamples(siteAuditId: string, issue: CommonIssue, cap?: number): Promise<CuratedExample[]>
```

> **C18 seam check (do this FIRST):** grep for an existing representative-page loader from C18 (`grep -rn "representative" lib/ components/ada-audit/ --include="*.ts*" -l`). If C18 has landed one that resolves (siteAuditId, CommonIssue) → nodes, DELEGATE to it inside `loadRepresentativeExamples` and keep this module as the thin sales-facing adapter (same `CuratedExample` output). If not (C18 unmerged), implement as below — the interface was designed to match the umbrella spec's bounded-loader rules, so a later swap is internal-only.

- [ ] **Step 1: Write the failing test**

```ts
// lib/sales/representative-examples.test.ts
// DB-backed: seeds a SiteAudit + child AdaAudit with a result blob.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { loadRepresentativeExamples } from './representative-examples'
import type { CommonIssue } from '@/lib/ada-audit/types'

const PREFIX = 'c14-rep-'
const created = { site: [] as string[], child: [] as string[] }
async function cleanup() {
  await prisma.adaAudit.deleteMany({ where: { id: { in: created.child } } })
  await prisma.siteAudit.deleteMany({ where: { id: { in: created.site } } })
}
beforeAll(cleanup)
afterAll(cleanup)

const issue = (over: Partial<CommonIssue> = {}): CommonIssue => ({
  ruleId: 'color-contrast', impact: 'serious', help: 'Elements must have sufficient color contrast',
  description: 'desc', helpUrl: 'https://x', affectedPagesCount: 3, totalPagesScanned: 5,
  sharedAncestor: null, ancestorConfidence: null, examplePageUrl: `https://${PREFIX}x.test/a`,
  ...over,
})

function resultBlob() {
  return JSON.stringify({
    violations: [{
      id: 'color-contrast', impact: 'serious', help: 'h', description: 'd', helpUrl: 'u', tags: [],
      nodes: [
        { html: '<a class="cta">Apply</a>', target: ['a.cta'], screenshotPath: 'color-contrast-0.png' },
        { html: '<a class="cta">Apply</a>', target: ['a.cta'] }, // duplicate html → deduped
        { html: '<p class="fine">x</p>', target: ['p.fine'] },
      ],
    }],
    passes: [], incomplete: [], inapplicable: [],
    timestamp: 't', url: `https://${PREFIX}x.test/a`,
    testEngine: { name: 'axe', version: '4' }, testRunner: { name: 'axe' },
  })
}

describe('loadRepresentativeExamples', () => {
  it('extracts deduped nodes for the rule from the example page child audit', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}x.test`, wcagLevel: 'wcag21aa', status: 'complete' },
    })
    created.site.push(site.id)
    const child = await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}x.test/a`, status: 'complete', siteAuditId: site.id, result: resultBlob() },
    })
    created.child.push(child.id)

    const out = await loadRepresentativeExamples(site.id, issue(), 5)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      html: '<a class="cta">Apply</a>', selector: 'a.cta',
      screenshotFile: 'color-contrast-0.png', adaAuditId: child.id,
      pageUrl: `https://${PREFIX}x.test/a`,
    })
    expect(out[1].screenshotFile).toBeNull()
  })

  it('returns [] when no example page or child audit matches', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}none.test`, wcagLevel: 'wcag21aa', status: 'complete' },
    })
    created.site.push(site.id)
    expect(await loadRepresentativeExamples(site.id, issue({ examplePageUrl: null }))).toEqual([])
    expect(await loadRepresentativeExamples(site.id, issue({ examplePageUrl: 'https://nope.test/x' }))).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/sales/representative-examples.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/sales/representative-examples.ts
// C14: bounded curated-evidence loader — resolve the pattern's example page,
// load that ONE child audit, extract its nodes for the rule. NEVER fans out
// across all affected pages (umbrella-spec Codex fix #10 discipline).
import { prisma } from '@/lib/db'
import { buildArchivedAxeResults } from '@/lib/ada-audit/findings-fallback'
import type { CommonIssue, StoredAxeResults } from '@/lib/ada-audit/types'

export interface CuratedExample {
  html: string
  selector: string | null
  screenshotFile: string | null
  adaAuditId: string | null
  pageUrl: string | null
}

export async function loadRepresentativeExamples(
  siteAuditId: string,
  issue: CommonIssue,
  cap = 5,
): Promise<CuratedExample[]> {
  if (!issue.examplePageUrl) return []
  const child = await prisma.adaAudit.findFirst({
    where: { siteAuditId, url: issue.examplePageUrl },
    select: { id: true, url: true, result: true },
  })
  if (!child) return []

  let stored: StoredAxeResults | null = null
  if (child.result) {
    try {
      stored = JSON.parse(child.result) as StoredAxeResults
    } catch {
      stored = null
    }
  }
  // Archived degradation: blob pruned → findings-table fallback (capped nodes,
  // no screenshots). Copy in the UI labels these as a capped sample.
  if (!stored) stored = await buildArchivedAxeResults(child.id)
  if (!stored) return []

  const violation = stored.violations.find((v) => v.id === issue.ruleId)
  if (!violation) return []

  const seen = new Set<string>()
  const out: CuratedExample[] = []
  for (const node of violation.nodes) {
    if (!node.html || seen.has(node.html)) continue
    seen.add(node.html)
    out.push({
      html: node.html,
      selector: node.target?.length ? node.target[node.target.length - 1] : null,
      screenshotFile: node.screenshotPath ?? null,
      adaAuditId: child.id,
      pageUrl: child.url,
    })
    if (out.length >= cap) break
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/sales/representative-examples.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/sales/representative-examples.ts lib/sales/representative-examples.test.ts
git commit -m "feat(c14): bounded representative-example loader for sales evidence"
```

---

### Task 8: Sales report data loader + copy module

**Files:**
- Create: `lib/sales/copy.ts`
- Create: `lib/sales/sales-report-data.ts`
- Test: `lib/sales/sales-report-data.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 7 outputs; `buildSummaryFromFindings` from `@/lib/ada-audit/findings-fallback`; `SiteAuditSummary`/`CommonIssue` from `@/lib/ada-audit/types`.
- Produces (Tasks 9, 10 consume):

```ts
type SalesReportResult =
  | { kind: 'invalid' }
  | { kind: 'pending'; prospect: { name: string; domain: string } }
  | { kind: 'ready'; data: SalesReportData }
loadSalesReportData(token: string): Promise<SalesReportResult>
validateSalesToken(token: string): Promise<{ id: number; name: string; domain: string } | null>
curatedScreenshotSet(prospectId: number, adaAuditId: string): Promise<Set<string>> // Task 10 uses; keys are `${adaAuditId}/${filename}`
// SalesReportData shape — see Step 3 code.
```

- [ ] **Step 1: Write `lib/sales/copy.ts`** (pure data, no test-first needed — covered by lookups test in Step 2)

```ts
// lib/sales/copy.ts
// ALL canned persuasion copy for the sales view lives here so wording is
// editable without touching components. Plain-English, honest labels only —
// no "WCAG compliant", no "Core Web Vitals pass" claims.

export const SECTION_INTROS = {
  accessibility:
    'Accessibility barriers lock out prospective students who rely on assistive technology — and expose the school to ADA demand letters. These are real elements on your site, captured during our scan.',
  seo:
    'Search engines can only recommend what they can read. Broken links, missing titles, and duplicated content all reduce how often your programs appear in front of prospective students.',
  performance:
    'Every extra second of load time costs applicants: slow pages get abandoned before your programs are ever seen. These numbers are Lighthouse-measured on your actual pages.',
  geo:
    'AI search tools (ChatGPT, Gemini, AI Overviews) lean on structured data to understand and recommend schools. Pages without it are effectively invisible to that traffic.',
} as const

export const ISSUE_LABELS: Record<string, string> = {
  broken_internal_links: 'Broken links on your site',
  broken_images: 'Broken images',
  broken_external_links: 'Broken outbound links',
  missing_title: 'Pages missing a title',
  duplicate_title: 'Pages sharing the same title',
  missing_meta_description: 'Pages missing a meta description',
  duplicate_meta_description: 'Duplicated meta descriptions',
  missing_h1: 'Pages missing a main heading',
  duplicate_h1: 'Duplicated main headings',
  thin_content: 'Thin-content pages',
}

export const HIGH_VALUE_SCHEMA_TYPES = ['Organization', 'Course', 'FAQPage', 'BreadcrumbList']

export const CTA_CLOSING =
  'Enrollment Resources helps schools turn findings like these into enrollments. Ask us what we would fix first — and what it would be worth.'

export function issueLabel(type: string): string {
  return ISSUE_LABELS[type] ?? type.replace(/_/g, ' ')
}
```

- [ ] **Step 2: Write the failing loader test**

```ts
// lib/sales/sales-report-data.test.ts
// DB-backed: full synthetic fixture — prospect + complete audit + summary blob
// + ada/seo CrawlRuns + child with lighthouseSummary. ZERO network.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { loadSalesReportData } from './sales-report-data'

const PREFIX = 'c14-load-'
async function cleanup() {
  const prospects = await prisma.prospect.findMany({ where: { domain: { startsWith: PREFIX } }, select: { id: true } })
  const audits = await prisma.siteAudit.findMany({ where: { domain: { startsWith: PREFIX } }, select: { id: true } })
  const auditIds = audits.map((a) => a.id)
  await prisma.crawlRun.deleteMany({ where: { siteAuditId: { in: auditIds } } })
  await prisma.adaAudit.deleteMany({ where: { siteAuditId: { in: auditIds } } })
  await prisma.siteAudit.deleteMany({ where: { id: { in: auditIds } } })
  await prisma.prospect.deleteMany({ where: { id: { in: prospects.map((p) => p.id) } } })
}
beforeAll(cleanup)
afterAll(cleanup)

const future = () => new Date(Date.now() + 86_400_000)

function summaryBlob(domain: string) {
  return JSON.stringify({
    aggregate: { critical: 4, serious: 10, moderate: 2, minor: 1, total: 17, passed: 40, incomplete: 0 },
    pdfsAggregate: { total: 0, complete: 0, errored: 0, skipped: 0, withIssues: 0 },
    pages: [],
    commonIssues: [{
      ruleId: 'color-contrast', impact: 'serious', help: 'Contrast', description: 'd', helpUrl: 'u',
      affectedPagesCount: 3, totalPagesScanned: 5, sharedAncestor: null, ancestorConfidence: null,
      examplePageUrl: `https://${domain}/a`,
    }],
  })
}

const lhSummary = JSON.stringify({
  scores: { performance: 40, accessibility: 90, bestPractices: 90 },
  cwv: { lcp: 4200, cls: 0.3, tbt: 700, lcpStatus: 'fail', clsStatus: 'fail', tbtStatus: 'fail' },
  topFailures: [],
})

async function seedReady() {
  const domain = `${PREFIX}ready.test`
  const prospect = await prisma.prospect.create({
    data: { name: 'Ready U', domain, createdBy: 'Kevin', salesToken: crypto.randomUUID(), salesTokenExpiresAt: future() },
  })
  const audit = await prisma.siteAudit.create({
    data: {
      domain, wcagLevel: 'wcag21aa', status: 'complete', prospectId: prospect.id,
      completedAt: new Date(), pagesTotal: 5, summary: summaryBlob(domain),
    },
  })
  for (let i = 0; i < 3; i++) {
    await prisma.adaAudit.create({
      data: { url: `https://${domain}/${i}`, status: 'complete', siteAuditId: audit.id, lighthouseSummary: lhSummary },
    })
  }
  await prisma.crawlRun.create({
    data: {
      id: `${PREFIX}ada-run`, tool: 'ada-audit', source: 'site-audit', domain, siteAuditId: audit.id,
      status: 'complete', score: 62, pagesTotal: 5, startedAt: new Date(), completedAt: new Date(),
    },
  })
  await prisma.crawlRun.create({
    data: {
      id: `${PREFIX}seo-run`, tool: 'seo-parser', source: 'live-scan', domain, siteAuditId: audit.id,
      status: 'complete', score: 71, pagesTotal: 5, startedAt: new Date(), completedAt: new Date(),
      schemaTypesJson: JSON.stringify({ v: 1, observedPages: 5, pagesWithSchema: 2, types: [{ type: 'Organization', pages: 2 }] }),
      findings: {
        create: [
          { scope: 'run', type: 'broken_internal_links', severity: 'critical', count: 7, dedupKey: `${PREFIX}f1` },
          { scope: 'page', type: 'broken_internal_links', severity: 'critical', count: 3, url: `https://${domain}/0`, dedupKey: `${PREFIX}f2` },
          { scope: 'run', type: 'missing_title', severity: 'warning', count: 2, dedupKey: `${PREFIX}f3` },
        ],
      },
    },
  })
  return { prospect, audit }
}

describe('loadSalesReportData', () => {
  it('invalid on unknown/expired token', async () => {
    expect((await loadSalesReportData('nope')).kind).toBe('invalid')
    const p = await prisma.prospect.create({
      data: { name: 'Exp', domain: `${PREFIX}exp.test`, salesToken: crypto.randomUUID(), salesTokenExpiresAt: new Date(Date.now() - 1000) },
    })
    expect((await loadSalesReportData(p.salesToken!)).kind).toBe('invalid')
  })

  it('pending when no reportable audit (complete but no seo run)', async () => {
    const p = await prisma.prospect.create({
      data: { name: 'Pend U', domain: `${PREFIX}pend.test`, salesToken: crypto.randomUUID(), salesTokenExpiresAt: future() },
    })
    await prisma.siteAudit.create({
      data: { domain: `${PREFIX}pend.test`, wcagLevel: 'wcag21aa', status: 'complete', prospectId: p.id, completedAt: new Date() },
    })
    const out = await loadSalesReportData(p.salesToken!)
    expect(out.kind).toBe('pending')
    if (out.kind === 'pending') expect(out.prospect.name).toBe('Pend U')
  })

  it('assembles the full report for a reportable audit', async () => {
    const { prospect, audit } = await seedReady()
    const out = await loadSalesReportData(prospect.salesToken!)
    expect(out.kind).toBe('ready')
    if (out.kind !== 'ready') return
    const d = out.data
    expect(d.auditId).toBe(audit.id)
    expect(d.preparedBy).toBe('Kevin')
    expect(d.headline.accessibilityScore).toBe(62)
    expect(d.headline.seoScore).toBe(71)
    expect(d.headline.performanceScore).toBe(40)
    expect(d.headline.schemaCoveragePct).toBe(40) // 2/5
    expect(d.accessibility.counts.critical).toBe(4)
    expect(d.accessibility.patterns[0].ruleId).toBe('color-contrast')
    const broken = d.seo.issueGroups.find((g) => g.type === 'broken_internal_links')
    expect(broken?.count).toBe(7)
    expect(broken?.examplePages).toEqual([`https://${domain(audit)}/0`])
    expect(d.performance?.measuredPages).toBe(3)
    expect(d.geo.types).toContainEqual({ type: 'Organization', pages: 2 })
    expect(d.geo.missingHighValueTypes).toContain('Course')
  })
})

function domain(a: { domain: string }) { return a.domain }
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/sales/sales-report-data.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the loader**

```ts
// lib/sales/sales-report-data.ts
// C14: THE single server-side loader for the public sales view. All curation
// happens here — the token never grants access beyond what this module chose.
import { prisma } from '@/lib/db'
import { buildSummaryFromFindings } from '@/lib/ada-audit/findings-fallback'
import type { CommonIssue, ImpactLevel, SiteAuditSummary } from '@/lib/ada-audit/types'
import type { LighthouseSummary } from '@/lib/ada-audit/lighthouse-types'
import { aggregatePerformance, type PerformanceRollup } from './cwv-aggregate'
import { loadRepresentativeExamples, type CuratedExample } from './representative-examples'
import { HIGH_VALUE_SCHEMA_TYPES, ISSUE_LABELS } from './copy'
import type { SchemaTypesSummary } from '@/lib/ada-audit/seo/schema-types'

const MAX_PATTERNS = 4
const MAX_EXAMPLE_PAGES = 5
const IMPACT_RANK: Record<ImpactLevel, number> = { critical: 3, serious: 2, moderate: 1, minor: 0 }

export interface SalesPattern {
  ruleId: string
  impact: ImpactLevel
  help: string
  description: string
  affectedPagesCount: number
  totalPagesScanned: number
  examples: CuratedExample[]
}

export interface SeoIssueGroup {
  type: string
  label: string
  count: number
  examplePages: string[]
}

export interface SalesReportData {
  prospect: { id: number; name: string; domain: string }
  auditId: string
  completedAt: string | null
  pagesTotal: number | null
  preparedBy: string | null
  archived: boolean
  headline: {
    accessibilityScore: number | null
    seoScore: number | null
    performanceScore: number | null
    schemaCoveragePct: number | null
  }
  accessibility: {
    score: number | null
    counts: { critical: number; serious: number; moderate: number; minor: number; total: number }
    patterns: SalesPattern[]
  }
  seo: {
    score: number | null
    issueGroups: SeoIssueGroup[]
    duplicateContentGroups: number | null
    sitemapMissRatePct: number | null
  }
  performance: PerformanceRollup | null
  geo: {
    coveragePct: number | null
    pagesWithSchema: number | null
    observedPages: number | null
    types: { type: string; pages: number }[]
    missingHighValueTypes: string[]
    hreflangIssueCount: number
  }
}

export type SalesReportResult =
  | { kind: 'invalid' }
  | { kind: 'pending'; prospect: { name: string; domain: string } }
  | { kind: 'ready'; data: SalesReportData }

export async function validateSalesToken(
  token: string,
): Promise<{ id: number; name: string; domain: string; createdBy: string | null } | null> {
  if (!token) return null
  const prospect = await prisma.prospect.findUnique({
    where: { salesToken: token },
    select: { id: true, name: true, domain: true, createdBy: true, salesTokenExpiresAt: true },
  })
  if (!prospect || !prospect.salesTokenExpiresAt || prospect.salesTokenExpiresAt <= new Date()) return null
  return { id: prospect.id, name: prospect.name, domain: prospect.domain, createdBy: prospect.createdBy }
}

/**
 * Task 10's screenshot route: the set of `${adaAuditId}/${filename}` keys the
 * curated report for the URL's PINNED audit actually renders (Codex plan-review
 * fix #2 — ownership alone would expose any guessed screenshot under the
 * prospect's child audits; the token authorizes ONLY what the loader curated).
 * Pinned: resolved from the URL's child audit → its parent SiteAudit, NOT
 * re-resolved to "latest", so an open report keeps loading after a re-scan.
 */
export async function curatedScreenshotSet(prospectId: number, adaAuditId: string): Promise<Set<string>> {
  const child = await prisma.adaAudit.findUnique({
    where: { id: adaAuditId },
    select: { siteAudit: { select: { id: true, prospectId: true, summary: true } } },
  })
  if (!child?.siteAudit || child.siteAudit.prospectId !== prospectId) return new Set()

  let summary = parseJson<SiteAuditSummary>(child.siteAudit.summary)
  if (!summary) summary = await buildSummaryFromFindings(child.siteAudit.id)
  const set = new Set<string>()
  for (const issue of topPatternIssues(summary)) {
    for (const ex of await loadRepresentativeExamples(child.siteAudit.id, issue)) {
      if (ex.screenshotFile && ex.adaAuditId) set.add(`${ex.adaAuditId}/${ex.screenshotFile}`)
    }
  }
  return set
}

/** Shared pattern-selection rule: loader and screenshot allowlist MUST agree. */
function topPatternIssues(summary: SiteAuditSummary | null): CommonIssue[] {
  return [...(summary?.commonIssues ?? [])]
    .sort((a, b) => IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] || b.affectedPagesCount - a.affectedPagesCount)
    .slice(0, MAX_PATTERNS)
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function loadSalesReportData(token: string): Promise<SalesReportResult> {
  const prospect = await validateSalesToken(token)
  if (!prospect) return { kind: 'invalid' }

  // Latest REPORTABLE audit: complete AND live-scan run exists (spec Codex fix #4 —
  // the finalizer flips complete before the verifier writes the SEO run).
  const audits = await prisma.siteAudit.findMany({
    where: { prospectId: prospect.id, status: 'complete', seoOnly: false },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true, completedAt: true, pagesTotal: true, wcagLevel: true, summary: true,
      crawlRuns: {
        select: {
          id: true, tool: true, score: true,
          schemaTypesJson: true, contentSimilarityJson: true, discoveryCoverageJson: true,
          findings: { select: { scope: true, type: true, count: true, url: true } },
        },
      },
    },
  })
  const audit = audits.find((a) => a.crawlRuns.some((r) => r.tool === 'seo-parser'))
  if (!audit) return { kind: 'pending', prospect: { name: prospect.name, domain: prospect.domain } }

  const adaRun = audit.crawlRuns.find((r) => r.tool === 'ada-audit') ?? null
  const seoRun = audit.crawlRuns.find((r) => r.tool === 'seo-parser')!

  // Accessibility: summary blob, findings-fallback when pruned.
  let summary = parseJson<SiteAuditSummary>(audit.summary)
  let archived = false
  if (!summary) {
    summary = await buildSummaryFromFindings(audit.id)
    archived = true
  }
  const counts = summary
    ? {
        critical: summary.aggregate.critical, serious: summary.aggregate.serious,
        moderate: summary.aggregate.moderate, minor: summary.aggregate.minor, total: summary.aggregate.total,
      }
    : { critical: 0, serious: 0, moderate: 0, minor: 0, total: 0 }

  const topIssues = topPatternIssues(summary)
  const patterns: SalesPattern[] = []
  for (const issue of topIssues) {
    patterns.push({
      ruleId: issue.ruleId, impact: issue.impact, help: issue.help, description: issue.description,
      affectedPagesCount: issue.affectedPagesCount, totalPagesScanned: issue.totalPagesScanned,
      examples: await loadRepresentativeExamples(audit.id, issue),
    })
  }

  // SEO groups from live-scan findings: run-scope count + page-scope example URLs.
  const issueGroups: SeoIssueGroup[] = []
  for (const type of Object.keys(ISSUE_LABELS)) {
    const runFinding = seoRun.findings.find((f) => f.scope === 'run' && f.type === type)
    if (!runFinding || runFinding.count === 0) continue
    issueGroups.push({
      type,
      label: ISSUE_LABELS[type],
      count: runFinding.count,
      examplePages: seoRun.findings
        .filter((f) => f.scope === 'page' && f.type === type && f.url)
        .slice(0, MAX_EXAMPLE_PAGES)
        .map((f) => f.url as string),
    })
  }
  // Real shape (Codex plan-review fix #3): { v, exactDuplicateGroups, nearDuplicateGroups }
  const similarity = parseJson<{ exactDuplicateGroups?: unknown[]; nearDuplicateGroups?: unknown[] }>(
    seoRun.contentSimilarityJson,
  )
  const duplicateContentGroups = similarity
    ? (similarity.exactDuplicateGroups?.length ?? 0) + (similarity.nearDuplicateGroups?.length ?? 0)
    : null
  const coverage = parseJson<{ applicable?: boolean; missRate?: number }>(seoRun.discoveryCoverageJson)

  // Performance: per-page Lighthouse summaries off the child rows.
  const children = await prisma.adaAudit.findMany({
    where: { siteAuditId: audit.id, lighthouseSummary: { not: null } },
    select: { url: true, lighthouseSummary: true },
  })
  const lhRows = children
    .map((c) => ({ url: c.url, summary: parseJson<LighthouseSummary>(c.lighthouseSummary) }))
    .filter((r): r is { url: string; summary: LighthouseSummary } => r.summary !== null)
  const performance = aggregatePerformance(lhRows)

  // GEO: schema histogram (denominators from Task 3's versioned shape).
  const schema = parseJson<SchemaTypesSummary>(seoRun.schemaTypesJson)
  const coveragePct =
    schema && schema.observedPages > 0 ? Math.round((schema.pagesWithSchema / schema.observedPages) * 100) : null
  const presentTypes = new Set((schema?.types ?? []).map((t) => t.type))
  const hreflangIssueCount = seoRun.findings
    .filter((f) => f.scope === 'run' && f.type.startsWith('hreflang_'))
    .reduce((sum, f) => sum + f.count, 0)

  return {
    kind: 'ready',
    data: {
      prospect: { id: prospect.id, name: prospect.name, domain: prospect.domain },
      auditId: audit.id,
      completedAt: audit.completedAt?.toISOString() ?? null,
      pagesTotal: audit.pagesTotal,
      preparedBy: prospect.createdBy,
      archived,
      headline: {
        accessibilityScore: adaRun?.score ?? null,
        seoScore: seoRun.score,
        performanceScore: performance?.medianPerformance ?? null,
        schemaCoveragePct: coveragePct,
      },
      accessibility: { score: adaRun?.score ?? null, counts, patterns },
      seo: {
        score: seoRun.score,
        issueGroups,
        duplicateContentGroups,
        sitemapMissRatePct: coverage?.applicable && typeof coverage.missRate === 'number'
          ? Math.round(coverage.missRate * 100)
          : null,
      },
      performance,
      geo: {
        coveragePct,
        pagesWithSchema: schema?.pagesWithSchema ?? null,
        observedPages: schema?.observedPages ?? null,
        types: schema?.types ?? [],
        missingHighValueTypes: HIGH_VALUE_SCHEMA_TYPES.filter((t) => !presentTypes.has(t)),
        hreflangIssueCount,
      },
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/sales/sales-report-data.test.ts`
Expected: PASS (3 tests). Note: the `Finding` create in the fixture needs the model's required fields — if `dedupKey`/`runId` constraints complain, match the actual `Finding` model column list from `prisma/schema.prisma` (nested create supplies `runId`).

- [ ] **Step 6: Commit**

```bash
git add lib/sales/copy.ts lib/sales/sales-report-data.ts lib/sales/sales-report-data.test.ts
git commit -m "feat(c14): sales report data loader + persuasion copy module"
```

---

### Task 9: Public sales view — components + page

**Files:**
- Create: `components/sales/SectionCard.tsx`, `components/sales/ExampleCard.tsx`, `components/sales/HeroTiles.tsx`, `components/sales/sections.tsx`, `components/sales/SalesReportView.tsx`
- Create: `app/(public)/sales/[token]/page.tsx`
- Test: `components/sales/SalesReportView.test.tsx`

**Interfaces:**
- Consumes: `SalesReportData`, `SalesReportResult` (Task 8), `SECTION_INTROS`/`CTA_CLOSING`/`issueLabel` (Task 8's copy module).
- Produces: `<SalesReportView data={SalesReportData} token={string} contactEmail={string} />` (server component). Screenshot URLs built as `/api/sales/${token}/screenshot/${adaAuditId}/${screenshotFile}` (Task 10 serves them).

All components are **server components** (no `'use client'`), `<details>/<summary>` collapse, house card classes.

- [ ] **Step 1: Write the failing component test**

```tsx
// components/sales/SalesReportView.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SalesReportView } from './SalesReportView'
import type { SalesReportData } from '@/lib/sales/sales-report-data'

afterEach(cleanup)

const data: SalesReportData = {
  prospect: { id: 1, name: 'Acme College', domain: 'acme.test' },
  auditId: 'aud1', completedAt: '2026-07-09T00:00:00.000Z', pagesTotal: 5,
  preparedBy: 'Kevin', archived: false,
  headline: { accessibilityScore: 62, seoScore: 71, performanceScore: 40, schemaCoveragePct: 40 },
  accessibility: {
    score: 62,
    counts: { critical: 4, serious: 10, moderate: 2, minor: 1, total: 17 },
    patterns: [{
      ruleId: 'color-contrast', impact: 'serious', help: 'Elements must have sufficient color contrast',
      description: 'd', affectedPagesCount: 3, totalPagesScanned: 5,
      examples: [{ html: '<a class="cta">Apply</a>', selector: 'a.cta', screenshotFile: 'color-contrast-0.png', adaAuditId: 'child1', pageUrl: 'https://acme.test/a' }],
    }],
  },
  seo: {
    score: 71,
    issueGroups: [{ type: 'broken_internal_links', label: 'Broken links on your site', count: 7, examplePages: ['https://acme.test/0'] }],
    duplicateContentGroups: 2, sitemapMissRatePct: 12,
  },
  performance: {
    measuredPages: 3, medianPerformance: 40, p75LcpMs: 4200, p75Cls: 0.3, p75TbtMs: 700,
    pctPassing: 0, scoreBuckets: { good: 0, fair: 1, poor: 2 },
    worstPages: [{ url: 'https://acme.test/slow', performance: 22 }],
  },
  geo: {
    coveragePct: 40, pagesWithSchema: 2, observedPages: 5,
    types: [{ type: 'Organization', pages: 2 }],
    missingHighValueTypes: ['Course', 'FAQPage'], hreflangIssueCount: 0,
  },
}

describe('SalesReportView', () => {
  it('renders hero, four sections, evidence, and CTA', () => {
    render(<SalesReportView data={data} token="tok1" contactEmail="kevin@enrollmentresources.com" />)
    expect(screen.getByText(/prepared for/i)).toBeTruthy()
    expect(screen.getByText('Acme College')).toBeTruthy()
    expect(screen.getByText('Accessibility')).toBeTruthy()
    expect(screen.getByText('SEO')).toBeTruthy()
    expect(screen.getByText('Performance')).toBeTruthy()
    expect(screen.getByText(/structured data/i)).toBeTruthy()
    expect(screen.getByText('Broken links on your site')).toBeTruthy()
    expect(screen.getByText(/prepared by kevin/i)).toBeTruthy()
    // curated screenshot URL is token-scoped
    const img = screen.getByRole('img', { name: /color-contrast/i }) as HTMLImageElement
    expect(img.src).toContain('/api/sales/tok1/screenshot/child1/color-contrast-0.png')
    // honest labeling: no compliance/CWV-pass claims
    expect(screen.queryByText(/wcag compliant/i)).toBeNull()
    expect(screen.getByText(/lighthouse-measured/i)).toBeTruthy()
  })

  it('renders performance absence gracefully', () => {
    render(<SalesReportView data={{ ...data, performance: null }} token="t" contactEmail="x@y.z" />)
    expect(screen.getByText(/not enough pages were measured/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/sales/SalesReportView.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the components**

```tsx
// components/sales/SectionCard.tsx
// Generic progressive-disclosure card: grade chip + headline counts collapsed;
// <details> reveals the intro copy + children (evidence).
import type { ReactNode } from 'react'

export type Grade = 'good' | 'warn' | 'bad' | 'none'

const GRADE_CLASSES: Record<Grade, string> = {
  good: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  bad: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  none: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60',
}

export function gradeForScore(score: number | null): Grade {
  if (score === null) return 'none'
  if (score >= 90) return 'good'
  if (score >= 60) return 'warn'
  return 'bad'
}

export function SectionCard(props: {
  title: string
  grade: Grade
  gradeLabel: string
  headline: string
  intro: string
  children: ReactNode
}) {
  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm">
      <details>
        <summary className="cursor-pointer list-none p-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white mb-1">{props.title}</h2>
            <p className="text-[13px] font-body text-navy/50 dark:text-white/50">{props.headline}</p>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-heading font-semibold ${GRADE_CLASSES[props.grade]}`}>
            {props.gradeLabel}
          </span>
        </summary>
        <div className="px-6 pb-6 space-y-4">
          <p className="text-[13px] font-body text-navy/60 dark:text-white/60">{props.intro}</p>
          {props.children}
        </div>
      </details>
    </section>
  )
}
```

```tsx
// components/sales/ExampleCard.tsx
import type { CuratedExample } from '@/lib/sales/representative-examples'

export function ExampleCard(props: { example: CuratedExample; token: string; alt: string }) {
  const { example } = props
  const src = example.screenshotFile && example.adaAuditId
    ? `/api/sales/${props.token}/screenshot/${example.adaAuditId}/${example.screenshotFile}`
    : null
  return (
    <div className="rounded-xl border border-gray-200 dark:border-navy-border p-4 space-y-2">
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={props.alt} className="max-w-full rounded-lg border border-gray-100 dark:border-navy-border" />
      )}
      <pre className="overflow-x-auto rounded-lg bg-gray-50 dark:bg-navy-deep p-3 text-[12px] font-mono text-navy/80 dark:text-white/80">
        {example.html}
      </pre>
      {example.pageUrl && (
        <p className="text-[12px] font-body text-navy/45 dark:text-white/45 break-all">Found on {example.pageUrl}</p>
      )}
    </div>
  )
}
```

```tsx
// components/sales/HeroTiles.tsx
import { gradeForScore, type Grade } from './SectionCard'

const TILE_GRADE: Record<Grade, string> = {
  good: 'text-green-700 dark:text-green-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
  none: 'text-navy/40 dark:text-white/40',
}

function Tile(props: { label: string; value: string; grade: Grade }) {
  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-5 text-center">
      <div className={`text-3xl font-heading font-bold ${TILE_GRADE[props.grade]}`}>{props.value}</div>
      <div className="mt-1 text-[12px] font-body text-navy/50 dark:text-white/50">{props.label}</div>
    </div>
  )
}

export function HeroTiles(props: {
  accessibilityScore: number | null
  seoScore: number | null
  performanceScore: number | null
  schemaCoveragePct: number | null
}) {
  const fmt = (v: number | null, suffix = '') => (v === null ? '—' : `${v}${suffix}`)
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 print:grid-cols-4">
      <Tile label="Accessibility score" value={fmt(props.accessibilityScore)} grade={gradeForScore(props.accessibilityScore)} />
      <Tile label="SEO score" value={fmt(props.seoScore)} grade={gradeForScore(props.seoScore)} />
      <Tile label="Performance (Lighthouse)" value={fmt(props.performanceScore)} grade={gradeForScore(props.performanceScore)} />
      <Tile label="Structured data coverage" value={fmt(props.schemaCoveragePct, '%')} grade={props.schemaCoveragePct === null ? 'none' : props.schemaCoveragePct >= 60 ? 'good' : props.schemaCoveragePct >= 30 ? 'warn' : 'bad'} />
    </div>
  )
}
```

```tsx
// components/sales/sections.tsx
// The four disclosure sections. Server components; evidence is pre-curated by
// the loader — these only render what they are given.
import { SECTION_INTROS } from '@/lib/sales/copy'
import type { SalesReportData } from '@/lib/sales/sales-report-data'
import { ExampleCard } from './ExampleCard'
import { SectionCard, gradeForScore } from './SectionCard'

export function AccessibilitySalesSection(props: { data: SalesReportData['accessibility']; token: string; archived: boolean }) {
  const { counts } = props.data
  return (
    <SectionCard
      title="Accessibility"
      grade={gradeForScore(props.data.score)}
      gradeLabel={props.data.score === null ? 'Not scored' : `${props.data.score}/100`}
      headline={`${counts.critical} critical · ${counts.serious} serious issues across the scanned pages`}
      intro={SECTION_INTROS.accessibility}
    >
      {props.archived && (
        <p className="text-[12px] font-body text-amber-600 dark:text-amber-400">
          Detailed evidence for this scan has been archived — examples below are a capped sample. Re-scan for fresh evidence.
        </p>
      )}
      {props.data.patterns.map((p) => (
        <details key={p.ruleId} className="rounded-xl border border-gray-200 dark:border-navy-border">
          <summary className="cursor-pointer list-none p-4">
            <span className="text-[13px] font-heading font-semibold text-navy dark:text-white">{p.help}</span>
            <span className="ml-2 text-[12px] font-body text-navy/50 dark:text-white/50">
              {p.affectedPagesCount} of {p.totalPagesScanned} pages
            </span>
          </summary>
          <div className="px-4 pb-4 space-y-3">
            <p className="text-[12px] font-body text-navy/60 dark:text-white/60">{p.description}</p>
            {p.examples.length === 0 ? (
              <p className="text-[12px] font-body text-navy/45 dark:text-white/45">Example elements unavailable for this pattern.</p>
            ) : (
              p.examples.map((e, i) => <ExampleCard key={i} example={e} token={props.token} alt={`${p.ruleId} example`} />)
            )}
          </div>
        </details>
      ))}
    </SectionCard>
  )
}

export function SeoSalesSection(props: { data: SalesReportData['seo'] }) {
  const d = props.data
  const headline = d.issueGroups.length
    ? d.issueGroups.slice(0, 2).map((g) => `${g.count} ${g.label.toLowerCase()}`).join(' · ')
    : 'No blocking SEO issues found on scanned pages'
  return (
    <SectionCard
      title="SEO"
      grade={gradeForScore(d.score)}
      gradeLabel={d.score === null ? 'Not scored' : `${d.score}/100`}
      headline={headline}
      intro={SECTION_INTROS.seo}
    >
      {d.issueGroups.length === 0 && (
        <p className="text-[13px] font-body text-green-700 dark:text-green-400">
          The scanned pages came back clean on links, titles, and content depth.
        </p>
      )}
      {d.issueGroups.map((g) => (
        <details key={g.type} className="rounded-xl border border-gray-200 dark:border-navy-border">
          <summary className="cursor-pointer list-none p-4 text-[13px] font-heading font-semibold text-navy dark:text-white">
            {g.label} <span className="ml-2 font-body font-normal text-navy/50 dark:text-white/50">{g.count}</span>
          </summary>
          {g.examplePages.length > 0 && (
            <ul className="px-4 pb-4 space-y-1">
              {g.examplePages.map((u) => (
                <li key={u} className="text-[12px] font-body text-navy/60 dark:text-white/60 break-all">{u}</li>
              ))}
            </ul>
          )}
        </details>
      ))}
      <div className="text-[12px] font-body text-navy/50 dark:text-white/50 space-y-1">
        {d.duplicateContentGroups !== null && d.duplicateContentGroups > 0 && (
          <p>{d.duplicateContentGroups} groups of pages share near-identical content.</p>
        )}
        {d.sitemapMissRatePct !== null && d.sitemapMissRatePct > 0 && (
          <p>{d.sitemapMissRatePct}% of reachable pages are missing from the sitemap.</p>
        )}
      </div>
    </SectionCard>
  )
}

export function PerformanceSalesSection(props: { data: SalesReportData['performance'] }) {
  const d = props.data
  if (!d) {
    return (
      <SectionCard title="Performance" grade="none" gradeLabel="Not measured"
        headline="Not enough pages were measured for a reliable roll-up"
        intro={SECTION_INTROS.performance}
      >
        <p className="text-[12px] font-body text-navy/45 dark:text-white/45">Re-scan to collect Lighthouse measurements.</p>
      </SectionCard>
    )
  }
  const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`
  return (
    <SectionCard
      title="Performance"
      grade={gradeForScore(d.medianPerformance)}
      gradeLabel={`${d.medianPerformance}/100`}
      headline={`Slowest pages take ${s(d.p75LcpMs)} to show their main content (Lighthouse-measured, ${d.measuredPages} pages)`}
      intro={SECTION_INTROS.performance}
    >
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Largest paint (p75)</dt><dd className="text-[15px] font-heading font-semibold text-navy dark:text-white">{s(d.p75LcpMs)}</dd></div>
        <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Layout shift (p75)</dt><dd className="text-[15px] font-heading font-semibold text-navy dark:text-white">{d.p75Cls}</dd></div>
        <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Blocking time (p75, lab proxy)</dt><dd className="text-[15px] font-heading font-semibold text-navy dark:text-white">{Math.round(d.p75TbtMs)}ms</dd></div>
        <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Pages passing all checks</dt><dd className="text-[15px] font-heading font-semibold text-navy dark:text-white">{d.pctPassing}%</dd></div>
      </dl>
      {d.worstPages.length > 0 && (
        <div>
          <h3 className="text-[13px] font-heading font-semibold text-navy dark:text-white mb-1">Slowest pages</h3>
          <ul className="space-y-1">
            {d.worstPages.map((p) => (
              <li key={p.url} className="text-[12px] font-body text-navy/60 dark:text-white/60 break-all">
                {p.url} — <span className="text-red-600 dark:text-red-400">{p.performance}/100</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  )
}

export function GeoSalesSection(props: { data: SalesReportData['geo'] }) {
  const d = props.data
  const grade = d.coveragePct === null ? 'none' : d.coveragePct >= 60 ? 'good' : d.coveragePct >= 30 ? 'warn' : 'bad'
  return (
    <SectionCard
      title="Structured data & AI readiness"
      grade={grade}
      gradeLabel={d.coveragePct === null ? 'Not measured' : `${d.coveragePct}% coverage`}
      headline={
        d.missingHighValueTypes.length
          ? `No ${d.missingHighValueTypes.slice(0, 2).join(' or ')} structured data found`
          : 'High-value structured data types are present'
      }
      intro={SECTION_INTROS.geo}
    >
      {d.observedPages !== null && (
        <p className="text-[13px] font-body text-navy/60 dark:text-white/60">
          {d.pagesWithSchema} of {d.observedPages} scanned pages carry structured data.
        </p>
      )}
      {d.types.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {d.types.map((t) => (
            <li key={t.type} className="rounded-full bg-gray-100 dark:bg-white/10 px-3 py-1 text-[12px] font-body text-navy/70 dark:text-white/70">
              {t.type} · {t.pages}
            </li>
          ))}
        </ul>
      )}
      {d.missingHighValueTypes.length > 0 && (
        <p className="text-[13px] font-body text-amber-600 dark:text-amber-400">
          Missing: {d.missingHighValueTypes.join(', ')} — AI search can’t confidently recommend your programs without these.
        </p>
      )}
      {d.hreflangIssueCount > 0 && (
        <p className="text-[12px] font-body text-navy/50 dark:text-white/50">{d.hreflangIssueCount} language-annotation issues found.</p>
      )}
    </SectionCard>
  )
}
```

```tsx
// components/sales/SalesReportView.tsx
import { CTA_CLOSING } from '@/lib/sales/copy'
import type { SalesReportData } from '@/lib/sales/sales-report-data'
import { HeroTiles } from './HeroTiles'
import { AccessibilitySalesSection, GeoSalesSection, PerformanceSalesSection, SeoSalesSection } from './sections'

export function SalesReportView(props: { data: SalesReportData; token: string; contactEmail: string }) {
  const { data } = props
  const scanned = data.completedAt ? new Date(data.completedAt).toLocaleDateString('en-US', { dateStyle: 'medium' }) : null
  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        <header className="space-y-2">
          <p className="text-[12px] font-heading font-semibold uppercase tracking-wide text-navy/50 dark:text-white/50">
            Enrollment Resources · Website Opportunity Report
          </p>
          <h1 className="text-2xl font-heading font-bold text-navy dark:text-white">
            Prepared for <span className="text-blue-700 dark:text-blue-400">{data.prospect.name}</span>
          </h1>
          <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
            {data.prospect.domain}
            {scanned ? ` · scanned ${scanned}` : ''}
            {data.pagesTotal ? ` · ${data.pagesTotal} pages` : ''}
          </p>
        </header>
        <HeroTiles {...data.headline} />
        <AccessibilitySalesSection data={data.accessibility} token={props.token} archived={data.archived} />
        <SeoSalesSection data={data.seo} />
        <PerformanceSalesSection data={data.performance} />
        <GeoSalesSection data={data.geo} />
        <footer className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6 space-y-2">
          {data.preparedBy && (
            <p className="text-[13px] font-heading font-semibold text-navy dark:text-white">
              Prepared by {data.preparedBy} — Enrollment Resources
            </p>
          )}
          <p className="text-[13px] font-body text-navy/60 dark:text-white/60">{CTA_CLOSING}</p>
          <a href={`mailto:${props.contactEmail}`} className="inline-block text-[13px] font-heading font-semibold text-blue-700 dark:text-blue-400">
            {props.contactEmail}
          </a>
        </footer>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/sales/SalesReportView.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Create the public page**

```tsx
// app/(public)/sales/[token]/page.tsx
import { notFound } from 'next/navigation'
import { loadSalesReportData } from '@/lib/sales/sales-report-data'
import { SalesReportView } from '@/components/sales/SalesReportView'

export const dynamic = 'force-dynamic'

export default async function SalesReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await loadSalesReportData(token)
  if (result.kind === 'invalid') notFound()

  if (result.kind === 'pending') {
    return (
      <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep flex items-center justify-center px-6">
        <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-8 max-w-md text-center space-y-2">
          <h1 className="text-xl font-heading font-bold text-navy dark:text-white">Your report is being prepared</h1>
          <p className="text-[13px] font-body text-navy/60 dark:text-white/60">
            We’re still scanning {result.prospect.domain}. Check back shortly — this page updates automatically once the scan completes.
          </p>
        </div>
      </div>
    )
  }

  const contactEmail = process.env.SALES_CONTACT_EMAIL || 'kevin@enrollmentresources.com'
  return <SalesReportView data={result.data} token={token} contactEmail={contactEmail} />
}
```

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add components/sales app/\(public\)/sales
git commit -m "feat(c14): public sales report view — hero tiles, disclosure sections, CTA"
```

---

### Task 10: Token-validated screenshot route + middleware public matchers

**Files:**
- Create: `app/api/sales/[token]/screenshot/[adaAuditId]/[filename]/route.ts`
- Modify: `middleware.ts` (`isPublicPath` regex block)
- Test: `app/api/sales/[token]/screenshot/screenshot-route.test.ts`, extend `middleware.test.ts`

**Interfaces:**
- Consumes: `validateSalesToken`, `curatedScreenshotSet` (Task 8); `SCREENSHOTS_DIR` from `@/lib/ada-audit/screenshot-helpers`.
- Produces: public GET `/api/sales/{token}/screenshot/{adaAuditId}/{filename}` → PNG stream or 404.

- [ ] **Step 1: Write the failing tests**

```ts
// app/api/sales/[token]/screenshot/screenshot-route.test.ts
// DB-backed + temp screenshot file on disk.
import fs from 'fs/promises'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { SCREENSHOTS_DIR } from '@/lib/ada-audit/screenshot-helpers'
import { GET } from './[adaAuditId]/[filename]/route'

const PREFIX = 'c14-shot-'
let token: string
let childId: string
let strangerChildId: string

async function cleanup() {
  const prospects = await prisma.prospect.findMany({ where: { domain: { startsWith: PREFIX } }, select: { id: true } })
  const audits = await prisma.siteAudit.findMany({ where: { domain: { startsWith: PREFIX } }, select: { id: true } })
  await prisma.adaAudit.deleteMany({ where: { siteAuditId: { in: audits.map((a) => a.id) } } })
  await prisma.siteAudit.deleteMany({ where: { id: { in: audits.map((a) => a.id) } } })
  await prisma.prospect.deleteMany({ where: { id: { in: prospects.map((p) => p.id) } } })
}

beforeAll(async () => {
  await cleanup()
  token = crypto.randomUUID()
  const prospect = await prisma.prospect.create({
    data: { name: 'Shot', domain: `${PREFIX}x.test`, salesToken: token, salesTokenExpiresAt: new Date(Date.now() + 86_400_000) },
  })
  // Curated-set membership requires: parent summary names the pattern +
  // example page; the child's result blob carries the screenshot node.
  const site = await prisma.siteAudit.create({
    data: {
      domain: `${PREFIX}x.test`, wcagLevel: 'wcag21aa', status: 'complete', prospectId: prospect.id,
      summary: JSON.stringify({
        aggregate: { critical: 0, serious: 1, moderate: 0, minor: 0, total: 1, passed: 10, incomplete: 0 },
        pdfsAggregate: { total: 0, complete: 0, errored: 0, skipped: 0, withIssues: 0 },
        pages: [],
        commonIssues: [{
          ruleId: 'color-contrast', impact: 'serious', help: 'Contrast', description: 'd', helpUrl: 'u',
          affectedPagesCount: 1, totalPagesScanned: 1, sharedAncestor: null, ancestorConfidence: null,
          examplePageUrl: `https://${PREFIX}x.test/a`,
        }],
      }),
    },
  })
  const child = await prisma.adaAudit.create({
    data: {
      url: `https://${PREFIX}x.test/a`, status: 'complete', siteAuditId: site.id,
      result: JSON.stringify({
        violations: [{
          id: 'color-contrast', impact: 'serious', help: 'h', description: 'd', helpUrl: 'u', tags: [],
          nodes: [{ html: '<a>x</a>', target: ['a'], screenshotPath: 'color-contrast-0.png' }],
        }],
        passes: [], incomplete: [], inapplicable: [], timestamp: 't',
        url: `https://${PREFIX}x.test/a`, testEngine: { name: 'axe', version: '4' }, testRunner: { name: 'axe' },
      }),
    },
  })
  childId = child.id
  const strangerSite = await prisma.siteAudit.create({ data: { domain: `${PREFIX}other.test`, wcagLevel: 'wcag21aa', status: 'complete' } })
  const strangerChild = await prisma.adaAudit.create({ data: { url: `https://${PREFIX}other.test/a`, status: 'complete', siteAuditId: strangerSite.id } })
  strangerChildId = strangerChild.id
  await fs.mkdir(path.join(SCREENSHOTS_DIR, childId), { recursive: true })
  await fs.writeFile(path.join(SCREENSHOTS_DIR, childId, 'color-contrast-0.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
})
afterAll(async () => {
  await fs.rm(path.join(SCREENSHOTS_DIR, childId), { recursive: true, force: true })
  await cleanup()
})

const call = (tok: string, aid: string, file: string) =>
  GET(new NextRequest(`http://localhost:3000/api/sales/${tok}/screenshot/${aid}/${file}`), {
    params: Promise.resolve({ token: tok, adaAuditId: aid, filename: file }),
  })

describe('GET /api/sales/[token]/screenshot/[adaAuditId]/[filename]', () => {
  it('streams a curated screenshot', async () => {
    const res = await call(token, childId, 'color-contrast-0.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
  })
  it('404s on a child audit the prospect does not own', async () => {
    expect((await call(token, strangerChildId, 'color-contrast-0.png')).status).toBe(404)
  })
  it('404s on an owned file that is NOT in the curated set', async () => {
    // File exists on disk under the owned audit, but no curated node references it.
    await fs.writeFile(path.join(SCREENSHOTS_DIR, childId, 'color-contrast-9.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect((await call(token, childId, 'color-contrast-9.png')).status).toBe(404)
  })
  it('404s on invalid token / bad filename / traversal', async () => {
    expect((await call('bad-token', childId, 'color-contrast-0.png')).status).toBe(404)
    expect((await call(token, childId, '../secrets.png')).status).toBe(404)
    expect((await call(token, childId, 'shot.svg')).status).toBe(404)
  })
})
```

Extend `middleware.test.ts` — add alongside the existing `isPublicPath` cases:

```ts
it('C14: sales public matchers', () => {
  expect(isPublicPath('/sales/3f9c2f4e-aaaa-bbbb-cccc-000000000000')).toBe(true)
  expect(isPublicPath('/api/sales/tok/screenshot/child1/color-contrast-0.png')).toBe(true)
  // the intake page + APIs stay gated
  expect(isPublicPath('/sales')).toBe(false)
  expect(isPublicPath('/api/sales/prospects')).toBe(false)
  expect(isPublicPath('/api/sales/prospects/3/scan')).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/sales/[token] middleware.test.ts`
Expected: FAIL — route module not found; middleware cases false/true mismatches.

- [ ] **Step 3: Implement the route**

```ts
// app/api/sales/[token]/screenshot/[adaAuditId]/[filename]/route.ts
// C14: token-validated screenshot streaming. Authorization = ownership chain
// (token → prospect → child audit's parent SiteAudit.prospectId). The URL pins
// the child audit id so an open report keeps loading its own images after a
// re-scan (spec Codex fix #3). Internal cookie-gated route untouched.
import fs from 'fs/promises'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { SCREENSHOTS_DIR } from '@/lib/ada-audit/screenshot-helpers'
import { curatedScreenshotSet, validateSalesToken } from '@/lib/sales/sales-report-data'

const AUDIT_ID_RE = /^[a-z0-9]+$/i
const FILENAME_RE = /^[a-z0-9_-]+\.png$/i

export const GET = withRoute(
  async (_request: NextRequest, { params }: { params: Promise<{ token: string; adaAuditId: string; filename: string }> }) => {
    const { token, adaAuditId, filename } = await params
    const notFoundRes = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (!AUDIT_ID_RE.test(adaAuditId) || !FILENAME_RE.test(filename)) return notFoundRes()
    const prospect = await validateSalesToken(token)
    if (!prospect) return notFoundRes()
    // Curated-set enforcement (spec + Codex): the token authorizes ONLY the
    // screenshots the pinned audit's report actually renders — ownership plus
    // membership, so a guessed filename under an owned audit still 404s.
    const allowed = await curatedScreenshotSet(prospect.id, adaAuditId)
    if (!allowed.has(`${adaAuditId}/${filename}`)) return notFoundRes()

    try {
      const buffer = await fs.readFile(path.join(SCREENSHOTS_DIR, adaAuditId, filename))
      return new Response(new Uint8Array(buffer), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' },
      })
    } catch {
      return notFoundRes()
    }
  },
)
```

- [ ] **Step 4: Add the middleware matchers**

In `middleware.ts` `isPublicPath`, with the other regex lines (BEFORE the prefix fallback):

```ts
  // C14 sales surface: public report page + token-scoped screenshots ONLY.
  // NEVER add an '/api/sales/' or '/sales/' PREFIX — that would expose the
  // cookie-gated intake page (/sales) and prospect APIs (/api/sales/prospects…).
  if (/^\/sales\/[^/]+$/.test(pathname)) return true
  if (/^\/api\/sales\/[^/]+\/screenshot\/[^/]+\/[^/]+$/.test(pathname)) return true
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run app/api/sales/[token] middleware.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/sales/\[token\] middleware.ts middleware.test.ts
git commit -m "feat(c14): token-validated sales screenshot route + public matchers"
```

---

### Task 11: `/sales` intake page + nav entry

**Files:**
- Create: `components/sales/intake/ProspectDashboard.tsx` (the ONE client component)
- Create: `app/(app)/sales/page.tsx`
- Modify: `lib/tools-registry.ts` (new ToolDef), `components/shell/icons.tsx` (new icon)
- Test: `components/sales/intake/ProspectDashboard.test.tsx`

**Interfaces:**
- Consumes: `ProspectRow` + `listProspects` (Task 5); intake APIs (Task 6).
- Produces: `<ProspectDashboard initialProspects={ProspectRow[]} />`.

- [ ] **Step 1: Write the failing component test**

```tsx
// components/sales/intake/ProspectDashboard.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ProspectDashboard } from './ProspectDashboard'
import type { ProspectRow } from '@/lib/services/prospects'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const rows: ProspectRow[] = [
  {
    id: 1, name: 'Acme College', domain: 'acme.test', createdAt: '2026-07-09T00:00:00.000Z',
    salesTokenActive: true,
    latestAudit: { id: 'a1', status: 'complete', completedAt: '2026-07-09T01:00:00.000Z', adaScore: 62, reportable: true },
  },
  {
    id: 2, name: 'Running U', domain: 'running.test', createdAt: '2026-07-09T00:00:00.000Z',
    salesTokenActive: false,
    latestAudit: { id: 'a2', status: 'running', completedAt: null, adaScore: null, reportable: false },
  },
  {
    id: 3, name: 'Verifying U', domain: 'verifying.test', createdAt: '2026-07-09T00:00:00.000Z',
    salesTokenActive: false,
    // parent complete but live-scan run not written yet → "Report building…"
    latestAudit: { id: 'a3', status: 'complete', completedAt: '2026-07-09T01:00:00.000Z', adaScore: null, reportable: false },
  },
  { id: 4, name: 'Fresh', domain: 'fresh.test', createdAt: '2026-07-09T00:00:00.000Z', salesTokenActive: false, latestAudit: null },
]

describe('ProspectDashboard', () => {
  it('renders form, list states, and per-state actions', () => {
    render(<ProspectDashboard initialProspects={rows} />)
    expect(screen.getByLabelText(/prospect name/i)).toBeTruthy()
    expect(screen.getByLabelText(/domain/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /scan/i })).toBeTruthy()
    expect(screen.getByText('Acme College')).toBeTruthy()
    expect(screen.getByRole('button', { name: /copy sales link/i })).toBeTruthy() // reportable row only
    expect(screen.getByText(/scanning/i)).toBeTruthy() // running row
    expect(screen.getByText(/report building/i)).toBeTruthy() // complete-but-not-reportable row
    expect(screen.getByText(/not scanned yet/i)).toBeTruthy() // fresh row
    expect(screen.getAllByRole('button', { name: /re-scan|scan now/i }).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/sales/intake/ProspectDashboard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the dashboard**

```tsx
// components/sales/intake/ProspectDashboard.tsx
'use client'
// C14 intake: deliberately minimal — one form + one list. Polls the list
// endpoint every 8s while any prospect has a transient scan (C17-style
// smart polling, list endpoint reused instead of a bespoke status route).
import { useCallback, useEffect, useState } from 'react'
import type { ProspectRow } from '@/lib/services/prospects'

const TRANSIENT = new Set(['queued', 'running', 'pdfs-running', 'lighthouse-running'])
const POLL_MS = 8000

export function ProspectDashboard(props: { initialProspects: ProspectRow[] }) {
  const [prospects, setProspects] = useState(props.initialProspects)
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/sales/prospects')
      if (res.ok) setProspects((await res.json()).prospects)
    } catch { /* transient poll failure — keep last state */ }
  }, [])

  const anyInFlight = prospects.some(
    (p) => p.latestAudit && (TRANSIENT.has(p.latestAudit.status) || (p.latestAudit.status === 'complete' && !p.latestAudit.reportable)),
  )
  useEffect(() => {
    if (!anyInFlight) return
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
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

  function statusLabel(p: ProspectRow): string {
    if (!p.latestAudit) return 'Not scanned yet'
    if (TRANSIENT.has(p.latestAudit.status)) return 'Scanning…'
    if (p.latestAudit.status === 'complete' && !p.latestAudit.reportable) return 'Report building…'
    if (p.latestAudit.status === 'complete') return 'Report ready'
    return `Scan ${p.latestAudit.status}`
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
          <div key={p.id} className="p-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[14px] font-heading font-semibold text-navy dark:text-white">{p.name}</p>
              <p className="text-[12px] font-body text-navy/50 dark:text-white/50">
                {p.domain} · {statusLabel(p)}
                {p.latestAudit?.adaScore != null && ` · ADA ${p.latestAudit.adaScore}/100`}
              </p>
            </div>
            <div className="flex gap-2">
              {p.latestAudit?.reportable && (
                <button onClick={() => copyLink(p.id)}
                  className="rounded-lg border border-gray-200 dark:border-navy-border px-3 py-1.5 text-[12px] font-heading font-semibold text-navy dark:text-white">
                  Copy sales link
                </button>
              )}
              <button onClick={() => startScan(p.id)}
                className="rounded-lg border border-gray-200 dark:border-navy-border px-3 py-1.5 text-[12px] font-heading font-semibold text-navy dark:text-white">
                {p.latestAudit ? 'Re-scan' : 'Scan now'}
              </button>
              <button onClick={() => remove(p.id)}
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

- [ ] **Step 4: Create the page + nav entry**

```tsx
// app/(app)/sales/page.tsx
import { listProspects } from '@/lib/services/prospects'
import { ProspectDashboard } from '@/components/sales/intake/ProspectDashboard'

export const dynamic = 'force-dynamic'

export default async function SalesIntakePage() {
  const prospects = await listProspects()
  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
      <header>
        <h1 className="text-2xl font-heading font-bold text-navy dark:text-white">Prospect Scans</h1>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          Scan a prospect’s site and share a branded opportunity report. Full scans take a while — start it before the meeting.
        </p>
      </header>
      <ProspectDashboard initialProspects={prospects} />
    </div>
  )
}
```

In `components/shell/icons.tsx`, add:

```tsx
export function IconProspect(p: IconProps) { return base(p, <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>) }
```

In `lib/tools-registry.ts`, add to `TOOLS` (group `run`, after the `audits` entry):

```ts
  {
    id: 'sales',
    name: 'Prospect Scans',
    href: '/sales',
    group: 'run',
    icon: IconProspect,
    description: 'Scan a prospect site & share a sales report link',
  },
```

(and add `IconProspect` to the icons import.)

- [ ] **Step 5: Run tests + verify**

Run: `npx vitest run components/sales/intake/ProspectDashboard.test.tsx && npx tsc --noEmit`
Expected: PASS + clean. Also run the registry drift tests: `npx vitest run lib/tools-registry.test.ts components/shell` (adjust to actual test paths if different — find with `ls lib/tools-registry*.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add components/sales/intake app/\(app\)/sales lib/tools-registry.ts components/shell/icons.tsx
git commit -m "feat(c14): /sales intake page — prospect form, list, smart polling, nav entry"
```

---

### Task 12: "Prospect" badge in unified recents

**Files:**
- Modify: `lib/ada-audit/recents-query.ts` (add `prospectId` to both SiteAudit selects; new `prospectLinked` field on `RecentItem`)
- Modify: `components/ada-audit/RecentsTable.tsx` (render the extra badge)
- Test: extend `components/ada-audit/RecentsTable.test.tsx`

**Interfaces:**
- Consumes: `SiteAudit.prospectId` (Task 1).
- Produces: `RecentItem.prospectLinked?: boolean`. **Deliberately NOT a new `RecentType`** — the recents cursor total-order (`createdAt DESC, type ASC, id ASC`) depends on the existing type literals; a new type would destabilize `cursorWhere`/`compareItems`. Prospect rows keep their `site-ada`/`site-seo` type and get an additive badge.

- [ ] **Step 1: Write the failing test**

In `components/ada-audit/RecentsTable.test.tsx`, add (matching the file's existing item-fixture helper — reuse its builder and pass the new field):

```tsx
it('renders a Prospect badge on prospect-linked rows', () => {
  const item = makeItem({ type: 'site-ada', prospectLinked: true }) // reuse the suite's existing fixture builder name
  render(<RecentsTable {...defaultProps} items={[item]} />)
  expect(screen.getByText('Prospect')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/ada-audit/RecentsTable.test.tsx`
Expected: FAIL — `prospectLinked` unknown / badge not rendered.

- [ ] **Step 3: Implement**

In `lib/ada-audit/recents-query.ts`:
- Add to `RecentItem`: `prospectLinked?: boolean`.
- In BOTH SiteAudit `findMany` selects (`adaSites` ~182–191 and `seoSites` ~192–201), add `prospectId: true`.
- In the mappers that build `RecentItem` from those rows, add `prospectLinked: row.prospectId != null`.

In `components/ada-audit/RecentsTable.tsx`, next to the type badge render (~lines 219–223):

```tsx
{it.prospectLinked && (
  <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-heading font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
    Prospect
  </span>
)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/ada-audit/RecentsTable.test.tsx lib/ada-audit/recents-query.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/recents-query.ts components/ada-audit/RecentsTable.tsx components/ada-audit/RecentsTable.test.tsx
git commit -m "feat(c14): Prospect badge on unified recents rows"
```

---

### Task 13: Gates + seeded browser verification

**Files:**
- Create: `scripts/dev-seed-prospect.ts` (dev-only fixture seeder)

- [ ] **Step 1: Run the full gates**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all green (build registers `/sales/[token]`, `/sales`, and the new API routes).

- [ ] **Step 2: Write the seed script** (ZERO external scans — synthetic rows only)

```ts
// scripts/dev-seed-prospect.ts
// Dev-only: seeds a Prospect + reportable synthetic SiteAudit so /sales and
// /sales/[token] can be browser-verified with NO external scanning.
// Run: npx tsx scripts/dev-seed-prospect.ts
import { prisma } from '@/lib/db'

async function main() {
  const domain = 'seeded-prospect.example'
  const token = crypto.randomUUID()
  const prospect = await prisma.prospect.create({
    data: {
      name: 'Seeded College', domain, createdBy: 'Kevin (seed)',
      salesToken: token, salesTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
  })
  const audit = await prisma.siteAudit.create({
    data: {
      domain, wcagLevel: 'wcag21aa', status: 'complete', prospectId: prospect.id,
      completedAt: new Date(), pagesTotal: 4,
      summary: JSON.stringify({
        aggregate: { critical: 3, serious: 8, moderate: 4, minor: 2, total: 17, passed: 41, incomplete: 1 },
        pdfsAggregate: { total: 0, complete: 0, errored: 0, skipped: 0, withIssues: 0 },
        pages: [],
        commonIssues: [{
          ruleId: 'color-contrast', impact: 'serious', help: 'Elements must have sufficient color contrast',
          description: 'Text elements do not meet the 4.5:1 contrast ratio.', helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
          affectedPagesCount: 3, totalPagesScanned: 4, sharedAncestor: null, ancestorConfidence: null,
          examplePageUrl: `https://${domain}/programs`,
        }],
      }),
    },
  })
  const lh = (perf: number, lcp: number) => JSON.stringify({
    scores: { performance: perf, accessibility: 88, bestPractices: 92 },
    cwv: { lcp, cls: 0.12, tbt: 350, lcpStatus: lcp > 2500 ? 'fail' : 'pass', clsStatus: 'needs-improvement', tbtStatus: 'needs-improvement' },
    topFailures: [],
  })
  await prisma.adaAudit.create({
    data: {
      url: `https://${domain}/programs`, status: 'complete', siteAuditId: audit.id, lighthouseSummary: lh(38, 4600),
      result: JSON.stringify({
        violations: [{
          id: 'color-contrast', impact: 'serious', help: 'Elements must have sufficient color contrast',
          description: 'd', helpUrl: 'u', tags: [],
          nodes: [{ html: '<a class="apply-btn">Apply Now</a>', target: ['a.apply-btn'] }],
        }],
        passes: [], incomplete: [], inapplicable: [], timestamp: new Date().toISOString(),
        url: `https://${domain}/programs`, testEngine: { name: 'axe-core', version: '4' }, testRunner: { name: 'axe' },
      }),
    },
  })
  for (const [i, perf] of [72, 55].entries()) {
    await prisma.adaAudit.create({
      data: { url: `https://${domain}/p${i}`, status: 'complete', siteAuditId: audit.id, lighthouseSummary: lh(perf, 2200 + i * 900) },
    })
  }
  await prisma.crawlRun.create({
    data: {
      id: `seed-ada-${audit.id}`, tool: 'ada-audit', source: 'site-audit', domain, siteAuditId: audit.id,
      status: 'complete', score: 58, pagesTotal: 4, startedAt: new Date(), completedAt: new Date(),
    },
  })
  await prisma.crawlRun.create({
    data: {
      id: `seed-seo-${audit.id}`, tool: 'seo-parser', source: 'live-scan', domain, siteAuditId: audit.id,
      status: 'complete', score: 66, pagesTotal: 4, startedAt: new Date(), completedAt: new Date(),
      schemaTypesJson: JSON.stringify({ v: 1, observedPages: 4, pagesWithSchema: 1, types: [{ type: 'WebPage', pages: 1 }] }),
      contentSimilarityJson: JSON.stringify({
        v: 1,
        exactDuplicateGroups: [],
        nearDuplicateGroups: [{ urls: [`https://${domain}/a`, `https://${domain}/b`], similarity: 0.94 }],
      }),
      findings: {
        create: [
          { scope: 'run', type: 'broken_internal_links', severity: 'critical', count: 5, dedupKey: `seed-${audit.id}-1` },
          { scope: 'page', type: 'broken_internal_links', severity: 'critical', count: 2, url: `https://${domain}/programs`, dedupKey: `seed-${audit.id}-2` },
          { scope: 'run', type: 'missing_meta_description', severity: 'warning', count: 3, dedupKey: `seed-${audit.id}-3` },
        ],
      },
    },
  })
  console.log(`Seeded. Intake: http://localhost:3000/sales`)
  console.log(`Public report: http://localhost:3000/sales/${token}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```

(As in Task 8, align the nested `findings.create` field list with the actual `Finding` model if the schema requires more columns.)

- [ ] **Step 3: Browser-verify (dev)**

Run: `npx tsx scripts/dev-seed-prospect.ts`, then `npm run dev`, then verify in the browser:
1. `/sales` (logged in): form renders, seeded prospect listed as "Report ready" with ADA 58/100, Copy sales link works.
2. `/sales/<token>` in a **private window (no cookies)**: hero tiles (58 / 66 / performance median / 25%), all four sections expand, color-contrast example HTML visible, CTA footer shows "Prepared by Kevin (seed)".
3. `/sales` in the private window → redirected to `/login` (gated).
4. `/api/sales/prospects` in the private window → 401 (gated).
5. Dark-mode toggle: report renders correctly in both themes.

- [ ] **Step 4: Commit**

```bash
git add scripts/dev-seed-prospect.ts
git commit -m "feat(c14): dev seed script for sales-view browser verification"
```

---

## Post-implementation (house protocol — not part of the task loop)

- PR via `superpowers:finishing-a-development-branch`; gates re-run on the merge candidate.
- Tracker checkbox + status-log line in `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`; rewrite `HANDOFF-improvement-roadmap.md`; move spec+plan to `archive/` on ship.
- Deploy per CLAUDE.md (`git push` then `ssh $PROD_SSH "~/deploy.sh"`); prod-verify: health ok, migration applied (`Prospect` table exists), `/sales/<token>` public, `/sales` gated, PM2 stable.
- Env (optional): `SALES_CONTACT_EMAIL` in the server `.env` if the default should change.
- First REAL prospect scan is Kevin-initiated (owner-sanctioned policy).
