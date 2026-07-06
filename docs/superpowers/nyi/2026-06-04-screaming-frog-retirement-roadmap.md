# Retiring Screaming Frog — Roadmap & Honest Gap Analysis

**Date:** 2026-06-04
**Status:** Strategy doc (NYI). Co-authored by Claude + Codex (peer review), grounded in the er-seo-tools codebase.
**Related:** `nyi/specs/2026-06-02-live-seo-on-ada-design.md`, `plans/2026-06-02-live-seo-on-ada.md`

---

## TL;DR — the honest thesis

**"Full retirement" is the wrong target. The right target is to demote Screaming Frog from a *routine* tool to a *deliberate fallback*.**

The Live SEO Audit (built on the nightly ADA headless-Chrome scan) can realistically own **recurring monitoring of pages we already know about** — title/meta/headings/canonical/schema/indexability/thin content, **audited-set internal-link authority** (relative inlinks over the sitemap set, not site-wide), and (with the phases below) broken links and content similarity. That covers the large majority of what our actual deliverables read. Full site-wide authority/depth/orphan parity arrives only with the discovery phase (Phase 2/3b) — or stays with SF.

What it cannot own — even after a full build — is **discovering and traversing what isn't in the sitemap**, plus a cluster of **workflow, configurability, and trust** capabilities that only a mature crawler product provides. Those are why SF stays in the toolbox as a few-times-a-year instrument, not a monthly one.

So the realistic end state: **stop running SF on every client every cycle; keep SF for discovery sweeps, migrations, staging/QA, competitor/ad-hoc audits, and any low-confidence live run.** That's a *potentially large* reduction in SF dependence (a rough estimate to confirm during the parallel-run period, §4), not 100%.

---

## Where we are today (baseline)

- **Live SEO MVP** (spec + plan written, Codex-reviewed): per-page extraction inside the ADA scan → `PageSeoSnapshot` + `SiteSeoResult`, a forked live scorer, a "graph over audited pages," rendered through existing seo-parser report components. Adds ~1–5% per-page time.
- **What our deliverables actually consume from SF today** (grounded):
  - `lib/services/brief.service.ts` — `inlinks` as an authority proxy (ranks programs; flags orphans where `inlinks === 0`).
  - `lib/services/pillarAnalysis.service.ts` — per-URL `crawlDepth`, `inlinks`, `outlinks`.
  - `lib/services/priority.service.ts` — broken links are the **top roadmap weights**: `broken_pages:100`, `broken_internal_links:90`, `broken_images:85`.
- **Fleet reality:** ~32 client domains, ~5,000 pages, full fleet in ~3.7h with ~10h of nightly headroom. Single VPS, SQLite, PM2, no serverless.

---

## 1. Capability gap inventory (what SF gives us that the MVP does not)

Tagged: **(A)** irreducible without changing the crawl/discovery model · **(B)** buildable with effort · **(C)** not-SF-at-all (an API integration SF merely joins).

