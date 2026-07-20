# Hybrid-discovery under-expansion fix — design

**Date:** 2026-07-20
**Author:** Claude (session: SF-retirement Phase 2, under-expansion fix)
**Status:** Draft → Codex review → plan
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
4. **Transparency:** `residualMissRate` becomes content-filtered (the gate
   number). Retain the unfiltered figure as `residualMissRateRaw` and add
   `nonContentExcludedCount` so nothing is hidden (parity log + ledger cite
   both). This is NOT the rejected dual-*gate* design — one gate number, one
   companion audit number. The same content filter applies to `missRate` and
   `sitemapMissRate` for consistency (documented).

**Tests:** pure `computeDiscoveryCoverage` fixtures — one per pattern class
(param collapse, `%C2%A0` collapse, pagination, taxonomy, thank-you, account),
plus a "raw vs filtered" fixture asserting `residualMissRateRaw` ≥
`residualMissRate` and `nonContentExcludedCount` correct. Existing tests updated
for the new fields.

**Expected effect** (from samples): soma clears (~all pagination), nuvani → ~4%,
federico → ~7%, cambria → ~9% (real program pages remain → needs L2).

### L2 — rendered-DOM adaptive discovery (fixes the JS-blind clients)

**New file:** `lib/ada-audit/seo/rendered-crawl.ts` (or extend
`sitemap-crawler-browser-fetch.ts`) exporting
`fetchPageLinksViaBrowser(url, auditedHost): Promise<FetchedPage | null>` —
renders via `acquirePage()`, navigates (`domcontentloaded` + a short bounded
settle), `page.evaluate` reads `[...document.querySelectorAll('a[href]')]
.map(a => a.href)`, returns `{ links, finalUrl }`. Owns its **own SSRF
request-interception layer** (mirror `fetchSitemapViaBrowser` exactly — the
runner's interception is not inherited). `releasePage` in `finally`. Same
`FetchedPage` shape as the raw fetcher, so it plugs straight into
`hybridCrawl(deps.fetchPageLinks)`.

**Wiring** in `discoverPages` / `discoverPagesWithDeps`:
1. Run the existing raw-HTTP hybrid crawl (unchanged — cheap, catches raw-HTML
   sites: manhattan/healthcarecareer/beal).
2. **JS-blindness probe** (1 render): render the homepage, count same-domain
   rendered links; compare to the raw-HTTP homepage same-domain link count. If
   `rendered − raw ≥ HYBRID_RENDER_PROBE_MIN_DELTA` (default 5), the site is
   JS-rendered → proceed. Else skip the whole rendered pass (raw-HTML site).
3. **Bounded rendered BFS:** reuse `hybridCrawl` with
   `deps.fetchPageLinks = fetchPageLinksViaBrowser`, seeds = existing discovered
   set + the homepage's rendered links (+ a detected `/site-map*` page if
   present — highest link yield), and **tight bounds**:
   - `HYBRID_RENDER_MAX_DEPTH` (default 2)
   - `HYBRID_RENDER_MAX_FETCHES` (default 40)
   - `HYBRID_RENDER_MAX_ADDED` (default 300)
   - `HYBRID_RENDER_CONCURRENCY` (default 2 — ≤ pool size 4, pool-safe)
   - `timeBudgetMs` = `min(HYBRID_RENDER_TIME_BUDGET_MS default 90_000,
     remaining job budget − INSERT_RESERVE)`; if `< CRAWL_FLOOR_MS`, skip.
4. **Union + dedupe** raw-crawl urls ∪ rendered-crawl urls, apply `HARD_CAP`.
   `mode` = `'hybrid'` (rendered pass recorded in coverage stats:
   `renderedProbeTriggered`, `renderedFetches`, `renderedAdded`, `renderStoppedBy`).

**Memory safety (the crux):**
- Discovery runs *before* this audit's page jobs fan out, so the pool is not
  contended by this audit. A concurrent standalone ADA audit (≤2) shares the
  pool; the pool semaphore serializes — the rendered crawl *waits* for slots,
  never oversubscribes. `BROWSER_POOL_SIZE` unchanged (≤4).
- `HYBRID_RENDER_CONCURRENCY` default 2 ⇒ ≤2 in-flight Chrome pages from
  discovery. `HYBRID_RENDER_MAX_FETCHES` (40) bounds total renders. The pool's
  recycle gate (`SITE_AUDIT_BROWSER_RECYCLE_PAGES`) still applies.
