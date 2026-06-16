# C6 Phase 2 — On-page SEO extraction (findings-native) — Design Spec

**Date:** 2026-06-16
**Status:** Active (spec under review)
**Author:** Kevin + Claude, Codex peer review pending
**Track:** C6 (Live SEO / Screaming-Frog-retirement), Phase 2.
**Supersedes (architecturally):** the pre-findings-layer plan
`docs/superpowers/nyi/plans/2026-06-02-live-seo-on-ada.md` + spec
`docs/superpowers/nyi/specs/2026-06-02-live-seo-on-ada-design.md`. Those propose
their own `PageSeoSnapshot`/`SiteSeoResult` models, a forked scorer, and
seo-parser-component rendering. **This spec lands the same capability in the
findings model instead** (no new run/page models), riding the C6 Phase 1
harvest + post-terminal job + live-scan `CrawlRun` plumbing.
**Builds on:** `docs/superpowers/archive/specs/2026-06-16-broken-link-verifier-design.md`
(C6 Phase 1, shipped PR #70).

---

## 1. Problem & goal

The ADA site audit already loads every sitemap-discovered page of a client site
in real headless Chrome and (since C6 Phase 1) harvests its `<a href>`/`<img src>`
links for out-of-band broken-link verification, writing a **live-scan `CrawlRun`**
(`tool:'seo-parser'`, `source:'live-scan'`, `score:null`) that coexists with the
ADA run on the same `SiteAudit` via `@@unique([siteAuditId, tool])`.

**Goal:** extract the cheap, rendered-DOM **on-page SEO signals** from the same
page load — title, meta description, H1/H2, canonical, JSON-LD schema, visible
word count, image alt/dimension coverage, hreflang — and surface the classic
on-page issues (duplicate / missing / thin) as normalized `Finding`s in the
**same live-scan `CrawlRun`** the broken-link verifier already builds.

**Explicit non-replacement of Screaming Frog.** This is a *Live (Rendered) SEO
Audit*: sitemap-bounded, rendered-Chrome, on-page signals only. Naming and UI
say so. It does **not** attempt crawl-depth, Link-Score, orphan parity, or
content-similarity.

### Sizing basis (unchanged from the 2026-06-02 spec, re-confirmed)
On-page extraction folds into the **existing** harvest `page.evaluate()` (one DOM
read already walks `<a>`/`<img>` — `link-harvest.ts:81`), so it adds **zero extra
page round-trips** and a negligible per-page DOM-walk cost. The post-terminal
aggregation rides the already-enqueued `broken-link-verify` job.

---

## 2. Scope

### In scope (MVP)
**Per-page rendered-DOM extraction** (one combined `page.evaluate`, successful-settle
path only):
- Title + length; meta description + length; meta robots (noindex); canonical href.
- H1 (first text + count), H2 count; visible word count.
- JSON-LD `@type` set + count (microdata/RDFa deferred).
- hreflang list.
- Images: count, missing `alt`, missing width/height.
- Login-like heuristic inputs (weighted).
- Response-derived (already available at harvest time): `statusCode`, `contentType`,
  `isHtml`, `x-robots-tag` (xRobotsNoindex).

**Persistence:** one transient `HarvestedPageSeo` row per **successfully-settled**
page (sibling to `HarvestedLink`), written in the same post-settle-fenced,
chunked block.

**Post-terminal aggregation** (inside the extended `broken-link-verify` job — the
**single live-scan run builder**):
- Populate the existing `CrawlPage` scalars (`title`, `h1`, `metaDescription`,
  `wordCount`, `indexable`, `statusCode`) on the live-scan run's pages.
- Emit run-scope + page-scope `Finding`s for: duplicate title / meta / H1,
  missing title / meta / H1, thin content — **reusing the SF parser's exact
  `type` strings and severities** (§5) so the B2 action center and any downstream
  treat live + SF findings consistently.
- Merge with the broken-link findings into **one** `FindingsBundle` → **one**
  live-scan `CrawlRun` (`score:null`).

### Out of scope (MVP — explicit non-goals)
- **Live SEO score.** `CrawlRun.score` stays `null` (consistent with Phase 1).
  The forked, coverage-denominated scorer (`computeHealthScore` fork with an
  explicit factor-availability map, null-below-coverage) is a **fast-follow
  phase**, not this one. `selectRuns` already segregates the live-scan run and
  never reads its score, so a null score displaces nothing.
- **Inlink / authority graph + crawl depth** (roadmap Phase 3a). `CrawlPage.crawlDepth`
  stays `null`. The harvested links already exist for broken-link checks; 3a can
  reuse them.
- **Snapshots for error / redirect / non-HTML pages.** Without a coverage-denominated
  score there is no consumer for them this phase; emitting them would force
  runner-path surgery (the runner throws/early-returns before the harvest hook on
  those paths). Deferred to the scorer phase, which needs the denominators.
- **Coverage / confidence banner + denominators** — coupled to the score; deferred
  with it. (The live-scan run's broken-link `detail` confidence block is unchanged.)
- **Canonical classification finding, schema-coverage finding, multiple-H1** — kept
  out to hold the MVP to the seven highest-value, vocabulary-aligned on-page issues.
- New Prisma models for runs/pages (`PageSeoSnapshot`/`SiteSeoResult`); forked
  scorer; touching the seo-parser `Session`/route/component contract.

---

## 3. Architecture

```
ADA site-audit page job  (lib/jobs/handlers/site-audit-page.ts, per URL)
  runAxeAudit → settlePage() succeeds (status-flip race won)         ← post-settle fence
    persistHarvest():
      [EXISTING] HarvestedLink rows (chunked @50)
      [NEW]      HarvestedPageSeo row for THIS page (chunked @50, same best-effort block)
  on-page signals come from the SAME page.evaluate that harvests links
  (link-harvest.ts:81 — extended to also return on-page fields)

finalizeSiteAudit (terminal 'complete')   (site-audit-finalizer.ts)
  … carry-forward → findings dual-write (ADA run) → enqueueBrokenLinkVerify(id) LAST  [UNCHANGED]

broken-link-verify job  (lib/jobs/handlers/broken-link-verify.ts — the live-scan run builder)
  reads HarvestedLink     → verify same-domain links/images (HEAD→GET)      [EXISTING]
  reads HarvestedPageSeo  → CrawlPage scalars + on-page aggregate findings  [NEW]
  builds ONE FindingsBundle:
     pages   = union(broken-link source pages, on-page pages) merged by normalized URL
     findings = on-page findings  ++  broken-link findings
     run     = live-scan CrawlRun (tool:'seo-parser', source:'live-scan', score:null)
  writeFindingsRun(bundle)   → delete-and-recreate on { siteAuditId, tool:'seo-parser' }  [ONE writer]
  deletes HarvestedLink + HarvestedPageSeo                                   [after the run is written]
```

### Why these boundaries
- **One run, one writer.** `writeFindingsRun` does delete-and-recreate keyed on
  `{ siteAuditId, tool:'seo-parser' }` (`writer.ts:35`), and the compound unique
  permits only one seo-parser run per `SiteAudit`. On-page data and broken-link
  data must therefore be assembled into **one** bundle by **one** job. The
  `broken-link-verify` job already owns that write; it broadens to fold in
  on-page findings. (Two jobs writing the same run would clobber each other.)
- **Extraction rides the existing harvest evaluate.** `link-harvest.ts` already
  does a single `page.evaluate` over the rendered DOM (`a[href]`/`img[src]`).
  Adding the on-page reads to that callback is the cheapest integration and keeps
  all rendered-DOM reads in one pure, jsdom-testable function.
- **Successful-settle path only.** The harvest hook runs *after* `settlePage()`
  wins its status flip (`site-audit-page.ts:249`, guarded by the `if (!settled)
  return` at :248). Riding it means **no changes to `runner.ts`** and no touching
  the redirect/non-HTML/error exits. The cost is no rows for those pages — accepted
  (§2 non-goals).
- **Transient scaffolding, deleted last.** `HarvestedPageSeo` mirrors
  `HarvestedLink`: written post-settle-fenced, chunked at 50, best-effort
  (a harvest failure never fails the page), deleted by the builder only **after**
  the run is written, 7-day retention backstop for stranded rows.
- **Job/type names stay stable.** The job type string remains `broken-link-verify`
  (dedupKey/group/recovery all key on it). Its responsibility broadens to "build
  the complete live-scan run." Avoids queue + recovery churn.

---

## 4. Data model

### New transient table `HarvestedPageSeo` (Prisma)
Sibling to `HarvestedLink` — transient scaffolding, cascade-on-`SiteAudit`-delete,
pruned at 7 days.

```prisma
model HarvestedPageSeo {
  id            String    @id @default(cuid())
  siteAuditId   String
  siteAudit     SiteAudit @relation(fields: [siteAuditId], references: [id], onDelete: Cascade)
  url           String    // normalized page URL (the audited page itself)
  statusCode    Int?
  isHtml        Boolean   @default(true)
  title         String?
  titleLength   Int?
  metaDescription String?
  metaDescriptionLength Int?
  h1            String?
  h1Count       Int?
  h2Count       Int?
  wordCount     Int?
  canonicalUrl  String?
  robotsNoindex   Boolean @default(false)
  xRobotsNoindex  Boolean @default(false)
  loginLike     Boolean   @default(false)
  schemaCount   Int?
  imageCount    Int?
  imagesMissingAlt        Int?
  imagesMissingDimensions Int?
  harvestTruncated Boolean @default(false)  // mirrors HarvestedLink; reserved for future cap
  detailsJson   String?   // bounded JSON: { schemaTypes: string[], hreflang: string[] }
  createdAt     DateTime  @default(now())

  @@index([siteAuditId])
  @@index([siteAuditId, url])
}
```
Add the `harvestedPageSeo HarvestedPageSeo[]` back-relation on `SiteAudit`. One
row per successfully-settled page. Missing content fields stay `null` (never 0).
Migration is hand-written SQL applied via `prisma migrate deploy` (local-dev
quirk; production runs `migrate deploy` in the deploy command).

### No change to `CrawlRun` / `CrawlPage` / `Finding`
The live-scan run's `CrawlPage` rows are created by the builder with the existing
scalars populated (`title`/`h1`/`metaDescription`/`wordCount`/`indexable`/`statusCode`);
on-page issues are ordinary `Finding`s. `score` stays `null`; `crawlDepth` stays
`null`.

---

## 5. Extraction & finding vocabulary

### `parseSeoFromDocument(doc, win)` — pure DOM parser
Lift the Codex-reviewed parser from the 2026-06-02 plan verbatim in spirit:
self-contained (injected via `.toString()` into `page.evaluate`, so **no** module
references), returns title/meta/robots/canonical, h1/h1Count/h2Count, visible word
count (ancestor-walk excludes `script`/`style`/`noscript`/`display:none`/
`visibility:hidden`/`aria-hidden`), JSON-LD `@type`s (with `@graph` recursion),
hreflang, image alt/dimension counts, and the **weighted** login-like signal
(password input OR title/H1 login-regex = strong; body-text "password" only when
the page is short = supporting). Unit-tested via jsdom. Integrated into the
`link-harvest.ts` evaluate so links + on-page facts come from one DOM pass.

### Indexability (per page, computed in the builder)
`indexable = statusCode in [200,300) ∧ isHtml ∧ ¬robotsNoindex ∧ ¬xRobotsNoindex`.
Login-like pages are recorded but **excluded** from the aggregation denominator
set (so a login wall never registers as "missing title" across the site).

### On-page aggregation set
Aggregate over **indexable HTML, non-login-like** pages. For each issue, emit:
- one **run-scope** `Finding` (`scope:'run'`, `count` = affected page count,
  `detail` = `{ description }`, `dedupKey = runFindingKey(type)`,
  `affectedComplete = ¬harvestTruncated`, `affectedSource = 'live-scan-onpage'`);
- one **page-scope** `Finding` per affected URL (`scope:'page'`,
  `dedupKey = pageFindingKey(type, url)`, `pageId` → the merged `CrawlPage`).

### Finding `type` strings + severity (verified against the SF parser)
Reuse the exact current SF vocabulary so live + SF findings coexist in B2:

| Issue | `type` | severity |
|---|---|---|
| Missing title | `missing_title` | critical |
| Duplicate title | `duplicate_title` | warning |
| Missing meta description | `missing_meta_description` | warning |
| Duplicate meta description | `duplicate_meta_description` | notice |
| Missing H1 | `missing_h1` | warning |
| Duplicate H1 | `duplicate_h1` | notice |
| Thin content (`< 300` visible words, `> 0`) | `low_content_pages` | warning |

(Severity strings map to the findings vocab via `critical|warning|notice`. The
thin-content threshold of 300 matches `internal.parser.ts:265`; it is a documented
constant in the builder. **Plan-time verification:** re-confirm `low_content_pages`
is the live type string emitted by the current content parser before wiring — it
must match what B2 already renders.)

"Duplicate" = same normalized non-empty value across ≥2 pages in the aggregation
set. "Missing" = absent/empty on an indexable page. Thin = `0 < wordCount < 300`
(null/0 word counts are extraction gaps, **not** thin — never counted).

---

## 6. Builder changes (`broken-link-verify.ts`)

`runBrokenLinkVerify` extends to:
1. Load `HarvestedPageSeo` rows for the `siteAuditId` alongside `HarvestedLink`.
2. Build the on-page `CrawlPage` set (one per harvested page, normalized URL,
   scalars populated, `indexable` computed).
3. Run on-page aggregation → on-page `Finding`s.
4. **Merge** with the broken-link mapper output: union the page sets by normalized
   URL (a page that both has on-page issues and sources a broken link is one
   `CrawlPage`); concatenate findings (dedupKeys already disjoint — on-page types
   vs `broken_internal_links`/`broken_images`; the writer's `@@unique([runId,
   dedupKey])` and `@@unique([runId,url])` hold because pages are merged and
   page-scope on-page findings key on `pageFindingKey(type,url)`).
5. `writeFindingsRun(mergedBundle)` once. Run status `partial` if links capped OR
   harvest truncated, else `complete`.
6. Delete **both** `HarvestedLink` and `HarvestedPageSeo` for the audit, after the
   write.

Refactor note: `mapBrokenLinks` currently builds the whole bundle (run + pages +
findings). To merge, extract a shared "assemble bundle" step or have the on-page
mapper and broken-link mapper each return `{ pages, findings }` partials that the
builder unions into one run. Keep both mappers **pure** (no DB) and unit-tested;
the builder owns the single `run` object and the merge. The empty-harvest case
(no links, no on-page rows) still writes an empty live-scan run (verified-clean /
no-findings state), unchanged from Phase 1.

---

## 7. Recovery & retention

- **`recoverBrokenLinkVerifies`** (`broken-link-recovery.ts`): the stranded
  condition broadens from "HarvestedLink rows exist" to "(`HarvestedLink` **or**
  `HarvestedPageSeo`) rows exist" — every completed audit now leaves
  `HarvestedPageSeo` rows even when it has zero links, so the recovery must
  re-enqueue on either. Skip when a live-scan run already exists or an active
  verify job is present (unchanged).
- **`pruneHarvestedPageSeo(now)`** in `lib/findings/retention.ts` mirrors
  `pruneHarvestedLinks` (7-day `createdAt` cutoff); registered in `runCleanup()`
  (`lib/cleanup.ts`).
- `SiteAudit` delete cascades both transient tables (FK `onDelete: Cascade`).

---

## 8. Surface

- **Results page** (`app/ada-audit/site/[id]/page.tsx`): the live-scan run query
  already selects `findings { scope, type, count, url, detail }`. Add an
  **On-page SEO section** (sibling component to `BrokenLinksSection`) that reads
  the same `liveScanRun`, filtering findings to the on-page `type`s and rendering
  per-type totals + affected-URL lists. No new query — one fetch feeds both
  sections. States: not-verified (no run) / clean (run, no on-page findings) /
  findings.
- **B2 action center / dashboard**: on-page findings flow through `selectRuns`'
  `seo.liveScan` slot **additively** — they appear in the findings panel without
  touching `seo.current` (the sf-upload health-score run). No score, no series
  change.
- Both surfaces work on archived audits (relational-only, no blob dependency).

---

## 9. Testing

1. **`parseSeoFromDocument`** (jsdom): title/meta/robots/canonical/h1/h2/wordCount;
   schema `@type` incl. `@graph`; hreflang; image alt/dimension counts; word-count
   excludes script/style/hidden; weighted login-like (password input = true;
   body-text "password" on a long page = false).
2. **On-page mapper** (pure): duplicate detection across pages; missing on indexable
   only; thin `0<wc<300` only (null/0 excluded); login-like + non-indexable excluded
   from the set; run-scope `count` = affected page count; page-scope keyed by URL;
   correct `type`/severity strings.
3. **Merge / builder** (DB): live-scan run carries both on-page and broken-link
   findings; pages merged by normalized URL (a shared source/issue page is one row);
   `CrawlPage` scalars populated; idempotent under repeat/concurrent verify
   (delete-and-recreate → one run); both transient tables deleted after write;
   empty-harvest still writes a clean run.
4. **Persist** (`site-audit-page` path): `HarvestedPageSeo` written only on the
   settled (flip-won) path; chunked; a harvest failure does not fail the page.
5. **Recovery**: a complete audit with `HarvestedPageSeo` rows + no live-scan run +
   no active job is re-enqueued (incl. the zero-links case).
6. **Retention**: `pruneHarvestedPageSeo` deletes rows older than 7 days only.
7. **DB-test hygiene** (per handoff gotchas): unique domain/id prefix; clean
   `CrawlRun` by domain before origin rows; any `crawlRun` lookup by `siteAuditId`
   uses the compound `siteAuditId_tool` input.
8. `npx tsc --noEmit` + full suite green; `npm run build` succeeds.

---

## 10. Acceptance criteria (MVP)

1. A completed site audit produces one `HarvestedPageSeo` row per successfully-settled
   page, deleted after the live-scan run is written.
2. The live-scan `CrawlRun` for the audit carries on-page `Finding`s (duplicate /
   missing / thin) **and** broken-link findings, with `CrawlPage` scalars populated;
   `score` stays `null`.
3. On-page extraction adds no extra page navigations (rides the harvest evaluate);
   no regression in site-audit timing or completion.
4. On-page finding `type` strings + severities match the SF parser exactly; B2 and
   the results page render live findings alongside SF findings without special-casing.
5. The build is idempotent: repeat/concurrent verify yields exactly one live-scan
   run with merged findings, no unique-constraint error escaping.
6. Login-like and non-indexable pages are excluded from the on-page aggregation set
   (unit-tested, incl. the weighted login heuristic).
7. A stranded audit (HarvestedPageSeo rows, no run, no job) is recovered.
8. `tsc --noEmit` + full suite + `npm run build` pass.

---

## 11. Decisions resolved

- **Where extraction + run-write happen** → unified post-terminal builder
  (Kevin, 2026-06-16). One writer owns the one live-scan run.
- **Live SEO score** → `null` for MVP; forked scorer deferred to a fast-follow
  (Kevin, 2026-06-16).
- **Snapshots for error/redirect pages** → out (no consumer without the score;
  avoids runner-path surgery). Revisit with the scorer.
- **Graph / crawl depth** → out (roadmap Phase 3a).
- **Finding vocabulary** → reuse the SF parser's exact `type`/severity strings.
- **Job naming** → keep `broken-link-verify`; broaden its responsibility.

## 12. Open (decide in the plan, low-risk)

- Confirm the **current** SF thin-content type string (`low_content_pages` vs
  legacy `thin_content`) against what B2 renders today; pin it before wiring.
- Whether to fold on-page reads into the existing `link-harvest.ts` evaluate vs a
  second adjacent `page.evaluate` (one combined pass preferred; confirm no payload
  shape clash).
- Exact shared "assemble bundle" refactor shape so `mapBrokenLinks` and the new
  on-page mapper stay pure and individually tested.
