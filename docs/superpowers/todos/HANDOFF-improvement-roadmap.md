# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-12 · **Updated by:** C4 close-out (reporting layer)
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

- **A1, A2, B1–B5, C1–C4 are DONE** (durable job queue #50–#54; findings
  layer #55–#58; client dashboard #60; findings/action center #61; Quarter
  Grid → DB #62; grid split #63; grid closure #64; standalone ADA durable #65;
  scheduled scans #66; ADA run diffing + blob-archive activation #67;
  **reporting layer #68, deployed + production-verified 2026-06-12**).
- **C4 shipped:** (1) site-audit share links (`SiteAudit.shareToken`, public
  `/ada-audit/site/share/[token]`, `shareMode` on `SiteAuditResultsView` with
  fetch-spy-pinned zero cookie-gated calls, middleware prefix, expired-token
  cleanup); (2) violations + changes CSV (`/api/site-audit/[id]/csv[?sheet=changes]`,
  `diffInstancesDetailed()` uncapped classifier — capped `diffInstances`
  derives from it byte-for-byte); (3) branded PDF report — pure escaped
  template-string HTML → `page.setContent()`+`page.pdf()` on the browser pool
  inside a durable `report-render` job (group/dedup `report:<id>`), files at
  `REPORTS_DIR/<id>.pdf`, deleted on audit DELETE + scheduled-retention
  snapshot sweep, status `ready` = stamp AND file; (4) VPAT 2.4 scaffold
  (two-state: Does Not Support / Not Evaluated). All relational-first —
  every export works on archived (pruned-blob) audits. `lib/report/` +
  `SiteAuditExportBar` are the surfaces. Suite 2,351 green (235 files).
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00`. Its latest audit now also has a
  share token + a generated report PDF (the C4 prod-verify artifacts).
- **⚠ PENDING HUMAN STEPS (Kevin) — unchanged from B5:**
  1. **B4 quarter-plan decision still open:** prod has a near-empty QuarterPlan
     (2026-06-11 19:51 UTC) 409-blocking the one-time analyst-browser
     localStorage import. Keep it, or delete QuarterPlan rows server-side and
     re-open `/quarter-grid` in the browser holding `seo-quarter-v3`.
  2. **First real qct_ push not yet exercised** (prod plan is all-pool). After
     (1): assign a client to a week, set its Teamwork tasklist ID, push, paste.
- **Blocked / gated:** Anthropic API billing (gates 03 Phase 3); sitemap
  miss-rate measurement not yet run; daily/nightly cadences gated until C6
  supersede-trimming (decided in C3).
- **Parked follow-ups (not next items):** standalone single-page audit
  CSV/VPAT/report; public share-page export buttons; expandable rows on the
  public share view (needs a token-scoped violations API); logo image asset
  for the PDF (text wordmark until provided); `SessionPage` model drop
  (≥180 d after 2026-06-11); same-URL standalone-audit diffing; fleet
  instance-level diffing; B2 v1 multi-domain limitation.
- **First real ada-audit blob prune still ~2026-09-08** (C3) — watch the
  cleanup tick log for `[findings] pruned … ada-audit` around then.

## Next item

**C5 — SEO parser source-agnostic ingestion** (tracker Track C; roadmap doc
`docs/superpowers/nyi/improvement-roadmaps/01-seo-parser.md` Phase 2,
1.5–2 wks; needs A2 ✓). Key context for the brainstorm:

- Core idea: define ONE internal interface ("what a crawl knows about a
  page") and make SF-CSV parsing one adapter producing it; the Live SEO scan
  (`docs/superpowers/plans/2026-06-02-live-seo-on-ada.md` — still in active
  plans/) becomes the second adapter. Aggregator, scorer, prioritizer,
  brief/roadmap services consume the interface, never CSVs.
- This is the keystone for Screaming Frog demotion (the SF-retirement
  roadmap `docs/superpowers/nyi/2026-06-04-screaming-frog-retirement-roadmap.md`
  rides on it) — the SF-vs-Live parallel-run comparison becomes a
  first-class view.
- **Scope-reconcile first as always:** A2 already shipped much of the
  "findings model" the 01-doc's Phase 1 describes (the doc predates A2) —
  check what `lib/findings/seo-mapper.ts` + the `CrawlRun` subtree already
  give you. The real question is the INGESTION interface, not the storage.
- **`PRUNE_ACTIVATED['seo-parser']` flips in C5** — the rule from A2: the
  flag flips in the same PR as that tool's LAST blob reader. Find the
  remaining `Session.result` blob readers (`grep -rn "session.result"` /
  `JSON.parse(session.result)`) and flip them to findings-table reads in
  this item, then activate the prune.
- C6 (live SEO phases, broken-link verifier first) needs C5 to land in the
  findings model — design the interface with that consumer in view.

Full flow: brainstorm/spec → Codex → plan → Codex → implement.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array
  form only, conditional logic via SQL `EXISTS`, manual `updatedAt =
  Date.now()` in raw statements (2026-06-10 production incident; CLAUDE.md
  "Do not").
- **C4 invariants:** report-render jobs use group/dedup `report:<id>` —
  NEVER `site-audit:<id>` (recovery treats that group as audit liveness).
  Report data loads BEFORE `acquirePage()`; only `setContent`+`pdf` while
  holding a page. Reports/CSV/VPAT are findings-run-only (pre-A2 → 409
  `no_findings_run`). Every dynamic string in report HTML is escaped; CSV
  fields are formula-injection-neutralized; Content-Disposition filenames go
  through `safeFilenamePart`. Report `ready` requires stamp AND file.
  `shareMode` must never issue a cookie-gated fetch (fetch-spy test pins it).
  Report files are deleted by BOTH the DELETE route (cancel jobs first) and
  scheduled retention's snapshot sweep — there is no report-file sweep.
- **C3 invariants:** instance diffs never render across a wcagLevel mismatch;
  `AuditScorecard` strictly numeric — archived unknowns travel in
  `archivedCounts` and render "—", never 0; triage off on archived data;
  blob-first, findings-fallback; retention child-blob updates use bounded
  `siteAuditId IN` lists; artifact deletion is snapshot-based.
- **C2 invariants:** scheduled path is ordinary downstream; handler resolves
  its Schedule via the Job row; config rot disables, DB errors retry; card
  scores read `CrawlRun.score`; scheduled retention only deletes
  `scheduleId IS NOT NULL` terminal rows.
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
  read services scalar/normalized-table only; ada-audit pruning ACTIVE;
  **seo-parser flip belongs to THIS item (C5)** — same PR as its last blob
  reader.
- **Quarter-grid invariants (B3/B4/B5):** singleton plan facade; mere
  page-opens never write; push metadata written ONLY by the receipt route.
- **Handoff-token / public route gotcha (bit us THREE times, verified again
  in C4):** any new token-authed or public route MUST be added to
  `middleware.ts` `isPublicPath` + a `middleware.test.ts` case.
- Test gotchas: DB-backed test files use their own unique domain/id/name
  prefix AND scope cleanup to tracked ids — never broad `deleteMany` on
  shared tables; pre-clean prefixes in `beforeAll`; clean `CrawlRun` by
  domain BEFORE origin rows; vitest jsdom has NO working localStorage;
  `waitFor` can't see fake timers under `globals:false`; if an existing route
  test file is mock-based, extend in its style or add a DB-backed sibling.
- **Parallel-agent execution note (C4):** when dispatching parallel
  implementation agents, a session usage limit can cut a whole wave mid-task;
  finisher agents resumed cleanly from the partial tree + plan. Stagger waves
  if budget looks tight; commit each agent's verified files as soon as it
  reports.
- **Local dev quirk:** prefix prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is
  interactive-only — write migration SQL by hand, apply with
  `prisma migrate deploy`. Local dev runs auth-free (`npx next dev`;
  `next start` refuses to boot without prod secrets).
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
  diff panel on the canary pair; `PRUNE_ACTIVATED['ada-audit']` ACTIVE (first
  eligible prune ~2026-09-08). Daily cadence stays gated until C6.
- 2026-06-12 — **C4 SHIPPED (PR #68), deployed, production-verified** — share
  links + CSV + branded PDF report (real 377 KB PDF rendered live) + VPAT
  scaffold; all relational-first. Next: C5 (SEO parser source-agnostic
  ingestion + seo-parser prune flip).