- The probe is a single render (~5 s); the whole pass is time-budgeted and
  degrades to whatever it found by the deadline (never fails discovery).

**Time safety:** discover job timeout 300 s, `INSERT_RESERVE` 60 s, raw crawl
≤120 s. Rendered pass budget is clamped to remaining headroom and skipped when
insufficient (crash-resume late in the window falls back to raw-only).

**Tests:** wire-level via injected deps (mirror the existing
`discoverPagesWithDeps` deps pattern) — a fake browser fetcher returns rendered
links; assert: probe triggers the pass when `rendered−raw ≥ delta`; skips when
below; skips on insufficient time budget; union/dedupe correct; rendered urls
appear in output with correct provenance. `fetchPageLinksViaBrowser` itself
(Chrome-bound) is exercised only in prod verification; its SSRF interception is
copied verbatim from the proven `fetchSitemapViaBrowser` and asserted by a unit
test of the interception predicate if extractable.

**Prod verification:** re-run the ledger probe on cambria/glow/nuvani/brownson/
federico → residual drops below 5%; confirm PM2 memory stays flat during a
rendered-discovery audit (watch `mem` in `pm2 status` across a scan).

### L3 — bound adaptivity for large raw-HTML sites

For sites where raw HTTP *is* productive (healthcarecareer maxAdded@300; soma
maxFetches@400; beal timeBudget). Two parts:
1. **Raise raw-crawl default bounds** with headroom analysis:
   `HYBRID_CRAWL_MAX_FETCHES` 400→800, `HYBRID_CRAWL_MAX_ADDED` 300→600. Time
   budget stays 120 s (raise only if the job-timeout headroom proves it safe —
   spec the arithmetic: 800 fetches @ concurrency 6 ≈ 134 waves; each wave is
   one round-trip batch, well inside 120 s for healthy hosts, and the time
   budget is the backstop).
2. Confirm bounds are still *honestly* reported (`stoppedBy`, `capped`) so a
   client that still caps is flagged, not silently passed.

**Tests:** `hybridCrawl` bound-respect tests already exist; add cases at the new
default magnitudes; assert `stoppedBy`/`capped` unchanged in meaning.

**Note:** L3 helps healthcarecareer/soma/beal; discovery needs L2 (JS-blind).

## 5. Falsifiable gate (per increment)

The single falsifiable number is **per-client `discoveryCoverageJson
.residualMissRate` (content-filtered) ≤ 5%**, re-measured on prod after each
increment via the session's ledger probe
(`.claude/skills/.../scripts` or the scratch probe). Before/after per client is
recorded in the parity log. This feature's job is to get the *per-run* residual
≤5%; the **N=8 qualifying-sweeps clock** (campaign Phase 7) is separate and
starts only after a client's coverage first reaches ≤5%.

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Chrome memory regression (the scars) | `HYBRID_RENDER_CONCURRENCY` 2, `MAX_FETCHES` 40, pool size unchanged, discovery precedes fan-out, prod `mem` watch in verification |
| Rendered pass blows the discover job timeout | Time-budget-clamped to remaining headroom − INSERT_RESERVE; skip below CRAWL_FLOOR; degrade to partial |
| L1 reads as goalpost-gaming | Fuller filter is documented in the parity log; `residualMissRateRaw` + `nonContentExcludedCount` retained; only well-known non-content patterns; functional params never stripped |
| Non-content classifier over-excludes a real page | Conservative patterns (pagination/taxonomy/thank-you/account only); fixtures per class; raw number stays visible for audit |
| SSRF via the browser fetcher | Own request-interception layer copied verbatim from `fetchSitemapViaBrowser`; `assertSafeHttpUrl` on nav + every intercepted request; `lib/seo-fetch`/safe-url untouched |
| Two-pass discovery double-runs on crash-resume | Reuse the existing `discoverySourcesJson: null` first-writer-wins guard; rendered stats are part of the same atomic persist |

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
- L2: new `lib/ada-audit/seo/rendered-crawl.ts`; `sitemap-crawler.ts`
  (`discoverPages`/`discoverPagesWithDeps` wiring, new env tunables);
  `lib/jobs/config` env parsing; tests.
- L3: `sitemap-crawler.ts` env defaults; `hybrid-crawl.test.ts` cases;
  `docs`/config-and-flags reference.
- No `prisma/schema.prisma` change (coverage is JSON on `CrawlRun`; discovery
  provenance columns already exist).
