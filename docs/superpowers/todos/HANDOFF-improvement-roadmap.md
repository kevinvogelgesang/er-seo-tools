# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-16 · **Updated by:** C6 Phase 1 close-out (broken-link verifier)
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

1. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md (current state + next item).
2. Read docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md (full plan).
3. Read the roadmap doc section named under "Next item" below.
4. Follow the normal flow: brainstorm/spec if the item needs one, write the plan,
   implement, test, commit. When the item is done: check it off in the tracker,
   add a status-log line, rewrite this handoff doc for the next item, and end
   your final reply with this doc's updated paste-in prompt in a code block.
```

## Current state

- **A1, A2, B1–B5, C1–C5 are DONE.** **C6 Phase 1 (broken-link verifier) is
  DONE** (PR #70, deployed + production-verified 2026-06-16). C6 stays `[~]` —
  it is a multi-phase track and only Phase 1 shipped.
- **C6 Phase 1 shipped:** (1) the named C6 migration —
  `CrawlRun.siteAuditId` `@unique` → `@@unique([siteAuditId, tool])`,
  `SiteAudit.crawlRun?` → `crawlRuns[]`; a SiteAudit now holds up to two runs
  (ada-audit + seo-parser **live-scan**); 15 readers re-keyed (compound
  `{ siteAuditId_tool: { siteAuditId, tool } }` for `findUnique`/`update`,
  `crawlRuns: { where: { tool:'ada-audit' } }`+`[0]` for relation-includes,
  plain `{ siteAuditId, tool }` for the writer's `deleteMany`). (2) The ADA
  site-audit page job harvests `<a href>`/`<img src>` → `HarvestedLink`
  (transient, post-settle-fenced, chunked). (3) A durable `broken-link-verify`
  job (enqueued LAST in `finalizeSiteAudit`, post-terminal) dedupes + checks
  same-domain links/images via `safeFetch` HEAD→GET, writes a **live-scan
  CrawlRun** (`source:'live-scan'`, `tool:'seo-parser'`, `score:null`), deletes
  the harvest rows. (4) `broken-link-recovery.ts` re-enqueues stranded
  verifiers (boot + 10-min). (5) Source-aware `selectRuns` — sf-upload stays the
  SEO score run, `seo.liveScan` surfaced additively (B2 panel +
  `BrokenLinksSection` on the site results page). (6) `pruneHarvestedLinks`
  (7-d) + tool-origin-aware `pruneArchivedBlobs`. Suite **2,399 green**.
  **Live canary proof:** a real proway.erstaging.site audit found **3 broken
  internal links + 2 broken images** (95 targets checked, 0 unconfirmed); the
  ada-audit (94) and live-scan (null) runs coexist on the SiteAudit.
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00`. (Its scans now also produce a
  broken-link live-scan run.)
- **⚠ PENDING HUMAN STEPS (Kevin) — unchanged from B5:**
  1. **B4 quarter-plan decision still open:** prod has a near-empty QuarterPlan
     (2026-06-11 19:51 UTC) 409-blocking the one-time analyst-browser
     localStorage import. Keep it, or delete QuarterPlan rows server-side and
     re-open `/quarter-grid` in the browser holding `seo-quarter-v3`.
  2. **First real qct_ push not yet exercised** (prod plan is all-pool). After
     (1): assign a client to a week, set its Teamwork tasklist ID, push, paste.
- **Blocked / gated:** Anthropic API billing (gates 03 Phase 3 + SF-retirement
  Phase 6 analytics integrations); sitemap miss-rate measurement not yet run;
  daily/nightly cadences still gated (C6 supersede-trimming NOT built in Phase 1).
- **Parked follow-ups (not next items):** C6 — external-link verification,
  CSS/JS/PDF broken-resource checks, redirect-chain/canonical/hreflang
  validation, the analyst SF-vs-Live parallel-run gate (SF-retirement §4),
  daily-cadence supersede-trimming; standalone single-page audit CSV/VPAT/report;
  public share-page export buttons; expandable rows on the public ADA share view;
  logo image asset for the PDF; `SessionPage` model drop (≥180 d after
  2026-06-11); same-URL standalone-audit diffing; fleet instance-level diffing;
  B2 v1 multi-domain limitation.

