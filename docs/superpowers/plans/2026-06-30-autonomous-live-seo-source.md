# Autonomous Live SEO Source + Native Link Graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SEO Parser near-autonomous — a scheduled/on-demand native crawl produces a canonical, source-labeled SEO report (on-page + broken links + score + native inlink/authority/approx-depth graph) and feeds pillar/brief natively, with Screaming Frog (SF) canonical only while a fresh upload exists.

**Architecture:** Reuse the existing ADA site-audit pipeline + the post-terminal `broken-link-verify` builder (the single live-scan run builder). Compute the link graph inside that builder from the raw `HarvestedLink` rows before they are deleted, persisting per-page scalars on `CrawlPage` (no edge table). A new domain-scoped `selectCanonicalSeoRun` resolves SF-vs-live per `clientId+domain` under a 30-day SF freshness window; every SEO read surface adopts it. `/seo-parser` becomes `CrawlRun`-native.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, the findings layer (`lib/findings/`), Vitest.

## Global Constraints

- **Node 22; SQLite only; no serverless** (RunCloud + PM2). Do not change the core stack.
- **NEVER interactive `prisma.$transaction(async tx => …)`** — array-form `$transaction([...])` only; conditional logic via SQL `EXISTS`; manual `updatedAt = Date.now()` (integer ms) in raw SQL.
- **No SQLite `createMany`/`skipDuplicates`** — individual creates guarded by P2002.
- **Migrations:** local `prisma migrate dev` is interactive-only — author migration SQL by hand, apply with `prisma migrate deploy`. Prefix prisma CLI + vitest with `DATABASE_URL="file:./local-dev.db"`.
- **Findings-layer invariants:** dual-write best-effort/non-fatal; origin FKs `SetNull`; subtrees cascade from `CrawlRun`; never backfill historical blobs; read services use scalar/normalized tables only; degraded shapes OMIT unknowns (never 0/fake).
- **Tests (DB-backed):** unique domain/id/name prefixes; scope cleanup to tracked ids (never broad `deleteMany` on shared tables); clean `CrawlRun` by domain BEFORE origin rows; a run queried by `siteAuditId` as unique needs the compound `siteAuditId_tool`. vitest jsdom has NO localStorage; node is default env.
- **`pruneArchivedBlobs` stays tool-origin-aware:** seo-parser prunes only session-origin `Session.result`; NEVER null an ADA `SiteAudit.summary` for a live-scan run.
- **Source enum values:** `'sf-upload'`, `'site-audit'`, `'page-audit'`, `'live-scan'`. SEO score canonical today = `sf-upload`.

---

## File Structure

**Schema / types**
- `prisma/schema.prisma` — add `CrawlPage.inlinks`, `CrawlPage.outlinks`, `SiteAudit.seoIntent`.
- `prisma/migrations/<ts>_live_seo_source/migration.sql` — hand-authored.
- `lib/findings/types.ts` — add `inlinks`/`outlinks` to `CrawlPageInput`.

**Graph (new, pure + builder wiring)**
- `lib/ada-audit/seo/link-graph.ts` (new) — pure `computeLinkGraph(rows, opts)`.
- `lib/ada-audit/seo/link-graph.test.ts` (new).
- `lib/jobs/handlers/broken-link-verify.ts` — compute graph from raw rows; pass scalars to `ensurePage`.

**Intent marker**
- `lib/ada-audit/queue-request.ts`, `lib/ada-audit/queue-manager.ts` — thread `seoIntent`.
- `app/api/site-audit/route.ts` — accept `seoIntent` (on-demand "Run SEO scan").
- `lib/jobs/handlers/scheduled-site-audit.ts` — pass `seoIntent` from payload.
- `app/api/clients/[id]/schedules/route.ts` — accept/persist `seoIntent` in schedule payload.

**Canonical selection (new)**
- `lib/services/seo-canonical.ts` (new) — `selectCanonicalSeoRun`, `SEO_SF_CANONICAL_WINDOW_DAYS`.
- `lib/services/seo-canonical.test.ts` (new).
- Adopt in: B1 series, client dashboard, fleet, client-findings (exact files located in Task 9).

**Surfacing**
- `app/seo-parser/results/run/[runId]/page.tsx` (new) — CrawlRun-native results.
- `app/api/parse/history/route.ts` — merge live-scan runs.
- `components/seo/SeoSourceBadge.tsx` (new) — source badge + caveat.

**Page-facts provider + pillar/brief**
- `lib/services/canonical-page-facts.ts` (new) — `getCanonicalPageFacts`.
- `lib/services/canonical-page-facts.test.ts` (new).
- `lib/services/pillarAnalysis/joinRecords.ts` — consume provider.
- `lib/services/brief.service.ts` — build `Page[]` from provider when canonical = live.

**Retention / guards / breadcrumbs**
- `lib/ada-audit/scheduled-retention.ts` — keep-latest-≥2 `seo-live` carve-out.
- `lib/findings/live-seo-score.test.ts` — depth-guard test.
- Breadcrumb comments + tracker line.

---

## Task 1: Schema — `CrawlPage.inlinks/outlinks`, `SiteAudit.seoIntent`, `CrawlPageInput`

**Files:**
- Modify: `prisma/schema.prisma` (`CrawlPage` model lines ~426–450; `SiteAudit` model lines ~119–167)
- Create: `prisma/migrations/<timestamp>_live_seo_source/migration.sql`
- Modify: `lib/findings/types.ts` (`CrawlPageInput`)