| Capability | Tag | Notes |
|---|---|---|
| Discovery of pages **not in the sitemap** (unknown/legacy/parameterized/hidden) | **A** | `discoverPages()` is sitemap-first with a shallow homepage fallback — not a full reachability crawl, so it can't *prove* reachability the way SF does. |
| True **crawl depth** (clicks-from-home) | **A** | Consumed by `pillarAnalysis.service.ts`; a flat URL set has no native depth. |
| SF **Link Score** parity | **A** | We can build a *useful ER authority score*, but not SF's exact metric. |
| True **orphan detection** | **A** | `inlinks === 0` only means "not linked by audited pages" without a reachability crawl + sitemap/GSC/log comparison. |
| Exact SF **crawl semantics** (include/exclude, frontier, JS mode, normalization, cap behavior) | **A** | Definitional; only matched by re-implementing a crawler. |
| **Broken** pages / internal links / images / JS / CSS / PDFs | **B** | Highest-value gap (top of `priority.service.ts`). Needs a throttled, deduped out-of-band verifier. |
| **Redirect chains** (beyond the audited page's own redirect) | **B** | Capture per-page now; resolve harvested URLs out of band. |
| **Canonical / hreflang validation** (target fetch + status + return-link) | **B** | MVP classifies tags; validation needs a shared URL-resolver pass. |
| **Anchor-text** analysis | **B** | Buildable from harvested `<a>` text/targets — but NOT captured yet (verified 2026-07-06): `HarvestedLink` persists only `sourcePageUrl`/`targetUrl`/`kind`, so anchor text dies in the page evaluate. SF's `all_anchor_text.csv` (→ `AnchorTextParser`) is today the ONLY source of the `empty_anchor_text` / `non_descriptive_anchor_text` / `single_anchor_variation` findings + anchor-diversity stats. See the Phase 4/5 note below. |
| **Resource inventory + size** checks | **B** | Needs network-event capture or follow-up HEAD/GET. |
| **Exact + near-duplicate** content | **B** | MVP does exact title/meta/H1 only; real similarity needs hashing/shingling/MinHash + boilerplate control. |
| **Structured-data validation** (errors/warnings) | **B** | Type extraction is cheap; validation needs a validator/external API. |
| **Sitemap hygiene** (sitemap URLs that 404/redirect/non-indexable) | **B** | Buildable if discovered URLs + fetch outcomes are retained beyond the audited set. |
| **Security / mixed-content** | **B** | Buildable from DOM + network events. |
| Readability / spelling / grammar / best-practice style outputs | **B** | Buildable, lower-confidence, lower-priority. |
| **GSC / Search Console** (impressions, clicks, position) | **C** | SF only joins it; integrate the API directly. |
| **GA4** (sessions, views, engagement) | **C** | Same — direct integration. |
| **SEMRush / DataForSEO** (rankings, gaps, volume) | **C** | Same — direct integration. |
| **PSI / Lighthouse / CWV** | **C** | Already integrated separately; treat as performance telemetry, not crawl output. |

**Takeaway:** the (C) items never required SF in the first place — SF is just a convenient joiner. The (B) list is long but tractable. The (A) list is the real moat, and it's smaller than it looks: it's fundamentally *discovery + exact-metric parity*.

---

## 2. Phased roadmap (MVP → SF-retirement candidate)

Effort: **S** ≈ days · **M** ≈ 1–2 wks · **L** ≈ 3+ wks. Each phase is independently shippable.

### Phase 0 — Live SEO MVP *(done: spec + plan)*
- **Effort:** M (specified). **Unlocks:** rendered on-page + response signals, relative internal-link graph, coverage/confidence.
- **Risk:** honest confidence/coverage labeling. **Gate:** the existing acceptance criteria.

### Phase 1 — Out-of-band broken-link / resource verifier  ⭐ highest priority
- **Effort:** M/L. **Architecture:** a deduped queue over harvested internal links + images/CSS/JS/PDFs, run *after* the crawl (not per-page), same-domain first, throttled, HEAD with GET fallback, cached, capped.
- **Unlocks:** the top-weighted roadmap items (`broken_pages/links/images`) — the single biggest reason the live audit can't yet replace SF for the roadmap deliverable.
- **Risk:** WAF/CDN bans from a fixed VPS IP, third-party-URL false positives, long tails, SQLite growth. **Mitigation:** same-domain-first, aggressive throttle, retry policy, confidence-labeled, results stored separately with retention.
- **Why first:** it converts the most consequential deferred gap and rides entirely on data the MVP already harvests.

### Phase 2 — Hybrid discovery: sitemap + capped BFS
- **Effort:** L. **Architecture:** extend `discoverPages()` from a flat sitemap list to a capped, same-domain frontier crawl that tags each URL by source (`sitemap | linked | seed | manual`).
- **Unlocks:** the **(A)** moat partially — unknown reachable pages and an *approximate* crawl depth.
- **Risk:** crawl traps (calendars, faceted search, infinite params), runtime, robots/canonical policy, the 1000-page cap interacting with BFS. **Mitigation:** strict caps, trap heuristics, robots respect, depth ceiling.
- **Note:** this is the phase that changes the tool's *character* (scanner → crawler). Biggest architectural commitment; weigh against just keeping SF for discovery.

### Phase 3a — Audited-set link graph *(no discovery dependency)*
- **Effort:** M. **Architecture:** persist normalized edges from harvested outlinks; compute **relative inlink counts and an "ER authority score" over the audited (sitemap) set**.
- **Unlocks:** a labeled **"audited-set authority/inlinks"** replacement for the graph fields `brief.service.ts` and `pillarAnalysis.service.ts` consume — good enough for ranking/orphan-within-known-set, with the coverage caveat surfaced.
- **Risk:** nav/template links dominate unless weighted; coverage-biased to the sitemap; do **not** label as SF Link Score.

### Phase 3b — Reachability graph + true depth *(requires Phase 2)*
- **Effort:** M (after Phase 2). **Architecture:** extend 3a's edges with BFS-discovered nodes; compute approximate clicks-from-home depth and authority over the *reachable* set.
- **Unlocks:** the closest we get to SF's crawl-graph fields (depth, true-er orphans). Still an approximation, not parity.
- **Risk:** inherits Phase 2's crawl-trap/runtime risks.

### Phase 4 — Redirect / canonical / hreflang validation
- **Effort:** M. **Architecture:** one shared URL-resolver service used by canonical, hreflang, redirect-chain, and sitemap-hygiene checks.
- **Unlocks:** technical-SEO parity beyond tag extraction. **Risk:** cross-domain behavior, rate limits.

### Phase 5 — Content similarity + quality layer
- **Effort:** M/L. **Architecture:** store normalized text fingerprints, exact hashes, near-duplicate signatures (MinHash/SimHash), readability metrics.
- **Unlocks:** duplicate/near-duplicate parity. **Risk:** boilerplate and rendered-text variance → false positives.

> **Note (2026-07-06) — anchor-text capture must land before the Phase 7 gate.**
> Full-export sweep vs the parser (Nuvani, all 629 SF exports) confirmed the SF
> input contract is otherwise complete: `all_outlinks` and `all_anchor_text` ARE
> parsed (`ExternalLinksParser`/`AnchorTextParser`), `all_inlinks` is redundant
> with `all_anchor_text` + `internal_all` and correctly ignored. The ONE dataset
> that exists nowhere in the live pipeline is **anchor text**: the harvest
> `page.evaluate` reads every `<a>` but persists only source/target/kind
> (`HarvestedLink`), so anchor-quality findings are SF-only today. Cheapest fix
> (Phase 4/5-adjacent, spec it then): capture trimmed anchor text in the SAME
> harvest evaluate (zero extra round-trips, bounded length), ride the existing
> post-settle persist, and emit the three anchor findings in the
> `broken-link-verify` builder from rows it already reads. Until then the Phase 1
> parity log will show anchor types as expected "—" rows — record, don't chase.

### Phase 6 — Non-crawl integrations (GSC / GA4 / SEMRush)
- **Effort:** M/L. **Architecture:** direct API ingestion keyed to client/session; feeds `keyword_signals` and the keyword/pillar memos.
- **Unlocks:** keyword/performance workflows **without SF as the joiner** — removes a whole class of SF dependence. Note the distinction: this phase is *not* required to replace SF's **crawler**; it's required to retire SF as a **data joiner** (the role where it merely imports GSC/GA4/SEMRush and stitches them to URLs). Both must be addressed for full demotion.
- **Risk:** credentials, quotas, client mapping, data-freshness semantics.

### Phase 7 — Operational retirement gate
- **Effort:** M. **Architecture:** side-by-side SF-vs-Live comparison reports, source labels, confidence banners, an analyst QA workflow.
- **Unlocks:** safe demotion of SF. **Risk:** analysts lose trust if discrepancies aren't explained — so explain them.

---

## 3. The honest residual gaps (what we still lose by dropping SF — even after the full build)

This is the section that matters. Even with every phase above shipped, dropping SF entirely costs us:

1. **Discovery-of-the-unknown is never fully equal.** Even hybrid BFS is capped and trap-averse; SF's mature frontier finds things our crawl won't. If a client's sitemap is bad, the live audit is partially blind in exactly the cases that matter most.
2. **List mode / arbitrary-URL crawls.** SF crawls *any* set of URLs on demand — a competitor site, a migration staging host, a random list from a spreadsheet. The live audit is bound to client `SiteAudit` records. Ad-hoc investigation is a SF strength we won't replicate.
3. **Configurable crawling.** SF exposes include/exclude rules, URL rewriting, custom user-agents, auth/forms, JS-rendering modes, robots overrides. Our scanner has one opinionated configuration. "Crawl this section only, rendering off, following these params" is a SF-only move.
4. **Custom extraction (XPath/CSS).** Analysts can pull arbitrary fields from a page in SF without an engineering change. Our extraction is fixed in code; new fields require a deploy.
5. **Exact metric definitions.** Crawl depth, Link Score, orphan pages, and SF's issue taxonomy have precise, trusted definitions. Our equivalents are *different measures* (and will produce different numbers — partly because we render JS and SF by default doesn't).
6. **Log-file analysis & specialist exports.** Entirely outside our scope.
7. **"Why was this URL crawled / not crawled?"** SF is a strong debugging instrument for crawl behavior. Our pipeline is harder to interrogate when coverage looks wrong.
8. **Desktop-origin trust.** A nightly VPS crawler may be treated differently by WAFs/CDNs than Kevin's desktop SF run — different blocks, different results, on the same site.
9. **Battle-tested trust.** SF is a known quantity analysts rely on. A new in-house tool earns that trust only through documented side-by-side agreement over time.
10. **Large-site scalability.** A single VPS + SQLite handles ER's current fleet comfortably, but not arbitrary 50k+ page crawls or one-off giant audits without more infrastructure.

