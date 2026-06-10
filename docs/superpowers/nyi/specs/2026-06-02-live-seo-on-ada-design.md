# Live SEO Audit (on the ADA headless-Chrome scan) — Design Spec

**Date:** 2026-06-02
**Status:** NYI (spec reviewed, not yet built)
**Author:** Kevin + Claude (analysis), with Codex peer review and an 8-agent consensus pass
**Related:** `project_seo_audit_overhaul`, the ADA site-audit subsystem

---

## 1. Problem & goal

The SEO Parser (`/seo-parser`) ingests **manual** Screaming Frog (SF) CSV exports because SF is too heavy to run on the RunCloud VPS. Separately, the ADA site audit already loads **every page** of a client site in real headless Chrome (puppeteer-core + axe-core) and is slated to run automatically, nightly.

**Goal:** Extract SEO signals from the page that ADA already loads, so the (eventually nightly) ADA scan doubles as an automated, rendered-DOM SEO crawl — removing the manual-SF dependency for the signals that are actually crawl-derived.

**This is explicitly NOT a Screaming Frog replacement.** It is a **Live (Rendered) SEO Audit**: sitemap-bounded, rendered-Chrome, graph-over-audited-pages only. Naming and UI must say so.

### Real-world sizing basis (queried from production 2026-06-02)
- Two clean full-fleet batches: 27 sites / ~5,000 pages, completing in **3h38m / 3h49m** wall-clock; effective **~2.6 s/page** (PSI included).
- Largest single site audit: soma.edu, **838 pages in 36.5 min** = 2.6 s/page.
- Axe-phase-only per-page median **~4 s** (the window extraction rides in). One extra `page.evaluate()` ≈ 0.05–0.2 s = **1–5% bump**, far under the 2× budget.
- A 6pm→8am (14h) window has **~10h of headroom** for the current fleet (~32 domains). Timing is not the constraint.
- **Storage is the real scaling limit:** DB already **295 MB / 20,417 `AdaAudit` rows**; a nightly fleet adds ~5,000 rich rows/night.
- Note: `SiteAudit.runnerType` reads `jsdom` for fleet runs — a **stale default**; child `AdaAudit` rows are `browser`. Do not trust the parent column (see §9).

---

## 2. Scope

### In scope (MVP)
**Cheap per-page signals** (one `page.evaluate()` + the in-scope `HTTPResponse`):
- Title + length; meta description + length; meta robots; canonical URL.
- H1 (first text + count), H2 count; visible word count.
- JSON-LD / microdata / RDFa schema presence + types.
- hreflang link list.
- Internal + external outlinks (hrefs) — counts always; internal harvested for the graph.
- Images: count, missing `alt`, missing width/height.
- HTTP: status code, content-type, redirect chain / final URL, `x-robots-tag`, rough TTFB/nav timing.

**Aggregate post-pass** (after the page loop, in the finalizer):
- Duplicate titles / meta / H1 clusters; missing-element complete sets; thin-content counts.
- Canonical classification (self / non-self / missing).
- Schema-type coverage.
- **Graph over audited pages**: inlink counts among the audited URL set (NOT SF crawl-depth / Link-Score / orphan parity).
- A **coverage + confidence** record and a per-run **live health score** (forked scorer).

### Out of scope (MVP — explicit non-goals)
- **Per-page broken-link/image HTTP verification** — timing blow-up + WAF/CDN-ban risk on a single VPS IP under nightly load. Not even behind a flag.
- **GSC / GA4 / SEMRush** analytics — not crawl-derived; needs separate API integrations.
- **SF parity** for crawl depth (clicks-from-home / BFS reachability), Link Score / PageRank, true orphan pages, exact/near-duplicate similarity scoring.
- Re-using the CSV `BaseParser`/`AggregatorService` pipeline or fabricating a fake SEO `Session`.

---

## 3. Architecture — "B-borrow-A"

Build a **separate** live-SEO data model + aggregator + scorer that never pretends to be an SF import, but **render it through the existing SEO report React components** where shapes overlap.

