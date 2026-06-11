# Durable Job Queue — Phase 4: Cleanup Ticks as Scheduled Jobs

**Date:** 2026-06-10 · **Parent spec:** `2026-06-10-durable-job-queue-design.md` (phase table row 4)
**Status:** spec — Codex-reviewed (accept with named fixes ×5; all applied 2026-06-10)
**Scope:** small — wiring + deletions. The Schedule tick, exactly-once-per-slot
unique index, and `tickSchedules()` machinery already exist and are tested.

## Problem

`instrumentation.ts` still owns three non-durable timers:

1. `runCleanup()` — at startup + `setInterval` every 24 h
2. `resetStaleAudits()` — `setInterval` every 10 min
3. `startScreenshotSweeper()` — its own interval module
   (`lib/ada-audit/screenshot-sweeper.ts`, every 30 min + startup sweep)

These are invisible (no record of when they last ran or whether they failed),
unschedulable, and the Schedule table ships with zero real consumers — C2/D5
will build on machinery that has never run in production.

Separately: **terminal Job rows are never deleted.** Phase 3 creates one job
per audited page; this phase adds ~150 scheduled-job rows/day. Without
retention the Job table grows without bound.

## Goals

1. The three recurring tasks become seeded `Schedule` rows + thin job
   handlers; the `setInterval`s in `instrumentation.ts` (and the sweeper's
   interval module) are deleted.
2. Idempotent seeding primitive (`name`-keyed upsert) that C2/D5 can reuse.
3. Job-row retention as a new `runCleanup()` task.

## Non-goals

- No new user-facing schedules (C2/D5 own those).
- No admin UI (A4).
- The worker's own internals stay intervals: `pollTimer`, `sweepTimer`, and
  `scheduleTimer` in `worker.ts` are the engine that *runs* scheduled jobs —
  they cannot themselves be scheduled jobs.

## Design decisions (from the handoff's open questions)

- **Seeding identity:** add `name String? @unique` to `Schedule`. Nullable —
  future per-client schedules (C2/D5) may not need names; SQLite treats NULLs
  as distinct so the unique index only binds named rows. Lookup by `jobType`
  was rejected: C2 will create many schedules sharing one jobType.
- **`resetStaleAudits` becomes a scheduled job** (`every:10m`), not a kept
  interval. Rationale: it dogfoods the scheduler before C2/D5 depend on it,
  and its failure mode is acceptable — it is a safety net for *audit parents*,
  and if the worker/scheduler is wedged enough that scheduled jobs don't run,
  audits aren't progressing either; the next boot's `recoverQueue()` covers
  that case exactly as it does today.
- **Startup `runCleanup()` stays inline** in `instrumentation.ts`
  (fire-and-forget, as today). "Run at boot" isn't a cadence.
- **The sweeper's startup sweep is dropped.** Worst case a sweep happens
  within 30 min of boot (the seeded schedule's `nextRunAt` persists across
  restarts); screenshot deletion is not urgent.

## Schema

```prisma
model Schedule {
  // ... existing fields unchanged ...
  name String? @unique // stable identity for system schedules; NULL for ad-hoc/client schedules
}
```

Hand-written migration (local quirk: `prisma migrate diff` → write folder by
hand → `prisma migrate deploy` with `DATABASE_URL="file:./local-dev.db"`).
`ALTER TABLE ADD COLUMN` + `CREATE UNIQUE INDEX` — no backfill needed (table
is empty in production today).

## System schedules (`lib/jobs/system-schedules.ts`)

```ts
const SYSTEM_SCHEDULES = [
  { name: 'system-cleanup',           jobType: 'cleanup',           cadence: 'daily@09:00' },
  { name: 'system-screenshot-sweep',  jobType: 'screenshot-sweep',  cadence: 'every:30m' },
  { name: 'system-stale-audit-reset', jobType: 'stale-audit-reset', cadence: 'every:10m' },
]
```