Put plainly: we can replace SF's **data for our known clients**; we cannot easily replace SF as a **flexible, trusted, general-purpose crawler/investigation tool.** That capability is worth keeping on the shelf.

---

## 4. Retirement decision gate

Safe to demote SF from routine client work only when **all** of these hold:

- [ ] Live SEO runs the full fleet successfully for several consecutive weeks with stable timing and clear coverage metrics.
- [ ] Sitemap/discovery coverage exceeds a defined threshold (e.g. **90–95%** of known pages) unless explicitly capped/blocked — surfaced per run.
- [ ] **Phase 1 broken-link verification** is shipped and validated against SF on representative clients (this is the top roadmap category).
- [ ] Graph signals are good enough for `brief.service.ts` and `pillarAnalysis.service.ts`, labeled **"ER authority/inlinks,"** not "SF Link Score."
- [ ] Documented, explainable variance from **side-by-side SF vs Live** comparisons on a representative client set.
- [ ] GSC/GA4/SEMRush have **independent ingestion** (Phase 6), so SF is not still needed as a data joiner.
- [ ] Dashboards, roadmap generation, and Teamwork outputs default to Live SEO as the source.

**Parallel-run period (required before any process change):** run SF *and* Live SEO side-by-side for **2–3 normal reporting cycles** across a representative client set, with documented variance, before SF leaves the routine process. Trust is earned by demonstrated agreement, not by a launch date.

