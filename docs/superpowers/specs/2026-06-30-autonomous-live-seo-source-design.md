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
| Depth in score | **Excluded from the live score for v1** (Codex-aligned conservatism — see §6). Approximate depth feeds the graph + pillar/brief but does not enter `scoreLiveSeo`. Future parallel-run-gated change. |
| v1 surface support (live-scan) | **Supported:** `/seo-parser` history + results + score, client dashboard / B1 / fleet / client-findings, pillar analysis, brief generation. **SF-only in v1 (live-scan shows a "needs Screaming Frog data" state, not an error):** report exports (CSV/VPAT/PDF), session diff, public share pages, and the srt_/claude roadmap-memo handoff. Bounds the routing migration (Codex spec-fix #4). |
| Schedule intent | Explicit payload marker **`intent:'seo-live'`** on the SEO schedule's payload + the on-demand trigger (Codex spec-fix #3) — NOT inferred from `requestedBy`/`scheduleId`. ADA-purposed audits still produce a live-scan run, but only `intent:'seo-live'` origins appear in `/seo-parser` SEO history. |

## 4. Architecture — units

Each unit has one purpose, a defined interface, and is independently testable.

### 4.1 SEO schedule + report origin (reuse the ADA audit)
- An SEO-source `Schedule` (reusing C2 infra) enqueues a site audit on the shared
  lane. No new job type for the crawl itself; the existing finalizer's
  fire-and-forget `broken-link-verify` enqueue still builds the live-scan run.
- **Explicit intent marker (Codex spec-fix #3):** the SEO schedule's payload and
  the on-demand trigger carry **`intent:'seo-live'`**, persisted on the
  `SiteAudit` (a small new scalar, e.g. `seoIntent Boolean @default(false)`, or a
  reuse of an existing provenance field if one fits). Do NOT infer SEO-purpose
  from `requestedBy:'scheduled'` / `scheduleId` — those already mean "ADA
  scheduled audit" and the scheduled handler hard-codes normal site-audit
  provenance. A plain ADA audit still yields a live-scan run (unchanged), but
  **only `intent:'seo-live'` audits appear in `/seo-parser` SEO history**; ADA
  audits keep their live-scan run as the additive broken-links/on-page panel they
  are today.
- **On-demand trigger:** a "Run SEO scan" action (new, small) = `POST` the
  existing site-audit enqueue with `intent:'seo-live'`. No separate pipeline.
- **Breadcrumb (required):** a comment at the enqueue site + a `// FUTURE:` marker
  noting that scheduled/on-demand SEO currently runs the full axe pass and a
  dedicated SEO-only scan mode (skip axe/screenshots/PSI) is the planned
  efficiency follow-up. Mirrored in §9 and a tracker line.

### 4.2 Native link graph (computed in the builder; no edge table)
- **Key design:** `broken-link-verify.ts` already loads all `HarvestedLink`
  rows *before* it deletes them. Compute graph aggregates there and persist them
  as `CrawlPage` scalars. **No raw-edge table is retained** — this sidesteps the
  Option-B DB-growth concern entirely.
- **Use the RAW rows, not the verify map (Codex spec-fix #1):** the existing
  `toCheck` dedupe in `broken-link-verify.ts` collapses multiple source pages per
  target for verification purposes — that is **wrong for graph metrics**. Graph
  computation must read the original `HarvestedLink` rows directly, filter to
  `kind === 'internal-link'`, and normalize both source and target URLs with the
  shared normalizer (`lib/findings/normalize-url.ts`) before counting.
- Computed per audited page (same-domain edges only, over the audited/sitemap
  set):
  - `inlinks` — count of distinct source pages linking to this URL.
  - `outlinks` — count of distinct same-domain targets from this URL.
  - `crawlDepth` — approximate clicks-from-home via BFS from the homepage over
    the harvested edge set. Unreachable-within-audited-set pages → `null`
    ("unknown depth", never 0). **Approximate because** `link-harvest.ts` caps
    harvested links per page (300) — some real edges are unobserved; label
    accordingly everywhere it surfaces.
  - **Homepage seed for BFS:** the normalized domain root (scheme+host, `/`),
    matched to its audited `CrawlPage` after normalization (www-insensitive, the
    final post-redirect URL). If the root was not audited, fall back to the
    shallowest audited URL by path depth; if still ambiguous, depth is left
    `null` for all pages and labeled "depth unavailable" (never fabricated).
  - orphan = `inlinks === 0` among indexable, non-login audited pages.
- **Authority signal (v1):** the relative `inlinks` count IS the audited-set
  authority proxy. Labeled **"ER audited-set authority,"** never "SF Link Score."
  Nav/template-link damping (down-weighting links present on >X% of pages) is a
  documented future refinement — YAGNI for v1.
- Persisted via the builder's existing `ensurePage` scalar path. Schema adds
  `inlinks Int?` + `outlinks Int?` to `CrawlPage`; `crawlDepth` already exists.

### 4.3 Canonical source selection (new domain-scoped selector)
- **Do not overload the list-based `selectRuns` (Codex spec-fix #2).** The
  current `findings-shared.selectRuns(runs)` is list-based, hard-excludes
  `live-scan`, and callers frequently pass client-wide run sets. Add a NEW
  **domain-scoped** selector — `selectCanonicalSeoRun({ clientId, domain })` —
  that resolves the canonical SEO run for one `clientId + normalized domain`
  pair, so two domains on the same client never cross-select.
- Inputs joined per `clientId + normalize(domain)`: the most recent `sf-upload`
  run (Session origin) and the most recent `intent:'seo-live'` live-scan run
  (SiteAudit origin). Rule:
  ```
  if (sfUpload && ageDays(sfUpload) <= WINDOW) -> sfUpload canonical
  else if (liveScan && (!sfUpload || liveScan.completedAt > sfUpload.completedAt))
       -> liveScan canonical
  else -> sfUpload canonical          // (or live, if no SF exists at all)
  ```
- `WINDOW` from `SEO_SF_CANONICAL_WINDOW_DAYS` (default 30). Age uses
  `completedAt`; a missing timestamp is treated as stale (live may supersede).
- **No double-counting:** when the live run is canonical it is the "current SEO"
  run; it must NOT also be re-counted as the additive broken-links/on-page
  `liveScan` panel for the same surface. The additive panel is for the
  *ADA-origin* live-scan run, distinct from a *canonical SEO* live run.
- This selector is the single source of truth for every score/report surface
  (§7). The old "exclude live-scan" filters are replaced by it.

### 4.4 `/seo-parser` CrawlRun-native surfacing
**Chosen model (Codex spec-fix #4): migrate the SEO-Parser read surfaces to be
`CrawlRun`-native; do NOT mint synthetic `Session` rows.** Synthetic Sessions
would carry upload-only fields and blur source semantics (and the findings-layer
thesis is "read normalized tables"). Bound the migration with the §3 v1
surface-support split.
- **History:** a merged, date-ordered, source-labeled list of `sf-upload`
  `Session`s + `intent:'seo-live'` live-scan runs for the client/domain. New
  history query (no longer `Session`-only).
- **Results:** render from the canonical `CrawlRun` (findings tables), not
  `Session.result`. Add a `CrawlRun`-native results route keyed by `crawlRunId`;
  the legacy `results/[sessionId]` route keeps working for SF/`Session` entries
  by resolving the Session → its `CrawlRun`.
- **v1 scope guard:** the SF-only surfaces from §3 (exports, diff, share,
  roadmap-memo) are NOT migrated in v1 — for a canonical live-scan run they render
  an explicit "needs Screaming Frog data" state, not a 500. This is the line that
  keeps the routing migration bounded.
- **Labeling:** a source badge (SF vs Live-scan) + a live caveat — "on-page +
  audited-set graph; depth approximate" — wherever the score/graph is shown.

### 4.5 pillar/brief rewiring
- **The accessor must return full "internal page facts," not graph fields alone
  (Codex spec-fix #5).** `{inlinks, outlinks, crawlDepth, source}` is too narrow:
  - `pillarAnalysis` (`joinRecords`/`score`/`verdict`) consumes the
    `internal.parser.ts` `InternalRecord` shape: URL, title, h1, meta
    description, word count, crawl depth, inlinks, outlinks, indexability, schema
    types.
  - `brief.service.ts` consumes: title, status/indexability, word count, h1, meta
    description, and inlinks (authority/orphan).
- Introduce a single **page-facts provider** `getCanonicalPageFacts({ clientId,
  domain })` → per-URL records in (a normalization of) the `InternalRecord`
  shape **plus** the graph overlay (`inlinks`/`outlinks`/`crawlDepth`) and a
  `source` tag, sourced from the §4.3 canonical run:
  - canonical = SF → the parsed `InternalRecord`s (today's path).
  - canonical = live → assemble from `CrawlPage` scalars (title/h1/meta/word
    count/indexability/schema from on-page extraction; `inlinks`/`outlinks`/
    `crawlDepth` from §4.2). Fields the live scan cannot supply are OMITTED, never
    faked (findings-layer degraded-shape rule).
- `pillarAnalysis` and `brief.service.ts` consume the provider instead of
  reaching into SF-parsed data directly; same freshness policy as the score (no
  separate rule); output carries `source` for labeling.

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
gated on observed agreement during real use. Codex confirmed this v1 call.
**Required guard test:** an explicit test asserting `scoreLiveSeo` ignores
`crawlDepth` (a run with populated depth scores identically to one without),
so a later "add depth" change is a deliberate, test-breaking decision.

## 7. Surfaces that must adopt source-aware canonical selection

This change deliberately reverses the C6 Phase 3 invariant ("live score never
canonical"). Every surface that currently either reads the `sf-upload` score or
*excludes* `live-scan` must switch to the §4.3 `selectCanonicalSeoRun` selector:
- B1 trend series + filters
- B2 panel (keep the ADA-origin live-scan as the additive broken-links/on-page
  panel — distinct from a canonical SEO live run; see §4.3 "no double-counting")
- Client dashboard SEO score/health
- Fleet views
- Client-findings aggregation
- `/seo-parser` history + results (§4.4)
- pillar/brief (§4.5)

Multi-domain clients: every one of these resolves canonical **per (client,
domain)**, never "latest client-wide SEO run."

Each must show the source label. A live-scan run still has **no origin blob**;
`pruneArchivedBlobs` tool-origin-awareness is unchanged (seo-parser prunes only
session-origin `Session.result`; it must never null an ADA `SiteAudit.summary`).

## 7a. Retention (Codex spec-fix #7)

Live-scan SEO runs originate from a `SiteAudit`, not a `Session`, so two existing
retention paths interact:
- **`pruneScheduledSiteAudits()`** hard-deletes schedule-originated terminal
  SiteAudits past per-cadence windows. A canonical `intent:'seo-live'` SEO run
  must NOT be silently destroyed while it is the client's only SEO source. v1
  rule: **keep the latest N (≥2) completed `intent:'seo-live'` audits per
  (client,domain)** regardless of the ADA cadence window — mirroring the existing
  "keep latest 2 completed per schedule" carve-out — and let the CrawlRun findings
  survive origin deletion via `SetNull` (findings-layer invariant) so SEO history
  degrades rather than vanishes.
- **`pruneArchivedBlobs()`** stays tool-origin-aware: seo-parser prunes only
  session-origin `Session.result`; it must NEVER null an ADA `SiteAudit.summary`
  for a live-scan run. Unchanged, but re-stated because live-scan runs now matter
  as canonical SEO sources.

`/seo-parser` SEO history reads the surviving `CrawlRun` (`score` + scalars), so a
pruned origin still shows a degraded, source-labeled entry rather than a gap.

## 8. Schema change

`CrawlPage`:
- add `inlinks Int?`
- add `outlinks Int?`
- (`crawlDepth Int?` already exists; live runs begin populating it)

`SiteAudit`:
- add `seoIntent Boolean @default(false)` (the §4.1 `intent:'seo-live'` marker) —
  unless an existing provenance field is confirmed to fit during planning.

Migration authored by hand (local `prisma migrate dev` is interactive-only) and
applied via `prisma migrate deploy` (CLAUDE.md). No new tables. No backfill of
historical runs (findings-layer invariant). `@default(false)` keeps existing
audits out of SEO history.

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

- **Unit:** graph math from RAW `HarvestedLink` rows (inlinks/outlinks/orphan
  over a fixture edge set; BFS depth incl. cycles, unreachable→null,
  homepage-not-audited fallback; `internal-link`-only filter; URL normalization);
  `selectCanonicalSeoRun` window logic (SF-fresh, SF-stale-live-newer, no-SF,
  missing timestamps, **per-domain isolation on a multi-domain client**, no
  double-count of a canonical live run as the additive panel); history-merge
  ordering + source labels; `getCanonicalPageFacts` (SF vs live branch,
  omitted-fields-not-faked); **the §6 depth-guard test** (`scoreLiveSeo` ignores
  `crawlDepth`).
- **Integration:** an `intent:'seo-live'` run → live-scan `CrawlRun` with
  populated graph scalars → canonical selection → `/seo-parser` shows it
  source-labeled; pillar/brief render from live-source page-facts; SF-within-30d
  vs live-supersede transition flips canonical correctly; a plain ADA audit does
  NOT appear in SEO history; `pruneScheduledSiteAudits` keeps the latest ≥2
  `seo-live` audits per (client,domain).
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