- `daily@09:00` server-local (server runs UTC → overnight for US clients,
  off-peak). Replaces "every 24 h since boot" with a predictable slot; the
  inline startup run keeps the "cleanup soon after deploy" property.
- `seedSystemSchedules()` — for each entry, `prisma.schedule.upsert` by
  `name`:
  - **create:** `{ name, jobType, cadence, payload: '{}', enabled: true }`
    with `nextRunAt: now` for `system-screenshot-sweep` and
    `system-stale-audit-reset` (first deploy runs them almost immediately,
    doubling as a production smoke test of the scheduler) but
    `nextRunAt: nextRun(cadence, now)` for `system-cleanup` — the inline
    startup `runCleanup()` already covers "cleanup soon after deploy," and
    seeding it immediate would race two concurrent cleanups at first boot
    (idempotent but noisy with duplicate-delete warnings).
  - **update:** refresh `jobType` + `cadence` + `payload` + `enabled: true`
    (payload refresh keeps the primitive drift-free for C2/D5 reuse);
    recompute `nextRunAt = nextRun(cadence, now)` **only when the stored
    cadence differs** (otherwise preserve scheduling continuity across
    restarts).
- **`system-*` is a reserved, code-owned namespace.** The seed is the source
  of truth: a manual DB disable of a `system-*` row is temporary by design
  and gets re-enabled at next boot. An operator kill switch, if ever needed,
  is an env/config flag — not DB mutation.
- **Retired-schedule sweep:** after upserts, disable (`enabled: false`) any
  schedule whose `name` starts with `system-` and is not in the current
  list, **and cancel its queued jobs** (`updateMany` queued → cancelled by
  `scheduleId`). A renamed/removed system schedule must not keep enqueuing
  jobs no handler will claim — and its already-queued orphans would
  otherwise sit `queued` forever (retention never touches queued rows).

## Job handlers (`lib/jobs/handlers/`)

Three thin wrappers, registered in `register.ts`:

| File | type | concurrency | maxAttempts | timeoutMs | body |
|---|---|---|---|---|---|
| `cleanup.ts` | `cleanup` | 1 | 1 | 10 min | `await runCleanup()` |
| `screenshot-sweep.ts` | `screenshot-sweep` | 1 | 1 | 10 min | `await sweepExpiredScreenshots()` |
| `stale-audit-reset.ts` | `stale-audit-reset` | 1 | 1 | default (5 min) | `await resetStaleAudits()` |

- `maxAttempts: 1` — these are periodic; the next slot *is* the retry,
  matching today's interval semantics. A failed run leaves a visible
  `status='error'` Job row (introspection picks it up).
- No `onExhausted` — there is no domain state to settle; the task simply runs
  again next slot.
- House pattern holds: the bodies already swallow per-item domain failures
  internally (`Promise.allSettled` in `runCleanup`, per-directory try/catch in
  the sweeper, per-audit handling in `resetStaleAudits`); an actual throw is
  unexpected (DB down, FS error) and correctly fails the job.
- Handlers ignore `ctx.signal` (the bodies are loops of small idempotent
  deletes/updates); a timeout zombie finishing late is harmless.
- `cleanup` and `screenshot-sweep` get 10 min because both walk the
  filesystem (180-day session dirs; one DB lookup per screenshot dir) and
  can be slow on the VPS.

## Job-row retention (new task in `runCleanup()`)

`cleanOldTerminalJobs()` added to the `Promise.allSettled` list:

- `status IN ('complete','cancelled') AND updatedAt < now − 7 days` → delete
- `status = 'error' AND updatedAt < now − 30 days` → delete (errors kept
  longer for debugging; `getJobQueueState()` surfaces recent failures)
- `updatedAt`-based because `completedAt` is not set on every terminal path
  (e.g. cancellation). Queued/running rows are never touched.
