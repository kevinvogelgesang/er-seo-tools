# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-12 · **Updated by:** C3 close-out (ADA run diffing + blob-archive activation)
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

- **A1, A2, B1–B5, C1, C2, C3 are DONE** (durable job queue #50–#54; findings
  layer #55–#58; client dashboard #60; findings/action center #61; Quarter
  Grid → DB #62; grid split #63; grid closure #64; standalone ADA durable #65;
  scheduled scans #66; **ADA run diffing + blob-archive activation #67,
  deployed + production-verified 2026-06-12**).
- **C3 shipped:** instance-level (URL×rule) run-over-run diffing keyed on
  `Finding.dedupKey` with page-set awareness (regressed vs new-page, resolved
  vs not-rescanned) — pure `diffInstances()` in `findings-shared.ts` + a
  selection service `lib/services/site-audit-diff.ts` (domain+wcagLevel-matched
  previous; `getRunPairInstanceDiff` → null on level mismatch/non-ada).
  Surfaced as `SiteAuditDiffPanel` on `/ada-audit/site/[id]`, `+N/−M` chips on
  `ScheduledScansCard`, and a `· +N / −M violations` clause on the dashboard
  ADA source line (fleet stays type-level by design).
  **`PRUNE_ACTIVATED['ada-audit'] = true`** — at 90 d, origin
  `SiteAudit.summary`/standalone `AdaAudit.result` AND site-audit child
  `AdaAudit.result` blobs are nulled (child `lighthouseSummary` kept) with
  snapshot-based screenshot deletion; every reader flipped: scores prefer
  `CrawlRun.score`, detail/share views degrade via
  `lib/ada-audit/findings-fallback.ts` (`buildSummaryFromFindings`,
  `buildArchivedAxeResults`, archived banner, `archivedCounts` → "—" never 0,
  triage off on archived). `CrawlPage.passCount`/`incompleteCount` added
  (migration `20260612100000_c3_pass_counts`). Suite 2,233 green (221 files).
  **First real prune is a designed no-op until ~2026-09-08** (oldest findings
  rows 2026-06-10) — watch the cleanup tick log for `[findings] pruned … ada-audit`
  around then.
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00`. Its audit pair now renders the
  live diff panel ("No accessibility changes…") and card chips (0/0) — it is
  the standing proof for both the C2 tick and the C3 diff path.
- **⚠ PENDING HUMAN STEPS (Kevin) — unchanged from B5:**
  1. **B4 quarter-plan decision still open:** prod has a near-empty QuarterPlan
     (2026-06-11 19:51 UTC) 409-blocking the one-time analyst-browser
     localStorage import. Keep it, or delete QuarterPlan rows server-side and
     re-open `/quarter-grid` in the browser holding `seo-quarter-v3`.
  2. **First real qct_ push not yet exercised** (prod plan is all-pool). After
     (1): assign a client to a week, set its Teamwork tasklist ID, push, paste.
- **Blocked / gated:** Anthropic API billing (gates 03 Phase 3); sitemap
  miss-rate measurement not yet run; **daily/nightly cadences stay gated —
  DECIDED in C3:** 90-d pruning doesn't reduce within-14-d-window volume
  (14 daily full-blob audits/client); supersede-based blob trimming (keep
  blobs only on latest N per schedule) is C6's design space.
- **Parked follow-ups (not next items):** `SessionPage` model drop (≥180 d
  after 2026-06-11); seo-parser `PRUNE_ACTIVATED` flip → C5 (same PR as its
  last blob reader); same-URL standalone-audit diffing; fleet instance-level
  diffing; B2 v1 multi-domain limitation; archived-client name uniqueness;
  schedule (client,domain) uniqueness best-effort app-level.

## Next item

**C4 — Reporting layer: branded PDF export, site-audit share links, CSV
export, VPAT scaffold** (tracker Track C; roadmap doc
`docs/superpowers/nyi/improvement-roadmaps/02-ada-audit.md` Phase 4,
1.5–2 wks; "best after C3" ✓). Key context for the brainstorm:

- **Branded PDF report** for site audits (executive summary, score trend,
  top issues with screenshots, remediation priorities): Chrome is already on
  the server — render an HTML report route to PDF through the existing
  browser pool (`acquirePage`/`releasePage`; NEVER hold a page across awaits
  you don't control; pool size 4, recycling gates live in `browser-pool.ts`).
  Consider a durable `pdf-render` job rather than rendering inside the
  request (deploy-restart safety; A1 patterns).
- **Site-audit share links:** single-page audits already have
  `shareToken`/`shareExpiresAt` + `/ada-audit/share/[token]` — mirror that on
  `SiteAudit`. **Middleware gotcha (bit us THREE times):** the new public
  share route MUST be added to `middleware.ts` `isPublicPath` + a
  `middleware.test.ts` case.
- **CSV export of violations** is now trivially relational (C3): `Violation`
  rows by runId; reuse `selectRuns`/diff shapes for a "changes" sheet.
- **Score trend data** exists (`CrawlRun.score` series, B1 sparkline
  helpers in `scorecard-shared.ts`); **instance-diff shapes**
  (`InstanceDiff`/`RuleInstanceDiff`) were built as C4 inputs — trend +
  changes sections should consume them, not reinvent.
- **Archived audits:** report rendering must tolerate pruned blobs — go
  through the same read paths the views use (summary-or-fallback,
  `archivedCounts`), never raw blob parses.
- VPAT/ACR scaffold is "optional / big differentiator" per the 02-doc —
  scope it honestly in the brainstorm (likely a markdown/HTML scaffold from
  `Violation` wcagTags, not a legal document).
- Scope-reconcile first as always: check what share/PDF machinery already
  exists (`ShareAuditButton`, `lib/ada-audit/screenshot-helpers.ts`, the PDF
  scan subsystem is for SCANNING client PDFs, not report rendering — don't
  conflate).

Full flow: brainstorm/spec → Codex → plan → Codex → implement.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array
  form only, conditional logic via SQL `EXISTS`, manual `updatedAt =
  Date.now()` in raw statements (2026-06-10 production incident; CLAUDE.md
  "Do not").
- **C3 invariants:** instance diffs NEVER render across a wcagLevel mismatch
  (`getRunPairInstanceDiff` returns null; results-page previous selection is
  level-matched). `AuditScorecard` stays strictly numeric — archived unknowns
  travel in `archivedCounts` and render "—", never 0. Triage stays disabled
  on archived data (check keys hash full node HTML; capped nodes can't match).
  Retention's child-blob updateMany uses the bounded `siteAuditId IN` list,
  never child-id lists; artifact deletion is snapshot-based, never a directory
  sweep. Parity compares passCount/incompleteCount unconditionally (stored
  null = stale row; rebuild populates). Blob-first, findings-fallback: views
  read the blob when present, fallback only when null + CrawlRun exists.
- **C2 invariants:** scheduled path is ordinary downstream (wrapper job →
  `queueSiteAuditRequest()`); handler resolves its Schedule via the Job row;
  config rot disables, DB errors retry, duplicate slots consumed; card scores
  read `CrawlRun.score` (the finalizer never persists `SiteAudit.score`);
  scheduled retention only deletes `scheduleId IS NOT NULL` terminal rows;
  the card score Δ and diff chips use the SAME previous audit.
- **Standalone-ADA invariants (C1):** status-fenced writes, first terminal
  writer wins, `dispatchPdfScans` BEFORE the complete settle, group-liveness
  death signal.
- Job-queue invariants (A1): attempt-fenced heartbeat/settle,
  finalize-before-fail, `system-` reserved namespace,
  `@@unique([scheduleId, scheduledFor])`.
- `finalizeSiteAudit` single decision point; hook order carry-forward THEN
  findings — **the findings hook stays LAST**.
- **Findings-layer invariants:** dual-write best-effort/non-fatal; origin FKs
  `SetNull`; subtrees cascade from `CrawlRun` only; never backfill blobs;
  read services scalar/normalized-table only; ada-audit pruning ACTIVE,
  seo-parser flip belongs to C5.
- **Quarter-grid invariants (B3/B4/B5):** singleton plan facade; mere
  page-opens never write; push metadata written ONLY by the receipt route.
- **Handoff-token / public route gotcha (bit us THREE times):** any new
  token-authed or public route MUST be added to `middleware.ts`
  `isPublicPath` + a `middleware.test.ts` case. C4's site-audit share link is
  EXACTLY this shape.
- Test gotchas: DB-backed test files use their own unique domain/id/name
  prefix AND scope cleanup to tracked ids — never broad `deleteMany` on
  shared tables; pre-clean prefixes in `beforeAll`; clean `CrawlRun` by
  domain BEFORE origin rows; vitest jsdom has NO working localStorage;
  `waitFor` can't see fake timers under `globals:false`; if an existing route
  test file is mock-based, add a DB-backed sibling file instead of expanding
  the mock (C3 pattern: `route.list.test.ts` / `route.fallback.test.ts`).
- **Local dev quirk:** prefix prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is
  interactive-only — write migration SQL by hand, apply with
  `prisma migrate deploy`. Local dev runs auth-free.
- **Server has no `sqlite3` CLI** — node + Prisma from
  `/home/seo/webapps/seo-tools`. Authenticated prod checks: source the
  server `.env` in the SSH session, then **form-POST**
  `--data-urlencode "password=$APP_AUTH_PASSWORD"` to `/api/auth/login`
  (it reads formData, NOT JSON; 303 + cookie jar), and reuse the jar.
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction (registry session for this workspace exists; resume it).

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created.
- 2026-06-10 — A1 Phases 0–4 (PRs #50–#54), production-verified. **A1 COMPLETE.**
- 2026-06-10/11 — A2 Phases 1–4 (PRs #55–#58 + inert retention), production-verified. **A2 COMPLETE.**
- 2026-06-11 — B1 (#60), B2 (#61), B3 (#62), B4 (#63), B5 (#64 + middleware
  fix) all shipped + production-verified. **TRACK B COMPLETE.** B4 keep-or-reset
  decision + first real qct_ push still pending on Kevin.
- 2026-06-11 — **C1 SHIPPED (PR #65)**, deployed, production-verified incl.
  restart drill. Standalone ADA audits durable.
- 2026-06-12 — **C2 SHIPPED (PR #66), deployed, production-verified** — two
  live scheduled runs end-to-end; weekly canary schedule live on client 31.
- 2026-06-12 — **C3 SHIPPED (PR #67), deployed, production-verified** — live
  diff panel on the canary pair, card chips via API, scores from
  `CrawlRun.score`; `PRUNE_ACTIVATED['ada-audit']` ACTIVE (first eligible
  prune ~2026-09-08). Daily cadence decision: stays gated until C6. Next: C4
  (reporting layer).
