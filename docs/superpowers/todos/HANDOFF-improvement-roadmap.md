# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-10 · **Updated by:** A1 Phases 0–1 session
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

- **Done:** A1 Phases 0–1 **merged (PR #50), deployed, and parity-verified
  in production**. `JOB_QUEUE_PSI=1` is live in `ecosystem.config.js` — PSI
  runs through the durable Job table. Parity evidence (2026-06-10, domain
  proway.erstaging.site, 20 pages): run 1 completed 19/19 lighthouse, 0
  errors, exact match with legacy runs; run 2 had PM2 restarted
  mid-`lighthouse-running` with 10 PSI jobs in flight — startup recovery
  re-queued all 10, `recoverQueue` resumed the parent ("resuming audit …
  (10 durable PSI job(s) outstanding)" in the logs), and the audit
  completed 19/19 with no errors. Spec/plan Codex-reviewed; 1,659 tests
  green; build green.
- **In progress:** A1 (tracker shows `[~]`) — Phases 2–4 + legacy-pool
  deletion remain.
- **Blocked / gated:** Anthropic API billing decision (gates 03 Phase 3);
  DB-growth projection and sitemap miss-rate measurement not yet run.

## Next item

**A1 continuation — Phase 1 close-out + Phase 2: PDF scans onto the job
queue** (then Phase 3 page loop, Phase 4 cleanup ticks). Plan's "Out of
scope" section lists the phases; the spec's phase table says what each
deletes.

Close-out first (parity has passed, so this is unblocked): delete the
legacy in-memory pool in `lib/ada-audit/lighthouse-queue.ts` — the
`queue`/`active`/`pump()` machinery and the `isPsiJobQueueEnabled()`
branching (keep `enqueuePsiJob` as a thin wrapper over `enqueueJob`, keep
the enqueue-failure `settlePsiFailure` fallback), drop the flag-off branch
in `recoverQueue`/`resetStaleAudits`, remove `JOB_QUEUE_PSI` from
`ecosystem.config.js`, and update the legacy-path tests.

Key context for Phase 2 (PDF scans → `pdf-scan` job type):
- Replace the fire-and-forget `withPdfSlot()` dispatch in
  `lib/ada-audit/pdf-orchestrator.ts` with `enqueueJob({ type: 'pdf-scan',
  groupKey: 'site-audit:<id>', dedupKey: 'pdf:<siteAuditId>:<url>' })`.
- Handler concurrency = `PDF_POOL_SIZE` (default 4); handler body = the scan
  + settle logic currently inline in pdf-orchestrator; needs the same
  conditional/atomic settle treatment as the PSI handler (see
  `lib/jobs/handlers/psi.ts` for the pattern, incl. `onExhausted`).
- Recovery interplay: `pdfs-running` parents can then survive restarts
  (extend the survival check in `recoverQueue`/`resetStaleAudits` the same
  way `lighthouse-running` was done — note `finalizeSiteAudit` gives
  `pdfs-running` precedence when both PDFs and PSI are outstanding, so the
  mixed case must check both groups' jobs before failing).
- Deletes: `pdf-worker-pool.ts`, `failOrphanPdfAudits` (shrinks), the
  fire-and-forget block in `dispatchPdfScans`.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- Job-queue invariants are load-bearing: attempt-fenced heartbeat/settle
  (`WHERE status='running' AND attempts=claimedAttempt`), handler timeout
  race (wrapper always settles), active-slot release AFTER settle, never
  hold a DB transaction across network/browser work, `onExhausted` fires
  from every error-flip path, `countActiveJobsByGroup` ignores `runAfter`,
  failed group-count = skip-don't-fail.
- Boot order in `instrumentation.ts` is deliberate: register handlers →
  recoverJobsOnStartup → await recoverQueue → startJobWorker. Don't reorder.
- Scheduler exactly-once-per-slot uses `@@unique([scheduleId, scheduledFor])`
  (durable), NOT the active-window dedupKey.
- **Local dev quirk:** `.env` points at `file:/var/lib/er-seo-tools/db.sqlite`
  (doesn't exist on the Mac). Run prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"` prefixed (resolves to
  `prisma/local-dev.db`).
- Findings tables (A2) are named `CrawlRun` / `CrawlPage` / `Finding` /
  `Violation`; dual-write + parity on 3–5 clients before readers flip.
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction (this session: 2 consults, both accept-with-fixes, applied).

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created. No implementation started.
- 2026-06-10 — A1 Phases 0–1 built (job queue core + PSI migration behind flag) on `feat/durable-job-queue`; PR opened. Next: merge/deploy/parity (Kevin), then Phase 2 (PDF scans).
- 2026-06-10 — PR #50 merged + deployed. `JOB_QUEUE_PSI=1` enabled. Parity PASSED in production incl. restart-resume mid-`lighthouse-running`. Next: legacy-pool deletion + Phase 2 (PDF scans).
