# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-10 · **Updated by:** A1 Phase 3 build session
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

- **Done & deployed:** A1 Phases 0–2 (job queue core, PSI, PDF scans) —
  merged (PRs #50–#52), production-verified 2026-06-10.
- **Built, awaiting merge/deploy:** **A1 Phase 3 (site-audit page loop)** on
  branch `feat/job-queue-phase3-page-loop` (PR open). Two new job types:
  `site-audit-discover` (claim/discovery/fan-out; raw-SQL `queued→running`
  claim with `NOT EXISTS` one-active guard) and `site-audit-page` (per-URL
  axe + settle + PSI/PDF dispatch). `processNext` is a stateless promoter;
  `runAudit()` + the `processing` mutex are deleted; `running` parents now
  survive restarts. Browser recycling moved into `browser-pool.ts`
  (pages-served drain gate + 60 s idle close). New migration:
  `@@unique([siteAuditId, url])` on AdaAudit **with a dedupe DELETE** —
  check production for duplicate pairs before deploying. 1,704 tests green;
  tsc + build green. Spec:
  `docs/superpowers/specs/2026-06-10-durable-job-queue-phase3-design.md` ·
  plan: `docs/superpowers/plans/2026-06-10-durable-job-queue-phase3.md`
  (both Codex-reviewed, accept-with-fixes ×8 each, all applied).
- **In progress:** A1 (tracker `[~]`) — Phase 4 (cleanup ticks) remains
  after Phase 3 ships.
- **Blocked / gated:** Anthropic API billing decision (gates 03 Phase 3);
  DB-growth projection and sitemap miss-rate measurement not yet run.

## Next item

**Merge + deploy Phase 3, verify in production, then A1 Phase 4**
(cleanup ticks + screenshot sweeper as scheduled jobs — deletes the
`setInterval`s in `instrumentation.ts`; parent spec phase table row 4).

Production verification checklist for Phase 3 (mirror the Phase 1/2 drills):
1. Before deploy: `sqlite3 db "SELECT siteAuditId, url, COUNT(*) FROM
   AdaAudit WHERE siteAuditId IS NOT NULL GROUP BY siteAuditId, url HAVING
   COUNT(*) > 1"` — the migration deletes these (keeps earliest); eyeball
   the count first.
2. Clean run: a PDF-bearing site audit (nyinstituteofmassage.com was the
   Phase 2 reference: 23 pages, 11 PDFs) completes with counters exact.
3. **Restart mid-`running`** (the new payoff): `pm2 restart` while pages
   are in flight → log shows "Startup recovery: resuming audit … (N durable
   job(s) outstanding)" → audit completes with all pages settled, no
   orphan children.
4. Restart mid-discovery (harder to time — optional): discover job re-runs,
   no duplicate children (unique index), pagesTotal consistent.
5. Queue order: enqueue two audits → second stays queued until first
   completes (one-active guard), then auto-promotes.

Phase 4 key context: `runCleanup()` daily interval + `resetStaleAudits()`
10-min interval + `startScreenshotSweeper()` in `instrumentation.ts` become
`Schedule` rows (`cadence` grammar: `every:<n>m|h|d` / `daily@HH:MM`) with
small job handlers. The Schedule tick + exactly-once-per-slot machinery
already exists and is tested — Phase 4 is mostly wiring + deleting
intervals. Decide whether `resetStaleAudits` even survives (it's now a
thin safety net; keeping it as a `every:10m` scheduled job is fine).

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
  instruction (this session: 2 consults, accept-with-fixes ×8 each, all
  applied).

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created. No implementation started.
- 2026-06-10 — A1 Phases 0–1 built (job queue core + PSI migration behind flag) on `feat/durable-job-queue`; PR opened. Next: merge/deploy/parity (Kevin), then Phase 2 (PDF scans).
- 2026-06-10 — PR #50 merged + deployed. `JOB_QUEUE_PSI=1` enabled. Parity PASSED in production incl. restart-resume mid-`lighthouse-running`. Next: legacy-pool deletion + Phase 2 (PDF scans).
- 2026-06-10 — Phase 1 close-out (legacy pool + flag deleted) + Phase 2 (PDF scans durable, `pdfs-running` survives restarts, finalize-before-fail) built on `feat/job-queue-phase2-pdf-scans`; PR opened. Next: merge/deploy + restart-test, then Phase 3 (page loop).
- 2026-06-10 — PRs #51 + #52 merged + deployed. Incident: first PDF-bearing audit wedged SQLite (interactive-transaction write-lock starvation under pdfjs load); fixed by converting all itxs to array form. Production verified: clean 23-page/11-PDF audit, restart-resume mid-`pdfs-running`, drained-parent finalize. Next: Phase 3 (page loop).
- 2026-06-10 — **A1 Phase 3 built** on `feat/job-queue-phase3-page-loop`; PR opened. Page loop fully durable (`site-audit-discover` + `site-audit-page`), mutex deleted, `running` parents restart-survivable, browser recycling pool-level, AdaAudit unique index + dedupe migration. 1,704 tests green. Next: merge/deploy + restart-test mid-`running`, then Phase 4 (cleanup ticks).
