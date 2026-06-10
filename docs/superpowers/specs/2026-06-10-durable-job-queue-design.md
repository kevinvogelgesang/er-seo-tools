# Durable Job Queue + Schedule Table — Design

**Date:** 2026-06-10 · **Roadmap item:** A1 (`docs/superpowers/nyi/improvement-roadmaps/06-platform.md` item 1)
**Status:** spec — Codex-reviewed (accept with named fixes; all nine applied 2026-06-10)
**Estimated effort:** 2–2.5 wks total; this spec covers the full design. Implementation is phased — Phase 0 (infrastructure) + Phase 1 (PSI migration) first.

## Problem

All background work is in-process and non-durable: the PSI worker pool
(`lib/ada-audit/lighthouse-queue.ts`), fire-and-forget PDF scans
(`lib/ada-audit/pdf-orchestrator.ts` + `pdf-worker-pool.ts`), the site-audit
page loop guarded by a `processing` mutex (`lib/ada-audit/queue-manager.ts`),
and cleanup `setInterval`s (`instrumentation.ts`). Every deploy kills in-flight
work; `recoverQueue` / `resetStaleAudits` / orphan-cascades exist purely to
reconcile the wreckage. Nothing can be scheduled (no recurring ADA scans,
no robots monitoring) because there is no durable "do this later" primitive.

## Goals

1. A `Job` table + one worker loop in the existing long-lived process, giving
   durability (jobs survive restarts), retries, dedup, and type-keyed
   concurrency.
2. A `Schedule` table + tick that enqueues due jobs — the primitive C2
   (scheduled ADA) and D5 (robots monitoring) build on.
3. Migrate existing background work one type at a time, deleting bespoke
   recovery code as each migration proves out.
4. Deploy behavior moves from "kill and reconcile" toward "drain or resume."

## Non-goals (decided, don't relitigate)

- No Postgres/Redis/BullMQ. SQLite job table + in-process worker only.
- No PM2 cluster mode. Single-process assumption is load-bearing and
  documented; the conditional-update claim keeps us correct anyway.
- No admin UI in this item (A4 `/admin/ops` will render queue state later;
  this item only exposes an introspection function).
- No new schedules actually created in this item — C2/D5 own that. We ship
  the table, the tick, and tests.

## Hard requirements (from the roadmap doc)

- Claim via conditional `UPDATE … WHERE status='queued'` — no two workers
  take one job.
- Heartbeat while running + stale-heartbeat recovery (re-queue or fail).
- Retry policy per type: `attempts`/`maxAttempts`, backoff via `runAfter`.
- Idempotency: `dedupKey` per job + idempotent job bodies — a re-run after a
  crash can't double-write results.
- **Never hold a DB transaction across browser/network work.** Claim, commit,
  do the work, then write the outcome.
- Type-keyed concurrency limits (`psi` gets 6 slots, etc.).

## Schema

```prisma
model Job {
  id          String    @id @default(cuid())
  type        String    // 'psi' | 'pdf-scan' | 'site-audit-page' | 'cleanup' | ...
  payload     String    @default("{}")   // JSON string (SQLite has no JSON type)
  status      String    @default("queued") // queued | running | complete | error | cancelled
  priority    Int       @default(0)      // higher claims first within a type
  attempts    Int       @default(0)      // incremented at claim time
  maxAttempts Int       @default(3)
  runAfter    DateTime  @default(now())  // not claimable before this; backoff writes here
  heartbeatAt DateTime?
  startedAt   DateTime?
  completedAt DateTime?
  lastError   String?
  dedupKey    String?   // active-job idempotency key (see partial index below)
  groupKey    String?   // owner linkage, e.g. 'site-audit:<id>' — lets owners query/cancel outstanding work
  scheduleId  String?   // set when enqueued by the scheduler tick
  scheduledFor DateTime? // the slot (the Schedule.nextRunAt that produced this job)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt       // doubles as write heartbeat, same as SiteAudit

  @@unique([scheduleId, scheduledFor])   // durable exactly-once-per-slot (NULLs exempt in SQLite)
  @@index([status, runAfter])
  @@index([type, status])
  @@index([groupKey, status])
  @@index([createdAt])
}

model Schedule {
  id        String    @id @default(cuid())
  jobType   String
  payload   String    @default("{}")
  cadence   String    // 'every:<n>m|h|d' | 'daily@HH:MM' | 'weekly:<0-6>@HH:MM' (server-local time)
  nextRunAt DateTime
  enabled   Boolean   @default(true)
  clientId  Int?
  client    Client?   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  lastRunAt DateTime?
  lastJobId String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@index([enabled, nextRunAt])
  @@index([clientId])
}
```