```
ADA site audit (existing)
  discoverPages() → { urls, capped, source } (sitemap-bounded, 1000 cap)   ← discovery change (§7)
  per page: runAxeAudit()
     navigate → (response available) → [NEW: extractPageSeo()] captured BEFORE
                redirect / non-HTML / HTTP-error exits → (if OK) postLoadSettle → axe → (PSI detached)
                runAxeAudit RETURNS seoSnapshotInput (does NOT persist)
                                        │
                                        ▼
  queue-manager persists PageSeoSnapshot in the SAME transaction as the
  AdaAudit status + SiteAudit page-counter increment (1 row per ATTEMPTED page)
                                        │
  finalizeSiteAudit() when pagesDone:
     [NEW: aggregateLiveSeo(siteAuditId)] — idempotent (upsert), non-blocking
                                        │
                                        ▼
                              SiteSeoResult (1 row/run: aggregate JSON + score + coverage)
                                        │
                                        ▼
                       Live SEO Audit results view (reuses report components)
```

### Why these boundaries (from Codex review)
- **Not in `AdaAudit.result`**: that column already holds truncated axe JSON; overloading it mixes domains and worsens blob growth/retention.
- **Extraction inside `attemptNavigation()`, not "after settle".** Verified in `lib/ada-audit/runner.ts`: the runner returns early for redirects (≈L217/L239/L249) and **throws** for non-HTML (≈L244) and HTTP errors (≈L204–L227) **before** the axe phase. So extraction (or minimal-snapshot capture) MUST happen as soon as `response` is available and before any redirect / non-HTML / error return-or-throw path — otherwise those pages never get a snapshot.
- **The runner does not persist.** `RunAxeOptions` exposes `auditId` + `siteAudit?: boolean` (no `siteAuditId`). Rather than thread `siteAuditId` in, `runAxeAudit()` **returns** a `seoSnapshotInput` on its result; `queue-manager.ts` (which already owns `AdaAudit` updates and `SiteAudit` counter increments) persists the snapshot.
- **Snapshot write is ordered with the counter.** `finalizeSiteAudit()` gates on counters (`pagesComplete + pagesError + pagesRedirected >= pagesTotal`, `site-audit-finalizer.ts:29`). The `PageSeoSnapshot` write MUST be in the same transaction as (or strictly before) the page-counter increment on every path (success / redirect / error), so aggregation never runs with missing rows.
- **Aggregate in `finalizeSiteAudit()`** (`lib/ada-audit/site-audit-finalizer.ts:21`), gated on `pagesDone` — the single drain predicate called from every settle pathway (page loop, PDF orchestrator, PSI worker). The page loop is **not** the terminal owner. Does **not** wait for PDFs/PSI.
- **Idempotent + non-blocking**: aggregation does a deterministic `upsert` on `SiteSeoResult.siteAuditId` (NOT delete-then-create — the finalizer can be called concurrently from three settle paths, so delete+create would race). Concurrent callers must converge to the same row with no unique-constraint error escaping. If aggregation throws, log and leave the ADA audit terminal status unchanged.

---

## 4. Data model (Prisma)

### `PageSeoSnapshot` (per page)
- `id` (cuid), `siteAuditId` (FK, `onDelete: Cascade`), `adaAuditId` (FK, `@unique`), `clientId?`
- `url`, `finalUrl`, `urlKey` (normalized — see §7), `capturedAt` (DateTime)
- `seoExtractionStatus` (`ok | error | skipped`), `seoExtractionError?`
- HTTP: `statusCode?`, `contentType?`, `redirected` (bool), `isHtml` (bool)
- Indexability: `indexable` (bool), `robotsNoindex` (bool), `xRobotsNoindex` (bool), `loginLike` (bool)
- On-page: `title?`, `titleLength?`, `metaDescription?`, `metaDescriptionLength?`, `h1?`, `h1Count?`, `h2Count?`, `wordCount?`
- Canonical: `canonicalUrl?`, `canonicalKind?` (`self | other | missing`)
- Resources: `schemaCount?`, `imageCount?`, `imagesMissingAlt?`, `imagesMissingDimensions?`
- Links: `internalOutlinkCount?`, `externalOutlinkCount?`, `internalOutlinkKeysTruncated` (bool)
- Perf: `ttfbMs?` — **best-effort, nullable**; from browser navigation timing, which is unreliable after redirects/cache/retries. NOT treated as equivalent to SF response time.
- `detailsJson` (String, bounded JSON): schema types, hreflang list, **deduped internal outlink keys** (for the graph — capped at e.g. 300/page, set `internalOutlinkKeysTruncated` when exceeded), external-link **sample** (capped) + total count, truncation flags.