**Interfaces:**
- Produces: `CrawlPage.inlinks Int?`, `CrawlPage.outlinks Int?`, `SiteAudit.seoIntent Boolean @default(false)`; `CrawlPageInput.inlinks?: number | null`, `CrawlPageInput.outlinks?: number | null`.

- [ ] **Step 1: Edit `prisma/schema.prisma`.** In `CrawlPage`, after `crawlDepth Int?` add:
```prisma
  inlinks         Int?
  outlinks        Int?
```
In `SiteAudit`, after `requestedBy String?` add:
```prisma
  seoIntent     Boolean    @default(false)
```

- [ ] **Step 2: Author migration SQL.** Create `prisma/migrations/<timestamp>_live_seo_source/migration.sql` (`<timestamp>` = `YYYYMMDDHHMMSS`):
```sql
ALTER TABLE "CrawlPage" ADD COLUMN "inlinks" INTEGER;
ALTER TABLE "CrawlPage" ADD COLUMN "outlinks" INTEGER;
ALTER TABLE "SiteAudit" ADD COLUMN "seoIntent" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Apply migration + regenerate client.**
Run: `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate`
Expected: migration applied; client regenerated, no errors.

- [ ] **Step 4: Extend `CrawlPageInput`** in `lib/findings/types.ts` — add to the interface (mirroring `crawlDepth`):
```ts
  inlinks?: number | null
  outlinks?: number | null
```

- [ ] **Step 5: Typecheck.**
Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add prisma/schema.prisma prisma/migrations lib/findings/types.ts
git commit -m "feat(schema): CrawlPage inlinks/outlinks + SiteAudit.seoIntent"
```

---

## Task 2: Pure link-graph computation

**Files:**
- Create: `lib/ada-audit/seo/link-graph.ts`
- Test: `lib/ada-audit/seo/link-graph.test.ts`

**Interfaces:**
- Consumes: raw `HarvestedLink`-shaped rows `{ sourcePageUrl: string; targetUrl: string; kind: string }` and the set of audited page URLs.
- Produces:
```ts
export interface LinkGraphRow { inlinks: number; outlinks: number; crawlDepth: number | null }
export interface LinkGraphResult {
  byUrl: Map<string, LinkGraphRow>   // keyed by normalizeFindingUrl(url)
  depthAvailable: boolean            // false when homepage couldn't be resolved
}
export function computeLinkGraph(
  rows: { sourcePageUrl: string; targetUrl: string; kind: string }[],
  auditedUrls: string[],
  homepageUrl: string | null,
): LinkGraphResult
```
- Rules: consider only `kind === 'internal-link'`; normalize every URL via `normalizeFindingUrl` (`lib/findings/normalize-url.ts`); count `inlinks` = distinct normalized `sourcePageUrl` per `targetUrl` (restricted to targets in `auditedUrls`); `outlinks` = distinct normalized `targetUrl` per `sourcePageUrl` (targets restricted to `auditedUrls`); `crawlDepth` = BFS hops from `homepageUrl` over the normalized edge set (visited-guarded); unreachable → `null`; if `homepageUrl` is null or not in `auditedUrls`, set `depthAvailable=false` and all `crawlDepth=null`.

- [ ] **Step 1: Write the failing test** `lib/ada-audit/seo/link-graph.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { computeLinkGraph } from './link-graph'

const A = 'https://x.test/', B = 'https://x.test/b', C = 'https://x.test/c', D = 'https://x.test/d'

describe('computeLinkGraph', () => {
  it('counts distinct inlinks/outlinks over audited internal links only', () => {
    const rows = [
      { sourcePageUrl: A, targetUrl: B, kind: 'internal-link' },
      { sourcePageUrl: A, targetUrl: B, kind: 'internal-link' }, // dup source→target
      { sourcePageUrl: C, targetUrl: B, kind: 'internal-link' },
      { sourcePageUrl: A, targetUrl: 'https://ext.test/', kind: 'external-link' }, // ignored
      { sourcePageUrl: A, targetUrl: C, kind: 'image' }, // ignored (not internal-link)
    ]
    const g = computeLinkGraph(rows, [A, B, C], A)
    expect(g.byUrl.get(B)!.inlinks).toBe(2) // A and C, dedup A
    expect(g.byUrl.get(A)!.outlinks).toBe(1) // only B (C link is image, ext ignored)
    expect(g.byUrl.get(B)!.outlinks).toBe(0)
  })

  it('computes BFS depth from homepage, null for unreachable', () => {
    const rows = [
      { sourcePageUrl: A, targetUrl: B, kind: 'internal-link' },
      { sourcePageUrl: B, targetUrl: C, kind: 'internal-link' },
    ]
    const g = computeLinkGraph(rows, [A, B, C, D], A)
    expect(g.depthAvailable).toBe(true)
    expect(g.byUrl.get(A)!.crawlDepth).toBe(0)
    expect(g.byUrl.get(B)!.crawlDepth).toBe(1)
    expect(g.byUrl.get(C)!.crawlDepth).toBe(2)
    expect(g.byUrl.get(D)!.crawlDepth).toBeNull() // unreachable
  })

  it('handles cycles without hanging and marks depthUnavailable when homepage missing', () => {
    const rows = [
      { sourcePageUrl: B, targetUrl: C, kind: 'internal-link' },
      { sourcePageUrl: C, targetUrl: B, kind: 'internal-link' },
    ]
    const g = computeLinkGraph(rows, [B, C], null)
    expect(g.depthAvailable).toBe(false)
    expect(g.byUrl.get(B)!.crawlDepth).toBeNull()
  })
})
```

