# Reachability Graph (roadmap 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute the live-scan link reachability graph over the *full discovered node set* (not just the audited/fetched pages), producing truer per-page inlinks/outlinks/clicks-from-home plus orphan/depth/unreachable metrics surfaced as `CrawlRun.reachabilityJson` run metadata and a `ReachabilitySection` UI block.

**Architecture:** `computeLinkGraph` is refactored to take the full node set + all internal-link edges + the exact homepage + the indexable set, returning per-node scalars (as today) plus a graph-level `ReachabilitySummary`. The live-scan run builder (`broken-link-verify.ts`) already loads every `HarvestedLink` edge and `SiteAudit.discoveredUrls`, so it passes them straight in — zero new fetches — writes the truer scalars onto its existing `CrawlPage` rows and attaches the summary JSON to the run. A read-time `ReachabilitySection` renders it, mirroring `DiscoveryCoverageSection`.

**Tech Stack:** TypeScript, Next.js 15 App Router, Prisma + SQLite, vitest, React + Tailwind (class dark mode).

## Global Constraints

- **NO score change** — `scoreLiveSeo` is untouched; crawlDepth/orphans never enter the denominator (deliberate exclusion at `lib/findings/live-seo-score.ts:90`).
- **NO orphan Finding** — reachability is run metadata only (avoids the `priority.service` count-0 landmine, scale 1.0). Same rule as `discoveryCoverageJson`.
- **Zero new fetches; no change to the audited page set; no SF-upload path change** (SF uses `seo-mapper.ts`, untouched).
- **Runs for every live-scan run**, not seoIntent-gated — the finalizer enqueues `broken-link-verify` for every completed site audit; `seoIntent` only enriches the node set via hybrid discovery.
- **Array-form `prisma.$transaction([...])` only** — never interactive. (No new transactions expected here; `writeFindingsRun` already handles persistence.)
- **No `.toString()`-injected code** — the graph is raw compute; no SWC-helper / `Class.name` runtime-name concern.
- **Additive-nullable migration only** — `prisma migrate deploy` auto-applies on deploy; author SQL by hand (`migrate dev` is interactive-only here) and apply locally with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … prisma generate`.
- **Gate commands:** `npm run lint` (tsc --noEmit) · `DATABASE_URL="file:./local-dev.db" npm test` (vitest run) · `npm run build`.

---

### Task 1: Schema column + `CrawlRunInput` field for `reachabilityJson`

**Files:**
- Modify: `prisma/schema.prisma` (CrawlRun model, after `discoveryCoverageJson` at line ~373)
- Create: `prisma/migrations/20260706120000_reachability_graph/migration.sql`
- Modify: `lib/findings/types.ts:44` (add field to `CrawlRunInput`)
- Create: `lib/findings/writer.reachability.test.ts` (round-trip — mirrors `writer.discovery-coverage.test.ts`)

**Interfaces:**
- Produces: `CrawlRun.reachabilityJson: string | null` column; `CrawlRunInput.reachabilityJson?: string | null` field consumed by Task 3.

- [ ] **Step 1: Write the failing writer round-trip test**

`writeFindingsRun` enforces an exactly-one-origin guard (`writer.ts:38`), so the run MUST carry a real `siteAuditId` — a null-origin run fails before `reachabilityJson` is exercised (Codex plan-review #1). Mirror `lib/findings/writer.discovery-coverage.test.ts` exactly. Create `lib/findings/writer.reachability.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { writeFindingsRun } from './writer'
import type { CrawlRunInput } from './types'

function baseRun(siteAuditId: string): CrawlRunInput {
  return {
    id: randomUUID(), tool: 'seo-parser', source: 'live-scan', domain: 'example.com',
    clientId: null, sessionId: null, siteAuditId, adaAuditId: null, status: 'complete',
    score: null, scoreBreakdown: null, wcagLevel: null, pagesTotal: 0,
    startedAt: null, completedAt: null,
  }
}