**Snapshots are created for EVERY attempted page** — including redirected, errored, and non-HTML — with `seoExtractionStatus` set accordingly. Missing content fields stay `null` (never 0).

**Relations & cascade:**
- `siteAudit  SiteAudit @relation(fields: [siteAuditId], references: [id], onDelete: Cascade)` and a `pageSeoSnapshots PageSeoSnapshot[]` back-relation on `SiteAudit`.
- `adaAudit   AdaAudit  @relation(fields: [adaAuditId], references: [id], onDelete: Cascade)` (`adaAuditId @unique`) + back-relation on `AdaAudit`.
- `clientId` is a **denormalized Int? without an FK** (avoids a third relation on `Client`; snapshots are pruned, clients are not).

Indexes: `[siteAuditId]`, `[adaAuditId]` unique, `[clientId, capturedAt]`, `[siteAuditId, urlKey]`, `[siteAuditId, indexable]`, `[siteAuditId, loginLike]`.

### `SiteSeoResult` (per run)
- `siteAuditId` (FK, `@unique`, `onDelete: Cascade`, with `siteSeoResult SiteSeoResult?` back-relation on `SiteAudit`), `clientId?` (denormalized, no FK), `domain`, `capturedAt`
- `score?` (Int 0–100, forked live scorer — **`null` when coverage is below the minimum threshold**, see §6), `confidence` (`high | medium | low`)
- `normalizationVersion` (String, e.g. `"sf1"`) — which `urlKey` rule produced this run's keys/graph (trends must not mix versions)
- Coverage denominators (exact names — UI must use these verbatim): `pagesTotal` (discovered + attempted), `pagesWithSeo` (successful HTML snapshots), `pagesSkipped`, `pagesErrored`, `pagesRedirected`, `loginLikePages`, `nonHtmlPages`, `indexablePages`, `scoreDenominatorPages` (= indexable HTML minus login-like)
- `discoveryCapped` (bool — see §7; derived from discovery metadata, not guessed)
- `aggregateJson` (String): the report-shaped aggregate (duplicate clusters, missing-element sets, canonical breakdown, schema coverage, graph summary).

---

## 5. Extraction (`lib/ada-audit/seo/extract-page-seo.ts`)

Called from inside `runAxeAudit()`'s `attemptNavigation()`, **as soon as `response` is available and before any redirect / non-HTML / HTTP-error exit** (see §3). On the OK path the on-page `page.evaluate()` runs after `postLoadSettle()` (settled DOM, axe hasn't mutated anything); on the redirect/non-HTML/error paths only the response-derived minimal fields are captured. `runAxeAudit()` attaches the result as `seoSnapshotInput` on its return value — it does **not** persist. Signature roughly:

```ts
extractPageSeo(page, response, url): Promise<RawPageSeo>   // page.evaluate only on OK HTML path
```

- One `page.evaluate()` returns the on-page facts (title, metas, headings, canonical, schema, hreflang, images, outlinks, visible word count, `loginLike` heuristic inputs).
- Read `response.status()`, `response.headers()` (content-type, x-robots-tag), `response.request().redirectChain()` for redirect/final URL; nav timing best-effort (nullable).
- Wrapped in try/catch: **extraction failure NEVER fails the ADA audit** — return `{ status:'error', error }`; the page audit proceeds and a minimal snapshot is still written.

### Extraction semantics the spec fixes
- **Word count**: visible text only. Exclude `script`, `style`, `noscript`; exclude nodes that are `display:none` / `visibility:hidden` (computed style) / `aria-hidden="true"` / zero-size. Nav/footer text counted by default (matches "rendered page" intent); flag for later refinement.
- **Indexability**: derived from `statusCode` (2xx) **AND** `isHtml` **AND** not `robotsNoindex` **AND** not `xRobotsNoindex`. **Canonical alone is NOT treated as noindex.**
- **`canonicalKind`**: `self` if canonical resolves (post-normalization) to `urlKey`; `other` if present and different; `missing` if absent.
- **Login-like detection (weighted, not flat OR)**: a `form input[type=password]` is **strong** (sufficient alone). A title/H1 login regex (sign in / log in / member login) is **strong**. A body-text "password" match is **supporting only** — not sufficient by itself (avoids false-positives on pages that merely mention passwords). Login-like pages are **recorded** (counted in coverage) but **excluded from `scoreDenominatorPages`**.
- **Bounded JSON**: never store full external link lists. Internal outlink keys (deduped, normalized) capped (e.g. 300/page) with `internalOutlinkKeysTruncated`; external links as a capped sample + total count. Record truncation flags.