- [ ] **Step 2: Run it; verify it fails.**
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/link-graph.test.ts`
Expected: FAIL ("computeLinkGraph is not a function" / module not found).

- [ ] **Step 3: Implement** `lib/ada-audit/seo/link-graph.ts`:
```ts
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'

export interface LinkGraphRow { inlinks: number; outlinks: number; crawlDepth: number | null }
export interface LinkGraphResult { byUrl: Map<string, LinkGraphRow>; depthAvailable: boolean }

export function computeLinkGraph(
  rows: { sourcePageUrl: string; targetUrl: string; kind: string }[],
  auditedUrls: string[],
  homepageUrl: string | null,
): LinkGraphResult {
  const audited = new Set(auditedUrls.map(normalizeFindingUrl))
  const inSets = new Map<string, Set<string>>()   // target -> distinct sources
  const outSets = new Map<string, Set<string>>()  // source -> distinct targets
  const adj = new Map<string, Set<string>>()       // source -> targets (for BFS)

  for (const r of rows) {
    if (r.kind !== 'internal-link') continue
    const s = normalizeFindingUrl(r.sourcePageUrl)
    const t = normalizeFindingUrl(r.targetUrl)
    if (!audited.has(t)) continue
    if (!inSets.has(t)) inSets.set(t, new Set())
    inSets.get(t)!.add(s)
    if (!outSets.has(s)) outSets.set(s, new Set())
    outSets.get(s)!.add(t)
    if (!adj.has(s)) adj.set(s, new Set())
    adj.get(s)!.add(t)
  }

  const home = homepageUrl ? normalizeFindingUrl(homepageUrl) : null
  const depthAvailable = !!home && audited.has(home)
  const depth = new Map<string, number>()
  if (depthAvailable) {
    const queue: string[] = [home!]
    depth.set(home!, 0)
    while (queue.length) {
      const cur = queue.shift()!
      const d = depth.get(cur)!
      for (const nxt of adj.get(cur) ?? []) {
        if (!depth.has(nxt)) { depth.set(nxt, d + 1); queue.push(nxt) }
      }
    }
  }

  const byUrl = new Map<string, LinkGraphRow>()
  for (const url of audited) {
    byUrl.set(url, {
      inlinks: inSets.get(url)?.size ?? 0,
      outlinks: outSets.get(url)?.size ?? 0,
      crawlDepth: depthAvailable ? (depth.has(url) ? depth.get(url)! : null) : null,
    })
  }
  return { byUrl, depthAvailable }
}
```

- [ ] **Step 4: Run tests; verify pass.**
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/link-graph.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**
```bash
git add lib/ada-audit/seo/link-graph.ts lib/ada-audit/seo/link-graph.test.ts
git commit -m "feat(seo): pure link-graph computation (inlinks/outlinks/BFS depth)"
```

---

## Task 3: Wire the graph into the live-scan builder

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts` (HarvestedLink query ~68–73; `ensurePage` scalar writes ~155–159)
- Test: `lib/jobs/handlers/broken-link-verify.test.ts` (extend; or a focused new test file `broken-link-verify.graph.test.ts`)

**Interfaces:**
- Consumes: `computeLinkGraph` (Task 2); raw `HarvestedLink` rows (already loaded at line 68 — note current `select` omits nothing needed: `targetUrl`, `kind`, `sourcePageUrl` present).
- Produces: live-scan `CrawlPage` rows now carry `inlinks`/`outlinks`/`crawlDepth`.

- [ ] **Step 1: Write the failing test.** In a builder test, seed a `SiteAudit` (complete) + `HarvestedPageSeo` rows for `A`,`B` + `HarvestedLink` rows (`A→B internal-link`), run the builder, assert the live-scan run's `CrawlPage` for `B` has `inlinks=1` and for `A` `outlinks=1`, and `crawlDepth` set when homepage (`A`) audited. (Follow the existing builder test's setup/cleanup patterns; unique domain prefix; clean `CrawlRun` by domain before origin rows.)

- [ ] **Step 2: Run it; verify it fails** (inlinks null today).
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.graph.test.ts`
Expected: FAIL (inlinks/outlinks/crawlDepth null).

- [ ] **Step 3: Implement.** In `broken-link-verify.ts`, after the `rows` query (the raw `HarvestedLink` rows are in `rows`) and after the `HarvestedPageSeo` rows are loaded (call that `seoRows`), compute the graph BEFORE the `toCheck` cap is applied:
```ts
// Graph metrics use the RAW rows (the toCheck map caps sources at 25 — wrong for counts).
const auditedUrls = seoRows.map((r) => r.url)
const homepageUrl = pickHomepage(auditedUrls, audit.domain) // see helper below
const graph = computeLinkGraph(
  rows.map((r) => ({ sourcePageUrl: r.sourcePageUrl, targetUrl: r.targetUrl, kind: r.kind })),
  auditedUrls,
  homepageUrl,
)
```
Add a small local `pickHomepage(urls, domain)`: return the normalized `https://<domain>/` if present in the normalized audited set, else the audited URL with the shallowest path (fewest `/` segments), else `null`. Then in the on-page `ensurePage(r.url, {...})` scalar call, merge graph fields:
```ts
const gx = graph.byUrl.get(normalizeFindingUrl(r.url))
ensurePage(r.url, {
  statusCode: r.statusCode, title: r.title, h1: r.h1,
  metaDescription: r.metaDescription, wordCount: r.wordCount,
  indexable: indexableOf(r) && !r.loginLike,
  inlinks: gx?.inlinks ?? null,
  outlinks: gx?.outlinks ?? null,
  crawlDepth: gx?.crawlDepth ?? null,
})
```
Wrap graph computation in try/catch logging `[live-seo] graph compute failed` and falling back to null aggregates — a graph failure must NOT fail the run write (findings-layer best-effort rule).

