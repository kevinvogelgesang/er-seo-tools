# Improvement Roadmap — Master Tracker

**Created:** 2026-06-10 · **Source docs:** `../nyi/improvement-roadmaps/` (00–06, Codex-reviewed)
**Scope:** critical-path spine ≈ 12–16 wks; full backlog ≈ 25–35 engineer-weeks.

How to use this file: work top-to-bottom within a track; tracks B–D unlock as
Track A milestones land. Check items off here; when a milestone gets a real
spec/plan, write it via the normal brainstorming → writing-plans flow, park it
in `specs/`/`plans/`, and link it next to the item. Statuses: `[ ]` not
started · `[~]` in progress · `[x]` shipped.

**Handoff rule:** whenever an item is completed (or meaningfully advanced),
update this tracker (checkbox + status-log line) **and** rewrite
`HANDOFF-improvement-roadmap.md` in the same commit, so any new chat can pick
up by reading the handoff doc alone.

---

## Track A — Platform foundations (4–5.5 wks) → `06-platform.md`

Spine items — everything else depends on these two:

- [x] **A1. Durable job queue + Schedule table** (2–2.5 wks)
  Job table (claim via conditional update, heartbeat, retries, dedupKey,
  type-keyed concurrency) + worker loop + cron-ish Schedule tick.
  Migrate in order: PSI jobs → PDF scans → site-audit page loop → cleanup.
  Old path stays behind a flag until parity proven.
  Specs: `../archive/specs/2026-06-10-durable-job-queue-design.md` ·
  `../archive/specs/2026-06-10-durable-job-queue-phase3-design.md` ·
  Plans: `../archive/plans/2026-06-10-durable-job-queue.md` (Phases 0–1,
  done) · `../archive/plans/2026-06-10-durable-job-queue-phase2.md`
  (close-out + Phase 2, done) ·
  `../archive/plans/2026-06-10-durable-job-queue-phase3.md` (page loop,
  merged PR #53, deployed + production-verified 2026-06-10) ·
  `../archive/plans/2026-06-10-durable-job-queue-phase4.md` (cleanup ticks,
  merged PR #54, deployed + verified 2026-06-10). Spec:
  `../archive/specs/2026-06-10-durable-job-queue-phase4-design.md`.
  **DONE** — all four phases shipped and production-verified.
- [x] **A2. Normalized findings layer** (2–3 wks)
  `CrawlRun` / `CrawlPage` / `Finding` / `Violation`; dual-write from parse +
  ADA runners; blobs demoted to archive columns; validate parity on 3–5
  representative clients before any reader flips.
  Spec: `../archive/specs/2026-06-10-findings-layer-design.md` (Codex ×10 fixes) ·
  Plan (Phase 1): `../archive/plans/2026-06-10-findings-layer-phase1.md` (Codex ×8
  fixes) — **Phase 1 merged (PRs #55 + #56), deployed, production-verified
  2026-06-10** (PARITY OK on 2 real sessions; cross-run SQL queries working).
  Plan (Phase 2): `../archive/plans/2026-06-10-findings-layer-phase2.md` (Codex ×5
  fixes) — **Phase 2 merged (PR #57), deployed, production-verified
  2026-06-10** (PARITY OK on 2 site audits + 1 standalone).
  DB-growth projection run 2026-06-10 (gated-decisions item: done for A2's
  purposes; C2 must add cadence-aware retention before nightly fleet scans).
  Plan (Phase 3): `../archive/plans/2026-06-11-findings-layer-phase3.md` (Codex ×4
  fixes) — **Phase 3 merged (PR #58), deployed, production-verified
  2026-06-11** (fresh-run parity gate passed on 4 live parses + fresh site
  audits + 1 standalone; SessionPage reader flipped with legacy fallback;
  SessionPage writes stopped).
  Plan (Phase 4): `../archive/plans/2026-06-11-findings-layer-phase4.md`
  (Codex clean accept) — **Phase 4 shipped 2026-06-11**:
  `pruneArchivedBlobs()` 90-d blob retention registered in `runCleanup()`,
  INERT (`PRUNE_ACTIVATED` both `false`; each flag flips in the same PR as
  that tool's last blob reader); CLAUDE.md findings-layer docs; A2 docs
  archived. **A2 COMPLETE.** (`SessionPage` model drop stays a post-A2
  follow-up, ≥180 d after the 2026-06-11 flip.)

Interleave as needed (not blockers):

- [ ] A3. API route kit (`withRoute()` wrapper) + tests for the 14 untested routes (1 wk)
- [ ] A4. Observability floor: `/api/health`, pino logging, `/admin/ops` page (0.5–1 wk)
- [ ] A5. Shared status hook → optional SSE notification layer (0.5 wk)
- [ ] A6. Shared UI primitives in `components/ui/` + data-driven nav (1 wk)
- [ ] A7. Auth hardening + per-worker test DBs + Playwright smoke suite (1 wk)

## Track B — Client command center (unlocks after nothing; richer after A2) → `04-clients-and-quarter-grid.md`

- [x] **B1. Client dashboard MVP from existing scalar data** (1.5–2 wks) —
  scorecards, activity timeline, fleet table. No dependency on Track A.
  Spec: `../archive/specs/2026-06-11-client-dashboard-mvp-design.md` (Codex ×5) ·
  Plan: `../archive/plans/2026-06-11-client-dashboard-mvp.md` (Codex ×4) —
  **merged (PR #60), deployed, production-verified 2026-06-11.**
- [x] **B2. Findings/action center on the dashboard** (1–1.5 wks) — needs A2.
  Spec: `../archive/specs/2026-06-11-findings-action-center-design.md` (Codex ×5) ·
  Plan: `../archive/plans/2026-06-11-findings-action-center.md` (Codex ×5) —
  **merged (PR #61), deployed, production-verified 2026-06-11.**
- [ ] B3. Quarter Grid state localStorage → DB (`QuarterPlan`/`QuarterAssignment` + importer) (1–1.5 wks)
- [ ] B4. Quarter Grid monolith split (1,215-LOC page → hook + components) (1 wk)
- [ ] B5. Grid ↔ tools ↔ Teamwork closure (push cycle to Teamwork tasklists) (1–1.5 wks)

## Track C — Continuous monitoring (needs A1; diffing needs A2) → `02-ada-audit.md`, `01-seo-parser.md`

- [ ] **C1. ADA orchestration onto the job queue** (2–3 wks) — needs A1.
- [ ] **C2. Scheduled recurring audits + score-level deltas** (1.5–2 wks) — needs C1.
- [ ] C3. Relational ADA violations → real run-over-run diffing + regression alerts (1–1.5 wks) — needs A2.
- [ ] C4. Reporting layer: branded PDF export, site-audit share links, CSV, VPAT scaffold (1.5–2 wks) — best after C3.
- [ ] C5. SEO parser source-agnostic ingestion (SF-CSV as one adapter; live-scan as the second) (1.5–2 wks) — needs A2.
- [ ] C6. Live SEO phases per `../nyi/2026-06-04-screaming-frog-retirement-roadmap.md`
  (Phase 1 broken-link verifier first; its decision gates apply) — needs C5 to land in the findings model.
- [ ] C7. Parser consolidation + streaming parse + per-file failure isolation (1 wk)
- [ ] C8. Configurable scoring/priority weights + score-explanation panel (0.5–1 wk)
- [ ] C9. ADA scoring v2 + poller/results-view consolidation (1–1.5 wks)

## Track D — Workflow polish (mostly independent) → `03-ai-memo-tools.md`, `05-small-tools.md`

- [ ] D1. Handoff engine consolidation: token factory, `HANDOFF_TYPES` registry,
  one `<MemoHandoffCard>`; retire legacy `pillar-analysis-narrative` skill (1 wk)
- [ ] D2. Memo arrival via SSE notification (0.5 wk) — needs A5.
- [ ] D3. Shared `lib/seo-fetch/` (robots/sitemap parsing through `safeFetch`) (1–2 days)
- [ ] D4. Client-attached robots/sitemap checks + history (2–3 days)
- [ ] D5. Scheduled robots/sitemap monitoring with change-only alerts (3–4 days) — needs A1.
- [ ] D6. RankMath redirect generator + dry-run + post-deploy verifier (1–1.5 wks) — or explicitly freeze as a doc; decide, don't drift.

## Gated decisions (block specific items; decide, then unblock)

- [ ] **Anthropic API billing** — gates direct memo generation (03 Phase 3). Until decided, all AI stays skill-handoff.
- [x] **DB growth projection** — run 2026-06-10 against production (numbers in the A2 spec). Verdict: 90-d archive window + findings-forever safe for human-triggered and weekly scheduled volume; **nightly fleet scans are NOT safe with these defaults — C2 must add a cadence-aware retention class first.**
- [ ] **Sitemap miss-rate measurement** — quantifies whether hybrid discovery (SF-retirement Phase 2) needs to move earlier.

## Status log

- 2026-06-11 — **B2 SHIPPED (PR #61), deployed, and VERIFIED in production.** Full flow: spec (Codex accept-with-fixes ×5 — multi-domain v1 limitation documented, `affectedComplete` three-state `isSample = !== true`, fleet ADA `(runId,type)` max-severity collapse, previous-run shape excludes severity, id-desc tie-breaker) → plan (Codex ×5 — `scope:'page'` guard on both ADA groupBys, collapsed-row sample badge incl. zero-URL case, dedupe+sort URLs before the 25 cap, fleet run-scope-ignored assertion, unused-import cleanup). Ships: `lib/services/findings-shared.ts` (pure run selection with domain-matched previous + id-desc tie-break, `aggregateSeoTypes`/`aggregateAdaTypes`/`collapseTypeGroups`, type-level `diffTypes`, `newCriticalTypes`; `URLS_PER_FINDING=25`), `client-findings.ts` (4 batched queries: current-run findings, previous SEO run-scope, previous ADA page-scope groupBy, Violation help distinct-by-ruleId; OpenFindingRow with NEW/delta/sample/href), `client-fleet.ts` extended to 8 batched queries (`openCritical`/`openWarning` distinct-type counts, `regression` alert via `computeAlerts.newCriticalTypes`), `FindingsPanel` (severity/tool/NEW/sample badges, worse-is-red deltas, expandable URL lists with cap footer, two empty states), `FleetTable` Issues column (sortable) + purple regression chip, dashboard page wiring. **Pure read layer: zero blob readers, no schema/write changes.** 38 new tests; suite 1,881 green (183 files); tsc + build clean. Production verification: boot clean; `/clients` 200 with Issues column — client 30 shows `17C` (7 SEO + 10 ADA distinct critical types, DB-cross-checked) `28W`; `/clients/30` panel renders Color contrast 288 URLs exactly matching `Finding` rows; `/clients/15` (nuvani, 2 same-domain parses) shows `+0 new / 5 resolved` trend header — domain-matched previous works live; sample badges + full-report links render; no spurious regression alerts (critical sets identical); no-CrawlRun client renders the pre-A2 empty state; unknown id 404s. Docs archived. Next: B3 (Quarter Grid localStorage → DB).

- 2026-06-11 — **B1 SHIPPED (PR #60), deployed, and VERIFIED in production.** Full flow: spec (Codex accept-with-fixes ×5 — standalone ADA score source corrected to page-audit `CrawlRun.score` with legacy non-null fallback, `SiteAudit.score` claim softened, manage-link audit, ADA fallback semantics, error-alert origins) → plan (Codex ×4 — scored-site-point rule, keyword-orphan ambiguity documented, keyword errors in `erroredTools`, timeline ADA stats prefer `CrawlRun.score`). Ships: `lib/services/scorecard-shared.ts` (pure series/delta/alert helpers; `SCORE_DROP_THRESHOLD=10`, `STALE_DAYS=30`, 12-point sparklines), `client-fleet.ts` (6 batched findMany, JS aggregation), `client-dashboard.ts` (origin-row timeline cap 50, 6 item types, orphaned CrawlRuns = score points without timeline rows); components `Sparkline`/`Scorecard`/`FleetTable`/`ActivityTimeline`/`ClientHeader`/`IssueTrendCard` (`SeoHistoryView` deleted, `SeoHistoryChart` kept); `/clients` = fleet table (force-dynamic server component), `/clients/[id]` = dashboard (header + 3 scorecards + trend + timeline), CRUD page moved verbatim to `/clients/manage` (manage-intent links in SiteAuditForm/ClientsAuditSummary/BulkQueueModal retargeted; ClientsAuditSummary name links → dashboard; nav Clients dropdown Fleet/Manage). **Scalar-only honored: zero new blob readers** (grep-verified) — scores from `CrawlRun.score` + `PillarAnalysis.score` + Session counts; keyword-research CrawlRuns excluded from the SEO series. 43 new tests; suite 1,843 green (180 files); tsc + build clean. Production verification: boot clean, `/clients` + `/clients/manage` 200 authed, client 30 dashboard renders its CrawlRun score (85) exactly, unknown id 404s; legacy standalone `AdaAudit.score` is **0/119 non-null** in prod (Codex spec-fix #1 was load-bearing — all ADA scores come from CrawlRun: 7 site + 2 page scored). Docs archived. Next: B2 (findings/action center) per tracker order.

- 2026-06-11 — **A2 Phase 4 SHIPPED — A2 COMPLETE.** Plan (Codex review: clean accept, zero fixes — a first). Ships: `lib/findings/retention.ts` — `pruneArchivedBlobs(now?, activated?)` finds `CrawlRun`s per activated tool with `completedAt < now − 90 d`, `archivePrunedAt IS NULL`, origin FK non-null (SetNull ⇒ non-null FK proves the origin row exists), then per chunk of 100 in ONE array-form `$transaction` nulls the origin blob (`Session.result` / `SiteAudit.summary` / `AdaAudit.result`), keeps all scalars, stamps `archivePrunedAt`. SHIPPED INERT: `PRUNE_ACTIVATED = { 'seo-parser': false, 'ada-audit': false }` — each flag flips only in the same PR as that tool's last blob reader (A1 pattern). Scope: origin blob ONLY — site-audit child `AdaAudit.result` blobs are NOT pruned (the results view still reads them; extending to children is the future ada-audit activation PR's decision). Registered in `runCleanup()`'s `Promise.allSettled` list. 10 new DB-backed tests (gated-off no-op, >90 d prune with scalars kept, recent/null-completedAt/already-pruned/SetNull-orphan exclusions, both ada origin shapes, per-tool isolation, 120-row chunking); suite 1,800 green; tsc + build clean. Close-out: findings layer documented in CLAUDE.md (Key files + Architecture patterns); spec + 4 phase plans archived to `docs/superpowers/archive/`. A2 `[~]` → `[x]`. Next: B1 (client dashboard MVP, doc 04 Phase 1a).
- 2026-06-11 — **A2 Phase 3 SHIPPED (PR #58), deployed, and VERIFIED in production; A1 residual check PASSED.** Step 1 (the gate): fresh-run production parity on 5 representative clients, all through the LIVE hooks — 4 fresh parses via the real upload+parse API (glowcollegecanada.ca 311 pages, nuvani.edu, manhattanschool.edu, proway.erstaging.site; SF exports re-uploaded from `~/enrollment-resources/sf-crawls/`), 4 fresh site audits (glow 290p, nuvani 122p, manhattanschool 67p, innovatesalonacademy 102p — all 0 errors), and 1 fresh standalone ADA audit (innovate — closes the last untested live hook): **PARITY OK on all 9 runs**, 0 `[findings] dual-write failed` log lines. Step 2+3 (the flips, plan Codex-reviewed ×4): pages reader → `CrawlPage` + page-level `Finding` join (issueTypes/issueCount from the join, filter via `findings.some`, sort via relation `_count`) with verbatim `SessionPage` fallback for pre-A2 sessions; parse route stopped writing `SessionPage` rows (deleteMany kept); `normalizeFindingUrl` extracted client-safe; `PageDetailModal` normalized-URL matching incl. `groups[*].urls`. 15 new tests (4 DB-backed proving the relation-`_count` orderBy on real SQLite); suite 1,790 green. Production verification: pre/post glow comparison (0 scalar diffs, issueTypes superset on all 149 overlapping URLs, 105 richer, total 312→311 = 1 dup deduped); `?issueType=duplicate_h1` → exactly 38 rows (non-derivable filters now work, was 0); legacy no-CrawlRun session serves via fallback; modal fix proven on prod data (root URLs: old 0 matches → new 2–4; non-root 5=5); deploy restart mid-run resumed the in-flight audit (122 durable jobs). A1 residual: `cleanup` completed at the 2026-06-11 09:00 UTC slot (attempts 1), 0 terminal Job rows >7 d. Next: Phase 4 (retention machinery, shipped inert) → A2 `[x]`.
- 2026-06-11 — **A2 Phase 2 live-hook verification PASSED.** Fresh human-triggered site audit on www.nyinstituteofmassage.com (23 pages incl. 1 redirected, 11/11 PDFs, 22/22 LH, 0 errors): the finalizer hook wrote the CrawlRun 9 ms after the terminal update (score 88, 4 findings / 4 violations); `findings-parity.ts` → PARITY OK incl. the summary.aggregate cross-check. Remaining live-hook check (standalone route) folds into Phase 3 step 1.
- 2026-06-10 — **A2 Phase 2 (ADA dual-write) merged (PR #57), deployed, and VERIFIED in production.** Plan written via writing-plans + Codex review (accept-with-fixes ×5: deterministic child ordering at all three load sites, vi.hoisted mock state, summary-corruption aggregate test, null-summary parity failure; all applied). Ships: `lib/findings/ada-mapper.ts` (mapAdaChildren + mapAdaSingle — severity critical/serious→critical, moderate→warning, minor→notice; exact axe impact on Violation with 'unknown' sentinel for null; nodes capped 5×300 chars; keep-first URL dedupe; mapper-computed scores — site runs via computeScoreFromCounts, pages/standalone via computeScore), `lib/findings/ada-write.ts`, finalizer hook (fire-and-forget AFTER terminal update + batch close + promoter kick, hoisted completedAt, widened select, deterministic child orderBy), standalone route hook (complete + redirected), compareAdaParity/compareAdaSingleParity (incl. independent Violation-rows-vs-summary.aggregate cross-check), CLI auto-detect of id type. 34 new tests; suite 1,787 green (172 files); tsc + build clean. Production verification: boot error-free; rebuild + parity → **PARITY OK on proway.erstaging.site (24 pages / 2 violations), nyinstituteofmassage.com (23 pages incl. 1 redirected child / 4 violations), and 1 standalone audit**. Live hooks fire on the next real audits — re-check parity then. Next: Phase 3 (production parity on 3–5 representative clients with fresh runs, then SessionPage reader flip).
- 2026-06-10 — **A2 Phase 1 merged (PR #55) + fix PR #56, deployed, and VERIFIED in production.** Migration `20260611014502_findings_layer` applied cleanly; boot error-free. Production parity surfaced one real bug — the nuvani.edu session's `page_index` carries one URL under two refs, violating `@@unique([runId, url])` — fixed with keep-first dedupe by normalized URL in the mapper (PR #56, +1 test, 1,753 green). Verification: `findings-rebuild` + `findings-parity` → **PARITY OK on both current-format sessions** (nuvani.edu: 146 pages / 433 findings / score 81; proway.erstaging.site: 4 pages / 56 findings / score 86); cross-run SQL works ("domains with broken_pages" answers from `Finding`+`CrawlRun`). The live dual-write hook (same `writeSeoFindings` path) fires on the next real parse — re-check parity then. Next: Phase 2 (ADA dual-write).
- 2026-06-10 — **A2 meaningfully advanced (Phase 1 of 4 built); PR #55 open** on `feat/findings-layer-phase1`. DB-growth projection run against production during the spec (DB 309 MB, ~249 MB blobs; 27 clients; 153 pages/site-audit avg; 0.78 violations/page): 90-d archive + findings-forever validated for current volume, nightly-fleet gate recorded for C2. Spec (Codex accept-with-fixes ×10) + Phase 1 plan (Codex ×8) written, fixed, committed. Phase 1 ships: 4-table schema (origin FKs SetNull, subtree cascades from CrawlRun), `lib/findings/` (hashed dedup keys, SEO mapper with groups[*].urls + computeHealthScore fallback, exactly-one-origin delete-and-recreate writer in one array-form txn chunked at 50, field-level parity comparator), parser dual-write hook (best-effort, post-commit), rebuild + parity tsx CLIs. 26 new tests; suite 1,752 green (169 files); tsc + build clean. Next: merge/deploy PR #55 + production parity (fresh parse → `npx tsx scripts/findings-parity.ts <sessionId>`), then Phase 2 (ADA dual-write).
- 2026-06-10 — **A1 COMPLETE. PR #54 merged + deployed + verified in production.** Migration `20260610230000_schedule_name` applied cleanly; boot log error-free. All three `system-*` Schedule rows seeded and enabled (cleanup `daily@09:00` → next run 2026-06-11 09:00 UTC; screenshot-sweep `every:30m` + stale-audit-reset `every:10m`, both fired their immediate first-seed slot and completed within ~2 min of boot). Residual next-day check: confirm a `cleanup` job completes at the 09:00 UTC slot and terminal Job rows >7 d are pruned. A1 `[~]` → `[x]` — the durable job queue (Phases 0–4) is fully shipped. Next: A2 (normalized findings layer).
- 2026-06-10 — Tracker created. All items not started. Roadmap docs written + Codex-reviewed (accept-with-fixes, fixes applied).
- 2026-06-10 — **A1 meaningfully advanced** (Phases 0–1 of 4): Job + Schedule schema, worker loop (fenced claim/heartbeat/settle, timeout, type-keyed concurrency, backoff, onExhausted), startup/stale recovery, scheduler tick (exactly-once-per-slot), introspection, and PSI migrated behind `JOB_QUEUE_PSI` flag (default off) with flag-aware `recoverQueue`/`resetStaleAudits` survival logic. Spec + plan each Codex-reviewed (accept-with-fixes ×2, all fixes applied). 38 new tests; full suite 1,659 green; build green. Branch `feat/durable-job-queue` → PR. Remaining: Phase 2 (PDF scans), Phase 3 (page loop), Phase 4 (cleanup ticks), parity verification + flag flip + legacy-pool deletion.
- 2026-06-10 — **A1 PSI parity PASSED in production.** PR #50 merged + deployed; `JOB_QUEUE_PSI=1` enabled in `ecosystem.config.js`. Run 1 (proway.erstaging.site, 20 pages): complete, 19/19 lighthouse, 0 errors — exact match with legacy runs. Run 2: PM2 restarted mid-`lighthouse-running` with 10 PSI jobs in flight — startup recovery re-queued all 10 (`attempts=2`, lastError "interrupted by restart"), `recoverQueue` resumed the parent instead of failing it, audit completed 19/19 with no errors. Remaining for Phase 1 close-out: delete the legacy in-memory pool + flag branching in `lighthouse-queue.ts`.
- 2026-06-10 — **A1 Phase 1 close-out + Phase 2 (PDF scans) built** on `feat/job-queue-phase2-pdf-scans`. Close-out: legacy in-memory PSI pool, `JOB_QUEUE_PSI` flag, and all flag branching deleted; `enqueuePsiJob` is a thin durable facade. Phase 2: `pdf-scan` job type (`lib/jobs/handlers/pdf-scan.ts`, concurrency `PDF_POOL_SIZE`=4) with conditional `pending|scanning` claim, one-transaction settle + counter bump, `onExhausted`/enqueue-failure via `settlePdfFailure`; `pdf-worker-pool.ts` deleted; `pdfs-running` parents now survive restarts (type-agnostic group survival check). Codex plan review: accept-with-fixes ×5, all applied — incl. **finalize-before-fail**: drained transient parents with zero active jobs get one `finalizeSiteAudit` attempt before the destructive fail path (both `recoverQueue` and `resetStaleAudits`). Plan: `../plans/2026-06-10-durable-job-queue-phase2.md`. 1,677 tests green; tsc + build green. Next: merge/deploy + restart-test mid-`pdfs-running` (Kevin), then Phase 3 (page loop).
- 2026-06-10 — **A1 Phase 3 merged (PR #53), deployed, and VERIFIED in production.** Pre-deploy check: 0 duplicate `(siteAuditId, url)` pairs (dedupe DELETE was a no-op); migration applied cleanly. Drills: (1) clean PDF-bearing run — nyinstituteofmassage.com complete with exact counters (23 pages = 22 complete + 1 redirected, 11/11 PDFs, 22/22 lighthouse, 0 errors); (2) queue order — proway.erstaging.site stayed `queued` behind the active audit (one-active guard), then auto-promoted on finalize; (3) **restart mid-`running`** — `pm2 restart` at 1/24 pages → "[jobs] startup recovery handled 10 orphaned running job(s)" + "[queue] Startup recovery: resuming audit … (24 durable job(s) outstanding)" → audit resumed and completed 24/24 pages, 24/24 lighthouse, 0 errors, all children `complete`, all jobs settled, 0 duplicate pairs. The `running` phase is now restart-survivable in production. Next: Phase 4 (cleanup ticks).
- 2026-06-10 — **A1 Phase 3 (site-audit page loop) built** on `feat/job-queue-phase3-page-loop`; PR #53 opened. Two new job types: `site-audit-discover` (one per audit — raw-SQL `queued→running` claim with a `NOT EXISTS` one-active guard, first-writer-wins `discoveredUrls`+`pagesTotal` persist, P2002-tolerant child creation under the new `@@unique([siteAuditId, url])`, page-job fan-out with enqueue-failure settle) and `site-audit-page` (one per URL — claim `pending|running`, axe via `runAxeAudit`, domain-errors-settle/DB-errors-throw, redirected handling, PDFs-before-settle invariant, array-form settle txn with raw counter bumps, PSI enqueue, claim-0 resume path that re-enqueues lost PSI jobs). `processNext` is now a stateless promoter; the `processing` mutex and `runAudit()` page loop are deleted. Browser recycling moved into `browser-pool.ts` (pages-served draining gate + 60s idle close; also fixed a latent poisoned-launch-promise bug). `finalizeSiteAudit` gained a discovery guard + queued guard + scalar-first reads. Recovery collapsed to one generic transient treatment (`running` parents now survive restarts) with a shared `failSiteAudit()` helper. Spec + plan each Codex-reviewed (accept-with-fixes ×8 ×2, all applied). 1,704 tests green (159 files); tsc + build green. Next: merge/deploy + production restart-test mid-`running`, then Phase 4 (cleanup ticks).
- 2026-06-10 — **A1 Phase 4 (cleanup ticks as scheduled jobs) built** on `feat/job-queue-phase4-cleanup-ticks`; PR #54 opened. `Schedule.name` (nullable unique) migration; `seedSystemSchedules()` upserts three code-owned `system-*` rows at boot (cleanup `daily@09:00` UTC — not immediate, the inline startup `runCleanup()` covers boot; screenshot-sweep `every:30m` + stale-audit-reset `every:10m`, both immediate on first seed), recomputes `nextRunAt` only on cadence change, re-enables manual disables (`system-` is code-owned), and disables retired `system-*` rows + cancels their queued jobs. Three thin handlers (concurrency 1, maxAttempts 1 — next slot is the retry). `instrumentation.ts` owns no `setInterval`s; screenshot-sweeper interval machinery deleted. NEW: terminal Job-row retention (`lib/jobs/retention.ts`, complete/cancelled 7 d / error 30 d, raw-SQL with slot-record guard protecting `Schedule.lastJobId` + current `(scheduleId, nextRunAt)` slots) added to `runCleanup()`. Spec + plan each Codex-reviewed (accept-with-fixes ×5 / ×4, all applied). 22 new tests; suite 1,726 green (164 files); tsc + build green. Next: merge/deploy + post-deploy schedule verification, then A1 → `[x]`.
- 2026-06-10 — **A1 Phase 2 merged (PR #51), deployed, and VERIFIED in production** — after one real incident: the first PDF-bearing audit wedged with SQLite "Operations timed out" (audit failed 15/23 pages). Root cause: interactive `$transaction(async tx =>)` holds SQLite's write lock across event-loop round-trips; 4 concurrent pdfjs parses starve the loop; the lock outlives `busy_timeout` and all writers time out. Fix (PR #52, deployed): all three interactive transactions (PSI settle, PDF settle, PDF insert) converted to array-form with SQL `EXISTS` conditional counter bumps + manual `updatedAt`; rule added to CLAUDE.md "Do not". Verification: identical audit (nyinstituteofmassage.com, 23 pages, 11 PDFs) completed in 59s with 0 timeouts; **Test A** restart mid-`pdfs-running` with an in-flight durable pdf-scan job → "resuming audit … (1 durable job(s) outstanding)", PDF re-scanned, audit finalized 11/11; **Test B** drained `pdfs-running` parent with zero jobs → "finalized drained audit" (finalize-before-fail works in prod). 1,679 tests green. Next: Phase 3 (page loop).
