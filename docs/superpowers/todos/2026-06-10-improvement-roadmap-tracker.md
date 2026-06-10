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

- [~] **A1. Durable job queue + Schedule table** (2–2.5 wks)
  Job table (claim via conditional update, heartbeat, retries, dedupKey,
  type-keyed concurrency) + worker loop + cron-ish Schedule tick.
  Migrate in order: PSI jobs → PDF scans → site-audit page loop → cleanup.
  Old path stays behind a flag until parity proven.
  Specs: `../specs/2026-06-10-durable-job-queue-design.md` ·
  `../specs/2026-06-10-durable-job-queue-phase3-design.md` ·
  Plans: `../plans/2026-06-10-durable-job-queue.md` (Phases 0–1, done) ·
  `../plans/2026-06-10-durable-job-queue-phase2.md` (close-out + Phase 2,
  done) · `../plans/2026-06-10-durable-job-queue-phase3.md` (page loop,
  merged PR #53, deployed + production-verified 2026-06-10). Phase 4
  (cleanup ticks) remains.
- [ ] **A2. Normalized findings layer** (2–3 wks)
  `CrawlRun` / `CrawlPage` / `Finding` / `Violation`; dual-write from parse +
  ADA runners; blobs demoted to archive columns; validate parity on 3–5
  representative clients before any reader flips.

Interleave as needed (not blockers):

- [ ] A3. API route kit (`withRoute()` wrapper) + tests for the 14 untested routes (1 wk)
- [ ] A4. Observability floor: `/api/health`, pino logging, `/admin/ops` page (0.5–1 wk)
- [ ] A5. Shared status hook → optional SSE notification layer (0.5 wk)
- [ ] A6. Shared UI primitives in `components/ui/` + data-driven nav (1 wk)
- [ ] A7. Auth hardening + per-worker test DBs + Playwright smoke suite (1 wk)

## Track B — Client command center (unlocks after nothing; richer after A2) → `04-clients-and-quarter-grid.md`

- [ ] **B1. Client dashboard MVP from existing scalar data** (1.5–2 wks) —
  scorecards, activity timeline, fleet table. No dependency on Track A.
- [ ] B2. Findings/action center on the dashboard (1–1.5 wks) — needs A2.
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
- [ ] **DB growth projection** — project SQLite size for nightly ADA + Live SEO before committing retention windows (feeds A2/C2).
- [ ] **Sitemap miss-rate measurement** — quantifies whether hybrid discovery (SF-retirement Phase 2) needs to move earlier.

## Status log

- 2026-06-10 — Tracker created. All items not started. Roadmap docs written + Codex-reviewed (accept-with-fixes, fixes applied).
- 2026-06-10 — **A1 meaningfully advanced** (Phases 0–1 of 4): Job + Schedule schema, worker loop (fenced claim/heartbeat/settle, timeout, type-keyed concurrency, backoff, onExhausted), startup/stale recovery, scheduler tick (exactly-once-per-slot), introspection, and PSI migrated behind `JOB_QUEUE_PSI` flag (default off) with flag-aware `recoverQueue`/`resetStaleAudits` survival logic. Spec + plan each Codex-reviewed (accept-with-fixes ×2, all fixes applied). 38 new tests; full suite 1,659 green; build green. Branch `feat/durable-job-queue` → PR. Remaining: Phase 2 (PDF scans), Phase 3 (page loop), Phase 4 (cleanup ticks), parity verification + flag flip + legacy-pool deletion.
- 2026-06-10 — **A1 PSI parity PASSED in production.** PR #50 merged + deployed; `JOB_QUEUE_PSI=1` enabled in `ecosystem.config.js`. Run 1 (proway.erstaging.site, 20 pages): complete, 19/19 lighthouse, 0 errors — exact match with legacy runs. Run 2: PM2 restarted mid-`lighthouse-running` with 10 PSI jobs in flight — startup recovery re-queued all 10 (`attempts=2`, lastError "interrupted by restart"), `recoverQueue` resumed the parent instead of failing it, audit completed 19/19 with no errors. Remaining for Phase 1 close-out: delete the legacy in-memory pool + flag branching in `lighthouse-queue.ts`.
- 2026-06-10 — **A1 Phase 1 close-out + Phase 2 (PDF scans) built** on `feat/job-queue-phase2-pdf-scans`. Close-out: legacy in-memory PSI pool, `JOB_QUEUE_PSI` flag, and all flag branching deleted; `enqueuePsiJob` is a thin durable facade. Phase 2: `pdf-scan` job type (`lib/jobs/handlers/pdf-scan.ts`, concurrency `PDF_POOL_SIZE`=4) with conditional `pending|scanning` claim, one-transaction settle + counter bump, `onExhausted`/enqueue-failure via `settlePdfFailure`; `pdf-worker-pool.ts` deleted; `pdfs-running` parents now survive restarts (type-agnostic group survival check). Codex plan review: accept-with-fixes ×5, all applied — incl. **finalize-before-fail**: drained transient parents with zero active jobs get one `finalizeSiteAudit` attempt before the destructive fail path (both `recoverQueue` and `resetStaleAudits`). Plan: `../plans/2026-06-10-durable-job-queue-phase2.md`. 1,677 tests green; tsc + build green. Next: merge/deploy + restart-test mid-`pdfs-running` (Kevin), then Phase 3 (page loop).
- 2026-06-10 — **A1 Phase 3 merged (PR #53), deployed, and VERIFIED in production.** Pre-deploy check: 0 duplicate `(siteAuditId, url)` pairs (dedupe DELETE was a no-op); migration applied cleanly. Drills: (1) clean PDF-bearing run — nyinstituteofmassage.com complete with exact counters (23 pages = 22 complete + 1 redirected, 11/11 PDFs, 22/22 lighthouse, 0 errors); (2) queue order — proway.erstaging.site stayed `queued` behind the active audit (one-active guard), then auto-promoted on finalize; (3) **restart mid-`running`** — `pm2 restart` at 1/24 pages → "[jobs] startup recovery handled 10 orphaned running job(s)" + "[queue] Startup recovery: resuming audit … (24 durable job(s) outstanding)" → audit resumed and completed 24/24 pages, 24/24 lighthouse, 0 errors, all children `complete`, all jobs settled, 0 duplicate pairs. The `running` phase is now restart-survivable in production. Next: Phase 4 (cleanup ticks).
- 2026-06-10 — **A1 Phase 3 (site-audit page loop) built** on `feat/job-queue-phase3-page-loop`; PR #53 opened. Two new job types: `site-audit-discover` (one per audit — raw-SQL `queued→running` claim with a `NOT EXISTS` one-active guard, first-writer-wins `discoveredUrls`+`pagesTotal` persist, P2002-tolerant child creation under the new `@@unique([siteAuditId, url])`, page-job fan-out with enqueue-failure settle) and `site-audit-page` (one per URL — claim `pending|running`, axe via `runAxeAudit`, domain-errors-settle/DB-errors-throw, redirected handling, PDFs-before-settle invariant, array-form settle txn with raw counter bumps, PSI enqueue, claim-0 resume path that re-enqueues lost PSI jobs). `processNext` is now a stateless promoter; the `processing` mutex and `runAudit()` page loop are deleted. Browser recycling moved into `browser-pool.ts` (pages-served draining gate + 60s idle close; also fixed a latent poisoned-launch-promise bug). `finalizeSiteAudit` gained a discovery guard + queued guard + scalar-first reads. Recovery collapsed to one generic transient treatment (`running` parents now survive restarts) with a shared `failSiteAudit()` helper. Spec + plan each Codex-reviewed (accept-with-fixes ×8 ×2, all applied). 1,704 tests green (159 files); tsc + build green. Next: merge/deploy + production restart-test mid-`running`, then Phase 4 (cleanup ticks).
- 2026-06-10 — **A1 Phase 2 merged (PR #51), deployed, and VERIFIED in production** — after one real incident: the first PDF-bearing audit wedged with SQLite "Operations timed out" (audit failed 15/23 pages). Root cause: interactive `$transaction(async tx =>)` holds SQLite's write lock across event-loop round-trips; 4 concurrent pdfjs parses starve the loop; the lock outlives `busy_timeout` and all writers time out. Fix (PR #52, deployed): all three interactive transactions (PSI settle, PDF settle, PDF insert) converted to array-form with SQL `EXISTS` conditional counter bumps + manual `updatedAt`; rule added to CLAUDE.md "Do not". Verification: identical audit (nyinstituteofmassage.com, 23 pages, 11 PDFs) completed in 59s with 0 timeouts; **Test A** restart mid-`pdfs-running` with an in-flight durable pdf-scan job → "resuming audit … (1 durable job(s) outstanding)", PDF re-scanned, audit finalized 11/11; **Test B** drained `pdfs-running` parent with zero jobs → "finalized drained audit" (finalize-before-fail works in prod). 1,679 tests green. Next: Phase 3 (page loop).
