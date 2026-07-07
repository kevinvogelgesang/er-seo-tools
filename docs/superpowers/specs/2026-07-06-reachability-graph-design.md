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

**Applies to every live-scan run, not just seoIntent (Codex #6).** The finalizer enqueues `broken-link-verify` for *every* completed site audit (`site-audit-finalizer.ts:132`); `seoIntent` is stored, not a gate on the verifier. So a live-scan `CrawlRun` — and now `reachabilityJson` — is produced for all site audits that harvested links. Hybrid discovery (seoIntent) only makes the node set *richer* (extra discovered nodes); reachability is meaningful for a sitemap-only audit too. No seoIntent guard is added. (Plain ADA audits already build a live-scan run today with broken-link/on-page findings; 3b adds one metadata field to that existing run — no new run, no change to the audited page set.)

### Depth semantics correction

The crawler's `hybridCrawl` BFS `depthOf` (`hybrid-crawl.ts`) is **seed-relative** — every sitemap-seeded URL is depth 0 — so it is *not* clicks-from-home and is **not** used here. We compute **clicks-from-home = BFS from the homepage over the full internal-link edge graph**, the SEO-meaningful metric `computeLinkGraph` already models (just over a truncated graph today).

## Design

### 1. `computeLinkGraph` over the full discovered graph

Change the signature from `(rows, auditedUrls, homepageUrl)` to operate over the **full node set** and return a graph-level summary in addition to per-node rows.

```ts
export interface LinkGraphRow { inlinks: number; outlinks: number; crawlDepth: number | null }

export interface ReachabilitySummary {
  nodeCount: number                   // all page nodes in the graph
  indexableNodeCount: number          // page nodes that are indexable (the eligible set — Codex #4)
  edgeCount: number
  homepageResolved: boolean
  orphanCount: number
  orphanSample: string[]              // capped
  unreachableCount: number
  unreachableSample: string[]         // capped
  depthHistogram: Record<string, number> // over the ELIGIBLE (indexable) set; keys '0','1','2','3','4plus','null' — 'null' == unreachableCount (Codex #4)
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
  homepageUrl: string | null,         // EXACT normalized homepage (Codex #2) — NOT a shallowest fallback
  indexableUrls: Set<string>,         // normalized urls that are indexable && !loginLike (orphan eligibility)
): LinkGraphResult
```

**Node set.** `nodes` = (`SiteAudit.discoveredUrls` **∪ all edge endpoints**) **minus non-page targets** (Codex #3). A link target never listed in `discoveredUrls` still participates as a node (honest inlink counts), but obvious non-page URLs (PDFs/assets) are excluded via the existing exported `NON_PAGE_EXT` from `discovery-coverage.ts` — this is a *page* reachability graph, matching the coverage instrument. Normalization: `normalizeFindingUrl` on every url (unchanged from today), first-seen original wins — reconciles with `CrawlPage.url`.

**Edges.** Every `kind === 'internal-link'` row (image edges ignored, as today); edges to non-page targets dropped along with those nodes. Self-links (`s === t` after normalization) excluded.

**inlinks/outlinks.** Counted across the whole page graph (distinct sources/targets per node), unchanged algorithm — only the node/edge domain widens. Includes inlinks from non-indexable pages (a real page's inlinks shouldn't be filtered by the *linker's* indexability).

**crawlDepth (clicks-from-home).** BFS from the **exact normalized homepage** (`homepageUrl`, derived by the builder as `normalizeFindingUrl('https://<domain>/')`) over the full adjacency. `homepageResolved` = that exact homepage node is present among `nodes`. **No shallowest-audited-URL fallback** (Codex #2): if the exact homepage is absent, `homepageResolved:false` and all depths are `null` (BFS from a random shallow page would be a misleading "clicks from home"). Unreachable nodes → `crawlDepth: null`.

**Summary** (orphan / unreachable / histogram all computed over the **eligible set** = indexable page nodes, so `depthHistogram['null'] === unreachableCount`, Codex #4):
- **orphan** = a node that is (a) in `indexableUrls`, (b) **not the homepage** (Codex #1 — the homepage legitimately has 0 internal inlinks once self-links are excluded, so it must never count as an orphan), and (c) has 0 inlinks. Only indexability-known nodes can be orphans — an edge-only node (never fetched, no indexability signal) is never counted (avoids false positives). `orphanSample` capped at `SAMPLE_CAP`.
- **unreachable** = an eligible node with `crawlDepth === null` (no internal path from home; homepage itself excluded). `unreachableSample` capped.
- **depthHistogram** buckets the **eligible** nodes by depth (`'4plus'` aggregates ≥4; `'null'` = unreachable, reconciles with `unreachableCount`).
- **maxDepth** over finite eligible depths (null if none).
- **deepSample** = eligible nodes with `crawlDepth >= DEEP_THRESHOLD` (4), capped, sorted by depth desc then url.
- **nodeCount** = all page nodes; **indexableNodeCount** = eligible nodes (the histogram/orphan/unreachable denominator).

Constants: `SAMPLE_CAP = 50`, `DEEP_THRESHOLD = 4` (module-local, mirroring `discovery-coverage.ts`).

Pure function, no I/O — all inputs passed by the builder.

### 2. Builder integration (`broken-link-verify.ts`)

- Build `indexableUrls` from the `HarvestedPageSeo` rows already loaded (`indexable && !loginLike`, normalized) — the same eligibility test on-page findings use.
- Derive the **exact** homepage: `homepageUrl = normalizeFindingUrl('https://' + (site.domain ?? job.domain) + '/')` — **not** `pickHomepage` (Codex #2), whose shallowest-audited fallback would produce a misleading clicks-from-home BFS root. (`pickHomepage` is used only here; it can be dropped or left unused for reachability.)
- Call `computeLinkGraph(harvestedLinkRows, discoveredNodes, homepageUrl, indexableUrls)` where `discoveredNodes = site.discoveredUrls` (parsed) — inside the **existing** try/catch (`:383-390`): on failure, log + leave scalars null AND `reachabilityJson` null; never fail the run.
- Per-node scalars written onto the `CrawlPage` rows the builder already creates for audited pages (lookup by normalized url, as today at `:417-423`). Discovered-but-unfetched nodes get no CrawlPage row — their facts live only in the summary.
- Attach `reachabilityJson: JSON.stringify({ v: 1, ...summary })` to the live-scan `CrawlRun` bundle (alongside `discoveryCoverageJson` at `:484`).
- **Add `reachabilityJson?: string` to the `CrawlRunInput` interface** (`lib/findings/types.ts:43`, Codex #5) — `writeFindingsRun` persists via `{ ...run }` (`writer.ts:40`), so the field is dropped silently without the type member. Add a writer round-trip test.

### 3. Persistence — additive migration

New nullable column `CrawlRun.reachabilityJson String?` (comment: "roadmap 3b: internal-link reachability metrics (orphans/depth); live-scan runs only; NOT a finding"). Additive-nullable → no table rebuild, `prisma migrate deploy` auto-applies on deploy. Migration dir `prisma/migrations/<timestamp>_reachability_graph/migration.sql`. No other schema change; `CrawlPage.inlinks/outlinks/crawlDepth` already exist (`schema.prisma:451-453`).

### 4. UI — `ReachabilitySection`

New `components/site-audit/ReachabilitySection.tsx`, rendered below `DiscoveryCoverageSection` in `app/ada-audit/site/[id]/page.tsx` (add `reachabilityJson` to the `crawlRun.findUnique` select at `:171`). Reads `liveScanRun.reachabilityJson` only.

- **absent** (`reachabilityJson` null — pre-3b runs or a graph-compute failure; a homepage-unresolved run still writes the field with `homepageResolved:false`) → renders nothing.
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

## Downstream behavior drift (Codex #7 — intended, not inert)

Changing live-scan `CrawlPage.inlinks/outlinks/crawlDepth` to full-graph values is a *desired* accuracy improvement, but it is **not inert** — three consumers read those scalars via `canonical-page-facts.ts` and will shift on live-scan (canonical) runs:
- **Brief orphan count** (`brief.service.ts:503`, `inlinks === 0`) — becomes *more* accurate (fewer false orphans from the old audited-only filter). Expected to change; update the brief characterization/snapshot tests rather than blindly re-baseline.
- **Pillar analysis page-type fallback** (`pageType.ts:83`, `crawlDepth ?? 99`) — depth values shift (clicks-from-home over the full graph, exact-homepage rooted). Review pillar snapshots.
- **PagesTable "Deepest" sort** (`components/seo-parser/PagesTable.tsx`) — display only, no logic change.

SF-upload runs are untouched (`seo-mapper.ts` + `avg_crawl_depth`, different path). These drifts apply only to live-scan runs.

## Testing

- **`link-graph.test.ts`** (extend): inlinks count edges from unfetched nodes; clicks-from-home depth correct *through* a non-audited intermediary (not null); orphan = 0-inlink indexable non-homepage node; **homepage with 0 inlinks is NOT an orphan** (Codex #1); edge-only (non-indexable-known) node never an orphan; unreachable = null-depth eligible node; **exact homepage absent → `homepageResolved:false`, all depths null, NO shallowest-fallback BFS** (Codex #2); non-page target (`.pdf`/`.jpg`) excluded from nodes/edges (Codex #3); empty edges/nodes → zeroed summary, no throw; self-link excluded; `depthHistogram` over eligible set with `'null' === unreachableCount` and `'4plus'` bucket (Codex #4).
- **URL-normalization / redirect tests** (Codex #8, in `link-graph.test.ts`): root-slash vs no-slash, `www.` vs apex, http vs https all normalize to one node (via `normalizeFindingUrl`); a discovered URL given as the *original* request URL reconciles with a harvested *source* URL for the same normalized page (no phantom duplicate node); documents that graph normalization uses `normalizeFindingUrl` (not `normalizeCoverageUrl`, which additionally strips tracking params / www / pins scheme — the graph deliberately does not, matching `CrawlPage.url`).
- **`broken-link-verify.test.ts`** (extend): builder attaches `reachabilityJson` + truer CrawlPage scalars; exact-homepage derivation used (not `pickHomepage`); graph failure → `reachabilityJson` null, scalars null, run still written (best-effort).
- **`writer.test.ts`** (extend, Codex #5): a `CrawlRunInput` carrying `reachabilityJson` round-trips to the persisted `CrawlRun.reachabilityJson` column.
- **Brief / pillar characterization** (Codex #7): update the affected `brief-from-canonical` / pillar snapshots as *reviewed* changes; assert the direction (fewer false orphans), not a blind re-baseline.
- **`ReachabilitySection.test.tsx`** (new): absent + measured states render correctly.

## Non-goals

- **No `scoreLiveSeo` change.** crawlDepth/orphans stay out of the denominator (the deliberate exclusion at `live-seo-score.ts:90`). Folding them in is a separate, evidence-gated, test-breaking decision needing Kevin's sign-off.
- **No orphan Finding.** Would risk the `priority.service` count-0 landmine (scale 1.0) and pre-empt the gated score decision. Reachability is run metadata, like `discoveryCoverageJson`.
- **No new fetches, no change to the audited page set, no SF-upload path change** (SF uses `seo-mapper.ts` + `avg_crawl_depth`, untouched).
- Not removing `depthAvailable` — kept (now equals `homepageResolved`, meaningful).

## Deploy notes

Additive-nullable migration only; no new required-in-prod env var → plain `~/deploy.sh` (migration auto-applies). Affects **every live-scan run** (all site audits that harvested links — Codex #6), enriched for seoIntent/hybrid audits by the larger discovered-node set; SF uploads unchanged. No `.toString()`-injected code (the graph is raw compute — no SWC-helper / `Class.name` minification concern). Prod-verify on a fresh seoIntent audit of a high-miss client (manhattan): expect `reachabilityJson` populated with a plausible `orphanCount`/`depthHistogram` (`'null'` bucket == `unreachableCount`), `homepageResolved:true`, `ReachabilitySection` rendering the measured state, and CrawlPage inlink counts ≥ the pre-3b audited-only counts.
