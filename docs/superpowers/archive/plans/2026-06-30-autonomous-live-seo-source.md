# Autonomous Live SEO Source + Native Link Graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SEO Parser near-autonomous — a scheduled/on-demand native crawl produces a canonical, source-labeled SEO report (on-page + broken links + score + native inlink/authority/approx-depth graph) and feeds pillar/brief natively (with persisted live records), with Screaming Frog (SF) canonical only while a fresh upload exists.

**Architecture:** Reuse the ADA site-audit pipeline + the post-terminal `broken-link-verify` builder (the single live-scan run builder). Compute the link graph inside that builder from the raw `HarvestedLink` rows before deletion, persisting per-page scalars on `CrawlPage` (no edge table). A durable `CrawlRun.seoIntent` marks SEO-purposed runs (survives `SiteAudit` retention `SetNull`). A pure, bulk-friendly canonical selector resolves SF-vs-live per `clientId+domain` under a 30-day SF window; every SEO read surface adopts it. `/seo-parser` becomes `CrawlRun`-native. pillar/brief read a canonical page-facts provider and persist live outputs.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, the findings layer (`lib/findings/`), Vitest.

## Resolved decisions (Kevin, 2026-06-30)
- **D1 — ADA + SEO schedules coexist** per client+domain; intent enters the schedules uniqueness key + UI (Task 4).
- **D2 — Persist SF `inlinks/outlinks` at parse time** onto `CrawlPage` so the provider always reads normalized tables (Tasks 1, 10).
- **D3 — Persist live pillar records; provider-fed brief** in v1. `PillarAnalysis` becomes keyable by `crawlRunId` (sessionId stays nullable+unique). Brief is generated on demand via the existing pure `generateBrief(...)` — NO persistence needed. The live **pillar (pat_) memo** works for live runs; the **`srt_` SEO-roadmap and `krt_` keyword memos remain session-bound / SF-only in v1** (separate `sessionId @unique` models — out of scope here; noted as future). Live brief degrades the SEMrush-keyword + schema-types sections (not available from live facts). (Tasks 1, 11, 12.)
- **D4 — "Needs Screaming Frog data" state** on the genuinely SF-only surfaces (report exports CSV/VPAT/PDF, SEO session diff, share pages); excluded from the diff picker; deletable normally (Tasks 6, 8). pillar/brief/memo are NOT SF-only (per D3).