## Next item

**Decision point — pick one (both are valid; recommendation: C6 Phase 2):**

**Option A (recommended) — C6 Phase 2: on-page SEO extraction MVP, findings-native.**
The roadmap doc `docs/superpowers/nyi/2026-06-04-screaming-frog-retirement-roadmap.md`
Phase 0 / the pre-A2 plan `docs/superpowers/nyi/plans/2026-06-02-live-seo-on-ada.md`
(spec in `nyi/specs/2026-06-02-live-seo-on-ada-design.md`). Scope-reconcile as
always — that plan predates the findings layer and proposes its own
`PageSeoSnapshot`/`SiteSeoResult` models + a forked scorer; **C6 must land it in
the findings model instead**: extract title/meta/H1/canonical/schema/word-count
in the rendered DOM (the old plan's `parseSeoFromDocument` is the right harvest
code), populate the **existing** `CrawlPage` scalars (title/h1/metaDescription/
wordCount/crawlDepth/indexable/statusCode all already exist), and emit on-page
`Finding`s (duplicate/missing/thin) into the **same live-scan CrawlRun** the
broken-link verifier already creates (or a sibling). Phase 1 already built the
harvest hook in `runAxeAudit` and the live-scan run plumbing — this rides it.
Key reconcile question for the brainstorm: does the on-page extraction run
inside the page job (populating CrawlPage scalars at settle) or in the verifier
job (which already loads the run)? And does the live SEO score (forked
`computeHealthScore`) live on the live-scan `CrawlRun.score` (currently null)?

**Option B — C7: parser consolidation + streaming parse + per-file failure
isolation** (tracker Track C, ~1 wk; no roadmap-doc section — it's an
infrastructure cleanup of `lib/parsers/`). Independent of C6; pick this if you
want to step off the SF-retirement track.

Full flow either way: brainstorm/spec → Codex → plan → Codex → implement.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array form
  only, conditional logic via SQL `EXISTS`, manual `updatedAt = Date.now()` in
  raw statements (2026-06-10 production incident; CLAUDE.md "Do not").
- **C6 invariants (NEW):** a SiteAudit holds up to TWO CrawlRuns (ada-audit +
  seo-parser live-scan) — `findUnique`/`update` on a SiteAudit-origin run use
  the compound `{ siteAuditId_tool: { siteAuditId, tool } }`; `deleteMany`/
  `count`/`findMany` use plain `{ siteAuditId, tool }` (filter, not unique input
  — the writer learned this the hard way). The verifier reuses the
  `site-audit:<id>` job group ONLY because it's enqueued post-terminal
  (finalize early-returns on complete → liveness-safe). HarvestedLink is
  transient scaffolding (deleted post-verify; 7-d backstop), persisted
  ONLY after a successful page settle (zombie-fenced). A live-scan run has
  `score:null` and NO origin blob — it must NEVER displace the sf-upload SEO
  score (source-aware `selectRuns` + B1 series filters) and `pruneArchivedBlobs`
  must NEVER null the ADA `SiteAudit.summary` for it (seo-parser prunes only
  session-origin runs). Verifier precision posture: HEAD→GET confirm, externals
  unverified in v1, timeout/blocked = `unconfirmed` (excluded from broken counts).
- **C5 invariants:** the `FindingsBundle` is the ingestion contract — adapters
  follow the `lib/findings/types.ts` header (normalized URLs, keys.ts dedup keys,
  3-severity vocab, adapter-computed score, exactly one origin FK). Degraded
  fallbacks are safe-shape (`archived:true`, arrays present, unknowns OMITTED
  never 0); completeness never recomputed on archived data; status buckets only
  from `CrawlPage.statusCode`; `session_archived` 409s require the
  `archivePrunedAt` stamp; degraded diffs refused; parity/rebuild need the blob.
- **C4 invariants:** report-render uses group/dedup `report:<id>` — NEVER
  `site-audit:<id>` (recovery treats that group as audit liveness; the C6
  verifier is the exception, allowed only because it runs post-terminal). Report
  data loads BEFORE `acquirePage()`. Reports/CSV/VPAT findings-run-only (pre-A2
  → 409). Every dynamic report string escaped; CSV formula-injection-neutralized.