describe('writeFindingsRun persists reachabilityJson', () => {
  let siteAuditId: string
  beforeEach(async () => {
    const audit = await prisma.siteAudit.create({
      data: { domain: 'example.com', status: 'complete', wcagLevel: 'wcag21aa' },
    })
    siteAuditId = audit.id
  })

  it('round-trips the reachabilityJson column', async () => {
    const json = JSON.stringify({ v: 1, orphanCount: 3 })
    await writeFindingsRun({
      run: { ...baseRun(siteAuditId), reachabilityJson: json },
      pages: [], findings: [], violations: [],
    })
    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      select: { reachabilityJson: true },
    })
    expect(run?.reachabilityJson).toBe(json)
  })

  it('leaves the column null when omitted', async () => {
    await writeFindingsRun({ run: baseRun(siteAuditId), pages: [], findings: [], violations: [] })
    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      select: { reachabilityJson: true },
    })
    expect(run?.reachabilityJson).toBeNull()
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/writer.reachability.test.ts`
Expected: FAIL — TS error "reachabilityJson does not exist on type CrawlRunInput" (and/or unknown column).

- [ ] **Step 3: Add the schema column**

In `prisma/schema.prisma`, immediately after the `discoveryCoverageJson` line in `model CrawlRun`:

```prisma
  reachabilityJson String?   // roadmap 3b: internal-link reachability metrics (orphans/depth/clicks-from-home); live-scan runs only; NOT a finding
```

- [ ] **Step 4: Create the migration SQL**

Create `prisma/migrations/20260706120000_reachability_graph/migration.sql`:

```sql
-- roadmap 3b reachability graph: additive, nullable run-metadata column.
ALTER TABLE "CrawlRun" ADD COLUMN "reachabilityJson" TEXT;
```

- [ ] **Step 5: Apply the migration + regenerate the client**

Run:
```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && \
DATABASE_URL="file:./local-dev.db" npx prisma generate
```
Expected: "All migrations have been successfully applied." + client regenerated.

- [ ] **Step 6: Add the `CrawlRunInput` field**

In `lib/findings/types.ts`, after line 44 (`discoveryCoverageJson?: string | null …`):

```ts
  reachabilityJson?: string | null   // roadmap 3b: reachability metrics; live-scan runs only
```

- [ ] **Step 7: Run the test — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/writer.reachability.test.ts`
Expected: PASS (both cases).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260706120000_reachability_graph lib/findings/types.ts lib/findings/writer.reachability.test.ts
git commit -m "feat(3b): add CrawlRun.reachabilityJson column + CrawlRunInput field"
```

---

### Task 2: Refactor `computeLinkGraph` to the full graph + `ReachabilitySummary`

**Files:**
- Modify: `lib/ada-audit/seo/link-graph.ts` (full rewrite of the function + new types)
- Test: `lib/ada-audit/seo/link-graph.test.ts` (rewrite — the existing 3-arg calls change)

**Interfaces:**
- Consumes: `normalizeFindingUrl` (`@/lib/findings/normalize-url`); `NON_PAGE_EXT` (exported from `@/lib/ada-audit/seo/discovery-coverage`).
- Produces:
  ```ts
  export interface ReachabilitySummary {
    nodeCount: number; indexableNodeCount: number; edgeCount: number
    homepageResolved: boolean
    orphanCount: number; orphanSample: string[]
    unreachableCount: number; unreachableSample: string[]
    depthHistogram: Record<string, number>   // keys '0','1','2','3','4plus','null'; 'null' === unreachableCount
    maxDepth: number | null
    deepSample: Array<{ url: string; depth: number }>
  }
  export interface LinkGraphResult {
    byUrl: Map<string, LinkGraphRow>; depthAvailable: boolean; summary: ReachabilitySummary
  }
  export function computeLinkGraph(
    edges: { sourcePageUrl: string; targetUrl: string; kind: string }[],
    nodes: string[], homepageUrl: string | null, indexableUrls: Set<string>,
  ): LinkGraphResult
  ```
  Task 3 calls this. `LinkGraphRow` unchanged (`{ inlinks; outlinks; crawlDepth }`).

- [ ] **Step 1: Rewrite the test file with the new signature + all cases**

Replace the entire contents of `lib/ada-audit/seo/link-graph.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeLinkGraph } from './link-graph'

const H = 'https://x.test/'            // homepage (exact)
const A = 'https://x.test/a', B = 'https://x.test/b', C = 'https://x.test/c'
const D = 'https://x.test/d', PDF = 'https://x.test/file.pdf'
const idx = (...u: string[]) => new Set(u)

