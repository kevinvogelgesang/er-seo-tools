# Normalized Findings Layer (A2) — Design

**Date:** 2026-06-10 · **Status:** Draft for Codex review
**Roadmap:** Track A item A2 (`docs/superpowers/nyi/improvement-roadmaps/06-platform.md` § 2; schema shared with `01-seo-parser.md` Phase 1 and `02-ada-audit.md` Phase 3)

## Problem

Both analysis tools persist their canonical output as JSON-string blobs
(`Session.result` ~2.5 MB avg, `SiteAudit.summary` ~450 KB avg,
`AdaAudit.result` ~2.7 KB × 23k rows). Nothing about a client's findings is
queryable: no trends, no run-over-run diffs, no "which clients currently have
broken_pages", and DB growth is unboundable because the blob *is* the data.
This layer is the prerequisite for B2 (findings on the client dashboard),
C3 (real ADA diffing), and C5 (source-agnostic SEO ingestion).

## Goals / non-goals

**Goals**

- New tables `CrawlRun` / `CrawlPage` / `Finding` / `Violation`, keyed to
  client + run + dedupKey, written by both tools.
- Dual-write from the SEO parser and the ADA runners. Legacy blobs remain the
  source of truth for every existing reader until parity is proven.
- Parity harness; validate on 3–5 representative clients in production before
  any reader flips.
- Retention machinery that demotes blobs to prunable archives (90-day window),
  shipped gated — pruning for a tool activates only when that tool's readers
  have flipped.
- Absorb `SessionPage` into `CrawlPage` (flip its one reader, then retire).

**Non-goals**

- No backfill of historical blobs — old runs stay readable via the existing
  blob code paths until natural expiry; new runs get tables. (Standing
  decision; do not relitigate.)
- No reader flips for the report page, site-audit results view, exports,
  shares, or memo tools — those migrate tool-by-tool in B2/C3/C5.
- No PDF findings rows — `PdfAudit` is already relational with a small
  per-row `issues` blob; fold into `Finding` only when a consumer needs it.
- No Lighthouse findings — `lighthouseSummary` stays on `AdaAudit`.
- No live-scan source yet (C5/C6); the schema reserves the `source` value.

## Measured baseline + growth projection (production, 2026-06-10)

Read-only measurement run against the production DB (27 clients, DB
309 MB total, ~249 MB of which is JSON blobs):

| Blob | rows | avg | sum |
|---|---|---|---|
| `Session.result` | 21 | 2.50 MB | 52.5 MB (four legacy 12.9 MB rows dominate) |
| `AdaAudit.result` (site children) | 23,456 | 2.7 KB | 63.3 MB |
| `AdaAudit.result` (standalone) | 118 | 5.0 KB | 0.6 MB |
| `SiteAudit.summary` | 148 | 452 KB | 66.9 MB |
| `AdaAudit.lighthouseSummary` | 21,161 | 3.0 KB | 63.7 MB |
| `PdfAudit.issues` | 3,393 | 0.6 KB | 2.0 MB |

Shape facts (random samples): completed site audits avg **153 pages** (max
838); ADA violation density is **0.78 violations/page** (p50 0, p90 2, max 4)
with **2.2 nodes/violation**; a current-format parse run has ~150 pages,
~50–72 issue types, ~280 page-attributed finding refs.

**Projected table growth:**

- *Current human-triggered volume* (~148 site audits / 6 wks, ~21 parse
  sessions total): ~25k `CrawlPage` + ~20k `Violation` + a few thousand
  `Finding` rows ≈ **< 25 MB**. Trivial.
- *Hypothetical nightly fleet ADA* (27 clients × 153 pages): ~1.5 M
  `CrawlPage` + ~1.2 M `Violation` rows/yr ≈ **1.2–2 GB/yr kept forever**,
  plus blob archive steady state at a 90-day window ≈ 1 GB ADA results +
  1.1 GB summaries + 1.1 GB lighthouse.

**Retention decision validated by the numbers:** a 90-day archive window and
findings-kept-forever are safe for human-triggered volume and for modest
scheduled use (e.g. weekly fleet scans ≈ 170–280 MB/yr of findings rows).
**Nightly** fleet scans are not safe with these defaults — C2 must introduce a
cadence-aware retention class (e.g. prune scheduled-run `CrawlPage`/
`Violation` rows after N days with weekly keepers, or skip summary blobs for
scheduled runs) before enabling them. This is recorded as a C2 gate, not an
A2 problem.

## Schema