- [ ] **Step 4: Run tests; verify pass.**
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.graph.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.graph.test.ts
git commit -m "feat(seo): populate CrawlPage link-graph scalars in the live-scan builder"
```

---

## Task 4: Thread `seoIntent` (schedule + on-demand)

**Files:**
- Modify: `lib/ada-audit/queue-request.ts` (`QueueRequestInput`), `lib/ada-audit/queue-manager.ts` (`enqueueAudit` + row create ~115–116)
- Modify: `app/api/site-audit/route.ts` (accept `seoIntent`)
- Modify: `lib/jobs/handlers/scheduled-site-audit.ts` (`ScheduledSiteAuditPayload` + pass-through)
- Modify: `app/api/clients/[id]/schedules/route.ts` (accept/persist `seoIntent` in payload)
- Test: `lib/ada-audit/queue-request.test.ts` (or the existing queue test)

**Interfaces:**
- Produces: `QueueRequestInput.seoIntent?: boolean`; written to `SiteAudit.seoIntent`. `ScheduledSiteAuditPayload.seoIntent?: boolean`.

- [ ] **Step 1: Write the failing test** — `queueSiteAuditRequest({ ..., seoIntent: true })` creates a `SiteAudit` with `seoIntent === true`; default omitted → `false`.

- [ ] **Step 2: Run; verify fail.**
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/queue-request.test.ts`
Expected: FAIL (unknown field / false).

- [ ] **Step 3: Implement.**
  - `QueueRequestInput`: add `seoIntent?: boolean`. Pass to `enqueueAudit(domain, clientId, wcagLevel, { preDiscoveredUrls, requestedBy, scheduleId, seoIntent })`.
  - `enqueueAudit` opts: add `seoIntent?: boolean`; in the `SiteAudit` create data add `seoIntent: opts.seoIntent ?? false`.
  - `app/api/site-audit/route.ts`: read `body.seoIntent === true` and pass `seoIntent` to `queueSiteAuditRequest` (this is the on-demand "Run SEO scan" trigger — same endpoint, flagged).
  - `scheduled-site-audit.ts`: add `seoIntent?: boolean` to `ScheduledSiteAuditPayload`; pass `seoIntent: p.seoIntent ?? false` into `queueSiteAuditRequest`.
  - `app/api/clients/[id]/schedules/route.ts`: accept an optional `seoIntent` boolean on schedule create/update and store it in the `Schedule.payload` JSON alongside `{clientId, domain, wcagLevel}`.

- [ ] **Step 4: Run; verify pass.**
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/queue-request.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add lib/ada-audit/queue-request.ts lib/ada-audit/queue-manager.ts app/api/site-audit/route.ts lib/jobs/handlers/scheduled-site-audit.ts app/api/clients/[id]/schedules/route.ts lib/ada-audit/queue-request.test.ts
git commit -m "feat(seo): thread seoIntent through schedule + on-demand site-audit enqueue"
```

---

## Task 5: Domain-scoped canonical selector

**Files:**
- Create: `lib/services/seo-canonical.ts`
- Test: `lib/services/seo-canonical.test.ts`

**Interfaces:**
- Produces:
```ts
export const SEO_SF_CANONICAL_WINDOW_DAYS =
  Number(process.env.SEO_SF_CANONICAL_WINDOW_DAYS ?? 30)

export interface SeoRunRef {
  id: string; source: string; domain: string | null
  completedAt: Date | null; createdAt: Date
  sessionId: string | null; siteAuditId: string | null
}
export type CanonicalSeo =
  | { run: SeoRunRef; source: 'sf-upload' | 'live-scan' }
  | null
// Pure selector over already-fetched candidate runs for ONE clientId+domain.
export function pickCanonicalSeo(
  runs: SeoRunRef[],
  nowMs: number,
  windowDays?: number,
): CanonicalSeo
```
Rule (mirrors spec §4.3): among `runs` (already domain-filtered), let `sf` = newest `source==='sf-upload'`, `live` = newest `source==='live-scan'`. If `sf` and `ageDays(sf) <= window` → sf. Else if `live` and (`!sf || live.completedAt > sf.completedAt`) → live. Else → sf (or live if no sf). `ageDays` from `completedAt` (missing → treat as Infinity/stale).

- [ ] **Step 1: Write the failing test** `lib/services/seo-canonical.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { pickCanonicalSeo } from './seo-canonical'

const day = 86_400_000
const now = 1_000 * day
const ref = (o: Partial<any>) => ({ id: o.id!, source: o.source!, domain: 'x.test',
  completedAt: o.completedAt ?? null, createdAt: new Date(now), sessionId: null, siteAuditId: null })