**Dedup is active-window only**, enforced by a partial unique index added by
hand to the generated migration (same precedent as `audit_batches_one_open`):

```sql
CREATE UNIQUE INDEX "jobs_active_dedup" ON "Job"("type", "dedupKey")
WHERE "dedupKey" IS NOT NULL AND "status" IN ('queued', 'running');
```

Once a job reaches a terminal status it leaves the index, so the same
dedupKey can be enqueued again later (e.g. tomorrow's scheduled run). Enqueue
catches `P2002`, looks up the existing active job, and returns it with
`deduped: true`. The race handling is total: if the P2002 was raised but the
follow-up lookup finds no active row (the winner went terminal in between),
retry the create once; a second `P2002` repeats the lookup and returns
whatever it finds. Never assume `P2002` leaves an active row visible.

Active-window dedup is **not** sufficient for scheduler exactly-once-per-slot
semantics (a scheduled job that completes before a crashed tick's restart
would leave the active window and get re-enqueued). Scheduled jobs therefore
carry `scheduleId` + `scheduledFor`, protected by the real (non-partial)
`@@unique([scheduleId, scheduledFor])` index, which survives terminal status.

`Schedule.clientId` uses `onDelete: Cascade` — a deleted client's schedules
go with it (orphan schedules would enqueue jobs that fail forever).

## Module layout (`lib/jobs/`)

| File | Responsibility |
|---|---|
| `types.ts` | `JobHandler`, `JobHandlerConfig`, `EnqueueOptions`, status constants |
| `registry.ts` | `registerJobHandler(config)` / `getJobHandler(type)` / `listJobTypes()`; module-level Map |
| `queue.ts` | `enqueueJob()`, `cancelJobsByGroup()` (queued rows only), `countActiveJobsByGroup()` (counts `queued` + `running` rows for a groupKey — **ignoring `runAfter`**, so backoff-delayed jobs still count as outstanding; never counts terminal rows) |
| `worker.ts` | `startJobWorker()` / `stopJobWorker()` / `kickJobWorker()`; the claim-execute-settle loop; heartbeat |
| `recovery.ts` | `recoverJobsOnStartup()` (all `running` → re-queue or fail), `sweepStaleJobs()` (heartbeat-based) |
| `scheduler.ts` | `tickSchedules()` + `parseCadence()` / `nextRun(cadence, from)` |
| `introspection.ts` | `getJobQueueState()` — per-type counts, oldest running, recent failures (for A4 later) |
| `handlers/psi.ts` | Phase 1: PSI handler (registered from `worker.ts` start path) |

### Handler contract

```ts
interface JobHandlerConfig {
  type: string
  concurrency: number        // max simultaneously running jobs of this type
  maxAttempts?: number       // default for jobs of this type (Job row can override)
  backoffBaseMs?: number     // delay = backoffBaseMs * 2^(attempts-1), default 30s, cap 15min
  timeoutMs?: number         // hard handler runtime cap, default 5min — see below
  handler: (payload: unknown, ctx: { jobId: string; attempt: number; signal: AbortSignal }) => Promise<void>
  onExhausted?: (payload: unknown, ctx: { jobId: string; lastError: string }) => Promise<void>
}
```

- Handler **resolves** → job `complete`.
- Handler **throws** (or exceeds `timeoutMs`) → if `attempts >= maxAttempts`,
  job `error` + `lastError`; else back to `queued` with
  `runAfter = now + backoff(attempts)`.
- **Timeout:** the worker races the handler against `timeoutMs` and aborts
  the ctx `AbortSignal` on expiry. The race guarantees the worker-side
  wrapper always settles even if the underlying promise hangs forever — a
  15 s heartbeat only proves the event loop is alive, not that the handler is
  making progress, so without this cap a hung network call would heartbeat
  indefinitely and never trip the stale sweep. A zombie promise that settles
  after timeout no-ops via the attempt fence (below).
- **`onExhausted`** runs (best-effort, errors logged) from **every** path
  that flips a job to terminal `error` — final-attempt settle, stale sweep
  exhaustion, and startup-recovery exhaustion — so domain tables never
  strand counters on a job-level failure (see the PSI handler).
- Handlers must be idempotent — they may run again after a crash mid-flight.
  The PSI handler achieves this with its existing conditional
  `updateMany({ where: { status: 'axe-complete' } })` claim (a re-run
  matches 0 rows and no-ops).
- "Expected" domain failures (e.g. PSI fetch returned an error) are recorded
  in the domain tables by the handler and the **job completes** — job-level
  retry is for unexpected throws (DB hiccups, bugs), matching today's
  semantics where a PSI fetch error becomes `lighthouseError` on the row.

### Worker loop

- `startJobWorker()` registers handlers, then runs a tick on:
  an in-process kick (`kickJobWorker()`, called by `enqueueJob`), and a
  fallback poll every `JOB_POLL_MS` (default 5 000 ms).
- Each tick, per registered type with free slots
  (`concurrency - activeSet.size`): claim loop —
  1. `findFirst` candidate: `status='queued' AND runAfter <= now`,
     ordered `priority desc, createdAt asc`.
  2. Conditional claim: `updateMany({ where: { id, status: 'queued' }, data:
     { status: 'running', attempts: { increment: 1 }, startedAt, heartbeatAt } })`.
     `count === 0` → another claim won (or cancel raced); retry from 1.
     The claimer records `claimedAttempt` (the attempts value it just wrote)
     as its **fencing token**.
  3. Run the handler **outside any transaction**, raced against `timeoutMs`,
     with a 15 s interval updating `heartbeatAt`. Heartbeat writes are fenced:
     `WHERE id AND status='running' AND attempts=claimedAttempt`. The
     interval is cleared in `finally`.
  4. Settle: `complete` / re-queue-with-backoff / `error` as above. Settle
     writes carry the same fence (`status='running' AND
     attempts=claimedAttempt`). `status='running'` alone is not enough: if
     the stale sweep re-queues attempt 1 and the worker reclaims the row as
     attempt 2, a zombie attempt-1 settle would otherwise clobber attempt 2.
     A fenced write matching 0 rows means the lease was lost — discard the
     result silently.
- **Active-slot bookkeeping** is a per-type `Map<jobId, claimedAttempt>`
  (not a counter). The handler wrapper's `finally` deletes its own entry
  idempotently — a delete can never double-fire into negative counts. The
  `timeoutMs` race guarantees the wrapper settles, so entries cannot leak
  from hung handlers; as defense-in-depth the stale sweep also retires any
  active entry whose DB lease is no longer current (row not `running` or
  `attempts !== claimedAttempt`).
- `stopJobWorker()` (SIGTERM path) stops the poll + stops claiming; in-flight
  handlers get a short grace (`Promise.race` with ~5 s) and whatever doesn't
  finish is recovered as `running` → re-queued at next startup. This is what
  turns deploys into "resume" for durable job types.
- Concurrency accounting is in-memory — correct under the single-process
  assumption, and the conditional claim keeps multi-process
  accidentally-safe (just over-concurrent), not corrupt.

### Recovery

- `recoverJobsOnStartup()` — single pass before the worker starts: every
  `running` job is, by definition, orphaned (fresh process). Re-queue
  (`status='queued'`, `runAfter=now`) if `attempts < maxAttempts`, else
  `error` with `lastError = 'interrupted by restart'` + the type's
  `onExhausted` hook.
- `sweepStaleJobs()` — every `JOB_STALE_SWEEP_MS` (default 60 s): `running`
  jobs with `heartbeatAt < now - 2 min` get the same re-queue-or-fail
  treatment (including `onExhausted` on the fail branch). With a 15 s
  heartbeat this only fires when a handler truly hung or the event loop
  stalled. The sweep also retires in-memory active-set entries whose DB
  lease is gone (see worker loop).
- Both replace, generically, what `resetStaleAudits`/`recoverQueue` do
  bespoke today — those shrink as each job type migrates.

### Scheduler

- `tickSchedules()` every 60 s (started/stopped with the worker):
  `enabled AND nextRunAt <= now` → for each, `enqueueJob({ type: jobType,
  payload, scheduleId: id, scheduledFor: nextRunAt, groupKey:
  'schedule:<id>' })`, then advance `nextRunAt` with `nextRun(cadence, …)`
  and set `lastRunAt`/`lastJobId`.
- **Exactly-once-per-slot** comes from the durable
  `@@unique([scheduleId, scheduledFor])` index, not the active-window
  dedupKey: a crash between enqueue and advance re-enqueues the same slot on
  restart and hits `P2002` even if the first job already completed. The
  tick treats that `P2002` as "slot already enqueued" and proceeds to
  advance `nextRunAt`.
- **Overlap protection:** an in-memory `tickRunning` guard prevents a slow
  tick from overlapping the next interval, and the `nextRunAt` advance is
  conditional (`updateMany WHERE id AND nextRunAt = <value read>`); a
  conditional advance matching 0 rows means another tick already moved this
  schedule — skip it.
- Missed slots (server down across several due times) collapse to **one**
  run: `nextRun` advances from `now`, not from the missed slot, so a
  week-long outage doesn't enqueue seven nightly scans.
- Cadence grammar kept deliberately tiny: `every:<n>m|h|d`, `daily@HH:MM`,
  `weekly:<dow>@HH:MM` (server-local). `parseCadence` throws on anything
  else; C2/D5 can extend it when they need more.

## Phase plan

| Phase | Scope | Deletes |
|---|---|---|
| **0** | Schema + worker + recovery + scheduler + introspection + tests | — |
| **1** | PSI jobs behind `JOB_QUEUE_PSI=1` flag | (after parity + flag default flip) the in-memory pool in `lighthouse-queue.ts` |
| **2** | PDF scans (`pdf-scan` type, concurrency = `PDF_POOL_SIZE`) | `pdf-worker-pool.ts`, fire-and-forget dispatch in `pdf-orchestrator.ts`, `failOrphanPdfAudits` |
| **3** | Site-audit page loop (`site-audit-page` type; respects browser pool) | `processing` mutex, most of `resetStaleAudits`/`recoverQueue`/`failOrphanAdaAudits` |
| **4** | Cleanup ticks + screenshot sweeper as scheduled jobs | the `setInterval`s in `instrumentation.ts` |

Phases 0–1 are this implementation; 2–4 are follow-up sessions under the same
tracker item.

### Phase 1: PSI on the queue

- `enqueuePsiJob()` in `lighthouse-queue.ts` branches on the flag:
  - legacy (default): in-memory pool, unchanged.
  - `JOB_QUEUE_PSI=1`: `enqueueJob({ type: 'psi', payload: PsiJob, dedupKey:
    'psi:' + adaAuditId, groupKey: 'site-audit:' + siteAuditId })`.
- `handlers/psi.ts` is `runJob()` moved verbatim (same conditional claim,
  counter bump, `finalizeSiteAudit` call). Exception: the two "DB write
  failed → warn + return" paths become **throws**, so the queue's retry
  covers transient SQLITE_BUSY instead of wedging the audit until stale
  reset. `concurrency = PSI_CONCURRENCY` (default 6), `maxAttempts = 3`,
  `backoffBaseMs = 30_000`.
- **Exhaustion is a domain settle, not just a Job error.**
  `finalizeSiteAudit`'s drain predicate only counts
  `lighthouseComplete + lighthouseError`; a PSI job dying with
  `Job.status='error'` alone would strand the parent in `lighthouse-running`
  until stale recovery failed the whole audit. The psi `onExhausted` hook
  therefore conditionally claims the `AdaAudit` row still in `axe-complete`
  (flips it to `complete` with `lighthouseError = 'PSI job failed after N
  attempts: <lastError>'` — mirroring the legacy fetch-error semantics where
  the page is complete but the LH portion failed), bumps
  `SiteAudit.lighthouseError`, and calls `finalizeSiteAudit`. If the
  conditional claim matches 0 rows, recovery already settled the row —
  no-op.
- **Recovery interplay when the flag is on** (the durability payoff):
  - `recoverQueue()` startup pass: a `lighthouse-running` parent with
    outstanding (queued/running) jobs in `groupKey = 'site-audit:<id>'` is
    **left alone** — its PSI jobs were re-queued by `recoverJobsOnStartup()`
    and will drain to completion. Parents in `running`/`pdfs-running` are
    still failed (page loop and PDF scans aren't durable until Phases 2–3).
    A `lighthouse-running` parent with **no** outstanding jobs falls through
    to today's fail path.
  - `resetStaleAudits()`: skips a `lighthouse-running` audit that still has
    active jobs in its group (PSI completions bump `SiteAudit.updatedAt`
    anyway, but backoff windows could exceed the 5-min threshold).
  - Whenever a parent **is** failed (either recovery path), call
    `cancelJobsByGroup('site-audit:<id>')` so queued PSI jobs don't run
    pointlessly. A running job that slips through settles harmlessly — its
    conditional `axe-complete` claim matches 0 rows.
- Flag default **off** in production until parity is observed on a real site
  audit (compare lighthouse counters + finalization against a legacy run),
  then flip in `ecosystem.config.js`, then delete the legacy pool.

## Wiring (`instrumentation.ts`)

After `initPragmas()` and before `recoverQueue()`:

```ts
const { recoverJobsOnStartup } = await import('@/lib/jobs/recovery')
await recoverJobsOnStartup()          // before recoverQueue, which reads job state
const { startJobWorker, stopJobWorker } = await import('@/lib/jobs/worker')
startJobWorker()                      // also starts stale sweep + schedule tick
```

`shutdown()` adds `await stopJobWorker()` before `closeBrowser()`.
Ordering matters: `recoverJobsOnStartup()` must complete before
`recoverQueue()` runs, because `recoverQueue` decides whether a
`lighthouse-running` parent survives based on active jobs in its group.

## Env vars

| Var | Default | Meaning |
|---|---|---|
| `JOB_QUEUE_PSI` | unset (off) | route PSI work through the Job table |
| `JOB_POLL_MS` | 5000 | worker fallback poll interval |
| `JOB_STALE_SWEEP_MS` | 60000 | stale-heartbeat sweep interval |
| `PSI_CONCURRENCY` | 6 | unchanged — now also the `psi` type's slot count |

## Testing

Tests follow the existing pattern (vitest, real Prisma against the shared dev
DB, `fileParallelism: false`); each file cleans up its own Job/Schedule rows
(test types are prefixed `test-` so `deleteMany({ type: { startsWith: 'test-' } })`
is safe). The worker is never auto-started in tests — tests drive
`runWorkerTickOnce()` / `tickSchedules()` / `sweepStaleJobs()` directly.

- `queue.test.ts` — enqueue, dedup (P2002 → `deduped: true`), dedup window
  reopens after terminal status, dedup race totality (P2002 then no active
  row → retried create succeeds), cancelJobsByGroup only touches queued
  rows, countActiveJobsByGroup counts queued+running incl. backoff-delayed
  (`runAfter` in the future) and excludes terminal rows, priority + FIFO
  ordering, `runAfter` gating, `@@unique([scheduleId, scheduledFor])`
  survives terminal status.
- `worker.test.ts` — conditional claim (simulated race: pre-flip a candidate
  and assert the claimer moves on), type-keyed concurrency (3 slow jobs,
  concurrency 2 → max 2 running), success → complete, throw → backoff →
  re-queue with later `runAfter`, exhaustion → error + lastError +
  `onExhausted` fired, **attempt fence**: zombie settle from a superseded
  attempt (attempts no longer match) is discarded, timeout: handler
  exceeding `timeoutMs` settles as a throw and its AbortSignal fires,
  active-set entry removed exactly once.
- `recovery.test.ts` — startup re-queues running jobs with attempts left and
  fails exhausted ones (with `onExhausted`); stale sweep ignores fresh
  heartbeats, recovers stale ones, and retires active-set entries whose
  lease is gone.
- `scheduler.test.ts` — `parseCadence` accepts the grammar and throws on
  garbage; `nextRun` math incl. DST-agnostic `every:` arithmetic; tick
  enqueues due schedules; crash-replay of the same slot hits the durable
  unique index and still advances `nextRunAt` (exactly-once-per-slot, even
  when the first job already completed); conditional advance skips a
  schedule another tick moved; `tickRunning` guard prevents overlap;
  advances past missed slots to a single future run; skips disabled
  schedules.
- `handlers/psi.test.ts` — mirrors `lighthouse-queue.test.ts` cases against
  the handler: success path bumps `lighthouseComplete` + finalizes, PSI fetch
  error records `lighthouseError` but completes the job, row already terminal
  → no counter bump and no finalize, DB failure throws (retryable),
  `onExhausted` settles the AdaAudit row + bumps `lighthouseError` +
  finalizes (and no-ops when the row is already terminal).
- `queue-manager.test.ts` additions — flag-on recovery: `lighthouse-running`
  parent with active group jobs survives `recoverQueue` (queued, running,
  and backoff-delayed jobs all count); parent without them is failed and its
  group jobs are cancelled; **mixed-outstanding parent**: a `pdfs-running`
  parent with active PSI jobs is still failed (PDF work is not durable until
  Phase 2) and its PSI jobs are cancelled — `finalizeSiteAudit` gives
  `pdfs-running` precedence over `lighthouse-running`, so this state occurs
  whenever both are outstanding at crash time.

## Risks

- **SQLITE_BUSY under claim contention** — mitigated by the existing
  `busy_timeout=5000` pragma and single-process worker; claim retries are
  cheap.
- **Zombie handler after stale re-queue** — double-execution window. The
  attempt fence on heartbeat + settle (`status='running' AND
  attempts=claimedAttempt`) plus idempotent handler bodies make the zombie's
  late writes no-ops, same pattern the PSI claim already uses.
- **Flag-conditional recovery** adds branching to already-subtle code —
  covered by dedicated tests; branching is deleted with the legacy path
  after parity.
