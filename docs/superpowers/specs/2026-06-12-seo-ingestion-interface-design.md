# C5 — SEO Parser Source-Agnostic Ingestion (design)

**Date:** 2026-06-12 · **Status:** spec (Codex-reviewed: accept-with-fixes ×9, applied)
**Tracker:** C5 (`docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`)
**Roadmap source:** `docs/superpowers/nyi/improvement-roadmaps/01-seo-parser.md` Phase 2
**Companions:** `nyi/2026-06-04-screaming-frog-retirement-roadmap.md` (C6 consumer),
`plans/2026-06-02-live-seo-on-ada.md` (pre-A2 live-scan plan, superseded in part by this spec)

---

## 0. Scope reconciliation (what Phase 2 still means after A2)

The 01-doc's Phase 2 ("define one internal interface — what a crawl knows about
a page — and make SF-CSV parsing one adapter") predates A2. A2 already shipped
the interface **in code**:

- `lib/findings/types.ts` — `FindingsBundle` = `CrawlRunInput` + `CrawlPageInput[]`
  + `FindingInput[]` (+ `ViolationInput[]` for ada). This *is* "what a crawl
  knows about a page": URL, title, h1, meta, wordCount, crawlDepth, indexable,
  statusCode, plus typed/severity-bucketed findings with per-URL rows.
- `lib/findings/writer.ts` — idempotent delete-and-recreate persistence.
- `lib/findings/seo-mapper.ts` — the SF adapter's output mapping
  (`AggregatedResult` → bundle), live since A2 Phase 1.
- `lib/findings/keys.ts` / `normalize-url.ts` — the dedup-key and URL
  vocabulary every adapter must share.
- One read surface already flipped: the seo-parser pages route
  (`CrawlPage` + `Finding` join, A2 Phase 3).

So C5 is **not** a pipeline rewrite. The 41 parsers + the 841-LOC
`AggregatorService` collectively *are* the SF-CSV adapter; they stay. What
remains of Phase 2 is the part that makes the interface real rather than
incidental:

1. **Declare and harden the contract** — `'live-scan'` enters the `source`
   vocabulary, the adapter rules get written down, and an adapter-readiness
   test proves a non-SF bundle renders end-to-end.
2. **Make every SEO read surface findings-capable** — today 12 production
   readers deserialize `Session.result`; after C5 none of them *require* it.
   This is also what the C6 live scan needs: a report path that renders from
   findings rows alone, because a live run never has a blob.
3. **Flip `PRUNE_ACTIVATED['seo-parser']`** — the A2 rule: the flag flips in
   the same PR as the tool's last blob reader.

Explicitly **out of scope** (recorded so nobody relitigates):

- Rewriting `AggregatorService` to consume a typed snapshot instead of
  `parsedData` dicts. The interface boundary is the bundle, not the parser
  internals (approach decision, § 1).
- Building the live-scan adapter itself — that is C6.
- `brief.service.ts` and `pillarAnalysis/runFromSession.ts` — they re-parse
  the *uploaded CSV files*, not the blob. They are SF-adapter enrichments;
  they do not block the prune (uploads are deleted by the 180-d session TTL
  in `lib/cleanup.ts`, not the 90-d blob prune, and both run at parse time).
- Parser consolidation/streaming (C7), configurable scoring (C8).

## 1. Approaches considered

**A. Full inversion** — typed `CrawlSnapshot` interface consumed by the
aggregator; parsers feed it; live scan feeds it too. Rejected: an 841-LOC
aggregator reading 41 untyped parser dicts in ~20 places would be rewritten
wholesale for zero user-visible gain; the SF-only sections (keyword_signals,
technical_seo, performance) would make the interface a bag of optionals; the
regression risk lands on the flagship report.

**B. Findings bundle as the contract (chosen)** — the A2 `FindingsBundle` is
the source-agnostic interface. SF pipeline = adapter #1 (already producing
it). C6's live scan = adapter #2 (maps its per-page extraction into the same
bundle). Downstream reads go findings-first/findings-fallback. The
`AggregatedResult` blob is demoted to "SF adapter's rich 90-day archive".

**C. New parallel `lib/ingest/` types mapped into findings** — an extra layer
with no consumer; the bundle already is the page-level truth. Rejected
(YAGNI).