---

## 6. Aggregation & scoring

### `lib/ada-audit/seo/aggregate-live-seo.ts`
- Loads all `PageSeoSnapshot` rows for the `siteAuditId`.
- Computes: duplicate title/meta/H1 clusters, missing-element complete sets, thin-content counts (threshold documented, e.g. <300 visible words on indexable HTML pages), canonical breakdown, schema-type coverage.
- **Graph over audited pages**: from deduped internal outlink keys, compute inlink counts per audited URL. Label everything "within audited set." Do **not** emit crawl-depth or Link-Score fields.
- Writes one `SiteSeoResult` (replace-if-exists; transactional).

### Forked live scorer `lib/ada-audit/seo/score-live-seo.ts`
**Do NOT call `computeHealthScore()` directly.** Verified failure modes in `lib/services/scoring.service.ts`:
- It normalizes over available factors **only when fields are truly `undefined`** — a live `avg_crawl_depth: 0` would award **full** crawl-depth points.
- Thin-content factor is only included when a `thin_content` issue object exists, so "content measured, zero thin pages" can be silently skipped rather than awarded.

The live scorer takes an **explicit factor-availability map** (`{ factor: 'present' | 'absent' }`). Factors with no live equivalent (crawl depth, link score) are `absent` and excluded from the denominator — never defaulted to 0 or full marks. Denominators for on-page factors use `scoreDenominatorPages` (**indexable HTML pages minus login-like pages**).

**Minimum-coverage rule:** when `scoreDenominatorPages / pagesTotal` is below a threshold (e.g. < 0.5) **OR** `confidence === 'low'`, the scorer returns **`score = null`** ("not enough coverage to score"), NOT a low numeric score. A login wall or high error rate must never produce a precise-looking but misleading number.

---

## 7. URL normalization (`urlKey`)

Single shared normalizer (`lib/ada-audit/seo/url-key.ts`, `normalizationVersion = "sf1"`) used by extraction, the graph, canonical comparison, **and discovery**:
- Lowercase host; strip fragment; strip leading `www.`; collapse trailing slash (documented rule: remove a single trailing slash except on the bare-host root).
- **Query handling (DECIDED, not open): keep the query string but strip known tracking params** — all `utm_*` (wildcard), `gclid`, `fbclid`, `mc_eid`, `msclkid`. Query params otherwise kept (they can denote distinct pages).
- **Alignment requires a discovery change.** Verified: `sitemap-crawler.ts` (≈L136–141) currently strips only the five named `utm_*` params + hash, does **not** strip `gclid`/`fbclid`/wildcard-`utm_*`, and does **not** collapse trailing slash. The plan must refactor discovery to call this shared normalizer so the audit set and the graph keys align. Bumping the rule = bump `normalizationVersion`.

---

## 8. Coverage & confidence (anti-silent-wrong)

`SiteSeoResult` stores all denominators (§4). The Live SEO results view shows a **confidence banner**:
- "Live rendered SEO snapshot — sitemap-bounded (N pages, capped: yes/no), graph is over audited pages only, not Screaming Frog crawl parity."
- Surfaces `loginLikePages`, `pagesSkipped`, `pagesErrored`, `discoveryCapped`.

**`discoveryCapped` derivation (requires a discovery change).** Verified: `discoverPages()` returns a bare `string[]` after `.slice(0, HARD_CAP)` (≈L294) — there is no cap signal today. The plan must change `discoverPages()` to return `{ urls, capped, source }` (where `capped` is set when the pre-slice count exceeded `HARD_CAP`). Interim fallback if that change is deferred: treat `urls.length === SITE_AUDIT_PAGE_CAP` as **"possibly capped"** (not definite) and label it as such. `discoveredUrls` is also persisted on `SiteAudit` for queued audits, so the metadata change must stay backward-compatible with that JSON.

