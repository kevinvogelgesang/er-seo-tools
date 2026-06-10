# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-10 · **Updated by:** A1 close-out + Phase 2 session
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

- **Done:** A1 Phases 0–2 + Phase 1 close-out. PSI parity passed in
  production 2026-06-10 (PR #50, incl. restart-resume). This session
  (branch `feat/job-queue-phase2-pdf-scans`, PR open — merge/deploy
  pending): legacy in-memory PSI pool + `JOB_QUEUE_PSI` flag **deleted**;
  PDF scans migrated to durable `pdf-scan` jobs
  (`lib/jobs/handlers/pdf-scan.ts`, concurrency `PDF_POOL_SIZE`=4);
  `pdf-worker-pool.ts` deleted; `pdfs-running` parents survive restarts.
  Codex plan review accept-with-fixes ×5, all applied — notably
  **finalize-before-fail**: in `recoverQueue`/`resetStaleAudits`, a
  `pdfs-running`/`lighthouse-running` parent with zero active group jobs
  gets one `finalizeSiteAudit` attempt (crash window: last job committed
  counters, died before finalize) and is only failed if still transient.
  1,677 tests green; tsc + build green.
- **In progress:** A1 (tracker `[~]`) — Phases 3–4 remain.
- **Blocked / gated:** Anthropic API billing decision (gates 03 Phase 3);
  DB-growth projection and sitemap miss-rate measurement not yet run.

## Next item

**First: merge + deploy the open PR from `feat/job-queue-phase2-pdf-scans`,
then verify in production** — run a site audit with PDFs on a real domain and
`pm2 restart seo-tools` mid-`pdfs-running`; the audit should resume and
complete (look for "Startup recovery: resuming audit … durable job(s)
outstanding" in the logs). Also worth one check on a WAF-protected PDF
(Referer header passes through `sourcePageUrl` in the job payload).

**Then: A1 Phase 3 — site-audit page loop onto the queue**
(`site-audit-page` job type), then Phase 4 (cleanup ticks as scheduled
jobs). Spec phase table says what each deletes.

Key context for Phase 3:
- Today the page loop lives in `runAudit()` (`lib/ada-audit/queue-manager.ts`):
  conditional `queued→running` claim, `discoverPages`, then batched inline
  page work (axe via browser pool → PDF dispatch → page-settle transaction →
  PSI enqueue), guarded globally by the in-memory `processing` mutex in
  `processNext()`.
- Phase 3 shape: one `site-audit-page` job per URL (groupKey
  `site-audit:<id>`, concurrency = `SITE_AUDIT_CONCURRENCY`), with discovery
  + child-row creation moving to an enqueue step. Deletes the `processing`
  mutex and most of `resetStaleAudits`/`recoverQueue`/`failOrphanAdaAudits`
  — `running` parents become restart-survivable like the other phases.
- Design decisions Phase 3 must make (worth a brainstorm/spec pass):
  per-page job vs page-batch job; where browser recycling
  (`SITE_AUDIT_BROWSER_RECYCLE_PAGES`, currently loop-index-based) lives
  under a job model; how "only one site audit at a time" is enforced once
  the mutex dies (likely: keep SiteAudit-level `queued` FIFO, jobs only
  exist for the active audit); redirected-page handling in the handler.
- The handler must hold the browser-pool page only inside the job body
  (never across enqueues), and the page-settle transaction + `pagesComplete`
  bump must stay atomic — same one-transaction pattern as psi/pdf-scan
  handlers.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- Job-queue invariants are load-bearing: attempt-fenced heartbeat/settle,
  handler timeout race, active-slot release AFTER settle, never hold a DB
  transaction across network/browser work, `onExhausted` fires from every
  error-flip path, `countActiveJobsByGroup` ignores `runAfter`, failed
  group-count = skip-don't-fail, **finalize-before-fail on drained
  transients** (new this session).
- groupKey `site-audit:<id>` is shared by `psi` + `pdf-scan` (+ future
  `site-audit-page`) jobs — survival checks and `cancelJobsByGroup` are
  deliberately type-agnostic.
- Standalone single-page audits dispatch PDFs with `adaAuditId` only:
  groupKey `ada-audit:<id>`, no counters, no finalize. Don't "fix" that.
- PDF scan domain errors (`scanError`/`skipReason` from `scanPdfUrl`, which
  never throws) complete the job; only DB failures throw/retry.
- Boot order in `instrumentation.ts` is deliberate: register handlers →
  recoverJobsOnStartup → await recoverQueue → startJobWorker. Don't reorder.
- **Local dev quirk:** `.env` points at `file:/var/lib/er-seo-tools/db.sqlite`
  (doesn't exist on the Mac). Run prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"` prefixed (resolves to
  `prisma/local-dev.db`).
- Findings tables (A2) are named `CrawlRun` / `CrawlPage` / `Finding` /
  `Violation`; dual-write + parity on 3–5 clients before readers flip.
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction (this session: 1 consult, accept-with-fixes, applied).

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created. No implementation started.
- 2026-06-10 — A1 Phases 0–1 built (job queue core + PSI migration behind flag) on `feat/durable-job-queue`; PR opened. Next: merge/deploy/parity (Kevin), then Phase 2 (PDF scans).
- 2026-06-10 — PR #50 merged + deployed. `JOB_QUEUE_PSI=1` enabled. Parity PASSED in production incl. restart-resume mid-`lighthouse-running`. Next: legacy-pool deletion + Phase 2 (PDF scans).
- 2026-06-10 — Phase 1 close-out (legacy pool + flag deleted) + Phase 2 (PDF scans durable, `pdfs-running` survives restarts, finalize-before-fail) built on `feat/job-queue-phase2-pdf-scans`; PR opened. Next: merge/deploy + restart-test, then Phase 3 (page loop).