## 2. The ingestion contract (deliverable 1)

### 2.1 Code changes

- `lib/findings/types.ts`: `CrawlRunInput.source` union gains `'live-scan'`
  (the DB column is a string; the schema comment already reserves it — no
  migration).
- Module-header documentation in `types.ts` becomes the adapter contract
  (mirrored in CLAUDE.md):
  - An adapter produces one `FindingsBundle` per run and persists it via
    `writeFindingsRun()` from a **fire-and-forget hook after its legacy
    commit** (or as its only write, for blob-less sources).
  - **URLs**: every `CrawlPage.url` and page-scope `Finding.url` is
    normalized via `normalizeFindingUrl()`; pages dedupe keep-first by
    normalized URL.
  - **Dedup keys**: `runFindingKey(type)` / `pageFindingKey(type, url)` from
    `lib/findings/keys.ts` — never hand-rolled.
  - **Severity vocabulary**: exactly `critical | warning | notice`.
  - **Issue shape**: each issue type emits one run-scope finding (count +
    `detail` JSON `{description}`) plus page-scope findings per affected URL
    with `affectedComplete`/`affectedSource` copied through.
  - **Score**: the adapter computes it (`CrawlRun.score` is the canonical
    cross-source score — B1 rule: readers never depend on origin-row scores).
  - **Origin**: exactly one origin FK (writer-enforced). Origin FKs are each
    `@unique` — **one CrawlRun per origin row** is the current invariant.

### 2.2 Named decision point for C6 (documented, not built)

A C6 live-SEO run riding the ADA site audit would be a *second* run on the
same `SiteAudit` origin, which today's `@unique siteAuditId` forbids.
Recommendation recorded for C6 (Codex fix #2 — the migration must be
complete, not additive): **remove** the field-level `@unique` from
`CrawlRun.siteAuditId`, **add** `@@unique([siteAuditId, tool])`, and update
`writer.ts` delete-and-recreate keying plus every
`findUnique({ where: { siteAuditId } })` reader to address runs by
`{ siteAuditId, tool }`. All of that lands *in the C6 PR that introduces the
second run* — not speculatively here. If C6 confirms one `SiteAudit` owns
both an ADA and an SEO run, that migration must ship before any live-scan
dual-write.
Related: run-selection helpers in `lib/services/findings-shared.ts` pick
"previous" by (domain, tool) — once two sources coexist, trend/diff consumers
must decide whether to filter by `source` (C6 presentation decision; the
column already discriminates).

### 2.3 Adapter-readiness proof (test, this PR)

A DB-backed test writes a synthetic bundle with `tool: 'seo-parser'`,
`source: 'live-scan'` through `writeFindingsRun()`, then renders it through
the findings-based report builder (§ 3) and asserts a complete, renderable
report model — issues bucketed, URLs listed, score present. **Origin: a
seeded `Session`** (Codex fix #1) — under today's schema a `SiteAudit` origin
would collide with that audit's ADA run (`@unique siteAuditId` + the writer's
origin-keyed delete-and-recreate would clobber it); true
`siteAuditId + tool` coexistence is C6's migration (§ 2.2). A companion
assertion documents the current limitation explicitly (second run on a
SiteAudit origin replaces the first). This pins the contract a C6 adapter
codes against.

## 3. Findings-based report builder (deliverable 2, the keystone)

New module `lib/findings/seo-findings-fallback.ts` (naming mirrors
`lib/ada-audit/findings-fallback.ts` from C3):

```ts
buildSeoResultFromRun(run, pages, runFindings, pageFindings, opts?)
  → ArchivedAggregatedResult   // AggregatedResult subset + { archived: true }
```

