# Hybrid-Discovery Increment 2 — The Crawler (design)

**Date:** 2026-07-06 · **Status:** spec (Codex-reviewed, ACCEPT-WITH-FIXES applied)
· **Roadmap ref:** C6 hybrid discovery Increment 2 / SF-retirement campaign Phase 2
· **Class:** feature + schema migration.

## Problem & evidence

Site-audit discovery today is **sitemap-first** (`discoverPages` in
`lib/ada-audit/sitemap-crawler.ts`): robots `Sitemap:` directives → `sitemap.xml`
→ `sitemap_index.xml` → `wp-sitemap.xml` → `.xml.gz`; if none yield pages, a
**one-page shallow crawl of the homepage** is the only link-based fallback. The
audited page set is therefore whatever the sitemap lists.

Increment 1 (shipped 2026-07-04, PR #101) measured how much that misses:
`computeDiscoveryCoverage` diffs the rendered-DOM internal links each page job
already harvested against the discovery baseline and stores a **sitemap
miss-rate** on `CrawlRun.discoveryCoverageJson`. The 2026-07-06 batch produced the
first data (7 clients): miss-rate **7.7%–42.2%**, median ~21%, **4/7 ≥ 18%, 3/7 ≥
37%**. Sitemaps routinely omit a large fraction of internally-reachable content.
That is the evidence gate the roadmap required before building the crawler.

**Goal:** when an audit is SEO-purposed, expand discovery from "the sitemap" to
"the sitemap **plus** internally-reachable pages found by a bounded link crawl,"
so those pages get audited and enter the SEO/ADA analysis — without changing the
behavior or cost of ordinary ADA audits, and without losing the intrinsic
sitemap miss-rate measurement the campaign tracks cycle-over-cycle.

## Scope decisions (owner, 2026-07-06)

1. **seoIntent audits only.** Hybrid discovery runs only when the SiteAudit has
   `seoIntent: true`. Plain ADA audits keep byte-for-byte today's sitemap→shallow
   behavior. Lowest blast radius; matches the miss-rate campaign thread; keeps the
   miss-rate instrument comparable.
2. **Moderate budget, env-configurable.** Defaults: BFS depth 3, ≤300 pages added
   beyond the sitemap, ~120 s crawl wall-clock budget. All exposed as env vars so
   prod can be tuned without a redeploy ("be ready to adjust based on findings").
   The existing **1000-page hard cap on the final audited set is unchanged.**
3. **Raw HTTP, never Chrome, for the crawl.** The VPS memory fence
   (`BROWSER_POOL_SIZE ≤ 4`, two memory-incident scars) rules out browser-driven
   crawling of hundreds of pages. Link extraction at discovery time is raw HTTP +
   HTML parse. **Accepted caveat:** links that only exist in JS-rendered DOM are
   not found at discovery time; on these WordPress/college sites most markup is
   server-rendered, and any residual shows up honestly in the post-audit
   `residualMissRate` (§Miss-rate continuity).

## Non-goals

- No change to ADA (non-seoIntent) audits.
- No browser rendering during discovery.
- No dynamic frontier expansion *during* the audit (discovery stays a discrete
  phase that produces the full URL set before fan-out — preserves the
  pagesTotal / first-writer-wins / drain / finalize invariants).
- No reachability-graph / true-depth / orphan analysis (that is Increment 3 /
  roadmap 3b, which depends on this).
- No subdomain widening (same-domain stays exact-host + www-insensitive, per the
  `link-harvest.ts` v1 fence).

## Current code (ground truth, re-mapped 2026-07-06)

- `discoverPages(domain): Promise<{urls, mode:'sitemap'|'shallow-crawl', capped}>`
  — the discrete discovery phase. `shallowCrawl(base, normDomain)` already does
  raw-HTTP homepage fetch + regex `<a href>` extraction + same-domain filter +
  `dedupeUrls`. `fetchHtml`/`fetchXml`/`fetchRobotsTxt` use `safeFetch` with a
  browser UA and byte/timeout limits. `isSameDomain` is exact-host + www-insensitive.
- `site-audit-discover` job — calls `discoverPages(domain)`, persists
  `discoveredUrls` (JSON `string[]`) + `pagesTotal` + `discoveryMode` +
  `discoveryCapped` **first-writer-wins**, creates one `AdaAudit` child per URL
  (`@@unique([siteAuditId, url])`, P2002 skip), fans out one `site-audit-page`
  job each. Timeout 300 s, maxAttempts 3, one-active `NOT EXISTS` claim guard.
- `computeDiscoveryCoverage({discoveredUrls, internalLinks, discoveryMode,
  discoveryCapped})` — pure; `applicable = mode==='sitemap' && !capped`;
  `missRate = offBaselineCount / (discoveredCount + offBaselineCount)`. Called
  once in the `broken-link-verify` builder (the live-scan run writer) from
  already-harvested rows; result → `CrawlRun.discoveryCoverageJson`.
  `normalizeCoverageUrl` is the clean normalizer (strips fragment + UTM + non-root
  trailing slash + `www.`, pins https) used on both baseline and linked sets.
- Schema: `SiteAudit.seoIntent Boolean @default(false)` (on main since PR #85);
  `discoveredUrls String?`, `discoveryMode String?`, `discoveryCapped Boolean?`;
  `CrawlRun.discoveryCoverageJson String?`.

## Architecture

### New module: `lib/ada-audit/seo/hybrid-crawl.ts`

Pure-as-possible bounded BFS link crawler. The **impure fetch is injected** so
the BFS logic is unit-testable against synthetic HTML with no network.

```
type CrawlSource = 'sitemap' | 'seed' | 'shallow' | 'linked'
interface FetchedPage { links: string[]; finalUrl: string }  // finalUrl = post-redirect URL
interface CrawlDeps {
  fetchPageLinks(url: string): Promise<FetchedPage | null>  // raw-HTTP HTML → {absolute hrefs, final URL}, or null on fetch failure
  now(): number
}
interface CrawlBounds {
  maxDepth: number; maxAdded: number; maxFetches: number   // Codex #6: cap FETCHES, not just additions
  timeBudgetMs: number; hardCap: number
}
interface CrawlSeed { url: string; source: 'sitemap' | 'seed' | 'shallow' }
interface CrawlResult {
  urls: string[]                                   // full ordered set (seeds first, then BFS order), ≤ hardCap
  sources: Record<string, CrawlSource>             // normalized-url → provenance (precedence-resolved)
  sitemapCount: number                             // count of 'sitemap'/'seed'/'shallow' seed URLs (the baseline size)
  addedByCrawl: number                             // count of 'linked' URLs
  fetches: number                                  // total fetchPageLinks calls made
  stoppedBy: 'depth' | 'maxAdded' | 'maxFetches' | 'timeBudget' | 'hardCap' | 'exhausted'
}
async function hybridCrawl(seeds: CrawlSeed[], auditedHost, bounds, deps, robots): Promise<CrawlResult>
```

BFS: seeds enter the frontier at depth 0 (marked with their seed source). Pop
frontier; for each URL within depth < maxDepth, `fetchPageLinks`; **resolve/normalize
each href against the page's `finalUrl` using `normalizeLinkTarget(raw, finalUrl)`
from `link-harvest.ts` (Codex #8 — do NOT reimplement URL joining)**, then apply
the coverage normalizer for the dedup/source key; keep same-domain via
`sameDomain` from `link-harvest.ts`, drop non-page extensions (reuse the
`NON_PAGE_EXT` set), apply robots `Disallow` (§robots) and trap heuristics
(§traps); unseen targets join the frontier at depth+1 tagged `'linked'`. Stop when
any bound trips (`maxDepth`, `maxAdded`, `maxFetches`, `timeBudgetMs`, `hardCap`,
or frontier exhausted) — `stoppedBy` records which, for observability.

**Source precedence (Codex #4):** a URL reachable as both sitemap and linked
resolves to the higher-precedence source. `sitemap > seed > shallow > linked`,
keyed by the coverage normalizer. Seeds are inserted into `sources` first at their
seed precedence; a later `'linked'` discovery of the same normalized key never
downgrades it.

Ordering is deterministic: seeds first (in input order), then BFS discovery order.
The `hardCap` slice keeps sitemap/seed/shallow URLs ahead of `linked` ones
(publisher intent + miss-rate comparability), then BFS order among the rest.

### robots.txt

New `lib/ada-audit/seo/robots-rules.ts` — pure `parseRobots(text)` →
`{ disallow: string[]; allow: string[] }` and `isAllowed(pathname, rules)`
(longest-match, `Allow` overrides `Disallow` per the standard; `*` and `$`
wildcards supported minimally). `discoverPages` fetches `/robots.txt` once (it
already does, for `Sitemap:` lines — extend that fetch to also capture rule
groups) and passes the parsed rules to `hybridCrawl`.

**UA policy (Codex #9):** the crawler's UA is a full browser string (to dodge
CDN/WAF bot 403s — see `USER_AGENT` in `sitemap-crawler.ts`), so there is no
custom token to match a UA-specific robots group against. **v1 honors the
`User-agent: *` group only** — the conservative, unambiguous choice. (A future
custom-token policy is out of scope.)

**Sitemap-vs-Disallow policy:** robots `Disallow` applies to the **linked crawl
frontier only**; sitemap/seed URLs are kept regardless. This is documented as
**continuity** — the existing audit pipeline already fetches and audits every
sitemap URL without consulting `Disallow`, so hybrid discovery does not change
that contract; it is NOT a claim of general robots purity. Documented in the
module header.

### Trap heuristics (in `hybrid-crawl.ts`, pure)

- **Per-path query-variant cap** — at most `MAX_QUERY_VARIANTS_PER_PATH` (default 5)
  distinct query-strings admitted for a given pathname; further variants dropped
  (faceted-nav / session-id explosion).
- **Max path-segment depth** — drop URLs whose pathname has more than
  `MAX_PATH_SEGMENTS` (default 12) segments (calendar `/2027/01/02/…` traps).
- **Budgets as backstop** — maxAdded + timeBudget + hardCap always terminate.

### Wiring `discoverPages`

`discoverPages(domain, opts?: { hybrid?: boolean; seeds?: string[] })`:
- `hybrid` falsy → **unchanged** return shape and behavior.
- `hybrid` true → resolve the seed set: if `opts.seeds` is provided (pre-discovered
  audit, §pre-discovered), those are the seeds tagged `'seed'`; otherwise run the
  existing sitemap/shallow resolution (tagged `'sitemap'`/`'shallow'`) + homepage.
  Then run `hybridCrawl` from those seeds. Return
  `{ urls, mode: 'hybrid', capped, coverage: { sources, sitemapCount, sitemapCapped, stoppedBy, fetches } }`.
  `capped` = the final hybrid set hit `hardCap` (== `discoveryCapped` column below).
  `sitemapCapped` (Codex #3) = the seed/sitemap portion alone exceeded `hardCap`
  *before* the crawl (drives `sitemapMissRate` applicability, independent of the
  final hybrid cap). `mode:'hybrid'` is set only when a crawl actually ran and the
  seed fetch succeeded; if seed resolution fell back to shallow and the crawl added
  nothing, mode may stay `'shallow-crawl'`.

Return type becomes `{ urls; mode; capped; coverage? }` (`coverage` present only for
hybrid). `fetchPageLinks` is implemented in `sitemap-crawler.ts` by factoring the
existing `shallowCrawl` href-extraction into a reusable helper that **returns the
post-redirect final URL alongside the hrefs and rejects a page whose final URL
left the audited host** (Codex #7 — `safeFetch` follows redirects; an off-host
final URL must not contribute links, and same-host links must resolve against the
final URL). Extraction uses `normalizeLinkTarget` + `sameDomain` (Codex #8).

### Wiring `site-audit-discover`

- Select `seoIntent` alongside the existing fields.
- **First-writer semantics (Codex reasoning):** the guarantee is "**first
  *successful persist* wins**," not "first attempt's set wins." No fan-out happens
  before the persist, so a crash after crawling but before the persist is safe — a
  later attempt re-crawls and its persist wins. Spec language corrected accordingly.

- **Non-pre-discovered path** (`discoveredUrls IS NULL`): call
  `discoverPages(audit.domain, { hybrid: audit.seoIntent })`. Persist
  `discoveredUrls` + `pagesTotal` + `discoveryMode` + `discoveryCapped` **and**
  `discoverySourcesJson` (new column) in **one** first-writer-wins `updateMany`
  guarded on `discoveredUrls IS NULL` (Codex #2 — the source map is written
  atomically with the URL set, never in a second write that could diverge).

- **Pre-discovered path (Codex #1)** (`discoveredUrls` already set at
  `enqueueAudit` time — e.g. seed-URL clients): if `audit.seoIntent` **and**
  `discoverySourcesJson IS NULL` (not yet hybrid-expanded), call
  `discoverPages(audit.domain, { hybrid: true, seeds: <stored urls> })`, then
  persist the **expanded** `discoveredUrls` + `pagesTotal` + `discoveryMode` +
  `discoveryCapped` + `discoverySourcesJson` in one `updateMany` guarded on
  `discoverySourcesJson IS NULL`. This closes the gap where seed-URL seoIntent
  audits would otherwise skip `discoverPages` entirely and never crawl. Non-seoIntent
  pre-discovered audits are untouched (no hybrid, no source map). **Verify:** the
  parity log records no *active* client with `seedUrls` today, so this path has no
  current traffic — but it must exist so the feature isn't silently absent for the
  first seed-URL client that turns seoIntent on.

- **The "ensure" repair `updateMany`** (guarded on `status='running'`, currently
  re-writes `discoveredUrls`/`pagesTotal` to repair corrupt legacy sets) must
  **preserve or re-derive `discoverySourcesJson`** in lockstep (Codex #2) — a
  repaired URL set with a stale/absent source map would break miss-rate derivation.
  For a corrupt-and-re-discovered set, re-store the freshly-computed source map too.

- Everything downstream (child creation, fan-out) still reads `discoveredUrls` as a
  plain `string[]` — **no churn**.

- **Effective crawl budget (Codex #5):** the crawl's wall-clock budget is not a
  fixed 120 s but `min(HYBRID_CRAWL_TIME_BUDGET_MS, JOB_TIMEOUT − elapsed −
  INSERT_RESERVE)`, where `elapsed` counts the robots/sitemap/child-sitemap/browser-
  fallback fetches already spent and `INSERT_RESERVE` reserves time for the serial
  ~2000 child-row inserts + fan-out that follow discovery. If the effective budget
  is below a floor, hybrid is skipped (mode stays `'sitemap'`/`'shallow-crawl'`) —
  the audit still runs sitemap-only rather than risking a discover-job timeout. This
  mirrors the `SAFETY_RESERVE_MS` pattern PR #106 widened in the verifier.

### Schema migration `<timestamp>_discovery_sources`

Add nullable `SiteAudit.discoverySourcesJson String?`. Its JSON value is a
**versioned object** (Codex #3 — the plain url→source map is not enough; the
sitemap-portion cap must be persisted separately from the final hybrid cap):

```
{ "v": 1,
  "sources": { "<normalized-url>": "sitemap"|"seed"|"shallow"|"linked", ... },
  "sitemapCount": <int>,          // size of the seed/sitemap baseline
  "sitemapCapped": <bool>,        // seed/sitemap portion alone exceeded HARD_CAP (independent of final hybrid cap)
  "stoppedBy": "<CrawlResult.stoppedBy>",
  "fetches": <int> }
```

`discoveryCapped` (existing boolean column) now means "the **final hybrid** set hit
`HARD_CAP`"; `sitemapCapped` inside the JSON means "the **sitemap baseline** portion
was capped" — the two are distinct and both feed coverage applicability.

Nullable + additive → no table rebuild. Hand-authored SQL per the repo's SQLite
migration procedure (`migrate dev` is interactive-only here):
`DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … generate`.
Prod applies it automatically in `~/deploy.sh`. Timestamp assigned at build time.

### Miss-rate continuity (the integration hinge)

`computeDiscoveryCoverage` gains optional inputs `sitemapBaseline?: string[]` and
`sitemapCapped?: boolean`. The `broken-link-verify` builder, when
`discoverySourcesJson` is present, derives `sitemapBaseline` = URLs whose source is
`'sitemap'` (or `'seed'`/`'shallow'` when no sitemap existed) and reads
`sitemapCapped` from the JSON, and passes both. The computation reports **two**
rates, **each with its own applicability flag** (Codex #10 — with hybrid,
`discoveryCapped` can flag the final hybrid cap while the sitemap baseline is still
valid, so a single `applicable` is ambiguous):

- **`sitemapMissRate`** (+ `sitemapApplicable`) — harvested internal links off the
  **sitemap baseline**. Meaning identical to Increment 1; **comparable to the
  cycle-1 data and the ongoing Phase-1 gate.** `sitemapApplicable` when a sitemap
  baseline exists and `sitemapCapped === false` (independent of the final hybrid cap).
- **`residualMissRate`** (+ `residualApplicable`) — harvested internal links off the
  **full hybrid baseline** (`discoveredUrls`). "What even the crawl missed."
  Falsifiable success number for Increment 2: `sitemapMissRate` high,
  `residualMissRate` low ⇒ the crawler closed the gap. `residualApplicable` when the
  full baseline wasn't `hybridCapped`.

Backward compatibility: for non-hybrid runs (`discoverySourcesJson` null),
`sitemapBaseline`/`sitemapCapped` are absent → the function behaves **exactly as
today** — the existing `missRate` + `applicable` fields retain their current
meaning and values (`missRate` == `sitemapMissRate`, `residualMissRate` null). The
stored JSON keeps every existing key (`missRate`, `applicable`, `mode`, `capped`,
counts, `sample`) and only **adds** `sitemapMissRate`/`sitemapApplicable`/
`residualMissRate`/`residualApplicable`/`hybridCapped`; all readers of
`discoveryCoverageJson` tolerate additive fields. `DiscoveryMode` type gains
`'hybrid'`. The Increment-1 unit tests (which pass no `sitemapBaseline`) stay green
unchanged — a hard regression guard on back-compat.

## Data flow

```
seoIntent site audit → site-audit-discover job
  → discoverPages(domain, {hybrid:true})
      → sitemap/shallow seed resolution (today's code)
      → hybridCrawl(seeds, host, bounds, {fetchPageLinks}, robots)   [raw HTTP BFS]
      → { urls (≤1000), mode:'hybrid', capped, sources }
  → persist discoveredUrls + discoverySourcesJson + discoveryMode='hybrid' (first-writer-wins)
  → children + page-job fan-out (unchanged)
... audit runs, pages harvested (unchanged) ...
→ broken-link-verify builder
  → computeDiscoveryCoverage({discoveredUrls, sitemapBaseline (from sources), internalLinks, mode, capped})
  → CrawlRun.discoveryCoverageJson = { …, sitemapMissRate, residualMissRate }
```

## Error handling & failure modes

- **Crawl fetch failures** (`fetchPageLinks` null): that frontier node contributes
  no links; crawl continues. A crawl that adds zero pages degrades to the seed set
  (mode may stay `'sitemap'`/`'shallow-crawl'`).
- **Time budget vs job timeout**: crawl budget (120 s) < discover-job timeout
  (300 s) with margin for the ~2000 child inserts. If a future env bump raises the
  crawl budget near 300 s, the discover-job `timeoutMs` must be raised in lockstep
  — called out in the plan.
- **Idempotent resume**: discovery still persists first-writer-wins; a crash/retry
  re-runs the crawl but the persisted set wins, so every attempt fans out the same
  URLs (crawl non-determinism across attempts is absorbed by first-writer-wins).
- **SSRF**: every crawl fetch goes through `safeFetch`/`assertSafeHttpUrl` exactly
  as the existing sitemap/shallow fetches do — no new egress surface.
- **1000-cap**: enforced on the final set after the crawl; sitemap/seed URLs kept
  ahead of linked ones so a cap never drops publisher pages in favor of crawled ones.

## Testing strategy

Pure units, synthetic HTML/URL fixtures, **no live scanning** (owner rule 3):
- `hybrid-crawl.test.ts` — BFS bounding (each `stoppedBy`: depth / maxAdded /
  maxFetches / timeBudget / hardCap / exhausted), dedup via normalizer, source
  precedence (sitemap wins over a later linked hit), deterministic ordering, hardCap
  keeps sitemap ahead of linked, trap heuristics (query-variant cap, path-segment
  depth), and the injected fetcher returning an off-host `finalUrl` → its links
  are dropped (Codex #7).
- `robots-rules.test.ts` — parse `*`/UA groups, longest-match, `Allow` override,
  `Disallow` applies to linked not sitemap.
- `discovery-coverage.test.ts` (extend) — `sitemapMissRate` vs `residualMissRate`;
  non-hybrid back-compat (no `sitemapBaseline` ⇒ today's numbers); hybrid case.
- `sitemap-crawler` — `discoverPages` with `hybrid:false` unchanged (regression);
  `hybrid:true` with an injected fetcher produces the expanded set + sources.
- Builder test — coverage call passes the derived `sitemapBaseline`.

Gates: `npm run lint` + `DATABASE_URL="file:./local-dev.db" npm test` +
`npm run build`.

## Prod verification (post-deploy)

Re-run a seoIntent audit on a client already in the system with a known high
miss-rate (manhattan 37.4% or cambria 21.1%). Expect: `discoveryMode:'hybrid'`,
`discoverySourcesJson` populated (mix of sitemap + linked, with `sitemapCount`,
`sitemapCapped`, `stoppedBy`, `fetches`), the audited page count above the
sitemap-only count, and on the live-scan run `sitemapMissRate` ≈ the cycle-1
number with `residualMissRate` materially lower. **Record which bound stopped the
crawl** (`stoppedBy`) alongside both rates in the parity log (Codex verify item) —
if it's `maxFetches`/`maxAdded` on a high-miss site, that's the signal to bump the
env caps. Also confirm no seoIntent client currently has `Client.seedUrls` set (the
pre-discovered path has no traffic yet). Never scan non-client sites.

## Env vars (all new, moderate defaults)

| Var | Default | Meaning |
|---|---|---|
| `HYBRID_CRAWL_MAX_DEPTH` | 3 | BFS hops from seeds |
| `HYBRID_CRAWL_MAX_ADDED` | 300 | max `linked` pages beyond the seed set |
| `HYBRID_CRAWL_MAX_FETCHES` | 400 | max total `fetchPageLinks` calls (Codex #6 — caps fetches, not just additions; politeness + runtime guard) |
| `HYBRID_CRAWL_TIME_BUDGET_MS` | 120000 | crawl wall-clock budget ceiling (clamped down by remaining job time, Codex #5) |
| `HYBRID_CRAWL_CONCURRENCY` | 6 | concurrent frontier fetches |
| `HYBRID_CRAWL_MAX_QUERY_VARIANTS_PER_PATH` | 5 | faceted-nav trap guard |
| `HYBRID_CRAWL_MAX_PATH_SEGMENTS` | 12 | calendar/deep-path trap guard |

Registered in the config surface per `er-seo-tools-config-and-flags`; a bad value
must never crash boot (parse-with-fallback, like existing tunables).

## Codex review outcome (2026-07-06, ACCEPT-WITH-FIXES — all applied above)

All four open questions were resolved by Codex (session `019f2b57…`), plus six
additional named fixes, all folded into the spec:

1. Discovery-time raw-HTTP BFS **is** the right seam. First-writer semantics
   corrected to "first *successful persist* wins."
2. Deriving `sitemapBaseline` from the source map **is** cleaner than a separate
   column — but the map must carry cap metadata (`sitemapCapped`) → versioned object.
3. robots "Disallow → linked frontier only, sitemap kept" is defensible **as
   continuity**; v1 honors `User-agent: *` only.
4. Trap heuristics needed a **total fetch cap** (`HYBRID_CRAWL_MAX_FETCHES`) added.
5. Pre-discovered seoIntent (seed-URL) audits — gap closed with a hybrid-expand path.
6. Source map persisted atomically with `discoveredUrls`; ensure-repair preserves it.
7. Crawl budget clamped to remaining job time (not fixed 120 s).
8. `fetchPageLinks` checks the post-redirect final URL; extraction uses `normalizeLinkTarget`.
9. Coverage output split into per-rate applicability flags.
10. Concurrency confirmed safe (no DB writes during crawl; write-lock incident not reopened).

**Kevin-verify items Codex flagged (also in Prod verification / plan):** count
seoIntent clients with `Client.seedUrls` (currently zero per the parity log);
measure worst-case existing sitemap discovery time before trusting the 120 s ceiling;
in prod, record which bound (`maxFetches`/`maxAdded`/`hardCap`/depth/time) stopped
the crawl alongside the two miss-rates.