- **Slot-record guard:** scheduled jobs double as the durable
  exactly-once-per-slot record (`@@unique([scheduleId, scheduledFor])`).
  Retention must never delete (a) a job referenced by any
  `Schedule.lastJobId`, or (b) a job whose `(scheduleId, scheduledFor)`
  matches its schedule's **current** `nextRunAt` — a stuck/unadvanced
  schedule would otherwise lose its slot record and re-run the slot.
  Implemented as raw-SQL `DELETE … WHERE … AND id NOT IN (SELECT lastJobId
  FROM Schedule WHERE lastJobId IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM
  Schedule s WHERE s.id = Job.scheduleId AND s.nextRunAt =
  Job.scheduledFor)` (house style: conditional logic in SQL, no interactive
  transactions).

## Wiring (`instrumentation.ts`)

Boot order gains one step (seed needs the DB, must precede the first tick):

1. `registerBuiltInJobHandlers()`
2. `await recoverJobsOnStartup()`
3. `await recoverQueue()`
4. `await seedSystemSchedules()`
5. `await startJobWorker()` — first `tickSchedules()` sees the seeded rows

Deleted: `cleanupInterval`, `staleCheckInterval`, the
`startScreenshotSweeper`/`stopScreenshotSweeper` import + calls, and the
corresponding `clearInterval`s in `shutdown()`. Kept: the inline
`void runCleanup()` at startup.

`lib/ada-audit/screenshot-sweeper.ts` keeps `sweepExpiredScreenshots()` and
loses `startScreenshotSweeper`/`stopScreenshotSweeper` (+ their tests).

## Testing

Existing pattern: vitest, real Prisma on the shared dev DB, no auto-started
worker; drive `tickSchedules()` directly. Test cleanup deletes
`type startsWith 'test-'` rows **and** the real system rows these tests
create (`name startsWith 'system-'` — same global-state discipline as the
one-active-guard neutralization in `queue-manager.test.ts`).

- `system-schedules.test.ts` — seed creates all three rows (`nextRunAt ≈
  now` for sweep/stale-reset, `nextRun(cadence, now)` for cleanup); re-seed
  is idempotent (no dupes, `nextRunAt` preserved when cadence unchanged);
  cadence change recomputes `nextRunAt`; payload refresh on update; re-seed
  re-enables a manually disabled row; retired `system-*` rows get disabled
  **and their queued jobs cancelled** (running/terminal jobs untouched);
  a NULL-name schedule is untouched by the sweep.
- `handlers/cleanup.test.ts` / `screenshot-sweep.test.ts` /
  `stale-audit-reset.test.ts` — registration config (type, concurrency 1,
  maxAttempts 1) and delegation to the underlying function (vi.mock the
  domain module); handler resolves when the body resolves, throws when it
  throws.
- `lib/jobs/retention.test.ts` (real-DB, jobs-test style — not the
  mock-based `lib/cleanup.test.ts`) — `cleanOldTerminalJobs()`: deletes old
  complete/cancelled, keeps young ones, keeps errors < 30 d, deletes errors
  > 30 d, never touches queued/running; **slot-record guard:** keeps an old
  terminal job referenced by `Schedule.lastJobId`, and keeps one whose
  `(scheduleId, scheduledFor)` matches its schedule's current `nextRunAt`.
- Integration (in `system-schedules.test.ts`): after seeding,
  `tickSchedules()` enqueues one job per due system schedule with the right
  `type` and `scheduleId`.

## Risks

- **Scheduler wedge disables the stale-audit safety net** — accepted (see
  design decisions); boot-time `recoverQueue()` remains the backstop.
- **Unclaimed-job buildup from retired schedules** — closed by the
  retired-schedule sweep (disable + cancel queued orphans).
- **Behavior change:** cleanup moves from "24 h after boot" to a fixed daily
  slot, and the screenshot sweep loses its boot-time run. Both are
  retention-window tasks where ±hours don't matter.