describe('computeLinkGraph — full-graph reachability', () => {
  it('counts inlinks from a discovered-but-unfetched source node', () => {
    // C is a node (discovered) but not in indexable set (unfetched); its link to B still counts.
    const edges = [
      { sourcePageUrl: H, targetUrl: B, kind: 'internal-link' },
      { sourcePageUrl: C, targetUrl: B, kind: 'internal-link' },
    ]
    const g = computeLinkGraph(edges, [H, B, C], H, idx(H, B))
    expect(g.byUrl.get(B)!.inlinks).toBe(2)   // both H and C count
  })

  it('clicks-from-home depth is correct through a non-audited intermediary', () => {
    // H -> A (unfetched) -> B (fetched). B's depth must be 2, not null.
    const edges = [
      { sourcePageUrl: H, targetUrl: A, kind: 'internal-link' },
      { sourcePageUrl: A, targetUrl: B, kind: 'internal-link' },
    ]
    const g = computeLinkGraph(edges, [H, A, B], H, idx(H, B))
    expect(g.byUrl.get(B)!.crawlDepth).toBe(2)
  })

  it('orphan = indexable, non-homepage node with 0 inlinks', () => {
    const edges = [{ sourcePageUrl: H, targetUrl: A, kind: 'internal-link' }]
    // B indexable, no inlinks -> orphan. A has an inlink. H is homepage (never orphan).
    const g = computeLinkGraph(edges, [H, A, B], H, idx(H, A, B))
    expect(g.summary.orphanCount).toBe(1)
    expect(g.summary.orphanSample).toContain(B)
  })

  it('homepage with 0 inlinks is NOT an orphan (Codex #1)', () => {
    const edges = [{ sourcePageUrl: H, targetUrl: A, kind: 'internal-link' }]
    const g = computeLinkGraph(edges, [H, A], H, idx(H, A))
    expect(g.summary.orphanSample).not.toContain(H)
    expect(g.summary.orphanCount).toBe(0)   // A has an inlink; H excluded
  })

  it('edge-only / non-indexable-known node is never an orphan', () => {
    const edges = [{ sourcePageUrl: H, targetUrl: A, kind: 'internal-link' }]
    // C is a bare node with no indexability signal, 0 inlinks -> NOT orphan.
    const g = computeLinkGraph(edges, [H, A, C], H, idx(H, A))
    expect(g.summary.orphanSample).not.toContain(C)
  })

  it('unreachable = indexable node with null depth; reconciles with histogram null bucket', () => {
    const edges = [{ sourcePageUrl: H, targetUrl: A, kind: 'internal-link' }]
    const g = computeLinkGraph(edges, [H, A, B], H, idx(H, A, B))   // B unreachable
    expect(g.summary.unreachableCount).toBe(1)
    expect(g.summary.depthHistogram['null']).toBe(1)
    expect(g.summary.unreachableSample).toContain(B)
  })

  it('exact homepage absent → homepageResolved:false, all depths null, NO shallowest fallback (Codex #2)', () => {
    const edges = [{ sourcePageUrl: A, targetUrl: B, kind: 'internal-link' }]
    const g = computeLinkGraph(edges, [A, B], H, idx(A, B))   // H not among nodes
    expect(g.summary.homepageResolved).toBe(false)
    expect(g.depthAvailable).toBe(false)
    expect(g.byUrl.get(A)!.crawlDepth).toBeNull()
    expect(g.byUrl.get(B)!.crawlDepth).toBeNull()
  })

  it('excludes non-page targets from nodes and edges (Codex #3)', () => {
    const edges = [
      { sourcePageUrl: H, targetUrl: PDF, kind: 'internal-link' },
      { sourcePageUrl: H, targetUrl: A, kind: 'internal-link' },
    ]
    const g = computeLinkGraph(edges, [H, A, PDF], H, idx(H, A))
    expect(g.byUrl.has(PDF)).toBe(false)
    expect(g.byUrl.get(H)!.outlinks).toBe(1)   // PDF edge dropped
    expect(g.summary.nodeCount).toBe(2)        // H, A only
  })

  it('collapses bare-root slash variants and excludes self-links (normalizeFindingUrl semantics)', () => {
    // normalizeFindingUrl ONLY strips the trailing slash on a bare root path
    // (not www, not scheme, not non-root slashes). So 'https://x.test/' and
    // 'https://x.test' are the same node; '/a/' and '/a' would NOT be.
    const edges = [
      { sourcePageUrl: 'https://x.test/', targetUrl: A, kind: 'internal-link' },
      { sourcePageUrl: 'https://x.test', targetUrl: A, kind: 'internal-link' }, // same source node as above
      { sourcePageUrl: A, targetUrl: A, kind: 'internal-link' },               // self-link excluded
    ]
    const g = computeLinkGraph(edges, [H, A], H, idx(H, A))
    expect(g.summary.homepageResolved).toBe(true)
    expect(g.byUrl.get(A)!.inlinks).toBe(1)     // one distinct source (homepage); self-link not counted
    expect(g.summary.edgeCount).toBe(1)          // distinct home->A edge counted once (Codex #4)
  })

  it('null-bucket reconciles with unreachableCount when homepage is unresolved (Codex #3)', () => {
    const edges = [{ sourcePageUrl: A, targetUrl: B, kind: 'internal-link' }]
    const g = computeLinkGraph(edges, [A, B], null, idx(A, B))   // no homepage
    expect(g.summary.homepageResolved).toBe(false)
    expect(g.summary.depthHistogram['null']).toBe(g.summary.unreachableCount)
    expect(g.summary.unreachableCount).toBe(2)   // homepage not a node → not excluded
  })

  it('empty edges/nodes → zeroed summary, no throw', () => {
    const g = computeLinkGraph([], [], null, idx())
    expect(g.summary.nodeCount).toBe(0)
    expect(g.summary.orphanCount).toBe(0)
    expect(g.summary.maxDepth).toBeNull()
  })

  it('depthHistogram buckets ≥4 into 4plus', () => {
    const edges = [
      { sourcePageUrl: H, targetUrl: A, kind: 'internal-link' },
      { sourcePageUrl: A, targetUrl: B, kind: 'internal-link' },
      { sourcePageUrl: B, targetUrl: C, kind: 'internal-link' },
      { sourcePageUrl: C, targetUrl: D, kind: 'internal-link' },   // D at depth 4
    ]
    const g = computeLinkGraph(edges, [H, A, B, C, D], H, idx(H, A, B, C, D))
    expect(g.summary.depthHistogram['4plus']).toBe(1)
    expect(g.summary.maxDepth).toBe(4)
    expect(g.summary.deepSample.some((d) => d.url === D && d.depth === 4)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests — expect FAIL**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/link-graph.test.ts`
Expected: FAIL — 4-arg signature / `summary` not present.

- [ ] **Step 3: Rewrite `link-graph.ts`**

Replace the entire contents of `lib/ada-audit/seo/link-graph.ts`:

```ts
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'
import { NON_PAGE_EXT } from '@/lib/ada-audit/seo/discovery-coverage'

export interface LinkGraphRow { inlinks: number; outlinks: number; crawlDepth: number | null }

export interface ReachabilitySummary {
  nodeCount: number
  indexableNodeCount: number
  edgeCount: number
  homepageResolved: boolean
  orphanCount: number
  orphanSample: string[]
  unreachableCount: number
  unreachableSample: string[]
  depthHistogram: Record<string, number>
  maxDepth: number | null
  deepSample: Array<{ url: string; depth: number }>
}

export interface LinkGraphResult {
  byUrl: Map<string, LinkGraphRow>
  depthAvailable: boolean
  summary: ReachabilitySummary
}

const SAMPLE_CAP = 50
const DEEP_THRESHOLD = 4

function isNonPage(normalizedUrl: string): boolean {
  try {
    return NON_PAGE_EXT.test(new URL(normalizedUrl).pathname)
  } catch {
    return false
  }
}

/**
 * Full-graph reachability. Nodes = (discovered `nodes` ∪ edge endpoints) minus
 * non-page targets, normalized via normalizeFindingUrl (first-seen original wins,
 * reconciling with CrawlPage.url). inlinks/outlinks span the whole page graph.
 * crawlDepth = clicks-from-home BFS from the EXACT homepage (no shallowest
 * fallback). Summary (orphan/unreachable/histogram) is over the eligible set =
 * indexable page nodes, so depthHistogram['null'] === unreachableCount.
 */
export function computeLinkGraph(
  edges: { sourcePageUrl: string; targetUrl: string; kind: string }[],
  nodes: string[],
  homepageUrl: string | null,
  indexableUrls: Set<string>,
): LinkGraphResult {
  // normalized indexable set
  const indexable = new Set<string>()
  for (const u of indexableUrls) indexable.add(normalizeFindingUrl(u))

  // node map: normalized -> original (first-seen wins). Seed from `nodes`, then
  // add edge endpoints. Non-page URLs are excluded.
  const normToOrig = new Map<string, string>()
  const addNode = (u: string): string | null => {
    const n = normalizeFindingUrl(u)
    if (isNonPage(n)) return null
    if (!normToOrig.has(n)) normToOrig.set(n, u)
    return n
  }
  for (const u of nodes) addNode(u)

  const inSets = new Map<string, Set<string>>()
  const outSets = new Map<string, Set<string>>()
  const adj = new Map<string, Set<string>>()
  let edgeCount = 0
  for (const e of edges) {
    if (e.kind !== 'internal-link') continue
    const s = addNode(e.sourcePageUrl)
    const t = addNode(e.targetUrl)
    if (s == null || t == null) continue   // non-page endpoint dropped
    if (s === t) continue                  // self-link excluded
    ;(inSets.get(t) ?? inSets.set(t, new Set()).get(t)!).add(s)
    ;(outSets.get(s) ?? outSets.set(s, new Set()).get(s)!).add(t)
    const a = adj.get(s) ?? adj.set(s, new Set()).get(s)!
    if (!a.has(t)) { a.add(t); edgeCount++ }   // distinct edges only (Codex #4)
  }

  // exact-homepage BFS (no fallback)
  const home = homepageUrl ? normalizeFindingUrl(homepageUrl) : null
  const homepageResolved = !!home && normToOrig.has(home)
  const depth = new Map<string, number>()
  if (homepageResolved) {
    const q = [home!]; depth.set(home!, 0)
    while (q.length) {
      const cur = q.shift()!, d = depth.get(cur)!
      for (const nxt of adj.get(cur) ?? []) if (!depth.has(nxt)) { depth.set(nxt, d + 1); q.push(nxt) }
    }
  }

  const byUrl = new Map<string, LinkGraphRow>()
  for (const [norm, orig] of normToOrig) {
    byUrl.set(orig, {
      inlinks: inSets.get(norm)?.size ?? 0,
      outlinks: outSets.get(norm)?.size ?? 0,
      crawlDepth: homepageResolved ? (depth.get(norm) ?? null) : null,
    })
  }

  // Summary over the eligible set = indexable page nodes.
  // Invariant (Codex #3): depthHistogram['null'] === unreachableCount. Holds in
  // both cases — when homepageResolved, the home node has depth 0 (never null, so
  // never in either count); when unresolved, the home isn't a node at all, so the
  // `!isHome` guard below excludes nothing from the eligible null set.
  const eligible: string[] = []
  for (const norm of normToOrig.keys()) if (indexable.has(norm)) eligible.push(norm)

  const orphanSample: string[] = []
  const unreachableSample: string[] = []
  const deep: Array<{ url: string; depth: number }> = []
  const histogram: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4plus': 0, 'null': 0 }
  let orphanCount = 0, unreachableCount = 0, maxDepth: number | null = null

  for (const norm of eligible) {
    const orig = normToOrig.get(norm)!
    const isHome = home != null && norm === home
    const inl = inSets.get(norm)?.size ?? 0
    const d = homepageResolved ? (depth.get(norm) ?? null) : null

    if (!isHome && inl === 0) {
      orphanCount++
      if (orphanSample.length < SAMPLE_CAP) orphanSample.push(orig)
    }
    if (!isHome && d == null) {
      unreachableCount++
      if (unreachableSample.length < SAMPLE_CAP) unreachableSample.push(orig)
    }
    if (d == null) histogram['null']++
    else {
      histogram[d >= 4 ? '4plus' : String(d)]++
      if (maxDepth == null || d > maxDepth) maxDepth = d
      if (d >= DEEP_THRESHOLD) deep.push({ url: orig, depth: d })
    }
  }
  deep.sort((a, b) => b.depth - a.depth || a.url.localeCompare(b.url))

  const summary: ReachabilitySummary = {
    nodeCount: normToOrig.size,
    indexableNodeCount: eligible.length,
    edgeCount,
    homepageResolved,
    orphanCount,
    orphanSample,
    unreachableCount,
    unreachableSample,
    depthHistogram: histogram,
    maxDepth,
    deepSample: deep.slice(0, SAMPLE_CAP),
  }
  return { byUrl, depthAvailable: homepageResolved, summary }
}
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/link-graph.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/link-graph.ts lib/ada-audit/seo/link-graph.test.ts
git commit -m "feat(3b): computeLinkGraph over full discovered graph + ReachabilitySummary"
```

---

### Task 3: Wire the builder — full-graph inputs + attach `reachabilityJson`

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts` (graph call ~375-390; bundle ~476-485)
- Test: `lib/jobs/handlers/broken-link-verify.test.ts` (extend)
- Review: brief / pillar snapshots (`lib/services/brief-from-canonical.test.ts` and any pillar snapshot tests) — update as reviewed drift.

**Interfaces:**
- Consumes: `computeLinkGraph(edges, nodes, homepageUrl, indexableUrls)` + `ReachabilitySummary` (Task 2); `CrawlRunInput.reachabilityJson` (Task 1); existing `safeParseUrlList`, `normalizeFindingUrl`, `indexableOf` locals in the file.
- Produces: live-scan `CrawlRun.reachabilityJson` populated; truer `CrawlPage.inlinks/outlinks/crawlDepth`.

- [ ] **Step 1: Write the failing builder test**

Extend `lib/jobs/handlers/broken-link-verify.test.ts` (copy the harness of an existing test that seeds `HarvestedLink` + `HarvestedPageSeo` + a `SiteAudit`, runs the handler, and reads the live-scan run). Assert:

```ts
it('attaches reachabilityJson and counts inlinks from discovered-but-unfetched nodes', async () => {
  // Seed: SiteAudit with discoveredUrls including an unfetched page /ghost that links to /a;
  // HarvestedPageSeo for homepage + /a (indexable); HarvestedLink edges: home->/a, /ghost->/a.
  // ... (seed rows per the file's existing helpers) ...
  await runBrokenLinkVerify(job, deps)   // the file's existing invocation helper
  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
    select: { reachabilityJson: true, pages: { select: { url: true, inlinks: true } } },
  })
  const reach = JSON.parse(run!.reachabilityJson!)
  expect(reach.v).toBe(1)
  expect(reach.nodeCount).toBeGreaterThanOrEqual(2)
  const a = run!.pages.find((p) => p.url.endsWith('/a'))
  expect(a!.inlinks).toBe(2)   // home + /ghost (unfetched) both count
})

it('an audited page with no harvested links still gets graph scalars (not null)', async () => {
  // Seed a seoRow whose url has NO outgoing/incoming HarvestedLink edges.
  // ... (seed per the file's helpers) ...
  await runBrokenLinkVerify(job, deps)
  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
    select: { pages: { select: { url: true, inlinks: true, outlinks: true } } },
  })
  const lonely = run!.pages.find((p) => p.url.endsWith('/lonely'))
  expect(lonely!.inlinks).toBe(0)    // seeded as a node → 0, not null
  expect(lonely!.outlinks).toBe(0)
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts -t reachabilityJson`
Expected: FAIL — `reachabilityJson` null (not yet attached) or inlinks under-counted.

- [ ] **Step 3: Update the graph call to the full-graph signature**

In `broken-link-verify.ts`, replace the graph-compute block (currently ~379-390):

```ts
  // roadmap 3b: reachability over the FULL discovered graph (not just audited).
  // Best-effort: a failure logs and falls back to null aggregates + null summary.
  const discoveredNodes = safeParseUrlList(site.discoveredUrls)
  // Seed audited seoRow urls FIRST so first-seen-original keying prefers r.url,
  // keeping graph.byUrl.get(r.url) reliable, and so an audited page with no
  // discovered-URL match and no edges still gets a graph row (Codex #6/#7).
  const graphNodes = [...seoRows.map((r) => r.url), ...discoveredNodes]
  const indexableUrls = new Set(
    seoRows.filter((r) => indexableOf(r) && !r.loginLike).map((r) => r.url),
  )
  const domain = site.domain ?? job.domain
  const homepageUrl = domain ? normalizeFindingUrl(`https://${domain}/`) : null   // null-domain guard (Codex #5)
  let graph: ReturnType<typeof computeLinkGraph> | null = null
  try {
    graph = computeLinkGraph(
      rows.map((r) => ({ sourcePageUrl: r.sourcePageUrl, targetUrl: r.targetUrl, kind: r.kind })),
      graphNodes,
      homepageUrl,
      indexableUrls,
    )
  } catch (e) {
    console.error('[live-seo] graph compute failed', e)
  }
```

Notes for the implementer:
- `indexableOf` is defined at ~411 — move its definition ABOVE this block (it's a pure local; hoist the `const indexableOf = …` above the graph call), or inline the same predicate. Keep one definition.
- Remove the now-unused `auditedUrls`/`pickHomepage` usage for the graph. `pickHomepage` becomes dead — delete it and its call if nothing else uses it (grep first: `grep -n pickHomepage lib/jobs/handlers/broken-link-verify.ts`).
- The per-row lookup `graph?.byUrl.get(r.url)` at ~417 stays correct: `graphNodes` lists every `r.url` first, so `byUrl` is keyed by those exact strings and the lookup hits.

- [ ] **Step 4: Attach `reachabilityJson` to the run bundle**

In the `bundle.run` object (~477-485), add after `discoveryCoverageJson`:

```ts
      reachabilityJson: graph ? JSON.stringify({ v: 1, ...graph.summary }) : null,
```

- [ ] **Step 5: Run the builder test — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the brief/pillar tests; review + update drifted snapshots**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/brief-from-canonical.test.ts lib/services/brief.service.test.ts lib/services/pillarAnalysis`
Expected: some assertions on live-scan-derived orphan/depth may shift. For each failure, confirm the new value is the *truer* number (fewer false orphans / correct clicks-from-home), then update that assertion. Do NOT blind-rebaseline — if a value moves in the wrong direction, stop and investigate. (SF-upload-fed tests must NOT change; if one does, that's a bug.)

- [ ] **Step 7: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.test.ts lib/services
git commit -m "feat(3b): builder computes full-graph reachability + attaches reachabilityJson"
```

---

### Task 4: `ReachabilitySection` UI + results-page wiring

**Files:**
- Create: `components/site-audit/ReachabilitySection.tsx`
- Test: `components/site-audit/ReachabilitySection.test.tsx`
- Modify: `app/ada-audit/site/[id]/page.tsx` (add `reachabilityJson: true` to the `liveScanRun` select ~171; render the section after `DiscoveryCoverageSection` ~228; import ~11)

**Interfaces:**
- Consumes: `liveScanRun.reachabilityJson: string | null` (Task 1/3).
- Produces: rendered section; no exported API.

- [ ] **Step 1: Write the failing component test**

Create `components/site-audit/ReachabilitySection.test.tsx` (mirror `DiscoveryCoverageSection.test.tsx`: jsdom pragma, `afterEach(cleanup)`, `toBeTruthy()`/`container.innerHTML`/`queryByText` — this repo has NO jest-dom, so do NOT use `toBeInTheDocument` — Codex #8):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ReachabilitySection } from './ReachabilitySection'

afterEach(cleanup)

const reach = (o: object) => ({ reachabilityJson: JSON.stringify(o) })
const measured = {
  v: 1, nodeCount: 100, indexableNodeCount: 88, edgeCount: 400, homepageResolved: true,
  orphanCount: 6, orphanSample: ['https://x.test/orphan'],
  unreachableCount: 4, unreachableSample: ['https://x.test/lost'],
  depthHistogram: { '0': 1, '1': 22, '2': 48, '3': 13, '4plus': 0, 'null': 4 },
  maxDepth: 3, deepSample: [],
}

describe('ReachabilitySection', () => {
  it('renders nothing when the column is null', () => {
    const { container } = render(<ReachabilitySection run={{ reachabilityJson: null }} />)
    expect(container.innerHTML).toBe('')
  })
  it('renders nothing when run is null', () => {
    const { container } = render(<ReachabilitySection run={null} />)
    expect(container.innerHTML).toBe('')
  })
  it('renders orphan + unreachable counts and the orphan sample in the measured state', () => {
    const { container } = render(<ReachabilitySection run={reach(measured)} />)
    expect(screen.getByText(/6/)).toBeTruthy()
    expect(container.textContent).toMatch(/orphan/i)
    expect(screen.getByText('https://x.test/orphan')).toBeTruthy()
  })
  it('shows the homepage-unresolved copy when homepageResolved is false', () => {
    render(<ReachabilitySection run={reach({ ...measured, homepageResolved: false })} />)
    expect(screen.getByText(/homepage not found/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/ReachabilitySection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

Create `components/site-audit/ReachabilitySection.tsx` (mirrors `DiscoveryCoverageSection`'s Card + typography exactly):

```tsx
// components/site-audit/ReachabilitySection.tsx
//
// roadmap 3b: read-time internal-link reachability. Reads the SAME live-scan
// CrawlRun as DiscoveryCoverageSection, from reachabilityJson. Measurement, NOT
// a finding — never feeds priority scoring.
import React from 'react'

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      {children}
    </section>
  )
}

interface ReachData {
  v: number
  nodeCount: number; indexableNodeCount: number; edgeCount: number
  homepageResolved: boolean
  orphanCount: number; orphanSample: string[]
  unreachableCount: number; unreachableSample: string[]
  depthHistogram: Record<string, number>
  maxDepth: number | null
  deepSample: Array<{ url: string; depth: number }>
}

function SampleList({ label, urls }: { label: string; urls: string[] }) {
  if (urls.length === 0) return null
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[13px] font-body text-navy/60 dark:text-white/60">
        {label} ({urls.length})
      </summary>
      <ul className="mt-1 space-y-1">
        {urls.map((u) => (
          <li key={u} className="text-[12px] font-mono text-navy/70 dark:text-white/70 break-all">{u}</li>
        ))}
      </ul>
    </details>
  )
}

export function ReachabilitySection({
  run,
}: {
  run: { reachabilityJson: string | null } | null
}) {
  if (!run?.reachabilityJson) return null
  let data: ReachData
  try { data = JSON.parse(run.reachabilityJson) } catch { return null }

  return (
    <Card>
      <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white">
        Internal reachability
      </h2>
      <p className="mt-1 text-[13px] font-body text-navy/70 dark:text-white/70">
        {data.homepageResolved ? (
          <>
            <span className="font-semibold text-navy dark:text-white">{data.orphanCount}</span> orphaned{' '}
            {data.orphanCount === 1 ? 'page' : 'pages'} (no internal links in),{' '}
            <span className="font-semibold text-navy dark:text-white">{data.unreachableCount}</span> unreachable
            from the homepage
            {data.maxDepth != null && <> · deepest page is {data.maxDepth} click{data.maxDepth === 1 ? '' : 's'} from home</>}.
          </>
        ) : (
          <>Reachability measured over {data.indexableNodeCount} indexable pages; homepage not found, so
          clicks-from-home could not be computed.</>
        )}
      </p>
      <p className="mt-1 text-[12px] font-body text-navy/40 dark:text-white/40">
        Measurement only — not part of the score.
      </p>
      <SampleList label="Orphaned pages" urls={data.orphanSample} />
      <SampleList label="Unreachable pages" urls={data.unreachableSample} />
      {data.deepSample.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[13px] font-body text-navy/60 dark:text-white/60">
            Deep pages ({data.deepSample.length})
          </summary>
          <ul className="mt-1 space-y-1">
            {data.deepSample.map((d) => (
              <li key={d.url} className="text-[12px] font-mono text-navy/70 dark:text-white/70 break-all">
                {d.url} <span className="text-navy/40 dark:text-white/40">({d.depth} clicks)</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}
```

- [ ] **Step 4: Run the component test — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/ReachabilitySection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire it into the results page**

In `app/ada-audit/site/[id]/page.tsx`:
1. Import after line 11: `import { ReachabilitySection } from '@/components/site-audit/ReachabilitySection'`
2. In the `liveScanRun` select (~171), add: `reachabilityJson: true,`
3. After `<DiscoveryCoverageSection run={liveScanRun} />` (~228): `<ReachabilitySection run={liveScanRun} />`

- [ ] **Step 6: Typecheck the page wiring**

Run: `npm run lint`
Expected: PASS (no TS errors — `reachabilityJson` now on the selected run type).

- [ ] **Step 7: Commit**

```bash
git add components/site-audit/ReachabilitySection.tsx components/site-audit/ReachabilitySection.test.tsx "app/ada-audit/site/[id]/page.tsx"
git commit -m "feat(3b): ReachabilitySection UI + results-page wiring"
```

---

## Final gates (after all tasks)

- [ ] `npm run lint` — clean
- [ ] `DATABASE_URL="file:./local-dev.db" npm test` — all green (note new counts)
- [ ] `npm run build` — compiles
- [ ] Whole-branch review (opus) per subagent-driven-development
- [ ] PR → merge (gate-green) → `~/deploy.sh` (migration auto-applies) → prod-verify on a fresh manhattan seoIntent audit (expect populated `reachabilityJson`, `homepageResolved:true`, `'null'` histogram bucket == `unreachableCount`, inlink counts ≥ pre-3b)
- [ ] Tracker checkbox + status-log line + handoff rewrite (same commit); archive spec+plan to `docs/superpowers/archive/`

## Self-Review notes

- **Spec coverage:** §1 core refactor → Task 2; §2 metadata → Task 1 (column/type) + Task 3 (populate); §3 migration → Task 1; §4 UI → Task 4; all 8 Codex fixes land in Task 2 (#1,#2,#3,#4,#8), Task 1/3 (#5), Task 3 scope+drift (#6,#7). ✔
- **Type consistency:** `computeLinkGraph(edges, nodes, homepageUrl, indexableUrls)` and `ReachabilitySummary` used identically in Task 2 (def), Task 3 (call), Task 4 (JSON shape). `reachabilityJson` field name identical across schema/type/builder/component. ✔
- **No placeholders:** all steps carry real code/commands. The two spots that say "copy the file's existing harness" (Task 1 Step 1, Task 3 Step 1) are DB-backed test-setup boilerplate whose exact fixture rows depend on the sibling tests' helpers — the implementer must read the neighboring test; the assertions themselves are fully specified.
