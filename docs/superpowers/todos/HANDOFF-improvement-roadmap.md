# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-10 · **Updated by:** A1 Phase 3 merge/deploy/verify session
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
  2026-06-10. The entire site-audit pipeline is durable: `running`,
  `pdfs-running`, and `lighthouse-running` all survive restarts.
- **Phase 3 production verification (2026-06-10):** 0 duplicate
  `(siteAuditId, url)` pairs pre-deploy (dedupe DELETE no-op); clean run —
  nyinstituteofmassage.com exact counters (23 pages = 22 + 1 redirected,
  11/11 PDFs, 22/22 LH, 0 errors); queue order — second audit held
  `queued` by the one-active guard, auto-promoted on finalize; **restart
  mid-`running`** — `pm2 restart` at 1/24 pages → "resuming audit … (24
  durable job(s) outstanding)" → completed 24/24 pages, 24/24 LH, 0
  errors, no orphans.
- **In progress:** A1 (tracker `[~]`) — only Phase 4 (cleanup ticks)
  remains, then A1 is done.
- **Blocked / gated:** Anthropic API billing decision (gates 03 Phase 3);
  DB-growth projection and sitemap miss-rate measurement not yet run.

## Next item

**A1 Phase 4 — cleanup ticks + screenshot sweeper as scheduled jobs**
(parent spec `docs/superpowers/specs/2026-06-10-durable-job-queue-design.md`,
phase table row 4: deletes the `setInterval`s in `instrumentation.ts`).

Key context:
- Today `instrumentation.ts` owns three timers: `runCleanup()` (startup +
  every 24 h), `resetStaleAudits()` (every 10 min), and
  `startScreenshotSweeper()` (its own interval module,
  `lib/ada-audit/screenshot-sweeper.ts`).
- Phase 4 shape: seed `Schedule` rows (cadence grammar: `every:<n>m|h|d` |
  `daily@HH:MM` | `weekly:<dow>@HH:MM`) + small job handlers per task. The
  Schedule tick, exactly-once-per-slot unique index, and `tickSchedules()`
  machinery already exist and are tested — Phase 4 is mostly wiring +
  deleting intervals.
- Design decisions to make (small spec/brainstorm pass): how schedules are
  seeded idempotently at boot (upsert by a stable key — there's no
  `name`/`dedupKey` column on Schedule today, so either add one or look up
  by `jobType`); whether `resetStaleAudits` survives as `every:10m`
  scheduled job or stays a plain interval (it's now a thin safety net);
  whether the startup `runCleanup()` invocation stays inline (probably yes
  — "run at boot" isn't a cadence).
- Job handlers must follow the house pattern: domain errors complete the
  job, DB errors throw, no interactive transactions.


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
- Phase 3 invariants (new): one-active is enforced by the **discover claim's
  `NOT EXISTS` guard**, not the promoter (the promoter is best-effort
  ordering); `discoveredUrls`+`pagesTotal` are always written together (the
  finalizer's discovery guard depends on it — `running` + null
  `discoveredUrls` is never finalized); PDFs dispatch BEFORE the page
  settle; domain errors settle / DB errors throw; page-job claim-0 path
  re-enqueues PSI for `axe-complete` children (closes the legacy
  lost-enqueue window); `failSiteAudit` never clobbers terminal parents.
- Browser pool: the drain gate is set at ACQUIRE time when the threshold is
  hit; `closeBrowser()` always resets gate state + notifies waiters (no
  parked-forever waiters). `SITE_AUDIT_BROWSER_RECYCLE_PAGES` is now
  pool-global (prod 15).
- groupKey `site-audit:<id>` is shared by `psi` + `pdf-scan` +
  `site-audit-page` + `site-audit-discover` — survival checks and
  `cancelJobsByGroup` are deliberately type-agnostic.
- Standalone single-page audits are untouched: own POST-driven runner,
  `ada-audit:<id>` PDF groups, NULL `siteAuditId` (exempt from the new
  unique index — SQLite NULLs are distinct).
- Test gotcha: the one-active guard and the promoter are GLOBAL over the
  shared dev DB — `queue-manager.test.ts` and `site-audit-discover.test.ts`
  neutralize stray transient/queued SiteAudits in `clearTestState`. New
  test files touching promotion must do the same.
- Boot order in `instrumentation.ts` is deliberate: register handlers →
  recoverJobsOnStartup → await recoverQueue → startJobWorker. Don't reorder.
- **Local dev quirk:** `.env` points at `file:/var/lib/er-seo-tools/db.sqlite`
  (doesn't exist on the Mac). Run prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"` prefixed. `prisma migrate dev` is
  interactive-only — generate SQL via `prisma migrate diff`, write the
  migration folder by hand, apply with `prisma migrate deploy`.
- Findings tables (A2) are named `CrawlRun` / `CrawlPage` / `Finding` /
  `Violation`; dual-write + parity on 3–5 clients before readers flip.
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction (Phase 3 session: 2 consults, accept-with-fixes ×8 each, all
  applied).

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created. No implementation started.
- 2026-06-10 — A1 Phases 0–1 built (job queue core + PSI migration behind flag) on `feat/durable-job-queue`; PR opened. Next: merge/deploy/parity (Kevin), then Phase 2 (PDF scans).
- 2026-06-10 — PR #50 merged + deployed. `JOB_QUEUE_PSI=1` enabled. Parity PASSED in production incl. restart-resume mid-`lighthouse-running`. Next: legacy-pool deletion + Phase 2 (PDF scans).
- 2026-06-10 — Phase 1 close-out (legacy pool + flag deleted) + Phase 2 (PDF scans durable, `pdfs-running` survives restarts, finalize-before-fail) built on `feat/job-queue-phase2-pdf-scans`; PR opened. Next: merge/deploy + restart-test, then Phase 3 (page loop).
- 2026-06-10 — PRs #51 + #52 merged + deployed. Incident: first PDF-bearing audit wedged SQLite (interactive-transaction write-lock starvation under pdfjs load); fixed by converting all itxs to array form. Production verified: clean 23-page/11-PDF audit, restart-resume mid-`pdfs-running`, drained-parent finalize. Next: Phase 3 (page loop).
- 2026-06-10 — **A1 Phase 3 built** on `feat/job-queue-phase3-page-loop`; PR #53 opened. Page loop fully durable (`site-audit-discover` + `site-audit-page`), mutex deleted, `running` parents restart-survivable, browser recycling pool-level, AdaAudit unique index + dedupe migration. 1,704 tests green. Next: merge/deploy + restart-test mid-`running`, then Phase 4 (cleanup ticks).
- 2026-06-10 — **PR #53 merged + deployed + production-verified** (clean PDF run with exact counters, queue-order hold/auto-promote, restart-resume mid-`running` 24/24). A1 Phases 0–3 all shipped. Next: Phase 4 (cleanup ticks) closes out A1.