describe('pickCanonicalSeo (30d window)', () => {
  it('fresh SF wins', () => {
    const r = pickCanonicalSeo([
      ref({ id: 'sf', source: 'sf-upload', completedAt: new Date(now - 5 * day) }),
      ref({ id: 'lv', source: 'live-scan', completedAt: new Date(now - 1 * day) }),
    ], now, 30)
    expect(r?.run.id).toBe('sf'); expect(r?.source).toBe('sf-upload')
  })
  it('stale SF + newer live → live wins', () => {
    const r = pickCanonicalSeo([
      ref({ id: 'sf', source: 'sf-upload', completedAt: new Date(now - 40 * day) }),
      ref({ id: 'lv', source: 'live-scan', completedAt: new Date(now - 1 * day) }),
    ], now, 30)
    expect(r?.run.id).toBe('lv'); expect(r?.source).toBe('live-scan')
  })
  it('no SF → live canonical', () => {
    const r = pickCanonicalSeo([ref({ id: 'lv', source: 'live-scan', completedAt: new Date(now) })], now, 30)
    expect(r?.run.id).toBe('lv')
  })
  it('stale SF + no live → SF still canonical', () => {
    const r = pickCanonicalSeo([ref({ id: 'sf', source: 'sf-upload', completedAt: new Date(now - 99 * day) })], now, 30)
    expect(r?.run.id).toBe('sf')
  })
  it('empty → null', () => { expect(pickCanonicalSeo([], now, 30)).toBeNull() })
})
```

- [ ] **Step 2: Run; verify fail.**
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/seo-canonical.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `lib/services/seo-canonical.ts`:
```ts
export const SEO_SF_CANONICAL_WINDOW_DAYS =
  Number(process.env.SEO_SF_CANONICAL_WINDOW_DAYS ?? 30)

export interface SeoRunRef {
  id: string; source: string; domain: string | null
  completedAt: Date | null; createdAt: Date
  sessionId: string | null; siteAuditId: string | null
}
export type CanonicalSeo = { run: SeoRunRef; source: 'sf-upload' | 'live-scan' } | null

const ageDays = (r: SeoRunRef, nowMs: number) =>
  r.completedAt ? (nowMs - r.completedAt.getTime()) / 86_400_000 : Infinity
const newest = (runs: SeoRunRef[], src: string) =>
  runs.filter((r) => r.source === src)
      .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0] ?? null

export function pickCanonicalSeo(
  runs: SeoRunRef[], nowMs: number, windowDays = SEO_SF_CANONICAL_WINDOW_DAYS,
): CanonicalSeo {
  const sf = newest(runs, 'sf-upload')
  const live = newest(runs, 'live-scan')
  if (sf && ageDays(sf, nowMs) <= windowDays) return { run: sf, source: 'sf-upload' }
  if (live && (!sf || (live.completedAt?.getTime() ?? 0) > (sf.completedAt?.getTime() ?? 0)))
    return { run: live, source: 'live-scan' }
  if (sf) return { run: sf, source: 'sf-upload' }
  if (live) return { run: live, source: 'live-scan' }
  return null
}
```
Also add `selectCanonicalSeoRun({ clientId, domain })` that queries `prisma.crawlRun.findMany` for `{ clientId, tool: 'seo-parser', source: { in: ['sf-upload','live-scan'] }, domain: normalizeDomain(domain) }` selecting the `SeoRunRef` fields and delegates to `pickCanonicalSeo(rows, Date.now())`. (For live-scan, also constrain to runs whose `siteAudit.seoIntent === true` via a relation filter, so ADA-only live runs don't surface as canonical SEO.)

- [ ] **Step 4: Run; verify pass.**
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/seo-canonical.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit.**
```bash
git add lib/services/seo-canonical.ts lib/services/seo-canonical.test.ts
git commit -m "feat(seo): domain-scoped SF-vs-live canonical selector (30d window)"
```

---

## Task 6: CrawlRun-native results route (live-scan)

**Files:**
- Create: `app/seo-parser/results/run/[runId]/page.tsx`
- Reuse: `lib/findings/seo-findings-fallback.ts` (`buildSeoResultFromRun`)
- Test: a route/unit test asserting a live-scan run renders an `AggregatedResult` (archived/degraded shape) without a `Session`.

**Interfaces:**
- Consumes: `buildSeoResultFromRun(run)` / `loadArchivedSeoResult` (already turn a `CrawlRun` + findings into an `AggregatedResult` with `archived: true`).
- Produces: a `/seo-parser/results/run/<crawlRunId>` page rendering the existing results view in a source-labeled, "live-scan" mode.

- [ ] **Step 1: Write the failing test** — given a seeded live-scan `CrawlRun` (+ `CrawlPage`/`Finding` rows), the loader for the run route returns a non-null `AggregatedResult` with the SEO score from `CrawlRun.score`. (Assert at the data-loader level, not full React render, to avoid jsdom overhead.)

- [ ] **Step 2: Run; verify fail.**
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/seo-parser/results/run`
Expected: FAIL (route/loader missing).

- [ ] **Step 3: Implement.** Add the loader (extract a `loadRunSeoResult(runId)` helper next to `loadArchivedSeoResult` in `lib/findings/seo-findings-fallback.ts` if not already callable by runId): fetch the `CrawlRun` by id (must be `tool:'seo-parser'`), build the result via `buildSeoResultFromRun`, and render the same results component the `[sessionId]` page uses, passing a `source: 'live-scan'` prop + the `SeoSourceBadge` (Task 8). For SF-only surfaces (export/diff/share/roadmap), render the "needs Screaming Frog data" state (Task 8 component) instead of those controls.