## Global Constraints
- **Node 22; SQLite only; no serverless** (RunCloud + PM2). Do not change the core stack.
- **NEVER interactive `prisma.$transaction(async tx => …)`** — array-form only; conditional logic via SQL `EXISTS`; manual `updatedAt = Date.now()` (integer ms) in raw SQL.
- **No SQLite `createMany`/`skipDuplicates`** — individual creates guarded by P2002.
- **Migrations:** local `prisma migrate dev` is interactive-only — author migration SQL by hand, apply with `prisma migrate deploy`. Prefix prisma CLI + vitest with `DATABASE_URL="file:./local-dev.db"`.
- **Findings-layer invariants:** dual-write best-effort/non-fatal; origin FKs `SetNull`; subtrees cascade from `CrawlRun`; never backfill historical blobs; read services use scalar/normalized tables only; degraded shapes OMIT unknowns (never 0/fake).
- **Tests (DB-backed):** unique domain/id/name prefixes; scope cleanup to tracked ids; clean `CrawlRun` by domain BEFORE origin rows; a run queried by `siteAuditId` as unique needs the compound `siteAuditId_tool`. vitest jsdom has NO localStorage; node is default env.
- **`pruneArchivedBlobs` stays tool-origin-aware:** seo-parser prunes only session-origin `Session.result`; NEVER null an ADA `SiteAudit.summary` for a live-scan run.
- **Source enum values:** `'sf-upload'`, `'site-audit'`, `'page-audit'`, `'live-scan'`. SEO score canonical default = `sf-upload` while fresh.
- **Durable intent (Codex #1):** SEO-purpose lives on `CrawlRun.seoIntent`. Canonical selection + history filter the **run's own** field, NEVER `siteAudit:{ seoIntent }` (the SiteAudit is SetNull'd by retention).

---

## File Structure

**Schema / types** — `prisma/schema.prisma` (+`CrawlPage.inlinks/outlinks`, `SiteAudit.seoIntent`, `CrawlRun.seoIntent`, `PillarAnalysis` decouple), hand-authored migration, `lib/findings/types.ts` (`CrawlPageInput`, `CrawlRunInput`), `lib/findings/writer.ts`.
**Graph** — `lib/ada-audit/seo/link-graph.ts` (+test), `lib/jobs/handlers/broken-link-verify.ts`.
**SF page-facts persistence** — `lib/findings/seo-mapper.ts` (map `parsePerUrlForPillar` inlinks/outlinks → `CrawlPage`).
**Intent** — `lib/ada-audit/queue-request.ts`, `queue-manager.ts`, `app/api/site-audit/route.ts`, `lib/jobs/handlers/scheduled-site-audit.ts`, `app/api/clients/[id]/schedules/route.ts`.
**Canonical selection** — `lib/services/seo-canonical.ts` (+test).
**Surfacing** — `app/seo-parser/results/run/[runId]/page.tsx`, `lib/findings/seo-findings-fallback.ts` (`loadRunSeoResult`), `app/api/parse/history/route.ts`, `components/seo-parser/HistoryList.tsx`, the diff page, `components/seo/SeoSourceBadge.tsx`.
**Provider + pillar/brief** — `lib/services/canonical-page-facts.ts` (+test), `lib/services/pillarAnalysis/runFromSession.ts` (+ new `runForCanonical`), `lib/services/brief.service.ts` + brief route.
**Score surfaces** — `client-dashboard`, `client-fleet`, `client-findings`, `scorecard-shared`, `findings-shared`, `buildSeoSeries`.
**Retention / guards / breadcrumbs** — `lib/ada-audit/scheduled-retention.ts`, `lib/findings/live-seo-score.test.ts`, tracker.

---

## Task 1: Schema — graph scalars, durable intent, SF facts, PillarAnalysis decouple

**Files:**
- Modify: `prisma/schema.prisma` (`CrawlPage` ~426; `SiteAudit` ~119; `CrawlRun` ~342; `PillarAnalysis`)
- Create: `prisma/migrations/<timestamp>_live_seo_source/migration.sql`
- Modify: `lib/findings/types.ts` (`CrawlPageInput`, `CrawlRunInput`), `lib/findings/writer.ts`

**Interfaces:**
- Produces: `CrawlPage.inlinks Int?`, `CrawlPage.outlinks Int?`; `SiteAudit.seoIntent Boolean @default(false)`; `CrawlRun.seoIntent Boolean @default(false)`; `PillarAnalysis` keyable by run/client/domain (relax `sessionId` to nullable, add `crawlRunId String?` + `clientId`/`domain`); `CrawlPageInput.inlinks?/outlinks?: number | null`; `CrawlRunInput.seoIntent?: boolean`.

- [ ] **Step 1: Edit `prisma/schema.prisma`.**
  - `CrawlPage`: after `crawlDepth Int?` add `inlinks Int?` and `outlinks Int?`.
  - `SiteAudit`: after `requestedBy String?` add `seoIntent Boolean @default(false)`.
  - `CrawlRun`: after `source String` add `seoIntent Boolean @default(false)`.
  - `PillarAnalysis` (Codex delta-fix #1/#2): keep `sessionId String? @unique` (NULLABLE but still `@unique` — SQLite permits multiple NULLs while enforcing uniqueness on non-null session IDs, preserving the existing `runFromSession.ts` P2002 backstop). Change the relation to `session Session?`. Add `crawlRunId String? @unique` with a REAL relation `crawlRun CrawlRun? @relation(fields: [crawlRunId], references: [id], onDelete: SetNull)` and a back-reference `pillarAnalyses PillarAnalysis[]` on `CrawlRun`. Add `clientId Int?`, `domain String?`. Confirm `Session.pillarAnalyses` (list relation) still compiles with nullable `sessionId`.

- [ ] **Step 2: Author migration SQL** `prisma/migrations/<timestamp>_live_seo_source/migration.sql` (`<timestamp>`=`YYYYMMDDHHMMSS`). Use table-rebuild form for the `PillarAnalysis` `@unique` drop if needed (SQLite can't drop a UNIQUE via ALTER) — follow the pattern of a prior column-drop migration in `prisma/migrations/`:
```sql
ALTER TABLE "CrawlPage" ADD COLUMN "inlinks" INTEGER;
ALTER TABLE "CrawlPage" ADD COLUMN "outlinks" INTEGER;
ALTER TABLE "SiteAudit" ADD COLUMN "seoIntent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CrawlRun" ADD COLUMN "seoIntent" BOOLEAN NOT NULL DEFAULT false;
-- PillarAnalysis: sessionId NOT NULL -> NULL (keep UNIQUE) + new cols. Requires a TABLE REBUILD
-- (SQLite cannot ALTER a column NOT NULL->NULL). Codex delta-fix #3: use the PRAGMA rebuild pattern,
-- carry EVERY existing column (id, sessionId, subscorePresence, subscoreContext, aiNarrative,
-- narrativeUpdatedAt, … — copy the live model's full column list), add new cols IN the rebuilt table:
PRAGMA foreign_keys=OFF;
CREATE TABLE "PillarAnalysis_new" (
  -- ...ALL existing columns verbatim, but "sessionId" TEXT NULL...
  "crawlRunId" TEXT,
  "clientId" INTEGER,
  "domain" TEXT
  -- ...existing FKs (sessionId -> Session) ...
  , FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "PillarAnalysis_new" (/* existing cols */) SELECT /* existing cols */ FROM "PillarAnalysis";
DROP TABLE "PillarAnalysis";
ALTER TABLE "PillarAnalysis_new" RENAME TO "PillarAnalysis";
CREATE UNIQUE INDEX "PillarAnalysis_sessionId_key" ON "PillarAnalysis"("sessionId");
CREATE UNIQUE INDEX "PillarAnalysis_crawlRunId_key" ON "PillarAnalysis"("crawlRunId");
-- ...recreate any other existing PillarAnalysis indexes...
PRAGMA foreign_keys=ON;
```
Copy the exact rebuild idiom from a prior rebuild migration in `prisma/migrations/`; do NOT `ALTER TABLE ADD COLUMN` on the old `PillarAnalysis` before the rebuild.

- [ ] **Step 3: Apply + regenerate.**
Run: `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate`
Expected: applied; client regenerated.

- [ ] **Step 4: Extend types.** `lib/findings/types.ts`: `CrawlPageInput` += `inlinks?: number | null`, `outlinks?: number | null`; `CrawlRunInput` += `seoIntent?: boolean`. `lib/findings/writer.ts`: `writeFindingsRun` writes `seoIntent: input.seoIntent ?? false` on the `CrawlRun` create.

- [ ] **Step 5: Typecheck.**
Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add prisma lib/findings/types.ts lib/findings/writer.ts
git commit -m "feat(schema): graph scalars, durable CrawlRun.seoIntent, PillarAnalysis decouple"
```

---

## Task 2: Pure link-graph computation

**Files:** Create `lib/ada-audit/seo/link-graph.ts`; Test `lib/ada-audit/seo/link-graph.test.ts`

**Interfaces:**
```ts
export interface LinkGraphRow { inlinks: number; outlinks: number; crawlDepth: number | null }
export interface LinkGraphResult { byUrl: Map<string, LinkGraphRow>; depthAvailable: boolean }
export function computeLinkGraph(
  rows: { sourcePageUrl: string; targetUrl: string; kind: string }[],
  auditedUrls: string[],
  homepageUrl: string | null,
): LinkGraphResult
```
Rules: only `kind === 'internal-link'`; normalize every URL via `normalizeFindingUrl`; **both source and target must be in `auditedUrls`** to count (Codex #2); `inlinks` = distinct normalized sources per target; `outlinks` = distinct normalized targets per source; `crawlDepth` = visited-guarded BFS hops from `homepageUrl`; unreachable → `null`; homepage null/not-audited → `depthAvailable=false`, all depths `null`.

- [ ] **Step 1: Write the failing test** (`lib/ada-audit/seo/link-graph.test.ts`):
```ts
import { describe, it, expect } from 'vitest'
import { computeLinkGraph } from './link-graph'
const A='https://x.test/', B='https://x.test/b', C='https://x.test/c', D='https://x.test/d'
describe('computeLinkGraph', () => {
  it('counts distinct inlinks/outlinks over audited internal links only', () => {
    const rows = [
      { sourcePageUrl: A, targetUrl: B, kind: 'internal-link' },
      { sourcePageUrl: A, targetUrl: B, kind: 'internal-link' },
      { sourcePageUrl: C, targetUrl: B, kind: 'internal-link' },
      { sourcePageUrl: A, targetUrl: 'https://ext.test/', kind: 'external-link' },
      { sourcePageUrl: A, targetUrl: C, kind: 'image' },
    ]
    const g = computeLinkGraph(rows, [A, B, C], A)
    expect(g.byUrl.get(B)!.inlinks).toBe(2)
    expect(g.byUrl.get(A)!.outlinks).toBe(1)
    expect(g.byUrl.get(B)!.outlinks).toBe(0)
  })
  it('BFS depth from homepage; null unreachable', () => {
    const rows = [
      { sourcePageUrl: A, targetUrl: B, kind: 'internal-link' },
      { sourcePageUrl: B, targetUrl: C, kind: 'internal-link' },
    ]
    const g = computeLinkGraph(rows, [A, B, C, D], A)
    expect(g.depthAvailable).toBe(true)
    expect(g.byUrl.get(A)!.crawlDepth).toBe(0)
    expect(g.byUrl.get(C)!.crawlDepth).toBe(2)
    expect(g.byUrl.get(D)!.crawlDepth).toBeNull()
  })
  it('cycles terminate; homepage missing → depthUnavailable', () => {
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

- [ ] **Step 2: Run; verify FAIL.** `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/link-graph.test.ts`

- [ ] **Step 3: Implement** `lib/ada-audit/seo/link-graph.ts`:
```ts
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'
export interface LinkGraphRow { inlinks: number; outlinks: number; crawlDepth: number | null }
export interface LinkGraphResult { byUrl: Map<string, LinkGraphRow>; depthAvailable: boolean }
export function computeLinkGraph(
  rows: { sourcePageUrl: string; targetUrl: string; kind: string }[],
  auditedUrls: string[], homepageUrl: string | null,
): LinkGraphResult {
  const audited = new Set(auditedUrls.map(normalizeFindingUrl))
  const inSets = new Map<string, Set<string>>(), outSets = new Map<string, Set<string>>()
  const adj = new Map<string, Set<string>>()
  for (const r of rows) {
    if (r.kind !== 'internal-link') continue
    const s = normalizeFindingUrl(r.sourcePageUrl), t = normalizeFindingUrl(r.targetUrl)
    if (!audited.has(s) || !audited.has(t)) continue
    ;(inSets.get(t) ?? inSets.set(t, new Set()).get(t)!).add(s)
    ;(outSets.get(s) ?? outSets.set(s, new Set()).get(s)!).add(t)
    ;(adj.get(s) ?? adj.set(s, new Set()).get(s)!).add(t)
  }
  const home = homepageUrl ? normalizeFindingUrl(homepageUrl) : null
  const depthAvailable = !!home && audited.has(home)
  const depth = new Map<string, number>()
  if (depthAvailable) {
    const q = [home!]; depth.set(home!, 0)
    while (q.length) {
      const cur = q.shift()!, d = depth.get(cur)!
      for (const nxt of adj.get(cur) ?? []) if (!depth.has(nxt)) { depth.set(nxt, d + 1); q.push(nxt) }
    }
  }
  const byUrl = new Map<string, LinkGraphRow>()
  for (const url of audited) byUrl.set(url, {
    inlinks: inSets.get(url)?.size ?? 0, outlinks: outSets.get(url)?.size ?? 0,
    crawlDepth: depthAvailable ? (depth.get(url) ?? null) : null,
  })
  return { byUrl, depthAvailable }
}
```

- [ ] **Step 4: Run; verify PASS.** (3 tests)
- [ ] **Step 5: Commit.** `git add lib/ada-audit/seo/link-graph.ts lib/ada-audit/seo/link-graph.test.ts && git commit -m "feat(seo): pure link-graph computation"`

---

## Task 3: Wire the graph into the live-scan builder

**Files:** Modify `lib/jobs/handlers/broken-link-verify.ts` (~64 onward); Test `lib/jobs/handlers/broken-link-verify.graph.test.ts`

**Interfaces:** Consumes `computeLinkGraph`. The real builder variables are `site` (the SiteAudit; use `site.domain ?? job.domain`), `rows` (raw HarvestedLink), `seoRows` (HarvestedPageSeo), `ensurePage(url, scalars?)`, `indexableOf(r)` (all confirmed present). Produces live-scan `CrawlPage` rows carrying `inlinks/outlinks/crawlDepth`, and `CrawlRun.seoIntent = site.seoIntent`.

- [ ] **Step 1: Write the failing test** — seed a complete `SiteAudit` (`seoIntent: true`) + `HarvestedPageSeo` for `A`,`B` + `HarvestedLink` (`A→B internal-link`); run the builder; assert the live-scan `CrawlPage` for `B` has `inlinks=1`, `A` has `outlinks=1`, depth set (homepage `A` audited), and the `CrawlRun.seoIntent === true`. Follow the existing builder test setup/cleanup (unique domain; clean `CrawlRun` by domain before origin rows).

- [ ] **Step 2: Run; verify FAIL.** `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.graph.test.ts`

- [ ] **Step 3: Implement.** Independent of the `toCheck` verification map, before the transient rows are deleted (Codex #2 wording): compute the graph from raw `rows`, restricting audited URLs to `seoRows`. Add a local `pickHomepage(urls, domain)` = normalized `https://<domain>/` if in the normalized audited set, else the shallowest-path audited URL, else `null`.
```ts
const auditedUrls = seoRows.map((r) => r.url)
const homepageUrl = pickHomepage(auditedUrls, site.domain ?? job.domain)
let graph: ReturnType<typeof computeLinkGraph> | null = null
try {
  graph = computeLinkGraph(
    rows.map((r) => ({ sourcePageUrl: r.sourcePageUrl, targetUrl: r.targetUrl, kind: r.kind })),
    auditedUrls, homepageUrl,
  )
} catch (e) { console.error('[live-seo] graph compute failed', e) } // best-effort
```
In the on-page `ensurePage(r.url, {...})` call, merge: `inlinks: graph?.byUrl.get(normalizeFindingUrl(r.url))?.inlinks ?? null`, same for `outlinks`, `crawlDepth`. Pass `seoIntent: site.seoIntent` into the `writeFindingsRun` input for this run.

- [ ] **Step 4: Run; verify PASS.**
- [ ] **Step 5: Commit.** `git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.graph.test.ts && git commit -m "feat(seo): populate link-graph scalars + run seoIntent in the builder"`

---

## Task 4: Thread `seoIntent`; coexisting ADA+SEO schedules (D1)

**Files:** Modify `lib/ada-audit/queue-request.ts`, `queue-manager.ts`, `app/api/site-audit/route.ts`, `lib/jobs/handlers/scheduled-site-audit.ts`, `app/api/clients/[id]/schedules/route.ts`; Test `lib/ada-audit/queue-request.test.ts` + a schedules-route test.

**Interfaces:** `QueueRequestInput.seoIntent?: boolean` → `SiteAudit.seoIntent`. `ScheduledSiteAuditPayload.seoIntent?: boolean`. Schedules uniqueness key becomes `(clientId, domain, seoIntent)`.

- [ ] **Step 1: Write failing tests** — (a) `queueSiteAuditRequest({..., seoIntent:true})` sets `SiteAudit.seoIntent=true` (default false); (b) creating an SEO schedule (`seoIntent:true`) for a `(client,domain)` that already has an ADA schedule succeeds (coexist), while a duplicate same-intent schedule is rejected.

- [ ] **Step 2: Run; verify FAIL.**

- [ ] **Step 3: Implement.**
  - `QueueRequestInput` += `seoIntent?: boolean`; pass through `enqueueAudit(..., { ..., seoIntent })`; in the `SiteAudit` create add `seoIntent: opts.seoIntent ?? false`.
  - `app/api/site-audit/route.ts`: read `body.seoIntent === true`, pass to `queueSiteAuditRequest` (this is the on-demand "Run SEO scan" trigger).
  - `scheduled-site-audit.ts`: `ScheduledSiteAuditPayload` += `seoIntent?: boolean`; pass `seoIntent: p.seoIntent ?? false`.
  - `app/api/clients/[id]/schedules/route.ts`: accept `seoIntent`, store in payload; change the "one schedule per (client,domain)" guard to key on `(client, domain, seoIntent)` — the guard already loads candidate schedules and parses `payload` in JS, so a payload field (not a column) is sufficient. Also update `getClientSchedules()` to parse + return `seoIntent`, and the `ScheduledScansCard` UI to distinguish ADA vs SEO schedules (Codex delta-fix #7).

- [ ] **Step 4: Run; verify PASS.**
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(seo): seoIntent threading + coexisting ADA/SEO schedules"`

---

## Task 5: Canonical selector (pure + bulk; no N+1) (Codex #5/#6)

**Files:** Create `lib/services/seo-canonical.ts`; Test `lib/services/seo-canonical.test.ts`

**Interfaces:**
```ts
export const SEO_SF_CANONICAL_WINDOW_DAYS = Number(process.env.SEO_SF_CANONICAL_WINDOW_DAYS ?? 30)
export interface SeoRunRef {
  id: string; source: string; seoIntent: boolean; domain: string | null
  completedAt: Date | null; createdAt: Date; sessionId: string | null; siteAuditId: string | null
}
export type CanonicalSeo = { run: SeoRunRef; source: 'sf-upload' | 'live-scan' } | null
// PURE — operate over already-loaded runs (use in fleet/dashboard loops without per-row DB hits):
export function pickCanonicalSeo(runs: SeoRunRef[], nowMs: number, windowDays?: number): CanonicalSeo
// Convenience DB wrapper for single-context callers ONLY (not loops):
export async function selectCanonicalSeoRun(args: { clientId: number; domain: string }): Promise<CanonicalSeo>
```
Rule (spec §4.3): consider only `source==='sf-upload'` OR (`source==='live-scan'` AND `seoIntent===true`). `sf`=newest sf-upload, `live`=newest qualifying live. Fresh SF (`ageDays(sf) ≤ window`) wins; else newer live supersedes; else SF; else live. Domain compared via `normaliseSiteAuditDomain` (there is NO `normalizeDomain`).

- [ ] **Step 1: Write failing test** (`lib/services/seo-canonical.test.ts`) covering: fresh-SF-wins, stale-SF+newer-live→live, no-SF→live, stale-SF+no-live→SF, **per-domain isolation on a multi-domain client**, a live run with `seoIntent=false` is IGNORED, empty→null. (Use the pure `pickCanonicalSeo`.)

- [ ] **Step 2: Run; verify FAIL.**

- [ ] **Step 3: Implement** `pickCanonicalSeo` (pure, as in the prior draft but gated on `seoIntent` for live) + `selectCanonicalSeoRun` that `prisma.crawlRun.findMany({ where: { clientId, tool:'seo-parser', domain: normaliseSiteAuditDomain(domain), OR: [{ source:'sf-upload' }, { source:'live-scan', seoIntent:true }] }, select: { id,source,seoIntent,domain,completedAt,createdAt,sessionId,siteAuditId } })` then `pickCanonicalSeo(rows, Date.now())`.
```ts
const ageDays = (r: SeoRunRef, n: number) => r.completedAt ? (n - r.completedAt.getTime())/86_400_000 : Infinity
const newest = (rs: SeoRunRef[], pred: (r: SeoRunRef)=>boolean) =>
  rs.filter(pred).sort((a,b)=>(b.completedAt?.getTime()??0)-(a.completedAt?.getTime()??0))[0] ?? null
export function pickCanonicalSeo(runs: SeoRunRef[], nowMs: number, windowDays = SEO_SF_CANONICAL_WINDOW_DAYS): CanonicalSeo {
  const sf = newest(runs, r => r.source==='sf-upload')
  const live = newest(runs, r => r.source==='live-scan' && r.seoIntent)
  if (sf && ageDays(sf, nowMs) <= windowDays) return { run: sf, source: 'sf-upload' }
  if (live && (!sf || (live.completedAt?.getTime()??0) > (sf.completedAt?.getTime()??0))) return { run: live, source: 'live-scan' }
  if (sf) return { run: sf, source: 'sf-upload' }
  if (live) return { run: live, source: 'live-scan' }
  return null
}
```

- [ ] **Step 4: Run; verify PASS.**
- [ ] **Step 5: Commit.** `git add lib/services/seo-canonical.ts lib/services/seo-canonical.test.ts && git commit -m "feat(seo): pure+bulk canonical SF-vs-live selector (30d, seoIntent-gated)"`

---

## Task 6: CrawlRun-native results route + `loadRunSeoResult` (Codex #3)

**Files:** Create `app/seo-parser/results/run/[runId]/page.tsx`; Modify `lib/findings/seo-findings-fallback.ts` (add `loadRunSeoResult`); Modify `components/.../ResultsView` + `PagesTable` to accept a run-keyed source; add a run-keyed pages API or branch in `/api/seo-parser/[sessionId]/pages`. Test: a loader test.

**Interfaces:** `buildSeoResultFromRun(run, pages, findings, origin)` already exists (4 args). Add `export async function loadRunSeoResult(runId: string): Promise<AggregatedResult | null>` that loads the run + its `CrawlPage`/`Finding` rows and calls `buildSeoResultFromRun`.

- [ ] **Step 1: Write failing test** — seed a live-scan run (+CrawlPage/Finding); `loadRunSeoResult(run.id)` returns a non-null `AggregatedResult` with score from `CrawlRun.score`.
- [ ] **Step 2: Run; verify FAIL.** `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/seo-findings-fallback`
- [ ] **Step 3: Implement** `loadRunSeoResult` (mirror `loadArchivedSeoResult`'s data loading, keyed by `runId`, `tool:'seo-parser'`). Add `app/seo-parser/results/run/[runId]/page.tsx` rendering the existing `ResultsView` with `source:'live-scan'` + `SeoSourceBadge` (Task 8). For the SF-only surfaces (export/share/diff per D4) render the `NeedsScreamingFrog` state (Task 8). Provide a run-keyed pages path for `PagesTable`.
- [ ] **Step 4: Run; verify PASS.**
- [ ] **Step 5: Commit.** `git add app/seo-parser/results/run lib/findings/seo-findings-fallback.ts components && git commit -m "feat(seo): CrawlRun-native results route + loadRunSeoResult"`

---

## Task 7: Merged source-labeled history + consumers (Codex #4)

**Files:** Modify `app/api/parse/history/route.ts`, `components/seo-parser/HistoryList.tsx`, the diff page; Test `app/api/parse/history/route.test.ts`.

**Interfaces:** Entries gain `{ kind: 'session' | 'run', source: 'sf-upload' | 'live-scan' }`. Run entries link to `/seo-parser/results/run/<id>`. Filter live runs on the run's own `seoIntent` (durable), NOT `siteAudit:{}`.

- [ ] **Step 1: Write failing test** — seed one SF `Session` (+crawlRun.score) and one `seoIntent` live-scan run; assert both appear, source-labeled, newest-first; an `seoIntent=false` live run is EXCLUDED.
- [ ] **Step 2: Run; verify FAIL.**
- [ ] **Step 3: Implement.** Keep the `Session.findMany` (label `kind:'session'`, `source:'sf-upload'`). Add `prisma.crawlRun.findMany({ where: { tool:'seo-parser', source:'live-scan', seoIntent:true }, take:50, orderBy:{createdAt:'desc'}, select:{ id,createdAt,score,domain,pagesTotal,clientId, client:{select:{id,name}} } })`; map to unified entries; concat; sort desc; slice 50. Update `HistoryList.tsx`: route `kind:'run'` items to `/seo-parser/results/run/${id}`, render the source badge, and handle delete for runs (delete the SiteAudit/run, not `/api/parse/${id}`) or hide delete for runs in v1. Filter the diff page to SF/session entries only (D4).
- [ ] **Step 4: Run; verify PASS.**
- [ ] **Step 5: Commit.** `git add app/api/parse/history components/seo-parser/HistoryList.tsx && git commit -m "feat(seo): merge live runs into history + update consumers"`

---

## Task 8: Source badge + "needs Screaming Frog" state

**Files:** Create `components/seo/SeoSourceBadge.tsx` (+ pure `seoSourceLabel`, + `NeedsScreamingFrog`); Test `components/seo/SeoSourceBadge.test.tsx`.

- [ ] **Step 1: Write failing test** — `seoSourceLabel('live-scan')` returns the caveat string; `seoSourceLabel('sf-upload')` returns "Screaming Frog".
- [ ] **Step 2: Run; verify FAIL.**
- [ ] **Step 3: Implement** the pure helper + the two components (Tailwind + `dark:` variants). `NeedsScreamingFrog({feature})` renders the D4 message for export/share/diff/report controls.
- [ ] **Step 4: Run; verify PASS.**
- [ ] **Step 5: Commit.** `git add components/seo/SeoSourceBadge.tsx components/seo/SeoSourceBadge.test.tsx && git commit -m "feat(seo): source badge + needs-Screaming-Frog state"`

---

## Task 9: Adopt the canonical selector across SEO score surfaces (Codex #6)

**Files (named, not grep-only):** `client-dashboard`, `client-fleet`, `client-findings`, `scorecard-shared`, `findings-shared`, `buildSeoSeries`, plus `HistoryList`/diff (done in Task 7). Tests: extend each surface's test.

**Interfaces:** Consume `pickCanonicalSeo` over already-loaded `crawlRuns` (these services already bulk-load runs — feed them in, no per-row DB call). `buildSeoSeries` currently carries only `sessionId` → extend its point shape to also carry `crawlRunId`/`source` so live points get `/results/run/<id>` hrefs. Keep `selectRuns().seo.liveScan` ONLY for the additive B2 broken-links/on-page panel (no double-count).

- [ ] **Step 1: Confirm the surface set.** Run `grep -rn "selectRuns\|\.seo\.current\|source !== 'live-scan'\|buildSeoSeries" lib app components | grep -v test` and reconcile against the named list above; add any extra hit found.
- [ ] **Step 2: Write/adjust failing tests** — a client/domain with only a fresh `seoIntent` live run now reports the live score on each surface; a fresh SF upload still wins; multi-domain stays per-domain.
- [ ] **Step 3: Run; verify FAIL.**
- [ ] **Step 4: Implement** — replace SEO-score selection with `pickCanonicalSeo` over the loaded runs; thread `source` for labels; extend `buildSeoSeries` point shape. Leave `pruneArchivedBlobs` tool-origin-awareness untouched.
- [ ] **Step 5: Run; verify PASS + `npx tsc --noEmit`.**
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(seo): adopt canonical selector across score surfaces"`

---

## Task 10: Canonical page-facts provider + SF facts persistence (D2, Codex #7)

**Files:** Create `lib/services/canonical-page-facts.ts` (+test); Modify the SF persistence seam (Codex delta-fix #6): `lib/types/index.ts` (`PageIndexEntry` += `inlinks/outlinks`), `lib/services/aggregator.service.ts` (carry `inlinks/outlinks` from `per_url_index` into `page_index`), `lib/findings/seo-mapper.ts` (persist them onto `CrawlPage`). NOTE: `seo-mapper` only sees `AggregatedResult.page_index`, so the fields must be widened upstream first — `seo-mapper` cannot read `parsePerUrlForPillar()` directly.

**Interfaces:**
```ts
export interface CanonicalPageFact {
  url: string; title?: string | null; h1?: string | null; metaDescription?: string | null
  wordCount?: number | null; crawlDepth?: number | null; inlinks?: number | null; outlinks?: number | null
  indexable?: boolean | null; schemaTypes?: string[]; statusCode?: number | null; indexability?: string | null
}
export interface CanonicalPageFacts { source: 'sf-upload' | 'live-scan'; pages: CanonicalPageFact[] }
export async function getCanonicalPageFacts(args: { clientId: number; domain: string }): Promise<CanonicalPageFacts | null>
```

- [ ] **Step 1: SF persistence first (upstream seam).** Widen `PageIndexEntry` (`lib/types/index.ts`) with `inlinks?: number | null` / `outlinks?: number | null`; in `aggregator.service.ts` copy those from `per_url_index` (which `InternalParser.parse()` already populates) into each `page_index` entry; in `seo-mapper.ts` map them onto the `CrawlPageInput`. Write a test asserting an SF parse persists `CrawlPage.inlinks/outlinks` (D2 — durable; provider then always reads normalized tables).
- [ ] **Step 2: Write the provider failing test** — seed a `seoIntent` live run (CrawlPage with inlinks/crawlDepth) → `getCanonicalPageFacts` returns `source:'live-scan'` + facts; add a fresh SF run for the same client/domain → flips to `source:'sf-upload'`.
- [ ] **Step 3: Run; verify FAIL.**
- [ ] **Step 4: Implement** — resolve canonical via `selectCanonicalSeoRun`; load `CrawlPage` rows for that run id and map scalars; OMIT fields the source can't supply (never fake). `schemaTypes` is not a CrawlPage scalar → omit on the live branch.
- [ ] **Step 5: Run; verify PASS.**
- [ ] **Step 6: Commit.** `git add lib/services/canonical-page-facts.ts lib/findings/seo-mapper.ts && git commit -m "feat(seo): canonical page-facts provider + persist SF inlinks/outlinks"`

---

## Task 11: Pillar analysis from canonical facts + live read/memo surfaces (D3, Codex delta-fix #4/#5)

**Files:** Modify `lib/services/pillarAnalysis/runFromSession.ts` (source-loading seam) + add `runForCanonical({ clientId, domain })`; persist a `PillarAnalysis` keyed by `crawlRunId`; **add the live READ/memo surfaces** so a persisted live pillar is actually usable: make `buildNarrativePayload` accept an analysis (not require `sessionId`/`session.siteName` — fall back to `domain`); ensure `/api/pillar-analysis/[id]` works without a `session`; add an analysis-id (or run) keyed poll path alongside `MemoPoller`'s `/api/pillar-analysis/by-session/:sessionId`; update dashboard/fleet/quarter pillar lookups that currently find pillars via `session`. `joinRecords.ts` stays a PURE join over `RawUrlData[]`. Test: `runForCanonical` + persistence + the analysis-keyed read path.

**Scope note (Codex delta-fix #5):** this delivers the **pillar (pat_) memo** for live runs. The **`srt_` SEO-roadmap and `krt_` keyword memos are NOT in scope** (still `sessionId @unique` models) — leave them session-bound/SF-only in v1; do not claim otherwise.

- [ ] **Step 1: Write failing tests** — (a) `runForCanonical` for a live-only client/domain produces pillar records (inlinks/crawlDepth present) and persists a `PillarAnalysis` with `crawlRunId` set, `sessionId` null; (b) the analysis-keyed read/payload path returns the narrative payload for that record without a `Session`.
- [ ] **Step 2: Run; verify FAIL.**
- [ ] **Step 3: Implement** — `runForCanonical` calls `getCanonicalPageFacts`, maps each `CanonicalPageFact` → the `RawUrlData` shape `joinRecords` expects (`url,title,h1,metaDescription,firstParagraph?,wordCount,crawlDepth,inlinks,outlinks,indexable,schemaTypes?`), runs the existing pure pipeline, persists via a P2002-guarded create keyed by `crawlRunId`. Refactor `buildNarrativePayload` + the pillar read route + poller + dashboard/fleet/quarter lookups to be analysis-id based (with a `domain` fallback where `session.siteName` was used). The SF/session path (`runFromSession`) stays unchanged.
- [ ] **Step 4: Run; verify PASS.**
- [ ] **Step 5: Commit.** `git add lib/services/pillarAnalysis app/api/pillar-analysis components && git commit -m "feat(seo): live pillar analysis (persisted) + analysis-keyed read/memo surfaces"`

---

## Task 12: Brief from canonical facts (provider-fed, no persistence) (D3, Codex delta-fix #8)

**Files:** Modify `lib/services/brief.service.ts` (add a provider-fed entry); add a run/client/domain-keyed brief route alongside `POST /api/brief/[sessionId]`. Test: brief from provider facts.

**Interfaces:** `brief.service.ts` already exposes a PURE `generateBrief(clientName, pages, schemaData, keywords)` — so the live path needs **no persistence**, just a provider-fed `pages` builder. Map `CanonicalPageFact` → brief's `Page` `{ url, title, statusCode, indexability, wordCount, inlinks, h1, metaDesc }`: `indexability = indexable===true ? 'Indexable' : 'Non-Indexable'`; `metaDesc = metaDescription ?? ''`; `title = title ?? ''`; numeric nulls → 0 (0 inlinks = orphan). **Degrade explicitly** (Codex delta-fix #8): live facts carry NO SEMrush `keywords` and NO persisted `schemaData` → pass empty/degraded for those sections and label them unavailable.

- [ ] **Step 1: Write failing test** — `buildBriefFromCanonical({ clientId, domain })` builds programs + orphan list from provider-sourced live pages (program sort by inlinks; orphan = inlinks===0); keyword/schema sections degrade cleanly.
- [ ] **Step 2: Run; verify FAIL.**
- [ ] **Step 3: Implement** — `buildBriefFromCanonical` pulls `getCanonicalPageFacts`, maps to `Page[]`, calls the pure `generateBrief(clientName, pages, [], [])` (degraded schema/keywords). Add a route keyed by run/client/domain that does NOT read a Session upload dir. Keep the CSV/session path unchanged.
- [ ] **Step 4: Run; verify PASS.**
- [ ] **Step 5: Commit.** `git add lib/services/brief.service.ts app/api/brief && git commit -m "feat(seo): provider-fed brief (live, degraded keywords/schema)"`

---

## Task 13 (OPTIONAL): Retention — preserve the SiteAudit results-view for live SEO (Codex delta-fix #10)

**Files:** Modify `lib/ada-audit/scheduled-retention.ts`; Test extend.

**Interfaces:** Durable `CrawlRun.seoIntent` (Task 1) already makes canonical/history/score SURVIVE `SiteAudit` retention `SetNull` — so this task is NOT needed for canonical/history correctness. Keep it ONLY to preserve the SiteAudit ORIGIN (the ADA results view + screenshots) for the latest live SEO scans: keep the latest ≥2 completed `seoIntent` audits per `(scheduleId, domain)`. If Kevin doesn't care about retaining the audit-origin view, SKIP this task.

- [ ] **Step 1: Write failing test** — a schedule with 4 completed `seoIntent` audits past the cutoff retains the latest 2 per domain; their live-scan `CrawlRun`s survive (SetNull) and remain `seoIntent=true` (durable, queryable post-deletion).
- [ ] **Step 2: Run; verify FAIL.**
- [ ] **Step 3: Implement** — extend the "keep" query so SEO schedules group keep-latest-2 by `(scheduleId, domain)`. Non-SEO behavior unchanged. (No reliance on `SiteAudit.seoIntent` after deletion — selectors use `CrawlRun.seoIntent`.)
- [ ] **Step 4: Run; verify PASS.**
- [ ] **Step 5: Commit.** `git add lib/ada-audit/scheduled-retention.ts && git commit -m "feat(seo): retention keeps latest 2 live-SEO audits per client+domain"`

---

## Task 14: Depth-guard test (Codex #12 — include tsc)

**Files:** Test `lib/findings/live-seo-score.test.ts`.

- [ ] **Step 1: Write the test:**
```ts
it('live score excludes crawl depth (v1 guard)', () => {
  const base = { attempted:10, observed:10, indexableScored:10, pagesError:0,
    missingTitle:0, missingMeta:0, missingH1:0, thin:0, pagesWithSchema:10 }
  expect(scoreLiveSeo(base)).toBe(scoreLiveSeo({ ...base }))
  // @ts-expect-error — depth is intentionally NOT part of LiveScoreInputs
  expect(scoreLiveSeo({ ...base, crawlDepth: 3 })).toBe(scoreLiveSeo(base))
})
```
- [ ] **Step 2: Run vitest + tsc.** `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/live-seo-score.test.ts && npx tsc --noEmit`
Expected: PASS; the `@ts-expect-error` is satisfied (no depth field).
- [ ] **Step 3: Commit.** `git add lib/findings/live-seo-score.test.ts && git commit -m "test(seo): guard live score excludes crawl depth"`

---

## Task 15: Breadcrumbs + tracker + final gate

**Files:** comments at the SEO-intent enqueue sites + `broken-link-verify.ts`; tracker + handoff docs.

- [ ] **Step 1: Breadcrumb comment** at the enqueue site(s):
```ts
// FUTURE (efficiency): scheduled/on-demand SEO scans currently run the FULL ADA
// site-audit pipeline (axe + screenshots + PSI) and reuse its live-scan run.
// A dedicated SEO-only scan mode (skip axe/screenshots/PSI) is the planned
// optimization — see docs/superpowers/specs/2026-06-30-autonomous-live-seo-source-design.md §9.
```
- [ ] **Step 2: Tracker line** — add the new C6 phase (autonomous live SEO source + native link graph) to `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`, referencing spec/plan paths + the SEO-only-mode breadcrumb; rewrite `HANDOFF-improvement-roadmap.md` per the handoff protocol.
- [ ] **Step 3: Full gate.** `npx tsc --noEmit && DATABASE_URL="file:./local-dev.db" npx vitest run && npm run build`
Expected: tsc clean; all tests pass; build succeeds.
- [ ] **Step 4: Commit.** `git add -A && git commit -m "docs(seo): breadcrumbs + tracker for autonomous live SEO source"`

---

## Self-Review (completed)
- **Spec coverage:** §3 scan-model → Task 4/15; canonical/30d → Task 5/9; surfacing → Task 6/7/8; crawl-depth approx → Task 2/3; §4.2 graph-from-raw → Task 2/3; §4.3 domain-scoped selector → Task 5; §4.4 CrawlRun-native → Task 6/7; §4.5 provider+pillar/brief → Task 10/11/12; §6 depth-guard → Task 14; §7 surfaces → Task 9; §7a retention → Task 13; §8 schema → Task 1. Decisions D1→Task 4, D2→Task 10, D3→Task 1/11/12, D4→Task 6/8. All covered.
- **Placeholders:** none. Task 9 has a named surface list + grep as a safety net.
- **Type consistency:** `pickCanonicalSeo`/`selectCanonicalSeoRun`/`SeoRunRef` (with `seoIntent`), `computeLinkGraph`/`LinkGraphResult`, `CanonicalPageFact(s)`/`getCanonicalPageFacts`, `loadRunSeoResult`, `CrawlRun.seoIntent`, `CrawlPageInput.inlinks/outlinks` consistent.

## Risks / open verification (for executor)
- `PillarAnalysis` UNIQUE-drop requires a SQLite table-rebuild migration — copy a prior rebuild-pattern migration; verify the `Session.pillarAnalyses` + `SeoRoadmap`/`KeywordResearchSession` relations still compile.
- Task 9 surface list is named but `grep` confirms completeness; a missed surface silently drops the live score there.
- `pickHomepage` heuristic — verify against a real audited set; depth stays labeled approximate.
- Memo handoffs (srt_/krt_/pat_) over live runs depend on Task 11/12 persistence — smoke-test one live memo end-to-end before closing the phase.
