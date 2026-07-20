# Hybrid-discovery under-expansion fix — design

**Date:** 2026-07-20
**Author:** Claude (session: SF-retirement Phase 2, under-expansion fix)
**Status:** Codex-reviewed (gpt-5.6-sol, "accept with named fixes" — all 6 applied) → plan
**Campaign:** SF-retirement Phase 2 (hybrid discovery). Gates the fleet-wide
`residualMissRate ≤ 5%` STRICT retirement bar Kevin set 2026-07-20.
**Roadmap:** `docs/superpowers/nyi/2026-06-04-screaming-frog-retirement-roadmap.md` Phase 2.

---

## 1. Problem

Kevin's retirement bar (2026-07-20) requires **per-run discovery `residualMissRate
≤ 5%` STRICT** (no capped/blocked escape), fleet-wide, for N=8 qualifying weekly
seoIntent sweeps per client. The hybrid crawler (shipped 2026-07-06, roadmap
Increment 2) already closed manhattan's 38.5% gap to 2.7% — but a fresh 29-domain
prod sweep (probed this session) shows **~11 domains still exceed 5% residual**,
blocking the fleet-wide gate.

The handoff framed this as "frontier/depth tuning of the BFS." **The diagnosis
this session overturns that framing.**

## 2. Diagnosis (falsifiable — from prod, 2026-07-20)

Full 29-domain ledger + per-client mechanism pulled from prod
(`discoverySourcesJson.stoppedBy/fetches/sitemapCount`, `discoveryCoverageJson`).
The blocked clients split into **two distinct root causes**, plus a
measurement-noise problem:

### Root cause 1 — the raw-HTTP crawler is blind to JS-rendered navigation

The hybrid crawler (`lib/ada-audit/seo/hybrid-crawl.ts`) fetches pages via
**raw HTTP** (`fetchPageLinks` in `sitemap-crawler.ts`) and regex-extracts
`<a href>`. For JS-rendered sites the internal links are injected client-side and
are **absent from the raw HTML**. Decisive probe (this session) — the crawler's
exact raw-HTTP + regex path against these clients' hub pages:

| page | raw HTML bytes | total `<a href>` | same-host links |
|---|---|---|---|
| cambriacollege.ca/ | 120 KB | 11 | **0** |
| cambriacollege.ca/site-map | 103 KB | 8 | **0** |
| glowcollegecanada.ca/ | 95 KB | 6 | **0** |
| glowcollegecanada.ca/site-map | 118 KB | 3 | **0** |
| nuvani.edu/ | 82 KB | 4 | **0** |
| nuvani.edu/site-map | 73 KB | 1 | **0** |

Every page returns full-weight HTML but **zero same-host links** — the nav is
rendered by JS. The AXE audit sees these links only because it renders with
headless Chrome (`HarvestedLink`), which is precisely why coverage *knows* the
missed pages exist while discovery never found them. Affected (residual, added):

| client | residual | added | stoppedBy |
|---|---|---|---|
| cambria | 19.5% | 0 | exhausted |
| brownson | 18.1% | 1 | exhausted |
| federico | 14.5% | 1 | exhausted |
| glow | 12.9% | 0 | exhausted |
| nuvani | 11.5% | 0 | exhausted |

**Tuning BFS depth/frontier/fetches cannot help these** — there are no links in
the raw HTML to follow. The real missed pages (cambria `/education` `/healthcare`
`/news`, glow `/course/*`, nuvani `/locations/*-tx`) are rendered-DOM-only.

### Root cause 2 — genuine bound hits (raw HTTP *was* productive, got cut off)

| client | residual | stoppedBy | added |
|---|---|---|---|
| discovery | 40.8% | maxFetches@400 | 3 (of 623+ pages) |
| healthcarecareer | 14.9% | maxAdded@300 | 300 |
| soma | 9.7% | maxFetches@400 | 160 |
| beal | 6.9% | timeBudget@120s | 18 |

(discovery is *also* partially JS-blind — 400 raw fetches yielded only 3 links —
so it needs Root-cause-1 treatment more than bound tuning.)

### Measurement noise — a large share of "residual" is not missed *content*

From the stored `discoveryCoverageJson.sample`, much of the off-baseline set is
not auditable content:
- **Tracking-param variants** of already-audited pages: `?lead_src=cro_toolbar`,
  `?gclid=…`, `?gad=…`, `?position=…`.
- **Malformed URLs**: trailing `%C2%A0` (encoded non-breaking space) — broken
  links, not distinct pages.
- **Pagination**: `/blog/page/2…22`, `/category/*/page/N`, `/author/*/page/2`
  (soma's 9.7% is almost entirely this).
- **WP taxonomy archives**: `/category/*`, `/tag/*`, `/author/*`.
- **Form-confirmation pages**: `/thank-you*` (cambria alone has 8 variants).
- **Account pages**: `/my-account/*`.

Counting these as "missed pages" inflates residual with URLs no analyst audits
and SF itself typically excludes.

## 3. Goal & non-goals

**Goal:** every in-scope client's per-run `residualMissRate` (content-filtered)
drops to **≤ 5%** without raising `BROWSER_POOL_SIZE` and without regressing the
memory/time envelope (2026-06-22 build-OOM, 2026-07-16 verifier crash-loop scars).

**Non-goals:** changing canonical-run selection, the live SEO score, or the
audited-page cap semantics; retiring SF-as-keyword-joiner (separate gate);
folding crawl-depth into the score.

## 4. Approach — three sequenced increments

Kevin's decisions (2026-07-20):
- **Scope:** all three levers (L1 + L2 + L3), phased.
- **L1 aggressiveness:** *fuller* — params + malformed + non-content patterns,
  documented in the parity log so the bar's definition is explicit.

Each increment is an independent change-control cycle (spec → Codex → plan →
Codex → TDD → gate → PR → merge → deploy → prod re-measure). L1 ships first
(zero memory/network risk) and **re-baselines the ledger**, re-scoping L2/L3.

### L1 — coverage-metric normalization (residual counts indexable content pages)

**File:** `lib/ada-audit/seo/discovery-coverage.ts` (pure; no schema, no fetch).

1. **Extend tracking-param stripping** in `normalizeCoverageUrl`. Current set is
   `utm_*` only. Add the well-known tracking params seen in the data:
   `lead_src, gclid, gad, gbraid, wbraid, fbclid, msclkid, yclid, mc_cid,
   mc_eid, _ga`. **Do NOT strip functional params** (`position`, `page`, `s`,
   `p`) — those can be distinct pages. So `apply-online?lead_src=w-menu`
   collapses onto `/apply-online` (already in baseline → no longer missed).
2. **Trim trailing encoded whitespace** (`%C2%A0`, `%20`, literal whitespace) off
   the pathname so `/blog/x/%C2%A0` collapses onto `/blog/x/` (its real page)
   instead of counting as a distinct miss.
3. **Non-content pattern classifier** `isNonContentPath(pathname)` — a URL is
   excluded from BOTH the linked (numerator) set and the baseline (denominator)
   of the residual/miss computation when its pathname matches:
   - pagination: `/page/\d+/?$`
   - WP taxonomy: first segment ∈ `{category, tag, author}`
   - form-confirmation: last segment matches `^(thank-you|thank_you)(-.*)?$` or
     `.*-thank-you$`
   - account: first segment ∈ `{my-account}` (WooCommerce)
   These are applied uniformly to `linked` and every `base` set (`fullBaseline`,
   `sitemapSet`) so both numerator and denominator measure content pages only.
   **Honesty caveat (Codex F4):** taxonomy/author/pagination are NOT categorically
   non-content — they can be indexable landing pages, and pagination bridges to
   older articles. Thank-you/account are the safer exclusions. We keep the fuller
   set per Kevin's locked decision, but the metric and copy must call this a
   **"policy-filtered"** residual, never claim the heuristics identify "indexable
   content."
4. **Transparency (Codex F4):** `residualMissRate` becomes the single
   policy-filtered **gate** number. Retain the unfiltered `residualMissRateRaw`
   and add `nonContentExcludedCount` — **defined as distinct normalized URLs
   excluded** (not occurrences, not summed set sizes) — plus a per-reason
   breakdown `excludedByReason: { param, malformed, pagination, taxonomy,
   thankyou, account }` (counts, with bounded per-reason samples) so the parity
   log/ledger can show *which rule produced the pass*. One gate number, full
   transparency — NOT the rejected dual-*gate* design. The same content filter
   applies to `missRate` and `sitemapMissRate` for consistency (documented). The
   read-time `sample` (UI) is drawn from the **filtered** off-baseline set so it
   never shows URLs the metric no longer counts.

**Tests:** pure `computeDiscoveryCoverage` fixtures — one per pattern class
(param collapse, `%C2%A0` collapse, pagination, taxonomy, thank-you, account) +
`excludedByReason` correctness + `nonContentExcludedCount` as distinct-URL count.
**Codex F4 correction:** `residualMissRateRaw ≥ residualMissRate` is NOT an
invariant — filtering both sides can make the filtered rate *rise* (e.g. 100
content + 100 excluded baseline + 10 missed-content → raw `10/210 = 4.76%`,
filtered `10/110 = 9.09%`). Do NOT assert monotonicity; instead add an explicit
fixture proving the filtered rate can exceed the raw rate. Existing tests updated
for the new fields; sales `sitemapMissRatePct` consumer (`components/sales/
sections.tsx`) + `DiscoveryCoverageSection` re-checked against the filtered value.

**Expected effect** (from samples): soma clears (~all pagination), nuvani → ~4%,
federico → ~7%, cambria → ~9% (real program pages remain → needs L2).

### L2 — rendered-DOM adaptive discovery (fixes the JS-blind clients)

**New file:** `lib/ada-audit/seo/rendered-crawl.ts` exporting
`fetchPageLinksViaBrowser(url, auditedHost): Promise<FetchedPage | null>` —
renders via `acquirePage()`, navigates (`domcontentloaded` + a short bounded
settle), `page.evaluate` reads `[...document.querySelectorAll('a[href]')]
.map(a => a.href)`, returns `{ links, finalUrl }`. `releasePage` in `finally`.
Same `FetchedPage` shape as the raw fetcher so it plugs into `hybridCrawl`.

**Per-render bounds (Codex F1) — 40 pages is not a byte/DOM bound:**
- **Shared SSRF interceptor** (Codex F2): extract the request-interception layer
  from `fetchSitemapViaBrowser` into one helper both callers use (do not
  re-copy). It `assertSafeHttpUrl`s every request AND **aborts an off-domain
  main-frame redirect *before* the page renders** (rejecting `finalUrl`
  afterward would already have scanned a third-party page — the owner rule).
- The interceptor also **blocks `image`/`media`/`font`/`stylesheet` subresource
  loads** (we only need the DOM's `<a href>` graph) — caps per-render memory/time.
- **Cap returned anchors** per page (`HYBRID_RENDER_MAX_ANCHORS_PER_PAGE`,
  default ~1500) so a pathological DOM can't balloon the result array.

**Absolute discovery deadline (Codex F1) — the zombie-handler guard:** introduce
ONE absolute deadline (`Date.now() + budget`) covering seed resolution + raw
crawl + probe + rendered crawl + `INSERT_RESERVE`. Every phase checks it; nav +
settle timeouts are **clamped to the remaining deadline**; no new render wave
starts after it; `acquirePage()` is wrapped so a waiter that would block past the
deadline is **cancelled without leaking a semaphore slot** (a timed-out handler
must not later acquire and orphan a page). The existing pre-wave time check in
`hybridCrawl` is insufficient because `acquirePage()` can block indefinitely
behind other audits.

**Wiring** in `discoverPages` / `discoverPagesWithDeps`:
1. Run the existing raw-HTTP hybrid crawl (unchanged — cheap; catches raw-HTML
   sites: manhattan/healthcarecareer). Record the raw-discovered normalized-URL
   set as `knownUrls`.
2. **JS-blindness probe (Codex F3)** — bounded, novelty-based, not a raw-count
   delta. Render a **small bounded probe set**: the homepage **plus 1–2
   representative shallow hubs / `/site-map*` candidates** (catches the
   "SSR home, CSR-deep" shape a homepage-only probe misses). For each, collect
   rendered links, normalize + admit them through the **normal filters**
   (same-domain, robots `isAllowed`, non-page ext, path-segment, query-variant).
   Trigger the rendered pass when the count of **admissible rendered URLs novel
   vs `knownUrls`** ≥ `HYBRID_RENDER_PROBE_MIN_NOVEL` (default 5). This needs no
   raw-homepage-link instrumentation (novelty is measured against the raw crawl's
   output, which we already have). **Record probe failures** (nav error / WAF /
   consent block) as a distinct `renderProbe: 'failed'` state — NOT conflated
   with `'no-delta'` — so a blocked homepage is visible, not silently skipped.
3. **Bounded rendered BFS — corrected seed model (Codex F2).** Reuse
   `hybridCrawl` with `deps.fetchPageLinks = fetchPageLinksViaBrowser`, but do
   NOT pass the existing set as seeds (seeds bypass robots + traps and all become
   depth-0 fetch frontier → 40 renders wasted re-fetching known URLs, and
   homepage links would bypass robots). Instead the crawl takes three distinct
   inputs:
   - `knownUrls` — used for **dedup only, never fetched** (a new param on the
     crawl, or a pre-seeded `sources` map at a sentinel depth that is never
     enqueued to the frontier);
   - **true publisher seeds** — the homepage (+ detected `/site-map*`), fetched
     first, depth 0;
   - **rendered link candidates** — the probe's admissible novel URLs, entering
     through the **normal same-domain/robots/depth/query/non-page filters** (NOT
     as trusted seeds).
   The rendered frontier **prioritizes novel hubs** over already-known URLs.
   Bounds:
   - `HYBRID_RENDER_MAX_DEPTH` (default 2)
   - `HYBRID_RENDER_MAX_FETCHES` (default 40)
   - `HYBRID_RENDER_MAX_ADDED` (default 300)
   - `HYBRID_RENDER_CONCURRENCY` (default 2 — ≤ pool size 4)
   - deadline-clamped `timeBudgetMs` (above); skip if `< CRAWL_FLOOR_MS` remain.
4. **Merge by `normalizeCoverageUrl` with precedence (Codex F2)** — NOT a string
   `Set`. Union raw + rendered on the coverage key, preserving deterministic
   real-URL selection and source precedence (`sitemap > seed > shallow >
   rendered > linked`). Slice the merged result to `HARD_CAP` with the **same
   normalized-key operation** used for `discoveredUrls`. **Define HARD_CAP-full
   behavior:** if the raw pass already fills `HARD_CAP`, rendered URLs cannot
   silently vanish while the run reports healthy — either the rendered pass is
   skipped (recorded as `renderStoppedBy: 'hardCapPrefull'`) or novel rendered
   hubs displace lowest-precedence known URLs, deterministically; the chosen rule
   is recorded in coverage stats. `mode = 'hybrid'`; coverage stats gain
   `renderProbe` (`'skipped' | 'no-delta' | 'triggered' | 'failed'`),
   `renderedFetches`, `renderedAdded`, `renderStoppedBy`.

**Memory safety (the crux):**
- Discovery runs *before* this audit's page jobs fan out. A concurrent standalone
  ADA audit (≤2) shares the pool; the semaphore serializes — worst case is
  render-discovery (2) + standalone (2) = the full 4-slot pool, never exceeding
  it. `BROWSER_POOL_SIZE` unchanged (≤4).
- Per-render subresource blocking + anchor cap (above) bound each render's RSS.
  `HYBRID_RENDER_MAX_FETCHES` (40) bounds total renders; recycle gate applies.
- The absolute deadline + cancellable acquire prevent a zombie handler from
  holding/awaiting pages past the job timeout (Codex F1).

**Tests:** wire-level via injected deps (mirror `discoverPagesWithDeps`) — a fake
browser fetcher returns rendered links; assert: probe triggers on ≥ N **novel
admissible** URLs (not raw-count delta); the SSR-home/CSR-deep shape triggers via
a shallow-hub probe; probe-failure recorded distinctly from no-delta; `knownUrls`
are deduped but never fetched; rendered candidates pass through robots (a
`Disallow`ed rendered link is dropped); merge precedence + HARD_CAP-full rule;
deadline halts a new wave; a simulated blocking `acquire` past the deadline does
not leak a slot. `fetchPageLinksViaBrowser` (Chrome-bound) + the redirect-abort
interceptor are exercised in prod verification; the interceptor's abort predicate
gets a unit test (extract it as a pure function of request URL + type + host).

**Prod verification (Codex F1 — strengthened):** re-run the ledger probe on
cambria/glow/nuvani/brownson/federico → policy-filtered residual < 5%. Memory:
run the **worst case** — a render-discovery audit **while 2 standalone ADA audits
run** — and record **total process-tree RSS** (parent + all Chromium
descendants, e.g. `ps --ppid`/`pstree` RSS sum, not just `pm2 status` which omits
descendant RSS and short peaks), system memory headroom, and PM2 restart count,
against a **numeric pass threshold** (peak tree RSS stays under a stated MB
ceiling with ≥ N MB headroom, 0 restarts).

### L3 — bound adaptivity for large raw-HTML sites

For sites where raw HTTP *is* productive (healthcarecareer maxAdded@300; soma
maxFetches@400). Two parts:
1. **Raise raw-crawl default bounds** with headroom analysis:
   `HYBRID_CRAWL_MAX_FETCHES` 400→800, `HYBRID_CRAWL_MAX_ADDED` 300→600. Time
   budget stays 120 s (raise only if the job-timeout headroom proves it safe —
   spec the arithmetic: 800 fetches @ concurrency 6 ≈ 134 waves; each wave is
   one round-trip batch, well inside 120 s for healthy hosts, and the time
   budget is the backstop).
2. Confirm bounds are still *honestly* reported (`stoppedBy`, `capped`) so a
   client that still caps is flagged, not silently passed.

**Codex F6 — Beal correction:** Beal stops on the **120 s time budget**, not on
maxFetches/maxAdded, so raising fetch/added caps does nothing for it. Two
options, decide in the plan: (a) under the single **absolute deadline** (L2/F1),
let a productive raw crawl consume unused rendered-pass headroom (a raw-HTML site
never triggers the rendered pass, so its budget is free) — this is the preferred
fix and helps Beal without a fixed-budget bump; or (b) drop Beal from L3's
expected effect and let it ride the deadline. **Do not** claim L3's cap raises
help Beal.

**Tests:** `hybridCrawl` bound-respect tests already exist; add cases at the new
default magnitudes; assert `stoppedBy`/`capped` unchanged in meaning; if (a),
test that a raw-only run may use the freed rendered budget.

**Note:** L3 helps healthcarecareer/soma (+ Beal via option (a)); discovery
needs L2 (JS-blind).

### Persistence & provenance contract (Codex F5)

Both discovery passes are computed **before one row update** (never persist the
raw pass as an intermediate state), preserving atomic URL/source tuples. Guards
must be exact, not the spec's earlier loose phrasing:
- **Fresh discovery** persist is guarded by `discoveredUrls: null` (+
  `status: 'running'`); **pre-discovered expansion** by
  `discoverySourcesJson: null` (+ `status: 'running'`). Preserve BOTH explicitly.
- **Deterministic source-map merge:** raw + rendered maps merge by
  `normalizeCoverageUrl` key with the fixed precedence above. A new
  `rendered`/`rendered-linked` provenance value ⇒ bump `discoverySourcesJson`
  to **`{ v: 2, ... }`** (readers tolerate v1).
- The source map is **sliced by the exact same normalized-key HARD_CAP
  operation** as `discoveredUrls`, so `sources` and `urls` stay 1:1.
- **Concurrent-attempt test:** two attempts producing different rendered results
  → exactly one coherent (urls, sources) tuple wins; the loser re-reads that
  tuple and the ensure-normalize step never overwrites it back to raw-only.

### Fail-closed: clients no lever can solve (Codex F6)

The coverage metric only sees targets harvested from **audited** pages, so an
entirely unlinked cluster is absent from its own denominator. Explicitly accept
that some clients cannot reach ≤5% by L1–L3 and must **stay on SF / manual
discovery** — an honest campaign outcome, not a design failure. A client stays on
fallback (and its N=8 clock does NOT start) when:
- it has **> 1,000 relevant pages** while the `HARD_CAP` semantics are unchanged;
- routes are exposed only by **form POST, button click, infinite scroll, or
  router state with no rendered `href`** (invisible even to the rendered pass —
  out of scope);
- there are **isolated link clusters** with no link from any audited page.
Surface this as a labeled state in the ledger (`fallback: 'sf-required'` +
reason), never a silent sub-5% pass.

## 5. Falsifiable gate (per increment)

The single falsifiable number is **per-client `discoveryCoverageJson
.residualMissRate` (policy-filtered) ≤ 5%**, re-measured on prod after each
increment via the session's ledger probe
(`.claude/skills/.../scripts` or the scratch probe). Before/after per client is
recorded in the parity log alongside `residualMissRateRaw` +
`nonContentExcludedCount` + the per-reason breakdown. This feature's job is to
get the *per-run* residual ≤5%; the **N=8 qualifying-sweeps clock** (campaign
Phase 7) is separate and starts only after a client's coverage first reaches ≤5%
(and never starts for a `fallback: 'sf-required'` client).

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Chrome memory regression (the scars) | `HYBRID_RENDER_CONCURRENCY` 2 + per-render subresource blocking + anchor cap; pool size unchanged; discovery precedes fan-out; worst-case process-tree-RSS verification with a numeric threshold (Codex F1) |
| Zombie handler holds/awaits pages past job timeout | Single absolute discovery deadline across all phases; cancellable `acquirePage` that never leaks a slot; nav/settle clamped to remaining deadline; no wave starts after deadline (Codex F1) |
| Rendered pass wastes budget re-fetching known URLs / bypasses robots | Corrected seed model: `knownUrls` deduped-not-fetched, homepage = only publisher seed, rendered candidates through normal robots/filters, novel hubs prioritized (Codex F2) |
| Probe false-negative (SSR home, CSR-deep; sparse home; WAF-blocked home) | Novelty-based trigger over a bounded probe set (home + 1–2 shallow hubs); probe-failure recorded distinctly from no-delta (Codex F3) |
| L1 reads as goalpost-gaming | Single **policy-filtered** gate + `residualMissRateRaw` + `nonContentExcludedCount` + per-reason breakdown, all in the parity log; functional params never stripped; wording never claims "indexable content" (Codex F4) |
| Non-content classifier over-excludes a real page | Taxonomy/pagination flagged as NOT categorically non-content (Codex F4); per-reason samples visible; raw number retained; thank-you/account are the safe exclusions |
| SSRF via the browser fetcher | ONE extracted (not re-copied) interceptor; `assertSafeHttpUrl` per request; **off-domain main-frame redirect aborted before render**; subresources blocked; `lib/seo-fetch`/safe-url untouched (Codex F2) |
| Two-pass persist race / provenance drift | Exact guards (`discoveredUrls:null` fresh / `discoverySourcesJson:null` pre-discovered, both + `status:'running'`); no intermediate raw persist; deterministic merge; `sources` sliced by same HARD_CAP op; concurrent-attempt test (Codex F5) |
| Client unsolvable by any lever | Explicit `fallback: 'sf-required'` state + reason; N=8 clock never starts; never a silent sub-5% pass (Codex F6) |

## 7. Sequencing & session plan

1. **L1** — ship first (pure, no memory), deploy, re-baseline the 29-domain
   ledger, update the parity log with raw-vs-filtered per client.
2. **L2** — the long pole; ship after L1 re-scoping, prod-verify residual +
   memory on cambria/glow/nuvani.
3. **L3** — modest default bump + tests; ship, prod-verify
   healthcarecareer/soma/beal.

Each increment: own plan, own PR, own deploy, own prod re-measure, own
tracker/parity-log update. Realistically L1 lands fully this session; L2/L3
follow (own plans, possibly next session).

## 8. Files touched (anticipated)

- L1: `lib/ada-audit/seo/discovery-coverage.ts` (+ its test); readers of the new
  fields (ledger/log only — no UI change required, but check
  `components/site-audit/DiscoveryCoverageSection.tsx` for raw-vs-filtered
  labeling).
- L2: new `lib/ada-audit/seo/rendered-crawl.ts` (`fetchPageLinksViaBrowser` +
  probe); **extract** the shared SSRF interceptor from
  `sitemap-crawler-browser-fetch.ts` into a helper both callers use (redirect
  abort-before-render + subresource blocking); `hybrid-crawl.ts` (`knownUrls`
  dedup-not-fetched input + novel-hub priority + absolute-deadline plumbing);
  a cancellable `acquirePage` wrapper (in `rendered-crawl.ts` or `browser-pool.ts`);
  `sitemap-crawler.ts` (`discoverPages`/`discoverPagesWithDeps` wiring, deadline,
  merge-by-normalized-key, HARD_CAP-full rule, new env tunables); the
  `site-audit-discover.ts` persist branches (exact guards + v2 source map);
  `lib/jobs/config` env parsing; tests.
- L3: `sitemap-crawler.ts` env defaults + (option a) raw-crawl budget reuse;
  `hybrid-crawl.test.ts` cases; `docs`/config-and-flags reference.
- No `prisma/schema.prisma` change (coverage is JSON on `CrawlRun`; discovery
  provenance columns already exist).