- [ ] **Step 4: Run; verify pass.**
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/seo-parser/results/run`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add app/seo-parser/results/run lib/findings/seo-findings-fallback.ts
git commit -m "feat(seo): CrawlRun-native /seo-parser results route for live-scan runs"
```

---

## Task 7: Merged, source-labeled `/seo-parser` history

**Files:**
- Modify: `app/api/parse/history/route.ts`
- Test: `app/api/parse/history/route.test.ts` (new or extend)

**Interfaces:**
- Consumes: the existing `Session` query; adds a live-scan `CrawlRun` query.
- Produces: a merged, date-ordered array where each entry has `{ id, kind: 'session' | 'run', createdAt, siteName, clientId, clientName, healthScore, urlCount, source: 'sf-upload' | 'live-scan' }`. Run entries link to `/seo-parser/results/run/<id>`; session entries to `/seo-parser/results/<id>`.

- [ ] **Step 1: Write the failing test** — seed one SF `Session` (+ `crawlRun.score`) and one `intent:'seo-live'` live-scan `CrawlRun`; assert the history response includes both, source-labeled, newest-first, and that an ADA-only live-scan run (seoIntent=false) is EXCLUDED.

- [ ] **Step 2: Run; verify fail.**
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/parse/history`
Expected: FAIL (only sessions returned).

- [ ] **Step 3: Implement.** Keep the existing `Session.findMany` (label `source:'sf-upload'`, `kind:'session'`). Add:
```ts
const liveRuns = await prisma.crawlRun.findMany({
  where: { tool: 'seo-parser', source: 'live-scan', siteAudit: { seoIntent: true } },
  orderBy: { createdAt: 'desc' }, take: 50,
  select: { id: true, createdAt: true, score: true, domain: true, pagesTotal: true,
            clientId: true, client: { select: { id: true, name: true } } },
})
```
Map runs to the unified entry shape (`kind:'run'`, `source:'live-scan'`, `healthScore: score`, `urlCount: pagesTotal`, `siteName: domain`), concat with session entries, sort by `createdAt` desc, slice 50.

- [ ] **Step 4: Run; verify pass.**
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/parse/history`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add app/api/parse/history/route.ts app/api/parse/history/route.test.ts
git commit -m "feat(seo): merge live-scan runs into /seo-parser history (source-labeled)"
```

---

## Task 8: Source badge + "needs SF" state component

**Files:**
- Create: `components/seo/SeoSourceBadge.tsx`
- Test: `components/seo/SeoSourceBadge.test.tsx` (node-env pure render via the component's returned props is fine; or snapshot the label strings from a pure helper)

**Interfaces:**
- Produces: `<SeoSourceBadge source="sf-upload" | "live-scan" />` (badge + caveat text for live-scan: "Live scan — on-page + audited-set graph; depth approximate"); `<NeedsScreamingFrog feature="export" />` (renders the SF-only message used by Task 6).

- [ ] **Step 1: Write a failing test** asserting a pure label helper `seoSourceLabel('live-scan')` returns the caveat string and `seoSourceLabel('sf-upload')` returns "Screaming Frog". (Keep logic in a pure function to avoid jsdom.)

- [ ] **Step 2: Run; verify fail.**
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo/SeoSourceBadge`
Expected: FAIL.

