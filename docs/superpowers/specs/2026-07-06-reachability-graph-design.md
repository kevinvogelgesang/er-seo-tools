# Reachability Graph (roadmap 3b) — Design

**Date:** 2026-07-06 · **Status:** spec · **Roadmap item:** 3b (reachability graph / true depth / orphans) · **Unblocked by:** hybrid-discovery Increment 2 (PR #109, prod-verified 2026-07-06)

## Problem

The live-scan link graph is computed over only the **audited (fetched) page set**, not the full **discovered** set. `computeLinkGraph` (`lib/ada-audit/seo/link-graph.ts:20`) drops every internal-link edge whose source *or* target is outside `auditedUrls` (= distinct `HarvestedPageSeo.url`, ~97 of manhattan's 109 discovered pages). Consequences:

- **inlinks/outlinks are under-counted** — a page linked only from a discovered-but-unfetched page counts zero inlinks.
- **crawlDepth (clicks-from-home) is truncated** — the homepage BFS (`link-graph.ts:28-34`) traverses only surviving edges, so any page reachable *through* a non-audited hop gets `crawlDepth: null`, and `depthAvailable` needs the homepage itself in the audited set.
- **No orphan detection on live scans** — SF emits `orphan_pages`; the live path has no equivalent. The brief's orphan text (`brief.service.ts:503`, `inlinks===0`) is measured against the truncated audited subgraph, so "0 inlinks" can be a filter artifact, not a true orphan.

The signal to fix this is **already in hand at build time**: the builder loads the full `HarvestedLink` edge set (`broken-link-verify.ts:166-171`, incl. edges to out-of-set targets — `computeDiscoveryCoverage` already consumes them) and `SiteAudit.discoveredUrls`. Only `computeLinkGraph` discards it. Increment 2's crawler is what makes `discoveredUrls` a real reachable-node set worth graphing.

## Scope (locked with Kevin 2026-07-06)

**Deliverable = truer per-page numbers + reachability metrics surfaced as run metadata + a UI section. NO score change, NO orphan Finding.** This is the measurement-first step (same arc as Increment 1 → Increment 2). Promoting orphans/depth to a scored Finding or into `scoreLiveSeo` is a deliberate, evidence-gated later step, explicitly out of scope here.

### Depth semantics correction

The crawler's `hybridCrawl` BFS `depthOf` (`hybrid-crawl.ts`) is **seed-relative** — every sitemap-seeded URL is depth 0 — so it is *not* clicks-from-home and is **not** used here. We compute **clicks-from-home = BFS from the homepage over the full internal-link edge graph**, the SEO-meaningful metric `computeLinkGraph` already models (just over a truncated graph today).

## Design

### 1. `computeLinkGraph` over the full discovered graph

Change the signature from `(rows, auditedUrls, homepageUrl)` to operate over the **full node set** and return a graph-level summary in addition to per-node rows.

```ts
export interface LinkGraphRow { inlinks: number; outlinks: number; crawlDepth: number | null }

export interface ReachabilitySummary {
  nodeCount: number
  edgeCount: number
  homepageResolved: boolean
  orphanCount: number
  orphanSample: string[]              // capped
  unreachableCount: number
  unreachableSample: string[]         // capped
  depthHistogram: Record<string, number> // keys: '0','1','2','3','4plus','null'
  maxDepth: number | null
  deepSample: Array<{ url: string; depth: number }> // depth >= DEEP_THRESHOLD, capped
}

export interface LinkGraphResult {
  byUrl: Map<string, LinkGraphRow>    // keyed by ORIGINAL url, for every node
  depthAvailable: boolean             // retained (== homepageResolved); now meaningful
  summary: ReachabilitySummary
}

export function computeLinkGraph(
  edges: { sourcePageUrl: string; targetUrl: string; kind: string }[],
  nodes: string[],                    // full discovered node set (was: auditedUrls)
  homepageUrl: string | null,
  indexableUrls: Set<string>,         // normalized urls that are indexable && !loginLike (orphan eligibility)
): LinkGraphResult
```

**Node set.** `nodes` = `SiteAudit.discoveredUrls` **∪ all edge endpoints** (so a link target never listed in `discoveredUrls` still participates as a node and contributes honest inlink counts). Normalization: `normalizeFindingUrl` on every url (unchanged from today), first-seen original wins — reconciles with `CrawlPage.url`.

**Edges.** Every `kind === 'internal-link'` row (image edges ignored, as today). Self-links (`s === t` after normalization) excluded.

**inlinks/outlinks.** Counted across the whole graph (distinct sources/targets per node), unchanged algorithm — only the node/edge domain widens.

**crawlDepth.** BFS from the normalized homepage over the full adjacency. `homepageResolved` = homepage node present among `nodes`. Unreachable nodes → `crawlDepth: null`.

**Summary.**
- **orphan** = a node that is (a) in `indexableUrls` and (b) has 0 inlinks. Only indexability-known nodes can be orphans — an edge-only node (never fetched, no indexability signal) is never counted as an orphan (avoids false positives). `orphanSample` capped at `SAMPLE_CAP`.
- **unreachable** = a node in `indexableUrls` with `crawlDepth === null` (no internal path from home). `unreachableSample` capped.
- **depthHistogram** buckets all nodes by depth (`'4plus'` aggregates ≥4; `'null'` = unreachable/unknown).
- **maxDepth** over finite depths (null if none).
- **deepSample** = nodes with `crawlDepth >= DEEP_THRESHOLD` (4), capped, sorted by depth desc then url.

Constants: `SAMPLE_CAP = 50`, `DEEP_THRESHOLD = 4` (module-local, mirroring `discovery-coverage.ts`).

Pure function, no I/O — all inputs passed by the builder.

### 2. Builder integration (`broken-link-verify.ts`)

- Build `indexableUrls` from the `HarvestedPageSeo` rows already loaded (`indexable && !loginLike`, normalized) — the same eligibility test on-page findings use.
- Call `computeLinkGraph(harvestedLinkRows, discoveredNodes, homepageUrl, indexableUrls)` where `discoveredNodes = site.discoveredUrls` (parsed) — inside the **existing** try/catch (`:383-390`): on failure, log + leave scalars null AND `reachabilityJson` null; never fail the run.
- Per-node scalars written onto the `CrawlPage` rows the builder already creates for audited pages (lookup by normalized url, as today at `:417-423`). Discovered-but-unfetched nodes get no CrawlPage row — their facts live only in the summary.
- Attach `reachabilityJson: JSON.stringify({ v: 1, ...summary })` to the live-scan `CrawlRun` bundle (alongside `discoveryCoverageJson` at `:484`).

### 3. Persistence — additive migration

New nullable column `CrawlRun.reachabilityJson String?` (comment: "roadmap 3b: internal-link reachability metrics (orphans/depth); live-scan runs only; NOT a finding"). Additive-nullable → no table rebuild, `prisma migrate deploy` auto-applies on deploy. Migration dir `prisma/migrations/<timestamp>_reachability_graph/migration.sql`. No other schema change; `CrawlPage.inlinks/outlinks/crawlDepth` already exist (`schema.prisma:451-453`).

### 4. UI — `ReachabilitySection`

New `components/site-audit/ReachabilitySection.tsx`, rendered below `DiscoveryCoverageSection` in `app/ada-audit/site/[id]/page.tsx` (add `reachabilityJson` to the `crawlRun.findUnique` select at `:171`). Reads `liveScanRun.reachabilityJson` only.

- **absent** (null — pre-3b / non-hybrid / graph failure) → renders nothing.
- **measured** → headline tiles (orphan count, unreachable count, max depth), a compact depth-distribution bar from `depthHistogram`, and collapsible sample lists (orphaned pages, deep pages) with outbound links. Disclaimer that it is measurement, not a scored issue (mirrors `DiscoveryCoverageSection`'s "never feeds priority scoring" note).
- Dark-mode `dark:` variants on every element; no hydration-mismatch pattern; inherits the page's share-mode read-only behavior (no cookie-gated fetches).

## Data flow

```
SiteAudit.discoveredUrls ─┐
HarvestedLink (all edges) ─┼─► computeLinkGraph(edges, nodes, home, indexable)
HarvestedPageSeo(indexable)┘        │
                                    ├─► byUrl ──► CrawlPage.{inlinks,outlinks,crawlDepth} (audited pages)
                                    └─► summary ─► CrawlRun.reachabilityJson ──► ReachabilitySection
```

## Testing

- **`link-graph.test.ts`** (extend): inlinks count edges from unfetched nodes; clicks-from-home depth correct through a non-audited intermediary (not null); orphan = 0-inlink indexable node; edge-only (non-indexable-known) node never an orphan; unreachable = null-depth indexable node; homepage absent → `homepageResolved:false`, all depths null, no throw; empty edges/nodes → zeroed summary, no throw; self-link excluded; `depthHistogram` buckets incl. `'4plus'`/`'null'`.
- **`broken-link-verify.test.ts`** (extend): builder attaches `reachabilityJson` + truer CrawlPage scalars; graph failure → `reachabilityJson` null, scalars null, run still written (best-effort).
- **`ReachabilitySection.test.tsx`** (new): absent + measured states render correctly.

## Non-goals

- **No `scoreLiveSeo` change.** crawlDepth/orphans stay out of the denominator (the deliberate exclusion at `live-seo-score.ts:90`). Folding them in is a separate, evidence-gated, test-breaking decision needing Kevin's sign-off.
- **No orphan Finding.** Would risk the `priority.service` count-0 landmine (scale 1.0) and pre-empt the gated score decision. Reachability is run metadata, like `discoveryCoverageJson`.
- **No new fetches, no change to the audited page set, no SF-upload path change** (SF uses `seo-mapper.ts` + `avg_crawl_depth`, untouched).
- Not removing `depthAvailable` — kept (now equals `homepageResolved`, meaningful).

## Deploy notes

Additive-nullable migration only; no new required-in-prod env var → plain `~/deploy.sh` (migration auto-applies). Feature only affects live-scan runs (seoIntent audits); plain ADA audits and SF uploads unchanged. No `.toString()`-injected code (the crawler and graph are raw compute — no SWC-helper / `Class.name` minification concern). Prod-verify on a fresh seoIntent audit of a high-miss client (manhattan): expect `reachabilityJson` populated with a plausible `orphanCount`/`depthHistogram`, `ReachabilitySection` rendering the measured state, and CrawlPage inlink counts ≥ the pre-3b audited-only counts.