`confidence` heuristic: `low` if `discoveryCapped` OR `loginLikePages/pagesTotal > 0.2` OR `pagesErrored/pagesTotal > 0.1`; `medium` if any minor flag; else `high`.

---

## 9. Retention & SQLite maintenance (the real scaling limit)

- **`PageSeoSnapshot` prune window: 90 days** (configurable). Pruning is a scheduled job (align with `resetStaleAudits` cadence or a daily cron).
- **`SiteSeoResult` retained longer** (e.g. 1 year) — small, the basis for future trend tracking.
- Deleting rows does **not** shrink the SQLite file. Document a vacuum strategy (periodic `VACUUM` or `PRAGMA incremental_vacuum`; note it locks the DB — schedule outside the nightly crawl window).
- Prefer scalar columns over JSON for anything that will be queried/trended; keep `detailsJson`/`aggregateJson` bounded.

---

## 10. `SiteAudit.runnerType` cleanup

The parent column is a stale `jsdom` default. **Decision: set `SiteAudit.runnerType` correctly at run time** (preferred over "stop relying on it" — fixing the default removes future confusion across the whole subsystem, not just SEO). SEO logic must not branch on the parent value regardless; derive the engine from child `AdaAudit.runnerType` where it matters.

---

## 11. Operational notes (nightly automation — flagged, mostly outside MVP build)

These are **design-time adjustments**, not MVP blockers, but the plan should note them:
- **Deploy/crawl window contract**: `recoverQueue()` fails any running audit on PM2 restart/deploy; a multi-hour crawl can't survive a mid-run deploy. Schedule deploys outside the crawl window, or add per-page checkpoint/resume later (snapshots already persist per page, which eases this).
- **Scheduling**: a future nightly scheduler should track per-client last-run and skip/queue fairly; the ~10h headroom makes this low-urgency now.
- **Intra-run temporal drift**: `capturedAt` is per-snapshot so future trend queries can filter within-run; don't assume `siteAuditId` alone is a temporal key.

---

## 12. Acceptance criteria (MVP)

1. A site audit produces one `PageSeoSnapshot` per attempted page (incl. error/redirect/non-HTML) and exactly one `SiteSeoResult`.
2. Per-page extraction adds **< 2×** to axe-phase time (target: < 10%); verified by before/after timing on a real client site.
3. SEO extraction failure leaves the ADA audit outcome unchanged.
4. Aggregation is idempotent: a test invokes `aggregateLiveSeo(siteAuditId)` **twice and concurrently** (and `finalizeSiteAudit` repeatedly) and produces exactly one `SiteSeoResult` with identical content, no unique-constraint error escaping.
5. The live health score never awards points for absent factors (unit-tested against a snapshot set lacking graph data); returns `null` below the minimum-coverage threshold (§6).
6. Login-like pages are recorded but excluded from `scoreDenominatorPages` (unit-tested, incl. the weighted heuristic: password-input vs body-text-only).
7. Every attempted page yields a snapshot, snapshot write is ordered with the page-counter increment (test redirect + non-HTML + error paths).
8. Results view renders via existing report components and shows the confidence banner with real coverage numbers.
9. `tsc --noEmit` + build pass; no regression in existing ADA site-audit timing or completion.

---

## 13. Decisions resolved (were open) + remaining

**Resolved (post-Codex review):**
- **URL-key query handling** → keep query, strip tracking params (§7). `normalizationVersion = "sf1"`.
- **Results surface / IA** → expose Live SEO results under **`/ada-audit`** as a sibling tab/view to the a11y results for the same `SiteAudit` (one scan, two lenses). This fixes API/model naming (`/api/ada-audit/[id]/seo` or a field on the existing site-audit response) and avoids the "which `/seo-parser` source is canonical" confusion. The seo-parser report **components** are reused; the seo-parser **route/Session model** is not touched.
- **`SiteAudit.runnerType`** → set correctly at run time (§10).

**Remaining (decide during the plan, low-risk):**
- Thin-content word threshold for *rendered* pages (SF uses 300 on raw HTML; rendered DOM may need a different number) — pick a starting value, make it a documented constant.
- Internal-outlink per-page cap value (spec suggests 300) — confirm against the largest real site (soma.edu, 838 pages) so the graph isn't silently truncated on nav-heavy templates.