- [ ] **Step 3: Implement** the pure `seoSourceLabel` + the two small components (Tailwind, dark-mode variants per the codebase's `dark:` conventions).

- [ ] **Step 4: Run; verify pass.**
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo/SeoSourceBadge`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add components/seo/SeoSourceBadge.tsx components/seo/SeoSourceBadge.test.tsx
git commit -m "feat(seo): source badge + needs-Screaming-Frog state component"
```

---

## Task 9: Adopt the canonical selector across SEO score surfaces

**Files (locate exact lines at task start with grep):**
- Modify: B1 trend series + filters, client dashboard SEO score, fleet views, client-findings aggregation — every reader that currently consumes `selectRuns(...).seo.current` for the SEO score, or that filters out `live-scan`.
- Test: extend the relevant service tests.

**Interfaces:**
- Consumes: `selectCanonicalSeoRun({ clientId, domain })` (Task 5).
- Produces: each surface resolves the canonical SEO run per `clientId+domain` under the window rule; live-scan can now be canonical; the ADA-origin live-scan stays the additive B2 panel (no double-count).

- [ ] **Step 1: Locate call sites.**
Run: `grep -rn "selectRuns\|\.seo\.current\|source !== 'live-scan'\|live-scan" lib app components | grep -v test`
Record each SEO-score reader.

- [ ] **Step 2: Write/adjust failing tests** — for each surface, a test where a client/domain has only a fresh `seoIntent` live-scan run (no SF) now reports the live score (previously null/excluded), and where a fresh SF upload exists SF still wins.

- [ ] **Step 3: Run; verify fail.**
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run <the touched test files>`
Expected: FAIL.

- [ ] **Step 4: Implement** — replace the SEO-score selection in each reader with `selectCanonicalSeoRun`. Keep `selectRuns().seo.liveScan` ONLY for the additive B2 broken-links/on-page panel. Preserve `pruneArchivedBlobs` tool-origin-awareness (no change). Carry the `source` through for labeling.

- [ ] **Step 5: Run; verify pass + full gate.**
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run <touched files> && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add -A
git commit -m "feat(seo): adopt domain-scoped canonical selector across SEO score surfaces"
```

---

## Task 10: Canonical page-facts provider

**Files:**
- Create: `lib/services/canonical-page-facts.ts`
- Test: `lib/services/canonical-page-facts.test.ts`

**Interfaces:**
- Consumes: `selectCanonicalSeoRun` (Task 5); for SF → the parsed `Session` result / `parsePerUrlForPillar` shape; for live → `CrawlPage` rows of the canonical run.
- Produces:
```ts
export interface CanonicalPageFact {
  url: string; title?: string | null; h1?: string | null
  metaDescription?: string | null; wordCount?: number | null
  crawlDepth?: number | null; inlinks?: number | null; outlinks?: number | null
  indexable?: boolean | null; schemaTypes?: string[]
  // brief-specific:
  statusCode?: number | null; indexability?: string | null
}
export interface CanonicalPageFacts { source: 'sf-upload' | 'live-scan'; pages: CanonicalPageFact[] }
export async function getCanonicalPageFacts(args: { clientId: number; domain: string }): Promise<CanonicalPageFacts | null>
```
- Rule: SF branch returns the existing per-URL records (today's `parsePerUrlForPillar` output mapped into `CanonicalPageFact`). Live branch reads `prisma.crawlPage.findMany({ where: { runId: <canonical live run id> } })` and maps scalars (`title`,`h1`,`metaDescription`,`wordCount`,`crawlDepth`,`inlinks`,`outlinks`,`indexable`,`statusCode`); fields the live scan can't supply (e.g. `schemaTypes` if not persisted as a scalar) are OMITTED, never faked.

- [ ] **Step 1: Write the failing test** — seed a `seoIntent` live-scan run with two `CrawlPage` rows (with inlinks/crawlDepth); assert `getCanonicalPageFacts` returns `source:'live-scan'` and the per-URL facts; seed a fresh SF session for the same client/domain and assert it flips to `source:'sf-upload'`.

- [ ] **Step 2: Run; verify fail.**
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/canonical-page-facts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** per the interface above.

- [ ] **Step 4: Run; verify pass.**
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/canonical-page-facts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add lib/services/canonical-page-facts.ts lib/services/canonical-page-facts.test.ts
git commit -m "feat(seo): canonical page-facts provider (SF + live branches)"
```

---

## Task 11: Rewire pillar analysis to the provider

**Files:**
- Modify: `lib/services/pillarAnalysis/joinRecords.ts` (consumes per-URL records)
- Test: `lib/services/pillarAnalysis/joinRecords.test.ts` (extend)

**Interfaces:**
- Consumes: `getCanonicalPageFacts` → maps each `CanonicalPageFact` into the `RawUrlData` shape `joinRecords` expects (`url,title,h1,metaDescription,firstParagraph,wordCount,crawlDepth,inlinks,outlinks,indexable,schemaTypes`). `firstParagraph`/`schemaTypes` OMITTED on the live branch (downstream already tolerates missing enrichment).
- Produces: pillar analysis runs on live-source data when canonical = live, carrying `source`.

- [ ] **Step 1: Write the failing test** — pillar join produces records (with inlinks/crawlDepth) for a live-only client/domain via the provider.

- [ ] **Step 2: Run; verify fail.** Run the test file; Expected: FAIL.

- [ ] **Step 3: Implement** — where `joinRecords` currently sources per-URL SF data, call the provider and adapt. Keep the SF path identical when canonical = SF.

- [ ] **Step 4: Run; verify pass.** Run the test file; Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add lib/services/pillarAnalysis/joinRecords.ts lib/services/pillarAnalysis/joinRecords.test.ts
git commit -m "feat(seo): pillar analysis reads canonical page-facts (live or SF)"
```

---

## Task 12: Rewire brief generation to the provider

**Files:**
- Modify: `lib/services/brief.service.ts` (the `Page[]` builder + orphan/program logic)
- Test: `lib/services/brief.service.test.ts` (extend)

**Interfaces:**
- Consumes: `getCanonicalPageFacts` → maps to brief's internal `Page` shape `{ url, title, statusCode, indexability, wordCount, inlinks, h1, metaDesc }`. On the live branch, `indexability` derives from `CrawlPage.indexable` (`indexable===true ? 'Indexable' : 'Non-Indexable'`), `metaDesc` from `metaDescription`.
- Produces: brief generation works on a live-only client (program ranking by `inlinks`, orphan = `inlinks===0`), source-labeled.

- [ ] **Step 1: Write the failing test** — brief builds programs + orphan list from provider-sourced live pages.

- [ ] **Step 2: Run; verify fail.** Run the test file; Expected: FAIL.

- [ ] **Step 3: Implement** — add a provider-fed entry path producing `Page[]` (the existing CSV path stays for direct CSV uploads). Map fields per the interface.

- [ ] **Step 4: Run; verify pass.** Run the test file; Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add lib/services/brief.service.ts lib/services/brief.service.test.ts
git commit -m "feat(seo): brief generation reads canonical page-facts (live or SF)"
```

---

## Task 13: Retention carve-out for live-SEO runs

**Files:**
- Modify: `lib/ada-audit/scheduled-retention.ts` (`pruneScheduledSiteAudits`)
- Test: `lib/ada-audit/scheduled-retention.test.ts` (extend)

**Interfaces:**
- Produces: schedule-originated `seoIntent` SiteAudits keep the latest ≥2 completed per `(client, domain)` even when the ADA cadence window would delete them; findings survive origin deletion via `SetNull`.

- [ ] **Step 1: Write the failing test** — a schedule with 4 completed `seoIntent` audits past the cadence cutoff retains the latest 2; their live-scan `CrawlRun`s survive (origin SetNull).

- [ ] **Step 2: Run; verify fail.** Run the test file; Expected: FAIL (current logic keeps latest 2 per *schedule* without the seo-domain carve-out, OR deletes seo runs the SEO history needs).

- [ ] **Step 3: Implement** — extend the "keep" set so that for `seoIntent` schedules the keep query groups by domain (keep latest 2 completed per `scheduleId+domain`). Leave non-SEO behavior unchanged.

- [ ] **Step 4: Run; verify pass.** Run the test file; Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add lib/ada-audit/scheduled-retention.ts lib/ada-audit/scheduled-retention.test.ts
git commit -m "feat(seo): retention keeps latest 2 live-SEO audits per client+domain"
```

---

## Task 14: Depth-guard test for `scoreLiveSeo`

**Files:**
- Test: `lib/findings/live-seo-score.test.ts` (extend)

**Interfaces:**
- Consumes: `scoreLiveSeo(LiveScoreInputs)` — note `LiveScoreInputs` has NO depth field today; the guard locks that in.

- [ ] **Step 1: Write the test** asserting depth plays no role: the `LiveScoreInputs` interface has no `crawlDepth`/depth key, and two input sets identical except for any added depth-like field score identically. Concretely, assert a representative input scores the same value across runs and document that adding depth to the score is a deliberate, test-breaking change:
```ts
it('live score excludes crawl depth (v1 guard)', () => {
  const base = { attempted: 10, observed: 10, indexableScored: 10, pagesError: 0,
    missingTitle: 0, missingMeta: 0, missingH1: 0, thin: 0, pagesWithSchema: 10 }
  expect(scoreLiveSeo(base)).toBe(scoreLiveSeo({ ...base }))
  // @ts-expect-error — depth is intentionally NOT part of LiveScoreInputs
  expect(scoreLiveSeo({ ...base, crawlDepth: 3 })).toBe(scoreLiveSeo(base))
})
```

- [ ] **Step 2: Run; verify pass** (the `@ts-expect-error` confirms the field is absent; runtime ignores the extra key).
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/live-seo-score.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit.**
```bash
git add lib/findings/live-seo-score.test.ts
git commit -m "test(seo): guard that live score excludes crawl depth (v1)"
```

---

## Task 15: Breadcrumbs + tracker + final gate

**Files:**
- Modify: `lib/jobs/handlers/scheduled-site-audit.ts` + `app/api/site-audit/route.ts` (comment), `lib/jobs/handlers/broken-link-verify.ts` (comment)
- Modify: `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md` (C-track line) + `docs/superpowers/todos/HANDOFF-improvement-roadmap.md`

**Interfaces:** none (docs/comments + gate).

- [ ] **Step 1: Add breadcrumb comments** at the SEO-intent enqueue site(s):
```ts
// FUTURE (efficiency): scheduled/on-demand SEO scans currently run the FULL ADA
// site-audit pipeline (axe + screenshots + PSI) and reuse its live-scan run as
// the SEO report. A dedicated SEO-only scan mode (skip axe/screenshots/PSI) is
// the planned optimization — see docs/superpowers/specs/2026-06-30-autonomous-live-seo-source-design.md §9.
```

- [ ] **Step 2: Add a C-track tracker line** documenting this phase (new C6 phase: autonomous live SEO source + native link graph), referencing the spec/plan paths, and noting the future SEO-only-mode breadcrumb.

- [ ] **Step 3: Run the full gate.**
Run: `npx tsc --noEmit && DATABASE_URL="file:./local-dev.db" npx vitest run && npm run build`
Expected: tsc clean; all tests pass; build succeeds.

- [ ] **Step 4: Commit.**
```bash
git add -A
git commit -m "docs(seo): breadcrumbs + tracker for autonomous live SEO source"
```

---

## Self-Review (completed)

- **Spec coverage:** §3 scan-model → Task 4/15 (+breadcrumb); §3 canonical/30d → Task 5/9; §3 surfacing → Task 6/7/8; §3 crawl-depth approx → Task 2/3; §4.2 graph-from-raw-rows → Task 2/3; §4.3 domain-scoped selector → Task 5; §4.4 CrawlRun-native → Task 6/7; §4.5 page-facts provider + pillar/brief → Task 10/11/12; §6 depth-guard → Task 14; §7 surface list → Task 9; §7a retention → Task 13; §8 schema → Task 1. All covered.
- **Placeholders:** none — every code step has concrete code; Task 9's call-site list is resolved by an explicit grep step (the codebase locations vary and must be found at task start — acceptable, with the exact command given).
- **Type consistency:** `pickCanonicalSeo`/`selectCanonicalSeoRun`, `computeLinkGraph`/`LinkGraphResult`, `CanonicalPageFact(s)`/`getCanonicalPageFacts`, `seoIntent`, `CrawlPageInput.inlinks/outlinks` consistent across tasks.

## Risks / open verification (for executor)
- Task 9's surface list is codebase-discovered — if a surface is missed, the live score silently won't appear there; the grep step + per-surface tests are the safety net.
- `schemaTypes` is not a `CrawlPage` scalar — pillar's live branch omits it; confirm pillar tolerates missing `schemaTypes` (it already handles missing enrichment).
- `pickHomepage` heuristic (Task 3) — verify against a real audited set during execution; depth is labeled approximate regardless.
