# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-10 · **Updated by:** A1 Phase 4 build session (PR #54)
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

- **Done & deployed:** A1 Phases 0–3 — job queue core, PSI, PDF scans, and
  the site-audit page loop (PRs #50–#53), all production-verified
  2026-06-10. The entire site-audit pipeline is durable.
- **Built, awaiting merge:** A1 Phase 4 (PR #54,
  `feat/job-queue-phase4-cleanup-ticks`) — the three recurring timers
  (daily `runCleanup`, 10-min `resetStaleAudits`, 30-min screenshot sweep)
  are now seeded `system-*` Schedule rows + thin job handlers;
  `instrumentation.ts` owns no `setInterval`s; terminal Job-row retention
  added to `runCleanup()` (`lib/jobs/retention.ts`). Spec + plan
  Codex-reviewed, all fixes applied. 1,726 tests green; tsc + build green.
- **Blocked / gated:** Anthropic API billing decision (gates 03 Phase 3);
  DB-growth projection and sitemap miss-rate measurement not yet run.

## Next item

**Merge + deploy PR #54, verify in production, then mark A1 `[x]` in the
tracker** (it's the last Phase of A1). After that, the next tracker item is
**A2 (normalized findings layer)** — or interleave A3/A4 if preferred.

Post-deploy verification checklist (also at the bottom of
`../plans/2026-06-10-durable-job-queue-phase4.md`):

1. Boot log clean — no errors from `seedSystemSchedules`; deploy migration
   `20260610230000_schedule_name` applies.
2. `sqlite3 /home/seo/data/seo-tools/db.sqlite "SELECT name, jobType,
   cadence, enabled, datetime(nextRunAt/1000,'unixepoch') FROM Schedule
   WHERE name LIKE 'system-%'"` → three enabled rows.
3. Within ~2 min: `SELECT type, status, COUNT(*) FROM Job WHERE type IN
   ('screenshot-sweep','stale-audit-reset') GROUP BY 1,2` → completed runs
   (`cleanup` waits for its 09:00 UTC slot — the inline startup
   `runCleanup()` covers boot).
4. Next day: a `cleanup` job completed at the 09:00 slot; terminal Job rows
   older than 7 d are gone.

When verified: tracker A1 `[ ~ ]` → `[x]` + status-log line + rewrite this
doc for A2.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array
  form only, conditional logic via SQL `EXISTS`, manual `updatedAt =
  Date.now()` in raw statements (2026-06-10 production incident; CLAUDE.md
  "Do not").
- Job-queue invariants are load-bearing: attempt-fenced heartbeat/settle,
  handler timeout race, active-slot release AFTER settle, never hold a DB
  transaction across network/browser work, `onExhausted` fires from every
  error-flip path, `countActiveJobsByGroup` ignores `runAfter`, failed
  group-count = skip-don't-fail, finalize-before-fail on drained transients.
- Phase 3 invariants: one-active is enforced by the **discover claim's
  `NOT EXISTS` guard**; `discoveredUrls`+`pagesTotal` written together;
  PDFs dispatch BEFORE the page settle; domain errors settle / DB errors
  throw; `failSiteAudit` never clobbers terminal parents.
- Phase 4 invariants (new): `system-` is a **reserved, code-owned Schedule
  namespace** — the seed re-enables manual disables at every boot (operator
  kill switch = env flag, not DB mutation); retired `system-*` rows are
  disabled and their queued jobs cancelled; Job retention must never delete
  a job referenced by `Schedule.lastJobId` or holding its schedule's
  current `(scheduleId, nextRunAt)` slot (the durable exactly-once-per-slot
  record); maintenance handlers are maxAttempts 1 — the next slot is the
  retry; boot order is register handlers → recoverJobsOnStartup →
  recoverQueue → **seedSystemSchedules** → startJobWorker.
- groupKey `site-audit:<id>` is shared by all four site-audit job types;
  scheduled jobs get groupKey `schedule:<id>`.
- Standalone single-page audits are untouched: own POST-driven runner,
  `ada-audit:<id>` PDF groups, NULL `siteAuditId`.
- Test gotchas: the one-active guard and promoter are GLOBAL over the
  shared dev DB — test files touching promotion neutralize stray audits in
  `clearTestState`. **`system-schedules.test.ts` creates real `system-*`
  rows — it deletes them (and real-typed jobs) in beforeEach AND afterEach**;
  new tests that seed system schedules must do the same or other files'
  `tickSchedules()` calls will enqueue real job types.
- **Local dev quirk:** `.env` points at `file:/var/lib/er-seo-tools/db.sqlite`
  (doesn't exist on the Mac). Run prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"` prefixed. `prisma migrate dev` is
  interactive-only — generate SQL via `prisma migrate diff`, write the
  migration folder by hand, apply with `prisma migrate deploy`.
- Findings tables (A2) are named `CrawlRun` / `CrawlPage` / `Finding` /
  `Violation`; dual-write + parity on 3–5 clients before readers flip.
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction (Phase 4 session: 2 consults, accept-with-fixes ×5 spec /
  ×4 plan, all applied).

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created. No implementation started.
- 2026-06-10 — A1 Phases 0–1 built (job queue core + PSI migration behind flag) on `feat/durable-job-queue`; PR opened. Next: merge/deploy/parity (Kevin), then Phase 2 (PDF scans).
- 2026-06-10 — PR #50 merged + deployed. `JOB_QUEUE_PSI=1` enabled. Parity PASSED in production incl. restart-resume mid-`lighthouse-running`. Next: legacy-pool deletion + Phase 2 (PDF scans).
- 2026-06-10 — Phase 1 close-out (legacy pool + flag deleted) + Phase 2 (PDF scans durable, `pdfs-running` survives restarts, finalize-before-fail) built on `feat/job-queue-phase2-pdf-scans`; PR opened. Next: merge/deploy + restart-test, then Phase 3 (page loop).
- 2026-06-10 — PRs #51 + #52 merged + deployed. Incident: first PDF-bearing audit wedged SQLite (interactive-transaction write-lock starvation under pdfjs load); fixed by converting all itxs to array form. Production verified: clean 23-page/11-PDF audit, restart-resume mid-`pdfs-running`, drained-parent finalize. Next: Phase 3 (page loop).
- 2026-06-10 — **A1 Phase 3 built** on `feat/job-queue-phase3-page-loop`; PR #53 opened. Page loop fully durable (`site-audit-discover` + `site-audit-page`), mutex deleted, `running` parents restart-survivable, browser recycling pool-level, AdaAudit unique index + dedupe migration. 1,704 tests green. Next: merge/deploy + restart-test mid-`running`, then Phase 4 (cleanup ticks).
- 2026-06-10 — **PR #53 merged + deployed + production-verified** (clean PDF run with exact counters, queue-order hold/auto-promote, restart-resume mid-`running` 24/24). A1 Phases 0–3 all shipped. Next: Phase 4 (cleanup ticks) closes out A1.
- 2026-06-10 — **A1 Phase 4 built** on `feat/job-queue-phase4-cleanup-ticks`; PR #54 opened. `Schedule.name` + `seedSystemSchedules()` (three `system-*` rows, retired-row sweep), three maintenance handlers, zero `setInterval`s in `instrumentation.ts`, terminal Job-row retention with slot-record guard. Spec + plan Codex-reviewed (×5/×4 fixes applied). 1,726 tests green. Next: merge/deploy + verify, then A1 → `[x]`.
