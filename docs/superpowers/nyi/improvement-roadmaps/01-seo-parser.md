# SEO Parser — Improvement Roadmap

**Date:** 2026-06-10 · **Status:** NYI strategy doc
**Scope:** `app/seo-parser/**`, `app/api/upload`, `app/api/parse`, `lib/parsers/**` (41 parsers), `lib/services/**` (aggregator 841 LOC, brief 715 LOC, scoring, priority), `components/seo-parser/**`

---

## Current state (verified)

- Pipeline: upload SF CSVs (≤40 MB batches) → core-export gate
  (`lib/parsers/expected-exports.ts`) → sequential per-file parse in
  `app/api/parse/[sessionId]/route.ts` → `AggregatorService` merges 41 parser
  outputs in memory → `computeHealthScore()` → **the canonical result
  serialized into `Session.result` as one JSON string** → report page
  deserializes the whole blob → roadmap export via `brief.service.ts` (715 LOC).
- Some relational data already exists — `SessionPage` rows and the scalar
  summary columns on `Session` (totalUrls, critical/warning/notice counts) —
  but they are *derived from* the blob (lossy convenience copies), not a
  source of truth. `SessionPage` should not be mistaken for the future
  canonical page model unless it is deliberately migrated into one.
- Note: the report UI increasingly emphasizes severity buckets and priority
  ordering over the composite health score; treat score-related work below as
  secondary to findings work.
- Parsing is strictly sequential; each parser loads its full CSV into memory.
- ~20% of parser code is the same find-column → mask → iterate → accumulate
  pattern repeated (titles/meta/H1 are structurally identical).
- Scoring (6 weighted factors) and priority weights (40+ hardcoded
  issue-type → weight entries in `priority.service.ts`) are code constants —
  no per-client tuning, no visibility into why a score moved.
- The whole tool's input depends on a human running Screaming Frog with the
  right config and exporting 5+ CSVs correctly. One bad file fails the session.

## The big-picture problem

This tool is architected around its input format (SF CSV exports) instead of
around its output (findings about a client's site). That made sense when SF
was the only data source. Two things have changed: the Live SEO / SF-demotion
strategy (`nyi/2026-06-04-screaming-frog-retirement-roadmap.md`) means crawl
data will increasingly come from our own headless-Chrome scans, and the
client-centric platform direction (`00-overview.md`) needs findings to be
queryable across runs and tools. A JSON blob keyed to a one-shot upload
session can't serve either.

## Recommendation: invert the architecture around a findings model

### Phase 1 — Normalized findings + pages schema, dual-write (2–3 wks)

New tables (shared with ADA audit — see `06-platform.md`):

- `CrawlRun` (client, source: `sf-upload | live-scan`, startedAt, status,
  healthScore, raw-blob archive column)
- `CrawlPage` (run, url, title, h1, meta, wordCount, depth, indexable, status
  code) — named to avoid collision with the existing derived `SessionPage`
  model and Next.js pages; `SessionPage` is absorbed/retired by it
- `Finding` (run, page?, type, severity, detail JSON, dedupKey)

Aggregator keeps producing `AggregatedResult` for the existing report UI
(dual-write), but the report page, history lists, diffs, and client dashboard
progressively switch to querying the tables. End state: `Session.result`
becomes a raw archive only.

**Payoff:** run-over-run diffs become a SQL query instead of the bespoke
380-LOC diff page; client SEO history gets real trend data; "which clients
currently have broken_pages findings" becomes answerable; DB growth becomes
boundable (archive blobs can be pruned, findings stay).

Dual-write parity should be validated on 3–5 representative clients (compare
findings-table reads against blob reads) before any reader switches over.

### Phase 2 — Source-agnostic ingestion (1.5–2 wks)

Define one internal interface — effectively "what a crawl knows about a page"
— and make SF-CSV parsing *one adapter* that produces it. The Live SEO scan
(per the existing spec) becomes the second adapter. The aggregator, scorer,
prioritizer, brief/roadmap services all consume the interface, never CSVs.

This is the keystone for SF demotion: the report, roadmap, and pillar
analysis stop caring where crawl data came from, and the parallel-run
comparison the retirement doc requires (SF vs Live, side by side) becomes a
first-class view instead of a manual exercise.

### Phase 3 — Parser-layer consolidation (1 wk)

- Extract declarative parser bases: `LengthValidatorParser` (titles/meta/H1/H2),
  `ResourceParser` (images/links/CSS/JS/PDF). Target: 41 parser files → ~15
  files + config tables. Tests collapse with them.
- Parse files concurrently (limit ~4) and stream rows (Papa step callback)
  instead of whole-file loads — removes the memory cliff on big crawls.
- Per-file failure isolation: one corrupt CSV marks that export degraded
  instead of failing the session; report shows coverage per export.

### Phase 4 — Configurable scoring & priorities (0.5–1 wk)

Move health-score weights and the 40+ priority weights into a DB-backed config
(global default + optional per-client override), with an admin view and a
"score explanation" panel that shows factor contributions. This converts two
black boxes into things analysts can interrogate and tune without deploys.

### Phase 5 — Upload UX hardening (0.5 wk, only while SF uploads remain routine)

- Pre-flight validation on drop: header sniff per file, immediate "this
  export looks empty / wrong config" feedback instead of failing at parse.
- An export manifest: which SF menu produces each expected file (the checklist
  exists; the *instructions* don't).
- Resumable sessions: re-upload only the failed/missing files.

## What I would not do

- Don't build CSV → relational migration for *historical* sessions; archive
  blobs stay readable via the existing code path, new runs get tables.
- Don't parallelize parsing before streaming it — concurrent whole-file loads
  make the memory problem worse, not better.
- Don't expand the SF parser fleet further (e.g. new SF export types). New
  signal types should enter through the Phase 2 interface so they work for
  live scans too.

## Effort summary

| Phase | Effort | Depends on |
|---|---|---|
| 1. Findings schema + dual-write | 2–3 wks | Platform Track A schema work |
| 2. Source-agnostic ingestion | 1.5–2 wks | Phase 1 |
| 3. Parser consolidation + streaming | 1 wk | — (parallelizable) |
| 4. Configurable scoring | 0.5–1 wk | Phase 1 |
| 5. Upload UX | 0.5 wk | — |

Total ≈ 5.5–7.5 weeks. Phases 1–2 are the strategic ones; 3–5 are quality-of-life
and can be dropped if Track C (live monitoring) is hungrier for the time.