```prisma
model CrawlRun {
  id              String    @id @default(cuid())
  createdAt       DateTime  @default(now())
  tool            String    // 'seo-parser' | 'ada-audit'
  source          String    // 'sf-upload' | 'site-audit' | 'page-audit' (reserved: 'live-scan')
  domain          String?   // normalized host, denormalized for client-less queries
  clientId        Int?
  client          Client?   @relation(fields: [clientId], references: [id], onDelete: SetNull)
  sessionId       String?   @unique
  session         Session?  @relation(fields: [sessionId], references: [id], onDelete: SetNull)
  siteAuditId     String?   @unique
  siteAudit       SiteAudit? @relation(fields: [siteAuditId], references: [id], onDelete: SetNull)
  adaAuditId      String?   @unique // standalone page audits only
  adaAudit        AdaAudit? @relation(fields: [adaAuditId], references: [id], onDelete: SetNull)
  status          String    // 'complete' | 'partial'
  score           Int?      // healthScore (seo-parser) | site/page score (ada-audit)
  wcagLevel       String?   // ada runs only
  pagesTotal      Int       @default(0)
  startedAt       DateTime?
  completedAt     DateTime?
  archivePrunedAt DateTime? // set when the origin row's blob was pruned
  pages           CrawlPage[]
  findings        Finding[]
  violations      Violation[]

  @@index([clientId, tool, createdAt])
  @@index([domain, createdAt])
  @@index([createdAt])
}

model CrawlPage {
  id              String   @id @default(cuid())
  runId           String
  run             CrawlRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  url             String   // normalized (see Dedup keys)
  statusCode      Int?
  title           String?
  h1              String?
  metaDescription String?
  wordCount       Int?
  crawlDepth      Int?
  indexable       Boolean?
  score           Int?     // ada page score
  adaAuditId      String?  // drill-through to the child AdaAudit (no FK — row may outlive it)
  findings        Finding[]
  violations      Violation[]

  @@unique([runId, url])
  @@index([runId])
}

model Finding {
  id        String     @id @default(cuid())
  runId     String
  run       CrawlRun   @relation(fields: [runId], references: [id], onDelete: Cascade)
  pageId    String?
  page      CrawlPage? @relation(fields: [pageId], references: [id], onDelete: Cascade)
  type      String     // seo issue-type id (e.g. 'missing_title') | axe ruleId (e.g. 'color-contrast')
  severity  String     // 'critical' | 'warning' | 'notice' (canonical, cross-tool)
  count     Int        @default(1) // run-level rows: affected page count
  detail    String?    // capped JSON (description, source, completeness, sample urls)
  dedupKey  String     // stable identity across runs — see Dedup keys
  violation Violation?

  @@unique([runId, dedupKey])
  @@index([runId, severity])
  @@index([type])
  @@index([pageId])
}

model Violation {
  id        String    @id @default(cuid())
  findingId String    @unique
  finding   Finding   @relation(fields: [findingId], references: [id], onDelete: Cascade)
  runId     String    // denormalized for direct rule/impact queries
  run       CrawlRun  @relation(fields: [runId], references: [id], onDelete: Cascade)
  pageId    String
  page      CrawlPage @relation(fields: [pageId], references: [id], onDelete: Cascade)
  ruleId    String
  impact    String    // 'critical' | 'serious' | 'moderate' | 'minor' (exact axe impact)
  wcagTags  String    // JSON string[]
  help      String?
  helpUrl   String?
  nodeCount Int       @default(0)
  nodes     String?   // capped node JSON: ≤5 nodes, html truncated to 300 chars, target selectors

  @@index([runId, impact])
  @@index([ruleId])
  @@index([pageId])
}
```

Design points:

- **Origin FKs are `SetNull`, never `Cascade`.** `cleanExpiredSessions()`
  deletes `Session` rows at 180 days; findings must survive their origin
  (that's the whole point). `CrawlRun` owns its subtree; children cascade
  from the run only.
- **`Finding` is the single cross-tool query surface; `Violation` is a 1:1
  axe-detail extension.** Dashboards and "which clients have X" query
  `Finding`; ADA diffing (C3) queries `Violation` directly via its
  denormalized `runId`/`pageId`/`ruleId`.
- **Severity mapping (ADA → canonical):** critical/serious → `critical`,
  moderate → `warning`, minor → `notice`. `Violation.impact` keeps the exact
  axe impact, so nothing is lost.
- **Runs are written once, at completion** — immutable snapshots. Progress
  tracking stays on the legacy rows. Failed runs get no `CrawlRun` (the blob
  remains for forensics); a completed site audit with some errored pages
  writes `status: 'partial'` when `pagesError > 0`, else `'complete'`.

### Dedup keys

`lib/findings/keys.ts` exports the canonical helpers (mirrors the
`checks-keys.ts` pattern):

- `normalizeFindingUrl(url)` — lowercase host, strip fragment, strip
  trailing slash on root-path only; same normalization used for
  `CrawlPage.url`.
- Run-level SEO finding: `dedupKey = type`.
- Page-level finding (both tools): `dedupKey = `${type}:${normalizeFindingUrl(url)}``.

These keys are what make run-over-run diffs (`new` = key in run B not in
run A) and cross-run triage carry (C2) line up.

### Row mapping

**SEO parser (per completed parse):** one `CrawlRun`
(source `sf-upload`, `score` = health score); one `CrawlPage` per
`page_index` entry (same field mapping `buildSessionPages` uses today); one
**run-level** `Finding` per issue type (count = `issue.count`, detail =
description + `affectedUrlSource` + `affectedUrlRefsComplete`); one
**page-level** `Finding` per `(issue type, affected URL)` pair resolved
through `url_registry`. A finding URL with no `CrawlPage` row (e.g. broken
external target) gets `pageId = null` with the URL kept in the dedupKey and
detail. Legacy-format blobs without `page_index`/`url_registry` produce
run-level rows only — and only for new runs; historical sessions are never
read.

**ADA site audit (per finalized audit):** one `CrawlRun` (source
`site-audit`); one `CrawlPage` per child `AdaAudit` (url, final status code
n/a → null, `score`, `adaAuditId`); per child violation: one page-level
`Finding` (type = ruleId, mapped severity) + its `Violation` row (exact
impact, wcagTags, help, nodeCount, capped nodes). Redirected/errored children
still get a `CrawlPage` row (no findings).

**ADA standalone page audit (per completed audit):** one `CrawlRun` (source
`page-audit`, `pagesTotal` 1) + one `CrawlPage` + findings/violations as
above.

## Writer module: `lib/findings/`

- `keys.ts` — normalization + dedup keys.
- `mappers.ts` — pure functions: `mapSeoResult(result, ctx)`,
  `mapAdaChildren(children, ctx)`, `mapAdaSingle(audit)` → a
  `{ run, pages, findings, violations }` row bundle. Unit-testable without a
  DB.
- `writer.ts` — `writeFindingsRun(bundle)`:
  1. `deleteMany` any existing `CrawlRun` for the same origin (unique origin
     FK; cascade clears the subtree) — this is what makes the write
     **idempotent** under retries/restarts.
  2. Insert run, pages, findings, violations via `createMany`, **chunked at
     75 rows** (same SQLite bound-variable guard as the SessionPage insert),
     all inside ONE array-form `$transaction([...])`.
  - **Array-form only** — no interactive transactions (standing rule,
    2026-06-10 incident). The bundle is fully computed in memory before the
    transaction is assembled.
  - `createMany` cannot return ids, so ids (cuids) are generated in the
    mapper and cross-referenced in the bundle before insert.

### Hook points + failure policy

Dual-write is **best-effort and non-fatal**: every hook wraps
`writeFindingsRun` in try/catch and logs `[findings]` on failure. The legacy
write path must be completely unaffected by a findings failure.

1. **Parser** — `app/api/parse/[sessionId]/route.ts`, *after* the existing
   completion `$transaction` commits (separate transaction; a findings
   failure must not fail the session, and the blob commit must not wait on
   findings).
2. **ADA site audit** — `lib/ada-audit/site-audit-finalizer.ts`, after the
   `status: 'complete'` update; the children are already loaded for
   `buildSiteAuditSummary`, so the mapper reuses them (no second load).
   Finalize is the single decision point and is naturally idempotent here:
   a recovered/re-finalized audit just rewrites the run.
3. **ADA standalone** — `app/api/ada-audit/route.ts` background runner, after
   the final `complete` update.

Because dual-write is best-effort, a `scripts/findings-rebuild.ts` CLI can
rebuild the run bundle for any **new-format** origin row from its archived
blob (this is recovery for failed dual-writes of new runs, not historical
backfill).

## Parity harness

`lib/findings/parity.ts` — `compareSeoParity(sessionId)` /
`compareAdaParity(siteAuditId)`: recompute the bundle from the blob via the
same mappers, read the stored tables, and diff:

- SEO: severity counts, issue-type set + per-type counts, `CrawlPage` count
  vs `page_index` length, sampled page scalars.
- ADA: per-page rule sets + node counts vs blob violations; aggregate
  scorecard recomputed from `Violation` rows vs `summary.aggregate`.

Output: `{ ok, diffs[] }`. Exposed by `scripts/findings-parity.ts` and run on
production against 3–5 representative clients' fresh runs. **No reader flips
until parity passes** (standing decision).

## Retention / archive demotion (gated)

- New cleanup task `pruneArchivedBlobs()` in `lib/findings/retention.ts`,
  registered in `runCleanup()`:
  for each tool with pruning **activated**, find `CrawlRun`s with
  `completedAt < now − 90 d`, `archivePrunedAt IS NULL`, origin row present →
  null the origin blob (`Session.result` / `AdaAudit.result` /
  `SiteAudit.summary`), keep all scalar columns, set `archivePrunedAt`.
- Activation is per-tool via code constants (e.g.
  `PRUNE_ACTIVATED = { 'seo-parser': false, 'ada-audit': false }`) that flip
  **in the same PR as that tool's last blob reader** — identical to the A1
  pattern of deleting the legacy path only after parity. In A2 both ship
  `false`; the machinery ships tested and inert.
- Rows with no `CrawlRun` (historical, pre-A2) are untouched — they expire
  via the existing 180-day session TTL or live on (audits have no TTL today;
  giving audits a TTL is out of scope).

## SessionPage absorption

Phase-final, after parity passes in production:

1. Flip `app/api/seo-parser/[sessionId]/pages/route.ts` (SessionPage's only
   reader) to query `CrawlPage` + page-level `Finding` rows (issueTypes/
   issueCount become a join/group instead of denormalized columns), keeping
   the response shape identical.
2. Stop writing `SessionPage` in the parse route.
3. Drop the `SessionPage` model in a follow-up migration once the flip has
   soaked. (Sessions older than the flip keep working: their pages route
   reads find no CrawlPage rows only for pre-A2 sessions — the route falls
   back to `SessionPage` when the session has no `CrawlRun`.)

## Phasing (each phase = branch + PR + deploy + verify, like A1)

1. **Phase 1 — schema + writer + SEO dual-write.** Migration (4 tables),
   `lib/findings/` (keys, mappers for SEO, writer), parser hook, rebuild
   script, parity lib + script (SEO side), unit + integration tests.
2. **Phase 2 — ADA dual-write.** ADA mappers, finalizer + standalone hooks,
   ADA parity, tests.
3. **Phase 3 — production parity + cheap flips.** Run parity on 3–5
   representative clients (fresh parse + fresh site audit each); fix
   divergences; flip the SessionPage reader; stop writing SessionPage.
4. **Phase 4 — retention + retirement.** `pruneArchivedBlobs()` (inert
   activation constants), drop `SessionPage`, CLAUDE.md + roadmap updates.

## Testing

- Mapper unit tests from fixture blobs (current-format parse result; ADA
  children incl. redirected/errored/zero-violation pages; legacy-format
  session degrades to run-level only).
- Writer integration tests on the dev DB: idempotent rewrite (same origin
  twice → same row counts), chunking >75 rows, origin deletion sets null
  (run survives), cascade from run delete.
- Hook tests: parse completion writes a run; findings failure doesn't fail
  the session (inject a writer error); finalizer writes a run once complete;
  re-finalize rewrites instead of duplicating.
- Parity tests: blob vs tables on fixtures, including a seeded divergence.
- Retention tests: gated-off does nothing; activated prunes only >90 d runs
  with present origin; `archivePrunedAt` set; scalars untouched.
- Existing-suite guardrails: test files that create site audits/sessions
  must keep `clearTestState` neutralization patterns (one-active guard is
  global over the shared dev DB).

## Alternatives considered

- **Per-page-settle ADA writes** (write `Violation` rows inside the
  `site-audit-page` settle transaction): avoids re-parsing child blobs at
  finalize, but touches the carefully-tuned Phase-3 settle transactions,
  needs per-page idempotency, and spreads the write across three job types.
  Finalize-time write is one hook, naturally idempotent, and the finalizer
  already loads every child at completion. Re-parse cost is ~153 × 2.7 KB
  JSON — negligible. **Chosen: finalize-time.**
- **Violation as a standalone table (no Finding row for ADA):** saves ~0.8
  rows/page but forks the query surface — every cross-tool consumer (B2
  dashboard) would UNION two tables. **Chosen: Finding + 1:1 Violation.**
- **Dual-write inside the parser's completion transaction:** atomic, but a
  findings bug could fail parses, violating "legacy path unaffected".
  **Chosen: separate best-effort transaction + rebuild script.**

## Invariants to respect (from A1 — load-bearing)

- Array-form `$transaction([...])` only; conditional logic in SQL; manual
  `updatedAt` in raw statements (not needed here — new tables have no
  `@updatedAt` requirements beyond defaults).
- Never hold a transaction across network/browser work — bundles are
  computed fully in memory first.
- `finalizeSiteAudit` semantics unchanged: findings write happens after the
  terminal flip, is try/caught, and never blocks `closeBatchIfDrained` or the
  promoter kick.
- The site-audit one-active guard, settle transactions, and recovery paths
  are untouched.
