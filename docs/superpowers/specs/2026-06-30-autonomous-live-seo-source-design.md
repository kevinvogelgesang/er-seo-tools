# Autonomous Live SEO Source + Native Link Graph — Design

**Date:** 2026-06-30
**Status:** Spec (active). Brainstormed with Kevin; pending Codex review.
**Track:** C-track, new C6 phase (sits on shipped C6 Phases 1–3). Supersedes the
"live score never canonical" posture of the C6 Phase 3 invariant (see §7).
**Decision context:** chosen as "Option B" (bundle the autonomous SEO source +
the native link graph in one effort) over a thin-first sequencing, to close the
pillar/brief graph dependency in the same ship.

---

## 1. Goal

Make the SEO Parser near-autonomous, the way the ADA audit already is. A
scheduled or on-demand **native** SEO scan must produce a canonical,
source-labeled SEO report — on-page findings + broken links + a health score +
a native inlink / authority / approximate-depth graph — and feed the
`pillarAnalysis` and `brief` services natively so no deliverable silently
degrades when there is no Screaming Frog (SF) upload.

This does **not** retire Screaming Frog. SF, when freshly uploaded, remains the
canonical higher-fidelity source; the native scan is the always-on floor.

## 2. Background (verified code facts this builds on)

- The ADA site-audit pipeline already crawls every page (headless Chrome),
  harvests `<a href>`/`<img src>` edges (`lib/ada-audit/link-harvest.ts`), and
  extracts on-page SEO (`lib/ada-audit/seo/parse-seo-dom.ts`) into the transient
  `HarvestedLink` + `HarvestedPageSeo` tables.
- `lib/jobs/handlers/broken-link-verify.ts` is the **single live-scan run
  builder**: post-terminal, it reads both transient tables, writes ONE live-scan
  `CrawlRun` (`source:'live-scan'`, `tool:'seo-parser'`), then deletes them. It
  already owns one `runId` + a shared `ensurePage(url, scalars?)` map. It
  currently writes `crawlDepth: null` on every live `CrawlPage`.
- `lib/findings/live-seo-score.ts` (`scoreLiveSeo`) forks
  `computeHealthScore` and deliberately drops crawl-depth + broken-links from the
  denominator. `lib/services/scoring.service.ts` (`computeHealthScore`, the
  SF/`sf-upload` scorer) weights: indexability 20, error 20, missing
  title/meta/H1 25, **crawl depth 15**, thin 10, schema 10.
- `lib/services/findings-shared.ts` `selectRuns` currently **excludes
  `live-scan` from canonical SEO selection by design** — the live score never
  feeds B1 series / dashboard / fleet / client-findings.
- `pillarAnalysis` (`lib/services/pillarAnalysis/{joinRecords,score,verdict}.ts`)
  and `brief.service.ts` consume per-URL `inlinks` / `outlinks` / `crawlDepth`
  that today come **only** from a parsed SF Internal CSV
  (`lib/parsers/internal.parser.ts`).
- `/seo-parser` is `Session`/CSV-upload-centric: `app/seo-parser/page.tsx`
  ("Upload Screaming Frog CSV exports"), `app/seo-parser/results/[sessionId]`,
  and `app/api/parse/history` all read `Session` rows. A live-scan run originates
  from a `SiteAudit`, not a `Session`.
- `CrawlPage` already has a `crawlDepth` column (`prisma/schema.prisma`). It has
  no `inlinks` / `outlinks` columns yet.
- Scheduled scans (C2) are plain `Schedule` rows
  (`jobType:'scheduled-site-audit'`) on the single one-site-audit lane.

## 3. Scope decisions (locked with Kevin)

| # | Decision |
|---|---|
| Scan model | **Reuse the ADA audit pipeline.** An SEO schedule triggers a normal site audit; the live-scan run it already produces is the SEO report. No new crawl path. Accepts the inefficiency of paying axe-core on SEO runs — **breadcrumbed** as a future SEO-only scan mode (§9). |
| Canonical policy | **SF wins within a freshness window.** `sf-upload` is canonical while `age ≤ WINDOW`; past that the freshest of {SF, live} wins; live is canonical when no SF run exists. **WINDOW default = 30 days**, env-configurable (`SEO_SF_CANONICAL_WINDOW_DAYS`). |
| Surfacing | **CrawlRun-native.** A unified, source-labeled `/seo-parser` history merging `sf-upload` `Session`s + live-scan runs; results render from the canonical `CrawlRun`. |
| Crawl depth | **Approximate (audited-set).** BFS from the homepage over harvested edges → approximate clicks-from-home depth, labeled "approximate (audited-set)". Closes pillar/brief's `crawlDepth` consumption on live runs. |
| Depth in score | **Excluded from the live score for v1** (Codex-aligned conservatism — see §6). Approximate depth feeds the graph + pillar/brief but does not enter `scoreLiveSeo`. Flagged for Codex review and as a future parallel-run-gated change. |

## 4. Architecture — units

Each unit has one purpose, a defined interface, and is independently testable.