**Rollback triggers (SF returns to the routine, temporarily):** repeated low-confidence runs, coverage falling under the threshold, broken-link verifier false-positive rate too high to trust, or a major site migration/redesign on a client. Treat these as automatic — not a debate each time.

**Keep SF deliberately (do not retire) for:** quarterly/semiannual discovery sweeps, site migrations, staging/pre-launch QA, competitor & ad-hoc audits, arbitrary-URL list crawls, custom-extraction jobs, and any client whose live run is low-confidence / blocked / capped.

---

## 5. Recommendation

Sequence the build as:
**Phase 1 (broken links) → Phase 6 (analytics integrations) → Phase 3a (audited-set graph) + Phase 4 (validation) → Phase 5 (similarity) → Phase 2 (hybrid discovery) → Phase 3b (reachability graph + depth).**

Note the dependency ordering: the *audited-set* graph (3a) ships early with no discovery dependency; the *reachability* graph and true depth (3b) come only after hybrid discovery (Phase 2). Discovery itself (Phase 2) is deliberately late despite being the (A) moat, because it's the largest architectural commitment and the cheapest alternative — keeping SF as the periodic discovery instrument — is perfectly good. **Build the crawler only if measurement shows our clients' sitemaps routinely miss important pages.** Until then, deferring Phase 2 explicitly means: **do not retire SF for discovery.**

On cost: SF licensing and analyst time saved are *secondary* benefits. The real decision is **trust, coverage, and workflow reliability** — don't let the license fee drive a premature switch.

**The goal we're actually buying: turn SF from a monthly chore into a quarterly instrument.** That's the honest, achievable win — and it's a large one. Quantifying it ("~80–90% fewer SF runs") is an estimate to confirm during the parallel-run period (§4), not a guarantee.
