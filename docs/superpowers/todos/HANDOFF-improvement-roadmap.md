# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-10 · **Updated by:** A1 close-out session (PR #54 merged + verified)
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

- **A1 is DONE.** All four phases of the durable job queue (PRs #50–#54) are
  merged, deployed, and production-verified 2026-06-10. PSI, PDF scans, the
  site-audit page loop, and all recurring maintenance (daily `runCleanup`,
  10-min `resetStaleAudits`, 30-min screenshot sweep) run through the
  `Job`/`Schedule` tables; `instrumentation.ts` owns no `setInterval`s;
  terminal Job rows are pruned by `lib/jobs/retention.ts`.
- **Residual next-day check (non-blocking):** confirm a `cleanup` job
  completes at the 2026-06-11 09:00 UTC slot and terminal Job rows older
  than 7 d are pruned. (Immediate first-seed slots for screenshot-sweep and
  stale-audit-reset already verified complete in production.)
- **Blocked / gated:** Anthropic API billing decision (gates 03 Phase 3);
  **DB-growth projection not yet run — A2's roadmap section says to validate
  growth assumptions early, so do it during the A2 spec**; sitemap miss-rate
  measurement not yet run.

## Next item

**A2. Normalized findings layer** (2–3 wks) — tracker Track A. Read
`../nyi/improvement-roadmaps/06-platform.md` § "2. Normalized findings
layer", plus the schema discussions it references in `01-seo-parser.md` and
`02-ada-audit.md` (the findings schema is shared across both tools).

Key shape (decisions already made — see Gotchas):

- New tables `CrawlRun` / `CrawlPage` / `Finding` / `Violation`, keyed to
  client + run + dedupKey. (`CrawlPage`, not `Page` — avoids colliding with
  the derived `SessionPage` model; `SessionPage` gets absorbed or retired.)
- Raw blobs demoted to archive columns; retention: archive pruned at 90 d,
  findings kept.
- **Dual-write first** from the parser + ADA runners; migrate readers tool
  by tool; never backfill old blobs. Validate parity on 3–5 representative
  clients before flipping any reader.
- Run the DB-growth projection (nightly ADA + Live SEO across the fleet)
  during the spec, before committing retention windows.

This is a big item — start with brainstorming → spec → Codex review → plan →
Codex review → implement, phased like A1 was. After A2, Track A interleaves
(A3 route kit, A4 observability) and B2/C3/C5 unlock.

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
- Phase 4 invariants: `system-` is a **reserved, code-owned Schedule
  namespace** — the seed re-enables manual disables at every boot (operator
  kill switch = env flag, not DB mutation); Job retention never deletes a
  job referenced by `Schedule.lastJobId` or holding its schedule's current
  `(scheduleId, nextRunAt)` slot; maintenance handlers are maxAttempts 1 —
  the next slot is the retry; boot order is register handlers →
  recoverJobsOnStartup → recoverQueue → seedSystemSchedules → startJobWorker.
- groupKey `site-audit:<id>` is shared by all four site-audit job types;
  scheduled jobs get groupKey `schedule:<id>`.
- Standalone single-page audits are untouched: own POST-driven runner,
  `ada-audit:<id>` PDF groups, NULL `siteAuditId`.
- A2 schema names are settled: `CrawlRun` / `CrawlPage` / `Finding` /
  `Violation`; dual-write + parity on 3–5 clients before readers flip;
  never backfill old blobs.
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
- **Server has no `sqlite3` CLI** — verify production DB state via node +
  Prisma from `/home/seo/webapps/seo-tools` (`bash -lc` for the node PATH).
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction.

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created. No implementation started.
- 2026-06-10 — A1 Phases 0–1 built (job queue core + PSI migration behind flag) on `feat/durable-job-queue`; PR opened. Next: merge/deploy/parity (Kevin), then Phase 2 (PDF scans).
- 2026-06-10 — PR #50 merged + deployed. `JOB_QUEUE_PSI=1` enabled. Parity PASSED in production incl. restart-resume mid-`lighthouse-running`. Next: legacy-pool deletion + Phase 2 (PDF scans).
- 2026-06-10 — Phase 1 close-out (legacy pool + flag deleted) + Phase 2 (PDF scans durable, `pdfs-running` survives restarts, finalize-before-fail) built on `feat/job-queue-phase2-pdf-scans`; PR opened. Next: merge/deploy + restart-test, then Phase 3 (page loop).
- 2026-06-10 — PRs #51 + #52 merged + deployed. Incident: first PDF-bearing audit wedged SQLite (interactive-transaction write-lock starvation under pdfjs load); fixed by converting all itxs to array form. Production verified: clean 23-page/11-PDF audit, restart-resume mid-`pdfs-running`, drained-parent finalize. Next: Phase 3 (page loop).
- 2026-06-10 — **A1 Phase 3 built** on `feat/job-queue-phase3-page-loop`; PR #53 opened. Page loop fully durable (`site-audit-discover` + `site-audit-page`), mutex deleted, `running` parents restart-survivable, browser recycling pool-level, AdaAudit unique index + dedupe migration. 1,704 tests green. Next: merge/deploy + restart-test mid-`running`, then Phase 4 (cleanup ticks).
- 2026-06-10 — **PR #53 merged + deployed + production-verified** (clean PDF run with exact counters, queue-order hold/auto-promote, restart-resume mid-`running` 24/24). A1 Phases 0–3 all shipped. Next: Phase 4 (cleanup ticks) closes out A1.
- 2026-06-10 — **A1 Phase 4 built** on `feat/job-queue-phase4-cleanup-ticks`; PR #54 opened. `Schedule.name` + `seedSystemSchedules()` (three `system-*` rows, retired-row sweep), three maintenance handlers, zero `setInterval`s in `instrumentation.ts`, terminal Job-row retention with slot-record guard. Spec + plan Codex-reviewed (×5/×4 fixes applied). 1,726 tests green. Next: merge/deploy + verify, then A1 → `[x]`.
- 2026-06-10 — **PR #54 merged + deployed + verified; A1 COMPLETE.** Migration applied, boot clean, three `system-*` schedules seeded/enabled, immediate first-seed slots for screenshot-sweep + stale-audit-reset completed in production. Residual next-day check: cleanup at the 2026-06-11 09:00 UTC slot + retention prune. Next: A2 (normalized findings layer).