- **C3 invariants:** instance diffs never render across a wcagLevel mismatch;
  `AuditScorecard` strictly numeric (archived unknowns → "—", never 0); triage
  off on archived; blob-first, findings-fallback; artifact deletion snapshot-based.
- **C2 invariants:** scheduled path is ordinary downstream; handler resolves its
  Schedule via the Job row; config rot disables, DB errors retry; card scores
  read `CrawlRun.score`; scheduled retention only deletes `scheduleId IS NOT NULL`.
- **Findings-layer invariants:** dual-write best-effort/non-fatal; origin FKs
  `SetNull`; subtrees cascade from `CrawlRun` only; never backfill blobs; read
  services scalar/normalized-table only; BOTH prune flags ACTIVE.
- `finalizeSiteAudit` single decision point; hook order carry-forward THEN
  findings — **the findings hook stays LAST among DB writes; the broken-link
  enqueue is the trailing no-DB-write step after it.**
- **Quarter-grid invariants (B3/B4/B5):** singleton plan facade; mere page-opens
  never write; push metadata written ONLY by the receipt route.
- **Handoff-token / public route gotcha (bit us THREE times):** any new
  token-authed or public route MUST be added to `middleware.ts` `isPublicPath`
  + a `middleware.test.ts` case.
- Test gotchas: DB-backed test files use a unique domain/id/name prefix AND
  scope cleanup to tracked ids — never broad `deleteMany` on shared tables;
  clean `CrawlRun` by domain BEFORE origin rows; **any new test querying a
  CrawlRun by `siteAuditId` as a unique key needs the compound `siteAuditId_tool`
  input** (3 test files were missed on the first compile pass — the full suite
  catches them); vitest jsdom has NO working localStorage; node is the default
  env (component tests need `// @vitest-environment jsdom` + explicit
  `afterEach(cleanup)`).
- **Local dev quirk:** prefix prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is interactive-only
  — write migration SQL by hand, apply with `prisma migrate deploy`. (For C6 the
  local-dev.db had to be created first via `migrate deploy` from a clean state.)
  Local dev runs auth-free (`npx next dev`).
- **Server has no `sqlite3` CLI** — node + Prisma from
  `/home/seo/webapps/seo-tools` (run scripts from INSIDE the app dir). Authed
  prod checks: source the server `.env`, then **form-POST**
  `--data-urlencode "password=$APP_AUTH_PASSWORD"` to `/api/auth/login`
  (formData not JSON; 303 + cookie jar), reuse the jar. A site audit is
  triggered by `POST /api/site-audit {domain,wcagLevel}` (202 + queued id).
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction (registry session for this workspace exists; resume it — it's at
  turn 65).

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created.
- 2026-06-10 — A1 Phases 0–4 (PRs #50–#54), production-verified. **A1 COMPLETE.**
- 2026-06-10/11 — A2 Phases 1–4 (PRs #55–#58 + inert retention), production-verified. **A2 COMPLETE.**
- 2026-06-11 — B1 (#60), B2 (#61), B3 (#62), B4 (#63), B5 (#64 + middleware
  fix) all shipped + production-verified. **TRACK B COMPLETE.**
- 2026-06-11 — **C1 SHIPPED (PR #65)** — standalone ADA audits durable.
- 2026-06-12 — **C2 SHIPPED (PR #66)** — scheduled scans; weekly canary live.
- 2026-06-12 — **C3 SHIPPED (PR #67)** — ADA run diffing; ada-audit prune ACTIVE.
- 2026-06-12 — **C4 SHIPPED (PR #68)** — reporting layer (share/CSV/PDF/VPAT).
- 2026-06-12 — **C5 SHIPPED (PR #69)** — source-agnostic ingestion; seo-parser
  prune ACTIVE; `'live-scan'` reserved.
- 2026-06-16 — **C6 Phase 1 SHIPPED (PR #70), deployed, production-verified** —
  out-of-band broken-link verifier; named C6 migration
  (`@@unique([siteAuditId, tool])`) landed; live-scan run coexists with ada-audit;
  canary found 3 broken links + 2 broken images. C6 stays `[~]` (multi-phase).
  Next: C6 Phase 2 (on-page SEO extraction MVP, findings-native) or C7.