### 4.1 SEO schedule + report origin (reuse the ADA audit)
- An SEO-source `Schedule` (reusing C2 infra) enqueues a site audit on the shared
  lane. No new job type for the crawl itself; the existing finalizer's
  fire-and-forget `broken-link-verify` enqueue still builds the live-scan run.
- The only new scheduling concern is **intent labeling**: the resulting
  `SiteAudit` / live-scan run must be identifiable as "SEO-purposed" for history
  and surfacing. Reuse existing `requestedBy` / `scheduleId` provenance; do not
  add a parallel scheduler.
- **Breadcrumb (required):** a comment at the enqueue site + a `// FUTURE:` marker
  noting that scheduled SEO currently runs the full axe pass and a dedicated
  SEO-only scan mode (skip axe/screenshots/PSI) is the planned efficiency
  follow-up. Mirrored in §9 and a tracker line.

### 4.2 Native link graph (computed in the builder; no edge table)
- **Key design:** `broken-link-verify.ts` already holds all `HarvestedLink`
  edges in memory *before* it deletes them. Compute graph aggregates there and
  persist them as `CrawlPage` scalars. **No raw-edge table is retained** — this
  sidesteps the Option-B DB-growth concern entirely.
- Computed per audited page (same-domain edges only, over the audited/sitemap
  set):
  - `inlinks` — count of distinct source pages linking to this URL.
  - `outlinks` — count of distinct same-domain targets from this URL.
  - `crawlDepth` — approximate clicks-from-home via BFS from the homepage over
    the harvested edge set. Unreachable-within-audited-set pages → a sentinel
    (e.g. `null`, treated as "unknown depth", never 0).
  - orphan = `inlinks === 0` among indexable, non-login audited pages.
- **Authority signal (v1):** the relative `inlinks` count IS the audited-set
  authority proxy. Labeled **"ER audited-set authority,"** never "SF Link Score."
  Nav/template-link damping (down-weighting links present on >X% of pages) is a
  documented future refinement — YAGNI for v1.
- Persisted via the builder's existing `ensurePage` scalar path. Schema adds
  `inlinks Int?` + `outlinks Int?` to `CrawlPage`; `crawlDepth` already exists.

### 4.3 Canonical source selection (`selectRuns`)
- Extend `selectRuns` (and the source-aware selection helpers) to apply the
  freshness-window rule per client/domain:
  ```
  if (sfUpload && ageDays(sfUpload) <= WINDOW) -> sfUpload canonical
  else if (liveScan && (!sfUpload || liveScan.completedAt > sfUpload.completedAt))
       -> liveScan canonical
  else -> sfUpload canonical
  ```
- `WINDOW` from `SEO_SF_CANONICAL_WINDOW_DAYS` (default 30).
- This is the single source of truth consumed by every score/report surface
  (§7). The current "exclude live-scan" filters are replaced by source-aware
  canonical selection.

### 4.4 `/seo-parser` CrawlRun-native surfacing
- **History:** a merged, date-ordered, source-labeled list of `sf-upload`
  `Session`s + live-scan runs for the client/domain. New/refactored history query
  (no longer `Session`-only).
- **Results:** render from the canonical `CrawlRun` (via the findings tables),
  not from `Session.result`. A `results/[runId]` (CrawlRun-native) route; the
  legacy `results/[sessionId]` continues to work for SF/`Session` entries (or
  resolves a Session→its CrawlRun).
- **Labeling:** a source badge (SF vs Live-scan) + a live caveat — "on-page +
  audited-set graph; depth approximate" — wherever the score/graph is shown.

### 4.5 pillar/brief rewiring
- Introduce a single **graph-source accessor** that, given a client/domain,
  returns per-URL `{ inlinks, outlinks, crawlDepth, source }` from the **canonical
  run** (§4.3): SF-parsed `InternalRecord` when canonical = SF; `CrawlPage`
  scalars when canonical = live.
- `pillarAnalysis` (`joinRecords`/`score`/`verdict`) and `brief.service.ts`
  consume the accessor instead of reaching into SF-parsed data directly. Output
  carries the `source` for labeling. Same freshness policy as the score — no
  separate rule.

### 4.6 Labeling / trust (cross-cutting)
- A reusable "SEO source" badge + caveat component used by `/seo-parser`,
  client dashboard SEO surfaces, and the pillar/brief outputs.
- Live-scan score and SF score are NOT presented as the same metric — the badge +
  caveat make the source explicit (denominators already differ; see §6).

## 5. Data flow

```
SEO Schedule (C2)            on-demand "Run SEO scan" action
        \                        /
         v                      v
   site-audit pipeline (ADA pipeline reused; axe paid — breadcrumbed)
        | harvest edges + on-page SEO  -> HarvestedLink, HarvestedPageSeo
        v
   finalizeSiteAudit -> enqueue broken-link-verify (LAST, fire-and-forget)
        v
   broken-link-verify builder:
        read HarvestedPageSeo + HarvestedLink
        compute graph aggregates (inlinks/outlinks/BFS depth/orphan)  [NEW]
        write ONE live-scan CrawlRun:
            CrawlPage scalars incl. inlinks/outlinks/crawlDepth        [NEW cols]
            on-page + broken findings
            CrawlRun.score = scoreLiveSeo(...) (depth still excluded)  [§6]
        delete both transient tables
        v
   selectRuns (source-aware, 30-day window)  ->  canonical run per client/domain
        |                         |                          |
        v                         v                          v
   /seo-parser (merged,     pillar/brief (graph-       dashboard / B1 /
   CrawlRun-native,         source accessor reads      fleet / client-findings
   source-labeled)          canonical run's graph)     (source-aware canonical)
```