Run-centric, not session-centric — the same builder serves a pruned SF
session *and* a future blob-less live run. Origin context is loaded **per run
type** (Codex fix #8): session-origin runs may enrich from `Session` scalars
(`siteName`, `files`); siteAudit-origin runs enrich from `SiteAudit`; the
builder never assumes a `Session` exists.

**Safe-shape contract (Codex fix #3):** the degraded object always populates
the arrays/objects the UI and export code assume exist —
`metadata.files_processed: []`, `metadata.parsers_used: []`,
`recommendations: []`, all three issue buckets (possibly empty) — plus an
explicit `archived: true` marker. **Completeness is never recomputed on a
degraded result** (Codex fix #4): `ResultsView` falls back to
`computeCompleteness(result)` when `result.completeness` is absent, which
would misclassify a findings-only result as missing inputs; the builder sets
an explicit archived completeness verdict (or the UI suppresses the recompute
when `archived`).

**Reconstructed (exact or near-exact):**

| Field | Source |
|---|---|
| `crawl_summary.total_urls` | `run.pagesTotal` |
| `crawl_summary.indexable_urls` / `non_indexable_urls` | count over `CrawlPage.indexable` (null-aware: only non-null values counted; omit both when all null) |
| `crawl_summary.avg_word_count` | mean over non-null `CrawlPage.wordCount` |
| `crawl_summary.avg_crawl_depth` / `max_crawl_depth` | over non-null `CrawlPage.crawlDepth` |
| `issues.{critical,warnings,notices}` | run-scope `Finding` rows → `Issue { type, severity, description (detail JSON), count, urls, affectedUrlRefsComplete: affectedComplete }`; `urls` filled from that type's page-scope finding URLs (plain normalized URLs — no registry refs) |
| `site_structure.crawl_depth_distribution` | group-by over `CrawlPage.crawlDepth` (feeds `CrawlDepthChart`) |
| `metadata.health_score` | `run.score` |
| `metadata.site_name` | `Session.siteName ?? run.domain` |

**Status-code counts — opportunistic, never inferred (Codex fix #6):** the
contract has `CrawlPage.statusCode`; the builder computes
`ok_responses`/`redirects`/`client_errors`/`server_errors` buckets **when
page status codes are present** (a future live-scan run has them) and marks
them unavailable otherwise (today's SF-derived rows are null). Never inferred
from issue types like `broken_pages`.

**Degraded by contract (omitted, never fabricated):** `resources`, `technical_seo`, `performance`,
`duplicate_content`, `keyword_signals`, `recommendations` /
`structured_recommendations`, `url_registry`, `page_index`, `completeness`,
`supplemental_data`, issue `groups`. The C3 rule applies verbatim: **unknowns
render "—"/hidden, never a literal 0.**

UI handling (results page + share page): an archived banner (C3 pattern);
sections backed by omitted fields hide (most are already conditional —
`duplicate_content?`, `keyword_signals?`; `RecommendationsPanel` gains an
absent-data guard). The status-code section is guarded **at the container
level** (Codex fix #7) — the whole chart card hides when status data is
unavailable, so archived reports never render misleading zero bars. The pages table keeps
working untouched — it reads the relational pages route. `PageDetailModal`
already has the registry-less fallback path ("urls only").

## 4. Per-reader flip table (deliverable 2, the sweep)

Verified inventory — every production deserializer of `Session.result`.
Pattern is C3's: **blob-first, findings-fallback**; fresh sessions keep full
fidelity, pruned sessions degrade per § 3.

| # | Reader | Treatment |
|---|---|---|
| 1 | `app/seo-parser/results/[sessionId]/page.tsx:92` (+ guard at :52) | blob → full view; blob null + `crawlRun` present → § 3 fallback + archived banner. Guard becomes `complete && (result ‖ crawlRun)` |
| 2 | `app/share/[token]/page.tsx:65` (+ guard :59) | same fallback (public share of an archived session stays functional, degraded) |
| 3 | `app/api/share/[token]/route.ts:43` | same fallback (JSON, `archived: true`) |
| 4 | `app/api/share/route.ts:32` (mint) | existence check widens to `result ‖ crawlRun` |
| 5 | `app/api/parse/[sessionId]/route.ts:366` (GET) | blob null + run → serve § 3 fallback with `archived: true` |
| 6 | `app/api/parse/history/route.ts:42` | **full flip, blob-free for A2 sessions**: `healthScore` from `crawlRun.score` (one-to-one relation include), `urlCount` from `Session.totalUrls` scalar; existing blob parse kept only as pre-A2 fallback (no `crawlRun`) |
| 7 | `app/api/diff/route.ts:60,66` | **degraded diffs are refused** (Codex fix #5): if either side's blob is null → 409 `session_archived`. `diff.service.ts` coalesces missing numerics with `?? 0`, so a full-vs-degraded diff would fabricate false deltas; a confidently wrong diff is worse than a clear archived-data limitation. Findings-based type-level trends on the client dashboard (B2) remain the archived-era diff surface |
| 8 | `app/api/export/[sessionId]/[format]/route.ts:169` | blob ‖ § 3 fallback; degraded exports carry an "archived — reduced data" note in markdown/summary; JSON exports the degraded object as-is |
| 9 | `app/api/export/[sessionId]/claude/route.ts:32` | already refuses null blob; make it an explicit **409 `session_archived`** when `crawlRun.archivePrunedAt` is set (degraded data would mislead the srt_ memo) |
| 10 | `app/api/seo-roadmap/[id]/route.ts:35` | already 409s on null blob; error body distinguishes `session_archived` |
| 11 | `app/api/keyword-memo/[id]/route.ts:35` | already 409s; `session_archived` (keyword_signals are not reconstructible) |
| 12 | `app/keyword-research/[sessionId]/page.tsx:37` | blob null → archived empty-state on the signals panel |

Allowed blob readers (unchanged): `scripts/findings-rebuild.ts`,
`scripts/findings-parity.ts`, `lib/findings/parity.ts` — rebuild/parity on a
pruned session fails with a clear "blob pruned" message instead of a crash.

Memo-export rationale (9–11): srt_/krt_ exports feed Claude-written client
deliverables; a silently-degraded export (no recommendations, no performance,
no keyword data) would produce a confidently wrong memo. 409 with an explicit
code is the honest contract — mirrors C4's `no_findings_run` 409 precedent.
These exports are generated minutes after a parse in practice; a >90-day
re-pull is the rare case being refused.

## 5. Prune activation (deliverable 3)

- `PRUNE_ACTIVATED['seo-parser']` → `true`, same PR (the A1/A2/C3 rule).
- What the prune nulls for seo-parser: `Session.result` only. All Session
  scalars, the `CrawlRun` subtree, and uploaded CSVs (180-d TTL owns those)
  are untouched. No child blobs, no artifacts (unlike ada-audit).
- Keyword-research sessions also have CrawlRuns (same dual-write), so their
  blobs prune too — rows 11–12 are their read contract. This is **intentional
  UX, stated in user-facing copy** (Codex fix #9): keyword signals are
  blob-only, so archived keyword memos/exports are *unavailable* (explicit
  409 / archived empty-state with "signals were archived after 90 days"
  copy), never silently degraded.
- Lifecycle after C5: blob pruned at 90 d → degraded-but-viewable until the
  180-d session TTL deletes the Session row entirely → findings rows live on
  (SetNull) feeding dashboards/trends forever. First real seo-parser prune is
  a designed no-op until ~2026-09-08 (oldest CrawlRuns are 2026-06-10).

## 6. Testing

- **Builder unit tests** — fixture run/pages/findings → assert each § 3
  reconstruction row + each omission (no fabricated zeros).
- **Seeded-prune tests per surface** (C3 pattern): write a real fixture blob
  + findings via the live hook path, null `result`, hit rows 1–6, 8 and 12 —
  assert degraded render/JSON, archived markers, safe-shape arrays present,
  no 500s. Rows 7 and 9–11: assert the 409 bodies (`session_archived`).
- **History flip test** — A2 session served scalar/relational (and a
  pre-A2-shaped session still served via blob fallback).
- **Diff refusal test** — one archived side → 409; both fresh → unchanged
  diff output.
- **Adapter-readiness test** (§ 2.3) — `'live-scan'` bundle end-to-end.
- **Retention test update** — seo-parser activation asserted; existing
  inert-flag assertions updated.
- DB-backed test files follow the house rules: unique domain/id prefixes,
  tracked-id cleanup, `beforeAll` pre-clean, `CrawlRun` cleaned by domain
  before origin rows.

## 7. Invariants carried forward (do not break)

- Dual-write stays best-effort/non-fatal; finalizer hook order unchanged.
- Writer stays delete-and-recreate, array-form `$transaction` only.
- Never backfill historical blobs; pre-A2 sessions (no CrawlRun) are never
  pruned and keep their current read paths.
- `AuditScorecard`-style honesty: degraded unknowns render "—"/hidden, never 0.
- No new public/token routes (share routes already in `isPublicPath` —
  middleware untouched, but the share-page fallback gets a middleware-shaped
  test anyway per the thrice-bitten gotcha).