## 6. The "depth in score" decision (explicit)

We now compute an approximate crawl depth, so we *could* fold it into the live
score for closer parity with `computeHealthScore` (which weights depth 15/100).
**v1 keeps depth OUT of `scoreLiveSeo`:**
- The depth is an audited-set approximation, not true reachability; letting an
  approximation move the headline score is the exact risk Codex cautioned
  against.
- Keeping the live-score denominator stable preserves comparability of historical
  live scores and avoids a score discontinuity at this ship.
- Depth still earns its keep by feeding the graph + pillar/brief (its real
  consumers).

Folding approximate depth into the live score is recorded as a future option,
gated on observed agreement during real use. **This is an explicit Codex review
point.**

## 7. Surfaces that must adopt source-aware canonical selection

This change deliberately reverses the C6 Phase 3 invariant ("live score never
canonical"). Every surface that currently either reads the `sf-upload` score or
*excludes* `live-scan` must switch to the §4.3 canonical selection:
- B1 trend series + filters
- Client dashboard SEO score/health
- Fleet views
- Client-findings aggregation
- `/seo-parser` history + results (§4.4)
- pillar/brief (§4.5)

Each must show the source label. A live-scan run still has **no origin blob**;
`pruneArchivedBlobs` tool-origin-awareness is unchanged (seo-parser prunes only
session-origin `Session.result`; it must never null an ADA `SiteAudit.summary`).

## 8. Schema change

`CrawlPage`:
- add `inlinks Int?`
- add `outlinks Int?`
- (`crawlDepth Int?` already exists; live runs begin populating it)

Migration authored by hand (local `prisma migrate dev` is interactive-only) and
applied via `prisma migrate deploy` (CLAUDE.md). No new tables. No backfill of
historical runs (findings-layer invariant).

## 9. Out of scope / future work (breadcrumbed)

- **Dedicated SEO-only scan mode** (skip axe/screenshots/PSI) — the planned
  efficiency follow-up to §4.1; marked in code + tracker.
- **Hybrid discovery / true reachability depth** (SF-retirement Phase 2/3b) —
  approximate audited-set depth is the v1 ceiling.
- **Nav/template-link damping** for the authority signal.
- **Folding approximate depth into the live score** (§6) — parallel-run-gated.
- Near-duplicate content; redirect-chain / canonical / hreflang validation.

## 10. Error handling & invariants

- Builder graph computation is best-effort within the existing builder: a graph
  failure must not fail the live-scan run write (on-page + broken findings still
  land); log and persist null aggregates.
- All transactions array-form; manual `updatedAt = Date.now()` in any raw SQL;
  individual P2002-guarded creates (no SQLite `createMany`). (CLAUDE.md.)
- BFS over harvested edges is bounded by the existing per-page link cap (300) and
  page cap (1000); guard against cycles (visited set).
- `selectRuns` window comparison uses `completedAt`; missing timestamps fall back
  to treating the run as "stale" (live can supersede).

## 11. Testing

- **Unit:** graph math (inlinks/outlinks/orphan over a fixture edge set; BFS
  depth incl. cycles + unreachable); `selectRuns` window logic (SF-fresh,
  SF-stale-live-newer, no-SF, missing timestamps); history-merge ordering +
  source labels; graph-source accessor (SF vs live branch).
- **Integration:** an SEO-scheduled run → live-scan `CrawlRun` with populated
  graph scalars → canonical selection → `/seo-parser` shows it source-labeled;
  pillar/brief render from live-source graph; SF-within-window vs live-supersede
  transition flips canonical correctly.
- Test-DB hygiene per CLAUDE.md (unique prefixes; clean `CrawlRun` by domain
  before origin rows; compound `siteAuditId_tool` where querying a run as unique).

## 12. Acceptance criteria

1. A scheduled or on-demand SEO scan (no human, no SF) produces a canonical,
   source-labeled SEO report visible in `/seo-parser` with a health score.
2. Live `CrawlPage` rows carry `inlinks`, `outlinks`, and approximate
   `crawlDepth`; orphans (`inlinks===0`) are identifiable.
3. With a fresh (≤30d) SF upload present, SF remains canonical everywhere; once
   the SF upload ages past 30d, a newer live-scan supersedes it — both clearly
   source-labeled.
4. pillar/brief produce ranked programs + orphan flags from native graph data
   on a live-only client, labeled as audited-set/live-source.
5. No regression to ADA audits, the sf-upload path, or blob-prune
   tool-origin-awareness; gate green (tsc + tests + build).
