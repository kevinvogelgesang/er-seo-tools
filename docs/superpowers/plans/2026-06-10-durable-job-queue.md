# Durable Job Queue + Schedule Table — Implementation Plan (Phases 0–1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the SQLite-backed durable job queue + Schedule table (spec: `docs/superpowers/specs/2026-06-10-durable-job-queue-design.md`) and migrate PSI work onto it behind the `JOB_QUEUE_PSI` flag.

**Architecture:** A `Job` table claimed via conditional `updateMany` with an attempt-fence on every heartbeat/settle write, executed by an in-process worker loop with type-keyed concurrency, per-type timeout + AbortSignal, exponential backoff, and `onExhausted` domain hooks. A `Schedule` table + 60 s tick enqueues due jobs with durable exactly-once-per-slot uniqueness. Phase 1 routes PSI jobs through the queue behind a flag and teaches `recoverQueue`/`resetStaleAudits` to let `lighthouse-running` parents survive restarts when durable PSI jobs are outstanding.

**Tech Stack:** Next.js 15, Prisma + SQLite (WAL), vitest (real Prisma against the shared dev DB, `fileParallelism: false`), single PM2 process.

**Conventions that apply to every task:**
- Run tests with `npx vitest run <file>` from the repo root.
- All new test data uses `test-`-prefixed job types / `jobs-test-` URL+domain prefixes so cleanup `deleteMany` calls can't touch real rows.
- Never hold a Prisma transaction across handler execution.
- Commit after every task.

---

### Task 1: Schema — `Job` + `Schedule` models, partial unique index

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_job_queue_and_schedule/migration.sql` (generated, then hand-edited)

- [ ] **Step 1: Add models to `prisma/schema.prisma`**

Append at the end of the file:

```prisma
model Job {
  id           String    @id @default(cuid())
  type         String    // 'psi' | (later: 'pdf-scan' | 'site-audit-page' | 'cleanup')
  payload      String    @default("{}") // JSON string
  status       String    @default("queued") // queued | running | complete | error | cancelled
  priority     Int       @default(0)    // higher claims first within a type
  attempts     Int       @default(0)    // incremented at claim time; doubles as the fencing token
  maxAttempts  Int       @default(3)
  runAfter     DateTime  @default(now())
  heartbeatAt  DateTime?
  startedAt    DateTime?
  completedAt  DateTime?
  lastError    String?
  dedupKey     String?   // active-window idempotency key (partial unique index, see migration)
  groupKey     String?   // owner linkage, e.g. 'site-audit:<id>'
  scheduleId   String?   // set when enqueued by the scheduler tick
  scheduledFor DateTime? // the Schedule.nextRunAt slot that produced this job
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  @@unique([scheduleId, scheduledFor]) // durable exactly-once-per-slot (NULLs exempt in SQLite)
  @@index([status, runAfter])
  @@index([type, status])
  @@index([groupKey, status])
  @@index([createdAt])
}

model Schedule {
  id        String    @id @default(cuid())
  jobType   String
  payload   String    @default("{}")
  cadence   String    // 'every:<n>m|h|d' | 'daily@HH:MM' | 'weekly:<0-6>@HH:MM' (server-local)
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

And add the back-relation to the `Client` model (after `siteAudits SiteAudit[]`):

```prisma
  schedules             Schedule[]
```

- [ ] **Step 2: Generate the migration WITHOUT applying it**

Run: `npx prisma migrate dev --create-only --name job_queue_and_schedule`
Expected: a new folder `prisma/migrations/<timestamp>_job_queue_and_schedule/` containing `migration.sql` with `CREATE TABLE "Job"`, `CREATE TABLE "Schedule"`, and the unique/regular indexes.

- [ ] **Step 3: Hand-append the partial unique index to the generated `migration.sql`**

Same precedent as `audit_batches_one_open` in `prisma/migrations/20260513213622_add_audit_batches/migration.sql`. Append:

```sql
-- Active-window dedup: at most one queued/running job per (type, dedupKey).
-- Partial indexes aren't expressible in the Prisma schema; SQLite unique
-- violations on this index still surface as Prisma P2002.
CREATE UNIQUE INDEX "jobs_active_dedup" ON "Job"("type", "dedupKey")
WHERE "dedupKey" IS NOT NULL AND "status" IN ('queued', 'running');
```

- [ ] **Step 4: Apply the migration + regenerate the client**

Run: `npx prisma migrate dev`
Expected: migration applied, client regenerated, no drift warnings.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(jobs): Job + Schedule tables with active-window dedup index"
```

---

### Task 2: `lib/jobs/types.ts` + `lib/jobs/config.ts`

**Files:**
- Create: `lib/jobs/types.ts`
- Create: `lib/jobs/config.ts`

No tests — pure types and a tiny env helper (the helper's behavior is exercised by every later test file).

- [ ] **Step 1: Create `lib/jobs/types.ts`**

```ts
// lib/jobs/types.ts
//
// Shared types for the durable job queue. See
// docs/superpowers/specs/2026-06-10-durable-job-queue-design.md.

export const JOB_ACTIVE_STATUSES = ['queued', 'running'] as const

export type JobStatus = 'queued' | 'running' | 'complete' | 'error' | 'cancelled'

export interface JobHandlerContext {
  jobId: string
  attempt: number
  signal: AbortSignal
}

export interface JobExhaustedContext {
  jobId: string
  attempts: number
  lastError: string
}

export interface JobHandlerConfig {
  type: string
  /** Max simultaneously running jobs of this type (in-process slots). */
  concurrency: number
  /** Total starts before the job is failed. Default 3. */
  maxAttempts?: number
  /** Backoff: delay = backoffBaseMs * 2^(attempt-1), capped at 15 min. Default 30s. */
  backoffBaseMs?: number
  /** Hard runtime cap; the worker aborts ctx.signal and settles as a throw. Default 5 min. */
  timeoutMs?: number
  handler: (payload: unknown, ctx: JobHandlerContext) => Promise<void>
  /**
   * Domain settle for terminal job failure. Invoked (best-effort) from EVERY
   * path that flips a job to status='error': final-attempt settle, stale
   * sweep exhaustion, and startup-recovery exhaustion.
   */
  onExhausted?: (payload: unknown, ctx: JobExhaustedContext) => Promise<void>
}

/** JobHandlerConfig with all optional knobs resolved. */
export interface ResolvedJobHandlerConfig extends JobHandlerConfig {
  maxAttempts: number
  backoffBaseMs: number
  timeoutMs: number
}

export interface EnqueueJobOptions {
  type: string
  payload?: unknown
  dedupKey?: string
  groupKey?: string
  priority?: number
  runAfter?: Date
  maxAttempts?: number
  scheduleId?: string
  scheduledFor?: Date
}

export interface EnqueueJobResult {
  id: string
  deduped: boolean
}
```

- [ ] **Step 2: Create `lib/jobs/config.ts`**

```ts
// lib/jobs/config.ts

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const DEFAULT_MAX_ATTEMPTS = 3
export const DEFAULT_BACKOFF_BASE_MS = 30_000
export const BACKOFF_CAP_MS = 15 * 60 * 1000
export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
export const HEARTBEAT_MS = 15_000
export const STALE_HEARTBEAT_MS = 2 * 60 * 1000

export function jobPollMs(): number {
  return parsePositiveInt(process.env.JOB_POLL_MS, 5_000)
}

export function jobStaleSweepMs(): number {
  return parsePositiveInt(process.env.JOB_STALE_SWEEP_MS, 60_000)
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add lib/jobs/types.ts lib/jobs/config.ts
git commit -m "feat(jobs): job queue types + config helpers"
```

---

### Task 3: `lib/jobs/registry.ts` — handler registration + `runOnExhausted`

**Files:**
- Create: `lib/jobs/registry.ts`
- Test: `lib/jobs/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/jobs/registry.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  registerJobHandler,
  getJobHandler,
  listJobTypes,
  clearJobRegistryForTests,
  runOnExhausted,
} from './registry'

describe('jobs/registry', () => {
  beforeEach(() => clearJobRegistryForTests())

  it('applies defaults and resolves a registered handler', () => {
    registerJobHandler({ type: 'test-reg', concurrency: 2, handler: async () => {} })
    const cfg = getJobHandler('test-reg')
    expect(cfg).toBeDefined()
    expect(cfg?.concurrency).toBe(2)
    expect(cfg?.maxAttempts).toBe(3)
    expect(cfg?.backoffBaseMs).toBe(30_000)
    expect(cfg?.timeoutMs).toBe(5 * 60 * 1000)
    expect(listJobTypes()).toEqual(['test-reg'])
  })

  it('re-registration overwrites (idempotent startup)', () => {
    registerJobHandler({ type: 'test-reg', concurrency: 1, handler: async () => {} })
    registerJobHandler({ type: 'test-reg', concurrency: 4, handler: async () => {} })
    expect(getJobHandler('test-reg')?.concurrency).toBe(4)
    expect(listJobTypes()).toEqual(['test-reg'])
  })

  it('runOnExhausted parses payload and calls the hook', async () => {
    const onExhausted = vi.fn(async () => {})
    registerJobHandler({ type: 'test-ex', concurrency: 1, handler: async () => {}, onExhausted })
    await runOnExhausted('test-ex', '{"a":1}', 'job-1', 2, 'boom')
    expect(onExhausted).toHaveBeenCalledWith({ a: 1 }, { jobId: 'job-1', attempts: 2, lastError: 'boom' })
  })

  it('runOnExhausted is a no-op without a hook and swallows hook errors', async () => {
    registerJobHandler({ type: 'test-noop', concurrency: 1, handler: async () => {} })
    await expect(runOnExhausted('test-noop', '{}', 'j', 1, 'x')).resolves.toBeUndefined()
    registerJobHandler({
      type: 'test-throws', concurrency: 1, handler: async () => {},
      onExhausted: async () => { throw new Error('hook failed') },
    })
    await expect(runOnExhausted('test-throws', 'not-json', 'j', 1, 'x')).resolves.toBeUndefined()
    await expect(runOnExhausted('test-unknown-type', '{}', 'j', 1, 'x')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/jobs/registry.test.ts`
Expected: FAIL — cannot resolve `./registry`.

- [ ] **Step 3: Implement `lib/jobs/registry.ts`**

```ts
// lib/jobs/registry.ts
//
// In-process handler registry for the durable job queue. Handlers are
// registered at worker startup; the registry is module-level state, which is
// correct under the single-process PM2 assumption.

import {
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
} from './config'
import type { JobHandlerConfig, ResolvedJobHandlerConfig } from './types'

const registry = new Map<string, ResolvedJobHandlerConfig>()

export function registerJobHandler(config: JobHandlerConfig): void {
  registry.set(config.type, {
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    backoffBaseMs: DEFAULT_BACKOFF_BASE_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    ...config,
  })
}

export function getJobHandler(type: string): ResolvedJobHandlerConfig | undefined {
  return registry.get(type)
}

export function listJobTypes(): string[] {
  return [...registry.keys()]
}

export function clearJobRegistryForTests(): void {
  registry.clear()
}

/**
 * Invoke the type's onExhausted hook (if any). Best-effort: hook errors are
 * logged, never thrown — callers are settle/recovery paths that must finish.
 * Called from EVERY path that flips a job to terminal 'error'.
 *
 * KNOWN FALLBACK: if the hook itself fails, the domain settle is lost and the
 * owning entity (e.g. a lighthouse-running SiteAudit) is eventually cleaned
 * up by its parent-level stale-failure path (resetStaleAudits). Acceptable
 * for Phase 1; revisit if a job type ever needs a guaranteed domain settle.
 */
export async function runOnExhausted(
  type: string,
  payloadJson: string,
  jobId: string,
  attempts: number,
  lastError: string,
): Promise<void> {
  const cfg = registry.get(type)
  if (!cfg?.onExhausted) return
  let payload: unknown = null
  try {
    payload = JSON.parse(payloadJson)
  } catch {
    // hook still runs; it must tolerate null payload
  }
  try {
    await cfg.onExhausted(payload, { jobId, attempts, lastError })
  } catch (err) {
    console.warn(`[jobs] onExhausted hook for type=${type} job=${jobId} failed:`, (err as Error).message)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/jobs/registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/registry.ts lib/jobs/registry.test.ts
git commit -m "feat(jobs): handler registry with defaults + onExhausted dispatch"
```

---

### Task 4: `lib/jobs/queue.ts` — enqueue with total dedup-race handling, group helpers

**Files:**
- Create: `lib/jobs/queue.ts`
- Test: `lib/jobs/queue.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/jobs/queue.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { enqueueJob, cancelJobsByGroup, countActiveJobsByGroup } from './queue'

async function clearTestJobs() {
  await prisma.job.deleteMany({ where: { type: { startsWith: 'test-' } } })
}

describe('jobs/queue', () => {
  beforeEach(clearTestJobs)

  it('enqueues a job with payload, group, priority, runAfter', async () => {
    const runAfter = new Date(Date.now() + 60_000)
    const res = await enqueueJob({
      type: 'test-q', payload: { a: 1 }, groupKey: 'g1', priority: 5, runAfter, maxAttempts: 7,
    })
    expect(res.deduped).toBe(false)
    const row = await prisma.job.findUnique({ where: { id: res.id } })
    expect(row?.status).toBe('queued')
    expect(JSON.parse(row!.payload)).toEqual({ a: 1 })
    expect(row?.groupKey).toBe('g1')
    expect(row?.priority).toBe(5)
    expect(row?.maxAttempts).toBe(7)
    expect(row?.runAfter.getTime()).toBe(runAfter.getTime())
  })

  it('dedups an active job by (type, dedupKey)', async () => {
    const first = await enqueueJob({ type: 'test-q', dedupKey: 'k1' })
    const second = await enqueueJob({ type: 'test-q', dedupKey: 'k1' })
    expect(second).toEqual({ id: first.id, deduped: true })
    expect(await prisma.job.count({ where: { type: 'test-q' } })).toBe(1)
  })

  it('dedup window reopens after terminal status', async () => {
    const first = await enqueueJob({ type: 'test-q', dedupKey: 'k1' })
    await prisma.job.update({ where: { id: first.id }, data: { status: 'complete' } })
    const second = await enqueueJob({ type: 'test-q', dedupKey: 'k1' })
    expect(second.deduped).toBe(false)
    expect(second.id).not.toBe(first.id)
  })

  it('running jobs still dedup (active window covers queued + running)', async () => {
    const first = await enqueueJob({ type: 'test-q', dedupKey: 'k1' })
    await prisma.job.update({ where: { id: first.id }, data: { status: 'running' } })
    const second = await enqueueJob({ type: 'test-q', dedupKey: 'k1' })
    expect(second).toEqual({ id: first.id, deduped: true })
  })

  it('scheduled slot uniqueness survives terminal status', async () => {
    const slot = new Date('2026-06-10T03:00:00Z')
    const first = await enqueueJob({ type: 'test-q', scheduleId: 'sch1', scheduledFor: slot })
    await prisma.job.update({ where: { id: first.id }, data: { status: 'complete' } })
    const replay = await enqueueJob({ type: 'test-q', scheduleId: 'sch1', scheduledFor: slot })
    expect(replay).toEqual({ id: first.id, deduped: true })
    expect(await prisma.job.count({ where: { scheduleId: 'sch1' } })).toBe(1)
  })

  it('cancelJobsByGroup cancels queued rows only', async () => {
    const q = await enqueueJob({ type: 'test-q', groupKey: 'g2' })
    const r = await enqueueJob({ type: 'test-q', groupKey: 'g2', dedupKey: 'distinct' })
    await prisma.job.update({ where: { id: r.id }, data: { status: 'running' } })
    const count = await cancelJobsByGroup('g2')
    expect(count).toBe(1)
    expect((await prisma.job.findUnique({ where: { id: q.id } }))?.status).toBe('cancelled')
    expect((await prisma.job.findUnique({ where: { id: r.id } }))?.status).toBe('running')
  })

  it('countActiveJobsByGroup counts queued+running incl. backoff-delayed, excludes terminal', async () => {
    await enqueueJob({ type: 'test-q', groupKey: 'g3', runAfter: new Date(Date.now() + 3_600_000) })
    const r = await enqueueJob({ type: 'test-q', groupKey: 'g3', dedupKey: 'r' })
    await prisma.job.update({ where: { id: r.id }, data: { status: 'running' } })
    const done = await enqueueJob({ type: 'test-q', groupKey: 'g3', dedupKey: 'done' })
    await prisma.job.update({ where: { id: done.id }, data: { status: 'error' } })
    expect(await countActiveJobsByGroup('g3')).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/jobs/queue.test.ts`
Expected: FAIL — cannot resolve `./queue`.

- [ ] **Step 3: Implement `lib/jobs/queue.ts`**

```ts
// lib/jobs/queue.ts
//
// Enqueue + group helpers for the durable job queue.
//
// Dedup is active-window only (partial unique index jobs_active_dedup on
// (type, dedupKey) WHERE status IN ('queued','running')). Scheduled jobs
// additionally carry (scheduleId, scheduledFor) under a real unique index
// that survives terminal status — exactly-once-per-slot.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { JOB_ACTIVE_STATUSES } from './types'
import type { EnqueueJobOptions, EnqueueJobResult } from './types'

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export async function enqueueJob(opts: EnqueueJobOptions): Promise<EnqueueJobResult> {
  const data = {
    type: opts.type,
    payload: JSON.stringify(opts.payload ?? {}),
    dedupKey: opts.dedupKey ?? null,
    groupKey: opts.groupKey ?? null,
    priority: opts.priority ?? 0,
    runAfter: opts.runAfter ?? new Date(),
    ...(opts.maxAttempts !== undefined ? { maxAttempts: opts.maxAttempts } : {}),
    scheduleId: opts.scheduleId ?? null,
    scheduledFor: opts.scheduledFor ?? null,
  }

  // Total dedup-race handling: P2002 → look up the twin; if the twin went
  // terminal between our create and the lookup (active-window row vanished),
  // retry the create once. Never assume P2002 leaves an active row visible.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const job = await prisma.job.create({ data })
      kickWorkerSoon()
      return { id: job.id, deduped: false }
    } catch (err) {
      if (!isUniqueViolation(err)) throw err

      if (opts.scheduleId && opts.scheduledFor) {
        // Durable slot index — the twin exists regardless of status.
        const slotTwin = await prisma.job.findFirst({
          where: { scheduleId: opts.scheduleId, scheduledFor: opts.scheduledFor },
          select: { id: true },
        })
        if (slotTwin) return { id: slotTwin.id, deduped: true }
      }

      if (opts.dedupKey) {
        const activeTwin = await prisma.job.findFirst({
          where: { type: opts.type, dedupKey: opts.dedupKey, status: { in: [...JOB_ACTIVE_STATUSES] } },
          select: { id: true },
        })
        if (activeTwin) return { id: activeTwin.id, deduped: true }
        continue // twin went terminal — retry the create once
      }

      throw err
    }
  }
  throw new Error(`enqueueJob: dedup race did not settle for type=${opts.type} dedupKey=${opts.dedupKey}`)
}

/** Cancel queued jobs for a group. Running jobs finish; their fenced/conditional writes no-op if the owner is gone. */
export async function cancelJobsByGroup(groupKey: string): Promise<number> {
  const res = await prisma.job.updateMany({
    where: { groupKey, status: 'queued' },
    data: { status: 'cancelled', completedAt: new Date() },
  })
  return res.count
}

/**
 * Outstanding (queued + running) jobs for a group — IGNORING runAfter, so
 * backoff-delayed jobs still count. Recovery uses this to decide whether a
 * parent is still being drained. Never counts terminal rows.
 */
export async function countActiveJobsByGroup(groupKey: string): Promise<number> {
  return prisma.job.count({
    where: { groupKey, status: { in: [...JOB_ACTIVE_STATUSES] } },
  })
}

// Dynamic import: avoids a static queue → worker edge (worker dynamically
// imports handlers, which import modules that import this file).
function kickWorkerSoon(): void {
  void import('./worker')
    .then((w) => w.kickJobWorker())
    .catch(() => {})
}
```

- [ ] **Step 4: Run tests — they still fail on the missing worker module**

`kickWorkerSoon` swallows the import failure, so tests pass even before Task 5 exists.

Run: `npx vitest run lib/jobs/queue.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/queue.ts lib/jobs/queue.test.ts
git commit -m "feat(jobs): enqueue with total dedup-race handling + group helpers"
```

---

### Task 5: `lib/jobs/worker.ts` — claim, fence, heartbeat, timeout, settle

**Files:**
- Create: `lib/jobs/worker.ts`
- Create: `lib/jobs/recovery.ts` (stub — replaced in Task 6)
- Create: `lib/jobs/scheduler.ts` (stub — replaced in Task 7)
- Create: `lib/jobs/handlers/register.ts` (stub — completed in Task 9)
- Test: `lib/jobs/worker.test.ts`

- [ ] **Step 0: Create three stubs so every task commits typecheck-green**

`worker.ts` dynamically imports these modules, and TypeScript resolves dynamic import paths statically — so they must exist now. Each stub is replaced/completed by its own later task.

```ts
// lib/jobs/recovery.ts — STUB, replaced in Task 6
export async function recoverJobsOnStartup(): Promise<void> {}
export async function sweepStaleJobs(): Promise<void> {}
```

```ts
// lib/jobs/scheduler.ts — STUB, replaced in Task 7
export async function tickSchedules(): Promise<void> {}
```

```ts
// lib/jobs/handlers/register.ts — STUB, completed in Task 9
//
// Single registration point for built-in job handlers. Idempotent —
// instrumentation calls it BEFORE startup recovery (recoverJobsOnStartup may
// run onExhausted hooks, which need a populated registry) and startJobWorker
// calls it again (harmless re-register).
export function registerBuiltInJobHandlers(): void {}
```

- [ ] **Step 1: Write the failing tests**

```ts
// lib/jobs/worker.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { registerJobHandler, clearJobRegistryForTests } from './registry'
import { enqueueJob } from './queue'
import { runWorkerTickOnce, getActiveJobCounts, resetWorkerForTests, backoffMs } from './worker'

async function clearTestJobs() {
  await prisma.job.deleteMany({ where: { type: { startsWith: 'test-' } } })
}

function deferred() {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function waitFor(predicate: () => Promise<boolean>, tries = 40): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await predicate()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('waitFor timed out')
}

describe('jobs/worker', () => {
  beforeEach(async () => {
    clearJobRegistryForTests()
    resetWorkerForTests()
    await clearTestJobs()
  })

  it('backoffMs doubles per attempt and caps at 15 min', () => {
    expect(backoffMs(30_000, 1)).toBe(30_000)
    expect(backoffMs(30_000, 2)).toBe(60_000)
    expect(backoffMs(30_000, 3)).toBe(120_000)
    expect(backoffMs(30_000, 20)).toBe(15 * 60 * 1000)
  })

  it('claims and completes a job; attempts increments at claim time', async () => {
    const handler = vi.fn(async () => {})
    registerJobHandler({ type: 'test-w', concurrency: 1, handler })
    const { id } = await enqueueJob({ type: 'test-w', payload: { n: 1 } })
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.status === 'complete')
    const row = await prisma.job.findUnique({ where: { id } })
    expect(row?.attempts).toBe(1)
    expect(row?.startedAt).not.toBeNull()
    expect(row?.completedAt).not.toBeNull()
    expect(handler).toHaveBeenCalledWith({ n: 1 }, expect.objectContaining({ jobId: id, attempt: 1 }))
  })

  it('respects type-keyed concurrency', async () => {
    const gates = [deferred(), deferred(), deferred()]
    let started = 0
    registerJobHandler({
      type: 'test-w', concurrency: 2,
      handler: async () => { await gates[started++].promise },
    })
    await Promise.all([1, 2, 3].map(() => enqueueJob({ type: 'test-w' })))
    await runWorkerTickOnce()
    await waitFor(async () => getActiveJobCounts()['test-w'] === 2)
    expect(started).toBe(2)
    expect(await prisma.job.count({ where: { type: 'test-w', status: 'running' } })).toBe(2)
    gates[0].resolve()
    await waitFor(async () => (await prisma.job.count({ where: { type: 'test-w', status: 'complete' } })) === 1)
    await runWorkerTickOnce() // backfill the freed slot
    await waitFor(async () => started === 3)
    gates[1].resolve(); gates[2].resolve()
    await waitFor(async () => (await prisma.job.count({ where: { type: 'test-w', status: 'complete' } })) === 3)
    expect(getActiveJobCounts()['test-w'] ?? 0).toBe(0)
  })

  it('does not claim jobs whose runAfter is in the future', async () => {
    registerJobHandler({ type: 'test-w', concurrency: 1, handler: vi.fn(async () => {}) })
    const { id } = await enqueueJob({ type: 'test-w', runAfter: new Date(Date.now() + 3_600_000) })
    await runWorkerTickOnce()
    await new Promise((r) => setTimeout(r, 50))
    expect((await prisma.job.findUnique({ where: { id } }))?.status).toBe('queued')
  })

  it('claims higher priority first', async () => {
    const order: number[] = []
    registerJobHandler({
      type: 'test-w', concurrency: 1,
      handler: async (payload) => { order.push((payload as { n: number }).n) },
    })
    await enqueueJob({ type: 'test-w', payload: { n: 1 }, priority: 0 })
    await enqueueJob({ type: 'test-w', payload: { n: 2 }, priority: 10 })
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.count({ where: { type: 'test-w', status: 'complete' } })) === 1)
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.count({ where: { type: 'test-w', status: 'complete' } })) === 2)
    expect(order).toEqual([2, 1])
  })

  it('throw → re-queued with backoff runAfter and lastError', async () => {
    registerJobHandler({
      type: 'test-w', concurrency: 1, backoffBaseMs: 30_000,
      handler: async () => { throw new Error('flaky') },
    })
    const { id } = await enqueueJob({ type: 'test-w' })
    const before = Date.now()
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.status === 'queued')
    const row = await prisma.job.findUnique({ where: { id } })
    expect(row?.attempts).toBe(1)
    expect(row?.lastError).toBe('flaky')
    expect(row!.runAfter.getTime()).toBeGreaterThanOrEqual(before + 30_000)
  })

  it('exhaustion → error + onExhausted with attempts and lastError', async () => {
    const onExhausted = vi.fn(async () => {})
    registerJobHandler({
      type: 'test-w', concurrency: 1, maxAttempts: 1,
      handler: async () => { throw new Error('fatal') },
      onExhausted,
    })
    const { id } = await enqueueJob({ type: 'test-w', payload: { x: 1 }, maxAttempts: 1 })
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.status === 'error')
    expect((await prisma.job.findUnique({ where: { id } }))?.lastError).toBe('fatal')
    expect(onExhausted).toHaveBeenCalledWith({ x: 1 }, { jobId: id, attempts: 1, lastError: 'fatal' })
  })

  it('timeout settles as a throw and aborts the handler signal', async () => {
    let seenSignal: AbortSignal | null = null
    registerJobHandler({
      type: 'test-w', concurrency: 1, timeoutMs: 50,
      handler: async (_p, ctx) => {
        seenSignal = ctx.signal
        await new Promise(() => {}) // hangs forever
      },
    })
    const { id } = await enqueueJob({ type: 'test-w' })
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.status === 'queued')
    const row = await prisma.job.findUnique({ where: { id } })
    expect(row?.lastError).toContain('timed out')
    expect(seenSignal!.aborted).toBe(true)
    expect(getActiveJobCounts()['test-w'] ?? 0).toBe(0) // wrapper settled despite hung promise
  })

  it('attempt fence: a superseded attempt cannot clobber the reclaimed job', async () => {
    const gate = deferred()
    registerJobHandler({
      type: 'test-w', concurrency: 1,
      handler: async () => { await gate.promise },
    })
    const { id } = await enqueueJob({ type: 'test-w' })
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.status === 'running')

    // Simulate stale sweep re-queue + reclaim by a new attempt:
    await prisma.job.update({ where: { id }, data: { status: 'queued' } })
    await prisma.job.update({ where: { id }, data: { status: 'running', attempts: 2 } })

    gate.resolve() // zombie attempt-1 settles with fence attempts=1 → must match 0 rows
    await new Promise((r) => setTimeout(r, 100))
    const row = await prisma.job.findUnique({ where: { id } })
    expect(row?.status).toBe('running') // untouched by the zombie's 'complete' write
    expect(row?.attempts).toBe(2)
  })

  it('reconcileActiveSets retires entries whose DB lease is gone', async () => {
    const gate = deferred()
    registerJobHandler({ type: 'test-w', concurrency: 1, handler: async () => { await gate.promise } })
    const { id } = await enqueueJob({ type: 'test-w' })
    await runWorkerTickOnce()
    await waitFor(async () => getActiveJobCounts()['test-w'] === 1)
    // Simulate a sweep re-queue: the lease (status/attempts) no longer matches.
    await prisma.job.update({ where: { id }, data: { status: 'queued' } })
    const { reconcileActiveSets } = await import('./worker')
    await reconcileActiveSets()
    expect(getActiveJobCounts()['test-w'] ?? 0).toBe(0)
    gate.resolve() // let the zombie wrapper settle; fenced writes no-op
  })

  it('marks a job with unparseable payload as failed, not crashed', async () => {
    registerJobHandler({ type: 'test-w', concurrency: 1, maxAttempts: 1, handler: vi.fn(async () => {}) })
    const { id } = await enqueueJob({ type: 'test-w', maxAttempts: 1 })
    await prisma.job.update({ where: { id }, data: { payload: '{not json' } })
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.status === 'error')
    expect((await prisma.job.findUnique({ where: { id } }))?.lastError).toContain('payload')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/jobs/worker.test.ts`
Expected: FAIL — cannot resolve `./worker`.

- [ ] **Step 3: Implement `lib/jobs/worker.ts`**

```ts
// lib/jobs/worker.ts
//
// The claim-execute-settle loop for the durable job queue.
//
// Invariants (see spec):
// - Claim is a conditional UPDATE ... WHERE status='queued'; the claimer
//   records claimedAttempt (attempts value it wrote) as a fencing token.
// - EVERY subsequent write for that execution (heartbeat + settle) is fenced:
//   WHERE id AND status='running' AND attempts=claimedAttempt. A fenced write
//   matching 0 rows means the lease was lost — discard silently.
// - Handlers run OUTSIDE any DB transaction, raced against timeoutMs so the
//   wrapper always settles even if the underlying promise hangs forever.
// - Active-slot bookkeeping is a per-type Map<jobId, claimedAttempt>; the
//   wrapper deletes its own entry idempotently AFTER the settle write, so a
//   poll/kick during settle can't overfill the type's concurrency.
// - Single-process assumption: concurrency accounting is in-memory. The
//   conditional claim keeps an accidental second process safe (just
//   over-concurrent), not corrupt.

import { prisma } from '@/lib/db'
import { BACKOFF_CAP_MS, HEARTBEAT_MS, jobPollMs, jobStaleSweepMs } from './config'
import { getJobHandler, listJobTypes, runOnExhausted } from './registry'
import type { ResolvedJobHandlerConfig } from './types'

interface ClaimedJob {
  id: string
  type: string
  payload: string
  attempts: number // post-claim value = the fencing token
  maxAttempts: number
}

const activeByType = new Map<string, Map<string, number>>()

let stopped = true
let ticking = false
let pollTimer: NodeJS.Timeout | null = null
let sweepTimer: NodeJS.Timeout | null = null
let scheduleTimer: NodeJS.Timeout | null = null

function activeSet(type: string): Map<string, number> {
  let set = activeByType.get(type)
  if (!set) {
    set = new Map()
    activeByType.set(type, set)
  }
  return set
}

export function getActiveJobCounts(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [type, set] of activeByType) counts[type] = set.size
  return counts
}

export function backoffMs(baseMs: number, attempt: number): number {
  return Math.min(baseMs * 2 ** (attempt - 1), BACKOFF_CAP_MS)
}

export function kickJobWorker(): void {
  if (stopped) return
  void runWorkerTickOnce()
}

/** One pass: for each registered type, claim jobs into free slots. Exported for tests. */
export async function runWorkerTickOnce(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    for (const type of listJobTypes()) {
      const cfg = getJobHandler(type)
      if (!cfg) continue
      while (activeSet(type).size < cfg.concurrency) {
        const claimed = await claimNext(type)
        if (!claimed) break
        activeSet(type).set(claimed.id, claimed.attempts)
        void executeJob(cfg, claimed)
      }
    }
  } catch (err) {
    console.error('[jobs] worker tick failed:', (err as Error).message)
  } finally {
    ticking = false
  }
}

async function claimNext(type: string): Promise<ClaimedJob | null> {
  for (;;) {
    const candidate = await prisma.job.findFirst({
      where: { type, status: 'queued', runAfter: { lte: new Date() } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, type: true, payload: true, attempts: true, maxAttempts: true },
    })
    if (!candidate) return null
    const res = await prisma.job.updateMany({
      where: { id: candidate.id, status: 'queued' },
      data: {
        status: 'running',
        attempts: { increment: 1 },
        startedAt: new Date(),
        heartbeatAt: new Date(),
      },
    })
    if (res.count === 1) {
      return { ...candidate, attempts: candidate.attempts + 1 }
    }
    // Lost the claim race (concurrent cancel or another claimer) — next candidate.
  }
}

async function executeJob(cfg: ResolvedJobHandlerConfig, job: ClaimedJob): Promise<void> {
  const fence = { id: job.id, status: 'running', attempts: job.attempts }
  const abort = new AbortController()
  const heartbeat = setInterval(() => {
    void prisma.job
      .updateMany({ where: fence, data: { heartbeatAt: new Date() } })
      .catch(() => {})
  }, HEARTBEAT_MS)

  let error: string | null = null
  try {
    try {
      let payload: unknown
      try {
        payload = JSON.parse(job.payload)
      } catch {
        throw new Error('Unparseable job payload')
      }
      await runWithTimeout(
        cfg.handler(payload, { jobId: job.id, attempt: job.attempts, signal: abort.signal }),
        cfg.timeoutMs,
        abort,
      )
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      clearInterval(heartbeat)
    }

    try {
      if (error === null) {
        await prisma.job.updateMany({
          where: fence,
          data: { status: 'complete', completedAt: new Date() },
        })
      } else if (job.attempts >= job.maxAttempts) {
        const res = await prisma.job.updateMany({
          where: fence,
          data: { status: 'error', lastError: error, completedAt: new Date() },
        })
        if (res.count === 1) {
          await runOnExhausted(job.type, job.payload, job.id, job.attempts, error)
        }
      } else {
        await prisma.job.updateMany({
          where: fence,
          data: {
            status: 'queued',
            lastError: error,
            runAfter: new Date(Date.now() + backoffMs(cfg.backoffBaseMs, job.attempts)),
            heartbeatAt: null,
          },
        })
      }
    } catch (err) {
      // Settle write failed (e.g. transient SQLITE_BUSY). The row stays
      // 'running' with a stale heartbeat; the stale sweep recovers it.
      console.warn(`[jobs] settle failed for job=${job.id}:`, (err as Error).message)
    }
  } finally {
    // Release the slot only AFTER settle so a concurrent poll/kick can't
    // overfill this type's concurrency during the settle window. Map delete
    // is idempotent — it can't double-fire into negative counts.
    activeSet(job.type).delete(job.id)
  }

  if (!stopped) void runWorkerTickOnce() // backfill the freed slot
}

/**
 * Race the handler against timeoutMs. On expiry: abort the signal and reject —
 * the wrapper settles even if the underlying promise never does. A zombie
 * promise that settles later is harmless: the attempt fence discards its
 * effects at the queue layer, and handler bodies are required to be idempotent
 * at the domain layer.
 */
function runWithTimeout(promise: Promise<void>, timeoutMs: number, abort: AbortController): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      abort.abort()
      reject(new Error(`Job timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    promise.then(
      () => { clearTimeout(timer); resolve() },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

/**
 * Defense-in-depth: drop in-memory active entries whose DB lease is gone
 * (row no longer running, or attempts moved past the recorded token).
 * Called by the stale sweep.
 */
export async function reconcileActiveSets(): Promise<void> {
  for (const [type, set] of activeByType) {
    for (const [jobId, claimedAttempt] of set) {
      const row = await prisma.job.findUnique({
        where: { id: jobId },
        select: { status: true, attempts: true },
      })
      if (!row || row.status !== 'running' || row.attempts !== claimedAttempt) {
        set.delete(jobId)
        console.warn(`[jobs] retired dead active-set entry type=${type} job=${jobId}`)
      }
    }
  }
}

export async function startJobWorker(): Promise<void> {
  if (!stopped) return
  stopped = false

  // Dynamic imports keep this module free of domain/scheduler edges
  // (queue.ts ← lighthouse-queue ← queue-manager would otherwise cycle).
  // Idempotent — instrumentation already registered handlers before startup
  // recovery; this covers any other caller.
  const { registerBuiltInJobHandlers } = await import('./handlers/register')
  registerBuiltInJobHandlers()

  const { sweepStaleJobs } = await import('./recovery')
  const { tickSchedules } = await import('./scheduler')

  pollTimer = setInterval(() => void runWorkerTickOnce(), jobPollMs())
  // Sweep BEFORE reconcile, sequentially: reconciliation frees in-memory
  // slots based on DB lease state, so it must observe the sweep's re-queues
  // in the same pass — racing them delays slot release by a full interval.
  sweepTimer = setInterval(() => {
    void (async () => {
      await sweepStaleJobs()
      await reconcileActiveSets()
    })().catch((err) => console.warn('[jobs] sweep pass failed:', (err as Error).message))
  }, jobStaleSweepMs())
  scheduleTimer = setInterval(() => void tickSchedules(), 60_000)

  void runWorkerTickOnce()
  void tickSchedules()
}

export async function stopJobWorker(): Promise<void> {
  stopped = true
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null }
  if (scheduleTimer) { clearInterval(scheduleTimer); scheduleTimer = null }
  // Short grace for in-flight handlers; anything unfinished is recovered as
  // 'running' → re-queued by recoverJobsOnStartup() on the next boot.
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    let active = 0
    for (const set of activeByType.values()) active += set.size
    if (active === 0) break
    await new Promise((r) => setTimeout(r, 100))
  }
}

export function resetWorkerForTests(): void {
  stopped = true
  ticking = false
  activeByType.clear()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/jobs/worker.test.ts`
Expected: PASS (11 tests). The Step 0 stubs keep `npx tsc --noEmit` green — run it to confirm.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/worker.ts lib/jobs/worker.test.ts lib/jobs/recovery.ts lib/jobs/scheduler.ts lib/jobs/handlers/register.ts
git commit -m "feat(jobs): worker loop with fenced claim/heartbeat/settle, timeout, backoff"
```

---

### Task 6: `lib/jobs/recovery.ts` — startup recovery + stale sweep

**Files:**
- Modify: `lib/jobs/recovery.ts` (replace the Task 5 stub)
- Test: `lib/jobs/recovery.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/jobs/recovery.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { registerJobHandler, clearJobRegistryForTests } from './registry'
import { recoverJobsOnStartup, sweepStaleJobs } from './recovery'

async function clearTestJobs() {
  await prisma.job.deleteMany({ where: { type: { startsWith: 'test-' } } })
}

describe('jobs/recovery', () => {
  beforeEach(async () => {
    clearJobRegistryForTests()
    await clearTestJobs()
  })

  it('startup re-queues running jobs with attempts left', async () => {
    const job = await prisma.job.create({
      data: { type: 'test-rec', status: 'running', attempts: 1, maxAttempts: 3, heartbeatAt: new Date() },
    })
    await recoverJobsOnStartup()
    const row = await prisma.job.findUnique({ where: { id: job.id } })
    expect(row?.status).toBe('queued')
    expect(row?.attempts).toBe(1) // next claim increments
    expect(row?.lastError).toContain('restart')
    expect(row?.heartbeatAt).toBeNull()
  })

  it('startup fails exhausted running jobs and fires onExhausted', async () => {
    const onExhausted = vi.fn(async () => {})
    registerJobHandler({ type: 'test-rec', concurrency: 1, handler: async () => {}, onExhausted })
    const job = await prisma.job.create({
      data: { type: 'test-rec', payload: '{"k":1}', status: 'running', attempts: 3, maxAttempts: 3 },
    })
    await recoverJobsOnStartup()
    expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe('error')
    expect(onExhausted).toHaveBeenCalledWith({ k: 1 }, expect.objectContaining({ jobId: job.id, attempts: 3 }))
  })

  it('startup leaves queued/terminal jobs alone', async () => {
    const q = await prisma.job.create({ data: { type: 'test-rec', status: 'queued' } })
    const c = await prisma.job.create({ data: { type: 'test-rec', status: 'complete' } })
    await recoverJobsOnStartup()
    expect((await prisma.job.findUnique({ where: { id: q.id } }))?.status).toBe('queued')
    expect((await prisma.job.findUnique({ where: { id: c.id } }))?.status).toBe('complete')
  })

  it('stale sweep recovers only stale-heartbeat running jobs', async () => {
    const stale = await prisma.job.create({
      data: { type: 'test-rec', status: 'running', attempts: 1, maxAttempts: 3, heartbeatAt: new Date(Date.now() - 3 * 60_000) },
    })
    const fresh = await prisma.job.create({
      data: { type: 'test-rec', status: 'running', attempts: 1, maxAttempts: 3, heartbeatAt: new Date() },
    })
    await sweepStaleJobs()
    expect((await prisma.job.findUnique({ where: { id: stale.id } }))?.status).toBe('queued')
    expect((await prisma.job.findUnique({ where: { id: fresh.id } }))?.status).toBe('running')
  })

  it('stale sweep fails exhausted jobs with onExhausted', async () => {
    const onExhausted = vi.fn(async () => {})
    registerJobHandler({ type: 'test-rec', concurrency: 1, handler: async () => {}, onExhausted })
    const stale = await prisma.job.create({
      data: { type: 'test-rec', status: 'running', attempts: 3, maxAttempts: 3, heartbeatAt: new Date(Date.now() - 3 * 60_000) },
    })
    await sweepStaleJobs()
    expect((await prisma.job.findUnique({ where: { id: stale.id } }))?.status).toBe('error')
    expect(onExhausted).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/jobs/recovery.test.ts`
Expected: FAIL — the stub no-ops, so every assertion about changed statuses fails.

- [ ] **Step 3: Replace the stub with the real `lib/jobs/recovery.ts`**

```ts
// lib/jobs/recovery.ts
//
// Generic job recovery — this is what replaces the bespoke
// resetStaleAudits/recoverQueue logic as job types migrate onto the queue.
//
// Both paths use the same fenced re-queue-or-fail: a job whose attempts are
// exhausted flips to 'error' (+ onExhausted domain settle); otherwise it goes
// back to 'queued' for the next claim. Writes are fenced on
// (status='running', attempts) so a live worker that settles concurrently
// wins — recovery never clobbers a settled job.

import { prisma } from '@/lib/db'
import { STALE_HEARTBEAT_MS } from './config'
import { runOnExhausted } from './registry'

interface RecoverableJob {
  id: string
  type: string
  payload: string
  attempts: number
  maxAttempts: number
}

/**
 * Startup pass — run BEFORE the worker starts and BEFORE recoverQueue()
 * (which decides parent-audit survival based on active jobs). Every
 * 'running' job is orphaned by definition: this is a fresh process.
 */
export async function recoverJobsOnStartup(): Promise<void> {
  const running = await prisma.job.findMany({
    where: { status: 'running' },
    select: { id: true, type: true, payload: true, attempts: true, maxAttempts: true },
  })
  for (const job of running) {
    await recoverOne(job, 'Job interrupted by restart')
  }
  if (running.length > 0) {
    console.warn(`[jobs] startup recovery handled ${running.length} orphaned running job(s)`)
  }
}

/** Periodic pass — recovers jobs whose heartbeat stopped (hung handler whose
 * timeout also failed to settle, or an event-loop stall). */
export async function sweepStaleJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_HEARTBEAT_MS)
  const stale = await prisma.job.findMany({
    where: { status: 'running', heartbeatAt: { lt: cutoff } },
    select: { id: true, type: true, payload: true, attempts: true, maxAttempts: true },
  })
  for (const job of stale) {
    console.warn(`[jobs] stale heartbeat on job=${job.id} type=${job.type}`)
    await recoverOne(job, 'Job heartbeat went stale (worker hung or process died)')
  }
}

async function recoverOne(job: RecoverableJob, reason: string): Promise<void> {
  const fence = { id: job.id, status: 'running', attempts: job.attempts }
  try {
    if (job.attempts >= job.maxAttempts) {
      const res = await prisma.job.updateMany({
        where: fence,
        data: { status: 'error', lastError: reason, completedAt: new Date() },
      })
      if (res.count === 1) {
        await runOnExhausted(job.type, job.payload, job.id, job.attempts, reason)
      }
    } else {
      await prisma.job.updateMany({
        where: fence,
        data: { status: 'queued', lastError: reason, runAfter: new Date(), heartbeatAt: null },
      })
    }
  } catch (err) {
    console.warn(`[jobs] recovery failed for job=${job.id}:`, (err as Error).message)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/jobs/recovery.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/recovery.ts lib/jobs/recovery.test.ts
git commit -m "feat(jobs): startup recovery + stale-heartbeat sweep with onExhausted"
```

---

### Task 7: `lib/jobs/scheduler.ts` — cadence parsing + tick

**Files:**
- Modify: `lib/jobs/scheduler.ts` (replace the Task 5 stub)
- Test: `lib/jobs/scheduler.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/jobs/scheduler.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { parseCadence, nextRun, tickSchedules } from './scheduler'

async function clearTestState() {
  await prisma.job.deleteMany({ where: { type: { startsWith: 'test-' } } })
  await prisma.schedule.deleteMany({ where: { jobType: { startsWith: 'test-' } } })
}

describe('jobs/scheduler', () => {
  beforeEach(clearTestState)

  describe('parseCadence', () => {
    it('accepts the grammar', () => {
      expect(parseCadence('every:30m')).toEqual({ kind: 'every', ms: 30 * 60_000 })
      expect(parseCadence('every:6h')).toEqual({ kind: 'every', ms: 6 * 3_600_000 })
      expect(parseCadence('every:1d')).toEqual({ kind: 'every', ms: 86_400_000 })
      expect(parseCadence('daily@03:30')).toEqual({ kind: 'daily', hour: 3, minute: 30 })
      expect(parseCadence('weekly:1@09:00')).toEqual({ kind: 'weekly', dow: 1, hour: 9, minute: 0 })
    })

    it('throws on garbage', () => {
      for (const bad of ['hourly', 'every:0m', 'every:5s', 'daily@25:00', 'daily@10:75', 'weekly:7@09:00', '']) {
        expect(() => parseCadence(bad), bad).toThrow()
      }
    })
  })

  describe('nextRun', () => {
    it('every: is pure ms arithmetic from `from`', () => {
      const from = new Date('2026-06-10T10:00:00')
      expect(nextRun('every:30m', from).getTime()).toBe(from.getTime() + 30 * 60_000)
    })

    it('daily: next occurrence strictly after `from`', () => {
      const before = new Date('2026-06-10T02:00:00')
      expect(nextRun('daily@03:30', before).toISOString()).toBe(new Date('2026-06-10T03:30:00').toISOString())
      const after = new Date('2026-06-10T04:00:00')
      expect(nextRun('daily@03:30', after).toISOString()).toBe(new Date('2026-06-11T03:30:00').toISOString())
    })

    it('weekly: next matching day-of-week strictly after `from`', () => {
      // 2026-06-10 is a Wednesday (dow 3)
      const wed = new Date('2026-06-10T10:00:00')
      const nextMon = nextRun('weekly:1@09:00', wed)
      expect(nextMon.getDay()).toBe(1)
      expect(nextMon.getTime()).toBeGreaterThan(wed.getTime())
      const sameDayLater = nextRun('weekly:3@23:00', wed)
      expect(sameDayLater.toISOString()).toBe(new Date('2026-06-10T23:00:00').toISOString())
    })
  })

  describe('tickSchedules', () => {
    it('enqueues due schedules with slot keys and advances nextRunAt', async () => {
      const due = new Date(Date.now() - 60_000)
      const sched = await prisma.schedule.create({
        data: { jobType: 'test-sched', payload: '{"d":1}', cadence: 'every:30m', nextRunAt: due },
      })
      await tickSchedules()
      const jobs = await prisma.job.findMany({ where: { scheduleId: sched.id } })
      expect(jobs).toHaveLength(1)
      expect(jobs[0].type).toBe('test-sched')
      expect(JSON.parse(jobs[0].payload)).toEqual({ d: 1 })
      expect(jobs[0].scheduledFor!.getTime()).toBe(due.getTime())
      expect(jobs[0].groupKey).toBe(`schedule:${sched.id}`)
      const fresh = await prisma.schedule.findUnique({ where: { id: sched.id } })
      expect(fresh!.nextRunAt.getTime()).toBeGreaterThan(Date.now())
      expect(fresh!.lastJobId).toBe(jobs[0].id)
      expect(fresh!.lastRunAt).not.toBeNull()
    })

    it('skips disabled and not-yet-due schedules', async () => {
      await prisma.schedule.create({
        data: { jobType: 'test-sched', cadence: 'every:30m', nextRunAt: new Date(Date.now() - 60_000), enabled: false },
      })
      await prisma.schedule.create({
        data: { jobType: 'test-sched', cadence: 'every:30m', nextRunAt: new Date(Date.now() + 3_600_000) },
      })
      await tickSchedules()
      expect(await prisma.job.count({ where: { type: 'test-sched' } })).toBe(0)
    })

    it('crash-replay of a slot is exactly-once even when the first job completed', async () => {
      const slot = new Date(Date.now() - 60_000)
      const sched = await prisma.schedule.create({
        data: { jobType: 'test-sched', cadence: 'every:30m', nextRunAt: slot },
      })
      // Simulate: previous tick enqueued the slot, job completed, then the
      // process died BEFORE nextRunAt was advanced.
      const orphan = await prisma.job.create({
        data: { type: 'test-sched', status: 'complete', scheduleId: sched.id, scheduledFor: slot },
      })
      await tickSchedules()
      expect(await prisma.job.count({ where: { scheduleId: sched.id } })).toBe(1) // no duplicate
      const fresh = await prisma.schedule.findUnique({ where: { id: sched.id } })
      expect(fresh!.nextRunAt.getTime()).toBeGreaterThan(slot.getTime()) // still advanced
      expect(fresh!.lastJobId).toBe(orphan.id)
    })

    it('missed slots collapse to a single future run (advance from now, not the slot)', async () => {
      const longAgo = new Date(Date.now() - 7 * 86_400_000)
      const sched = await prisma.schedule.create({
        data: { jobType: 'test-sched', cadence: 'every:1d', nextRunAt: longAgo },
      })
      await tickSchedules()
      expect(await prisma.job.count({ where: { scheduleId: sched.id } })).toBe(1)
      const fresh = await prisma.schedule.findUnique({ where: { id: sched.id } })
      expect(fresh!.nextRunAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('concurrent ticks produce one job and one advance', async () => {
      const sched = await prisma.schedule.create({
        data: { jobType: 'test-sched', cadence: 'every:30m', nextRunAt: new Date(Date.now() - 60_000) },
      })
      await Promise.all([tickSchedules(), tickSchedules()])
      expect(await prisma.job.count({ where: { scheduleId: sched.id } })).toBe(1)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/jobs/scheduler.test.ts`
Expected: FAIL — the stub exports only a no-op `tickSchedules`; `parseCadence`/`nextRun` don't resolve and the tick assertions fail.

- [ ] **Step 3: Replace the stub with the real `lib/jobs/scheduler.ts`**

```ts
// lib/jobs/scheduler.ts
//
// Schedule tick: enqueue due jobs, advance nextRunAt.
//
// Exactly-once-per-slot comes from Job's durable @@unique([scheduleId,
// scheduledFor]) — NOT the active-window dedupKey, which a completed job
// exits. A crash between enqueue and advance replays the same slot on the
// next tick, hits the unique index, and is treated as already-enqueued.
//
// Missed slots collapse: nextRun() advances from `now`, so a week-long
// outage produces one run, not seven.

import { prisma } from '@/lib/db'
import { enqueueJob } from './queue'

export type Cadence =
  | { kind: 'every'; ms: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; dow: number; hour: number; minute: number }

const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 }

export function parseCadence(cadence: string): Cadence {
  const every = /^every:(\d+)(m|h|d)$/.exec(cadence)
  if (every) {
    const n = Number.parseInt(every[1], 10)
    if (n <= 0) throw new Error(`Cadence interval must be positive: ${cadence}`)
    return { kind: 'every', ms: n * UNIT_MS[every[2]] }
  }
  const daily = /^daily@(\d{2}):(\d{2})$/.exec(cadence)
  if (daily) {
    return { kind: 'daily', hour: parseClock(daily[1], 23, cadence), minute: parseClock(daily[2], 59, cadence) }
  }
  const weekly = /^weekly:([0-6])@(\d{2}):(\d{2})$/.exec(cadence)
  if (weekly) {
    return {
      kind: 'weekly',
      dow: Number.parseInt(weekly[1], 10),
      hour: parseClock(weekly[2], 23, cadence),
      minute: parseClock(weekly[3], 59, cadence),
    }
  }
  throw new Error(`Unrecognized cadence: ${cadence}`)
}

function parseClock(value: string, max: number, cadence: string): number {
  const n = Number.parseInt(value, 10)
  if (n > max) throw new Error(`Out-of-range time component in cadence: ${cadence}`)
  return n
}

/** Next run strictly after `from` (server-local time for daily/weekly). */
export function nextRun(cadence: string, from: Date): Date {
  const c = parseCadence(cadence)
  if (c.kind === 'every') return new Date(from.getTime() + c.ms)
  const next = new Date(from)
  next.setHours(c.hour, c.minute, 0, 0)
  if (c.kind === 'daily') {
    if (next <= from) next.setDate(next.getDate() + 1)
    return next
  }
  // weekly
  while (next.getDay() !== c.dow || next <= from) {
    next.setDate(next.getDate() + 1)
    next.setHours(c.hour, c.minute, 0, 0)
  }
  return next
}

let tickRunning = false

export async function tickSchedules(now: Date = new Date()): Promise<void> {
  if (tickRunning) return
  tickRunning = true
  try {
    const due = await prisma.schedule.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
    })
    for (const sched of due) {
      try {
        let payload: unknown = {}
        try {
          payload = JSON.parse(sched.payload)
        } catch {
          console.warn(`[jobs] schedule ${sched.id} has unparseable payload; enqueuing {}`)
        }
        const { id: jobId } = await enqueueJob({
          type: sched.jobType,
          payload,
          scheduleId: sched.id,
          scheduledFor: sched.nextRunAt,
          groupKey: `schedule:${sched.id}`,
        })
        // Conditional advance: if another tick already moved this schedule,
        // match 0 rows and leave it alone.
        await prisma.schedule.updateMany({
          where: { id: sched.id, nextRunAt: sched.nextRunAt },
          data: { nextRunAt: nextRun(sched.cadence, now), lastRunAt: now, lastJobId: jobId },
        })
      } catch (err) {
        // Enqueue or advance failed — leave nextRunAt as-is; next tick retries.
        console.warn(`[jobs] schedule tick failed for ${sched.id}:`, (err as Error).message)
      }
    }
  } finally {
    tickRunning = false
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/jobs/scheduler.test.ts`
Expected: PASS (9 tests).

Note on the concurrent-ticks test: the `tickRunning` guard makes the second call a no-op when truly concurrent; if interleaving lets both proceed, the durable slot index + conditional advance still guarantee one job and one advance. The test asserts the outcome, which is what matters.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/scheduler.ts lib/jobs/scheduler.test.ts
git commit -m "feat(jobs): schedule tick with exactly-once-per-slot + cadence grammar"
```

---

### Task 8: `lib/jobs/introspection.ts`

**Files:**
- Create: `lib/jobs/introspection.ts`
- Test: `lib/jobs/introspection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/jobs/introspection.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { getJobQueueState } from './introspection'

async function clearTestJobs() {
  await prisma.job.deleteMany({ where: { type: { startsWith: 'test-' } } })
}

describe('jobs/introspection', () => {
  beforeEach(clearTestJobs)

  it('reports per-type/status counts, oldest running, recent failures', async () => {
    await prisma.job.create({ data: { type: 'test-intro', status: 'queued' } })
    await prisma.job.create({
      data: { type: 'test-intro', status: 'running', startedAt: new Date('2026-01-01') },
    })
    await prisma.job.create({
      data: { type: 'test-intro', status: 'error', lastError: 'kaput', completedAt: new Date() },
    })
    const state = await getJobQueueState()
    expect(state.counts['test-intro']).toMatchObject({ queued: 1, running: 1, error: 1 })
    expect(state.oldestRunning?.type).toBe('test-intro')
    expect(state.recentFailures.some((f) => f.lastError === 'kaput')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/jobs/introspection.test.ts`
Expected: FAIL — cannot resolve `./introspection`.

- [ ] **Step 3: Implement `lib/jobs/introspection.ts`**

```ts
// lib/jobs/introspection.ts
//
// Read-only queue state for the future /admin/ops page (roadmap A4) and
// debugging. No UI in this phase.

import { prisma } from '@/lib/db'

export interface JobQueueState {
  counts: Record<string, Record<string, number>> // type → status → count
  oldestRunning: { id: string; type: string; startedAt: Date | null } | null
  recentFailures: Array<{ id: string; type: string; lastError: string | null; completedAt: Date | null }>
}

export async function getJobQueueState(): Promise<JobQueueState> {
  const grouped = await prisma.job.groupBy({
    by: ['type', 'status'],
    _count: { _all: true },
  })
  const counts: Record<string, Record<string, number>> = {}
  for (const row of grouped) {
    counts[row.type] = counts[row.type] ?? {}
    counts[row.type][row.status] = row._count._all
  }
  const oldestRunning = await prisma.job.findFirst({
    where: { status: 'running' },
    orderBy: { startedAt: 'asc' },
    select: { id: true, type: true, startedAt: true },
  })
  const recentFailures = await prisma.job.findMany({
    where: { status: 'error' },
    orderBy: { completedAt: 'desc' },
    take: 10,
    select: { id: true, type: true, lastError: true, completedAt: true },
  })
  return { counts, oldestRunning, recentFailures }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/jobs/introspection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/introspection.ts lib/jobs/introspection.test.ts
git commit -m "feat(jobs): queue introspection for future admin/ops"
```

---

### Task 9: `lib/jobs/handlers/psi.ts` — PSI handler + exhaustion hook

**Files:**
- Create: `lib/jobs/handlers/psi.ts`
- Modify: `lib/jobs/handlers/register.ts` (complete the Task 5 stub)
- Test: `lib/jobs/handlers/psi.test.ts`

The handler body mirrors `runJob()` in `lib/ada-audit/lighthouse-queue.ts` with two deliberate changes: (1) the AdaAudit settle and SiteAudit counter bump happen in **one short transaction** — the legacy split is exactly the wedge where a row flips to `complete`, the counter bump fails, and a retry no-ops on the conditional claim leaving the parent under-counted forever; (2) DB failures now **throw**, so the queue's retry covers transient SQLITE_BUSY. No browser/network work happens inside the transaction (the PSI fetch completes before it opens), so the spec's no-transactions-across-network rule holds. The finalize call still warns-and-continues (a finalize failure after the transaction committed must NOT retry the job — a retried handler would match 0 rows on the claim and never finalize).

- [ ] **Step 1: Write the failing tests**

```ts
// lib/jobs/handlers/psi.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/ada-audit/lighthouse-pagespeed', () => ({
  runPageSpeedInsights: vi.fn(),
}))
vi.mock('@/lib/ada-audit/site-audit-finalizer', () => ({
  finalizeSiteAudit: vi.fn(async () => undefined),
}))

const { prisma } = await import('@/lib/db')
const { runPageSpeedInsights } = await import('@/lib/ada-audit/lighthouse-pagespeed')
const { finalizeSiteAudit } = await import('@/lib/ada-audit/site-audit-finalizer')
const { runPsiJob, onPsiExhausted } = await import('./psi')

async function clearTestState() {
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://psi-handler-test-' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'psi-handler-test-' } } })
}

async function seed(domain: string) {
  const site = await prisma.siteAudit.create({
    data: { domain: `psi-handler-test-${domain}`, status: 'lighthouse-running', wcagLevel: 'wcag21aa', lighthouseTotal: 1 },
  })
  const row = await prisma.adaAudit.create({
    data: { url: `https://psi-handler-test-${domain}/p`, status: 'axe-complete', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
  })
  return { site, row }
}

describe('jobs/handlers/psi', () => {
  beforeEach(async () => {
    vi.mocked(runPageSpeedInsights).mockReset()
    vi.mocked(finalizeSiteAudit).mockReset()
    vi.mocked(finalizeSiteAudit).mockResolvedValue(undefined)
    await clearTestState()
  })

  it('success: writes summary, completes row, bumps lighthouseComplete, finalizes', async () => {
    vi.mocked(runPageSpeedInsights).mockResolvedValue({
      summary: { performance: 90 } as never,
      error: null,
    })
    const { site, row } = await seed('ok.example')
    await runPsiJob({ adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' })
    const final = await prisma.adaAudit.findUnique({ where: { id: row.id } })
    expect(final?.status).toBe('complete')
    expect(final?.lighthouseSummary).toContain('performance')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.lighthouseComplete).toBe(1)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('PSI fetch error: records lighthouseError, completes row + job (no throw), bumps lighthouseError', async () => {
    vi.mocked(runPageSpeedInsights).mockResolvedValue({ summary: null, error: 'PSI timed out' })
    const { site, row } = await seed('fetch-err.example')
    await expect(
      runPsiJob({ adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' }),
    ).resolves.toBeUndefined()
    const final = await prisma.adaAudit.findUnique({ where: { id: row.id } })
    expect(final?.status).toBe('complete')
    expect(final?.lighthouseError).toContain('PSI timed out')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.lighthouseError).toBe(1)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('PSI fetch throw: also recorded as lighthouseError, job completes', async () => {
    vi.mocked(runPageSpeedInsights).mockRejectedValue(new Error('network down'))
    const { site, row } = await seed('fetch-throw.example')
    await runPsiJob({ adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' })
    expect((await prisma.adaAudit.findUnique({ where: { id: row.id } }))?.lighthouseError).toContain('network down')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.lighthouseError).toBe(1)
  })

  it('row already terminal: no counter bump, no finalize (idempotent re-run)', async () => {
    vi.mocked(runPageSpeedInsights).mockResolvedValue({ summary: null, error: 'x' })
    const { site, row } = await seed('terminal.example')
    await prisma.adaAudit.update({ where: { id: row.id }, data: { status: 'error' } })
    await runPsiJob({ adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' })
    const siteFinal = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(siteFinal?.lighthouseComplete).toBe(0)
    expect(siteFinal?.lighthouseError).toBe(0)
    expect(finalizeSiteAudit).not.toHaveBeenCalled()
  })

  it('onPsiExhausted: settles the axe-complete row, bumps lighthouseError, finalizes', async () => {
    const { site, row } = await seed('exhausted.example')
    await onPsiExhausted(
      { adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' },
      { jobId: 'j1', attempts: 3, lastError: 'kept failing' },
    )
    const final = await prisma.adaAudit.findUnique({ where: { id: row.id } })
    expect(final?.status).toBe('complete')
    expect(final?.lighthouseError).toContain('PSI job failed after 3 attempts')
    expect(final?.lighthouseError).toContain('kept failing')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.lighthouseError).toBe(1)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('onPsiExhausted no-ops when the row is already terminal', async () => {
    const { site, row } = await seed('exhausted-noop.example')
    await prisma.adaAudit.update({ where: { id: row.id }, data: { status: 'error' } })
    await onPsiExhausted(
      { adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' },
      { jobId: 'j1', attempts: 3, lastError: 'x' },
    )
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.lighthouseError).toBe(0)
    expect(finalizeSiteAudit).not.toHaveBeenCalled()
  })

  it('rejects a malformed payload', async () => {
    await expect(runPsiJob({ nope: true } as never)).rejects.toThrow(/payload/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/jobs/handlers/psi.test.ts`
Expected: FAIL — cannot resolve `./psi`.

- [ ] **Step 3: Implement `lib/jobs/handlers/psi.ts`**

```ts
// lib/jobs/handlers/psi.ts
//
// Durable-queue PSI handler — the Job-table replacement for the in-memory
// pool in lib/ada-audit/lighthouse-queue.ts (legacy path kept behind the
// JOB_QUEUE_PSI flag until parity is proven; see spec Phase 1).
//
// Idempotency: the conditional claim on AdaAudit.status='axe-complete' makes
// re-runs (crash recovery, zombie attempts) no-ops — same pattern as legacy.
//
// Error semantics:
// - PSI fetch failure (returned error or throw) is a DOMAIN result: recorded
//   as lighthouseError, row completes, job completes. No job retry.
// - The AdaAudit settle + SiteAudit counter bump run in ONE short
//   transaction (no network work inside) — the legacy split is the wedge
//   where the row flips but the counter doesn't, and a retry no-ops forever.
// - DB failures THROW → the queue retries (covers transient SQLITE_BUSY).
//   Legacy warned-and-returned, wedging the audit until stale reset.
// - finalizeSiteAudit failure after the transaction committed
//   warns-and-continues: a retried handler would match 0 rows on the claim
//   and never finalize, so retrying would make things worse. Another
//   settling job or stale recovery picks it up — same exposure as legacy.

import { prisma } from '@/lib/db'
import { runPageSpeedInsights } from '@/lib/ada-audit/lighthouse-pagespeed'
import { finalizeSiteAudit } from '@/lib/ada-audit/site-audit-finalizer'
import type { PsiJob } from '@/lib/ada-audit/lighthouse-queue'
import { parsePositiveInt } from '../config'
import { registerJobHandler } from '../registry'
import type { JobExhaustedContext } from '../types'

export const PSI_JOB_TYPE = 'psi'

function assertPsiPayload(payload: unknown): PsiJob {
  const p = payload as Partial<PsiJob> | null
  if (!p || typeof p.adaAuditId !== 'string' || typeof p.siteAuditId !== 'string' || typeof p.url !== 'string') {
    throw new Error('Invalid psi job payload')
  }
  return p as PsiJob
}

/**
 * Atomically claim the axe-complete AdaAudit row, write the LH outcome, and
 * bump the matching SiteAudit counter. Returns false when the row was
 * already terminal (recovery beat us / idempotent re-run). On true, the
 * caller must invoke finalizeSiteAudit (outside the transaction).
 */
async function settlePsiOutcome(
  job: PsiJob,
  data: { lighthouseSummary: string | null; lighthouseError: string | null },
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.adaAudit.updateMany({
      where: { id: job.adaAuditId, status: 'axe-complete' },
      data: {
        status: 'complete',
        lighthouseSummary: data.lighthouseSummary,
        lighthouseError: data.lighthouseError,
        completedAt: new Date(),
      },
    })
    if (claimed.count !== 1) return false
    await tx.siteAudit.update({
      where: { id: job.siteAuditId },
      data: data.lighthouseSummary !== null
        ? { lighthouseComplete: { increment: 1 } }
        : { lighthouseError: { increment: 1 } },
    })
    return true
  })
}

export async function runPsiJob(payload: unknown): Promise<void> {
  const job = assertPsiPayload(payload)

  let lighthouseSummary: string | null = null
  let lighthouseError: string | null = null
  try {
    const result = await runPageSpeedInsights(job.url)
    if (result.summary) lighthouseSummary = JSON.stringify(result.summary)
    if (result.error) lighthouseError = result.error
  } catch (err) {
    lighthouseError = err instanceof Error ? err.message : String(err)
  }

  const settled = await settlePsiOutcome(job, { lighthouseSummary, lighthouseError })
  if (!settled) return // row already terminal — recovery beat us

  try {
    await finalizeSiteAudit(job.siteAuditId)
  } catch (err) {
    console.warn('[jobs/psi] finalize after PSI settle failed:', (err as Error).message)
  }
}

/**
 * Settle a PSI failure that happened OUTSIDE the handler's fetch path —
 * job exhaustion, or a failed durable enqueue (lighthouse-queue's fallback).
 * Without this, the parent strands in lighthouse-running until stale
 * recovery fails the whole audit, because finalizeSiteAudit only counts
 * lighthouseComplete + lighthouseError.
 */
export async function settlePsiFailure(payload: unknown, message: string): Promise<void> {
  const job = assertPsiPayload(payload)
  const settled = await settlePsiOutcome(job, { lighthouseSummary: null, lighthouseError: message })
  if (!settled) return
  try {
    await finalizeSiteAudit(job.siteAuditId)
  } catch (err) {
    console.warn('[jobs/psi] finalize after failure settle failed:', (err as Error).message)
  }
}

export async function onPsiExhausted(payload: unknown, ctx: JobExhaustedContext): Promise<void> {
  await settlePsiFailure(payload, `PSI job failed after ${ctx.attempts} attempts: ${ctx.lastError}`)
}

export function registerPsiHandler(): void {
  registerJobHandler({
    type: PSI_JOB_TYPE,
    concurrency: parsePositiveInt(process.env.PSI_CONCURRENCY, 6),
    maxAttempts: 3,
    backoffBaseMs: 30_000,
    // PSI fetch has its own ~90s internal timeout; 120s catches DB hangs too.
    timeoutMs: 120_000,
    handler: runPsiJob,
    onExhausted: onPsiExhausted,
  })
}
```

Complete `lib/jobs/handlers/register.ts` (replacing the Task 5 stub body):

```ts
// lib/jobs/handlers/register.ts
//
// Single registration point for built-in job handlers. Idempotent —
// instrumentation calls it BEFORE startup recovery (recoverJobsOnStartup may
// run onExhausted hooks, which need a populated registry) and startJobWorker
// calls it again (harmless re-register).

import { registerPsiHandler } from './psi'

export function registerBuiltInJobHandlers(): void {
  registerPsiHandler()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/jobs/handlers/psi.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/psi.ts lib/jobs/handlers/psi.test.ts lib/jobs/handlers/register.ts
git commit -m "feat(jobs): durable PSI handler with atomic settle + exhaustion hook"
```

---

### Task 10: Flag branch in `lib/ada-audit/lighthouse-queue.ts`

**Files:**
- Modify: `lib/ada-audit/lighthouse-queue.ts` (the `enqueuePsiJob` function + a new exported flag helper)
- Modify: `lib/ada-audit/lighthouse-queue.test.ts` (add flag tests)

- [ ] **Step 1: Add the failing tests to `lib/ada-audit/lighthouse-queue.test.ts`**

Add inside the existing `describe('lighthouse-queue', ...)` block (the existing `clearTestState` and imports stay; add a `prisma.job` cleanup line to `clearTestState`):

```ts
// In clearTestState(), add:
//   await prisma.job.deleteMany({ where: { type: 'psi', payload: { contains: 'psi-test-' } } })

describe('JOB_QUEUE_PSI flag', () => {
  const original = process.env.JOB_QUEUE_PSI
  afterEach(() => {
    if (original === undefined) delete process.env.JOB_QUEUE_PSI
    else process.env.JOB_QUEUE_PSI = original
  })

  it('flag off: legacy in-memory pool used, no Job row created', async () => {
    delete process.env.JOB_QUEUE_PSI
    vi.mocked(runPageSpeedInsights).mockResolvedValue({ summary: null, error: 'x' })
    const site = await prisma.siteAudit.create({
      data: { domain: 'psi-test-flag-off.example', status: 'running', wcagLevel: 'wcag21aa', lighthouseTotal: 1 },
    })
    const row = await prisma.adaAudit.create({
      data: { url: 'https://psi-test-flag-off.example/p', status: 'axe-complete', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    enqueuePsiJob({ adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' })
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setImmediate(r))
      if ((await prisma.adaAudit.findUnique({ where: { id: row.id } }))?.status === 'complete') break
    }
    expect((await prisma.adaAudit.findUnique({ where: { id: row.id } }))?.status).toBe('complete')
    expect(await prisma.job.count({ where: { type: 'psi', payload: { contains: 'psi-test-flag-off' } } })).toBe(0)
  })

  it('flag on: creates a durable Job row with dedupKey + groupKey, legacy pool untouched', async () => {
    process.env.JOB_QUEUE_PSI = '1'
    const site = await prisma.siteAudit.create({
      data: { domain: 'psi-test-flag-on.example', status: 'running', wcagLevel: 'wcag21aa', lighthouseTotal: 1 },
    })
    const row = await prisma.adaAudit.create({
      data: { url: 'https://psi-test-flag-on.example/p', status: 'axe-complete', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    enqueuePsiJob({ adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' })
    // enqueue is async behind the sync facade — poll for the row.
    let job = null
    for (let i = 0; i < 20 && !job; i++) {
      await new Promise((r) => setTimeout(r, 25))
      job = await prisma.job.findFirst({ where: { type: 'psi', dedupKey: `psi:${row.id}` } })
    }
    expect(job).not.toBeNull()
    expect(job!.groupKey).toBe(`site-audit:${site.id}`)
    expect(JSON.parse(job!.payload)).toMatchObject({ adaAuditId: row.id, siteAuditId: site.id })
    expect(getPsiQueueState()).toEqual({ active: 0, queued: 0 })
    expect(runPageSpeedInsights).not.toHaveBeenCalled() // worker not running in tests
  })

  it('flag on: double enqueue dedups to one Job row', async () => {
    process.env.JOB_QUEUE_PSI = '1'
    const site = await prisma.siteAudit.create({
      data: { domain: 'psi-test-dedup.example', status: 'running', wcagLevel: 'wcag21aa', lighthouseTotal: 1 },
    })
    const row = await prisma.adaAudit.create({
      data: { url: 'https://psi-test-dedup.example/p', status: 'axe-complete', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    const j = { adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' }
    enqueuePsiJob(j)
    enqueuePsiJob(j)
    await new Promise((r) => setTimeout(r, 200))
    expect(await prisma.job.count({ where: { type: 'psi', dedupKey: `psi:${row.id}` } })).toBe(1)
  })
})
```

Also add `afterEach` to the vitest import line if not present: `import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'`.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run lib/ada-audit/lighthouse-queue.test.ts`
Expected: existing 3 tests PASS; the 2 flag-on tests FAIL (no Job row is created yet). The flag-off test should already pass.

- [ ] **Step 3: Implement the flag branch in `lib/ada-audit/lighthouse-queue.ts`**

Add after the `PSI_CONCURRENCY` constant:

```ts
/** JOB_QUEUE_PSI=1 routes PSI work through the durable Job table (spec Phase 1).
 *  Read at call time so tests and ecosystem.config.js control it without module reloads. */
export function isPsiJobQueueEnabled(): boolean {
  return process.env.JOB_QUEUE_PSI === '1' || process.env.JOB_QUEUE_PSI === 'true'
}
```

Replace the existing `enqueuePsiJob` with:

```ts
export function enqueuePsiJob(job: PsiJob): void {
  if (isPsiJobQueueEnabled()) {
    // Durable path: the jobs worker picks this up (handlers/psi.ts).
    // Dynamic import keeps the legacy path dependency-free.
    void import('@/lib/jobs/queue')
      .then(({ enqueueJob }) =>
        enqueueJob({
          type: 'psi',
          payload: job,
          dedupKey: `psi:${job.adaAuditId}`,
          groupKey: `site-audit:${job.siteAuditId}`,
        }),
      )
      .catch(async (err) => {
        // The page loop already committed axe-complete + lighthouseTotal++.
        // With no durable job, nothing would ever drain this page — settle
        // the LH portion as failed NOW instead of waiting for the parent's
        // stale-failure path.
        console.error('[lighthouse-queue] durable PSI enqueue failed for', job.adaAuditId, ':', (err as Error).message)
        try {
          const { settlePsiFailure } = await import('@/lib/jobs/handlers/psi')
          await settlePsiFailure(job, `Failed to enqueue durable PSI job: ${(err as Error).message}`)
        } catch (settleErr) {
          console.error('[lighthouse-queue] PSI enqueue-failure settle also failed for', job.adaAuditId, ':', (settleErr as Error).message)
        }
      })
    return
  }
  queue.push(job)
  pump()
}
```

- [ ] **Step 4: Run the full file to verify all tests pass**

Run: `npx vitest run lib/ada-audit/lighthouse-queue.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/lighthouse-queue.ts lib/ada-audit/lighthouse-queue.test.ts
git commit -m "feat(jobs): route PSI enqueue through durable queue behind JOB_QUEUE_PSI"
```

---

### Task 11: Flag-aware recovery in `lib/ada-audit/queue-manager.ts`

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts` (`recoverQueue`, `resetStaleAudits`)
- Modify: `lib/ada-audit/queue-manager.test.ts` (add flag-on recovery tests)

- [ ] **Step 1: Add the failing tests to `lib/ada-audit/queue-manager.test.ts`**

Read the existing file first to match its setup/cleanup helpers, then add (adjust cleanup to also delete `prisma.job` rows whose `groupKey` matches the created site-audit ids):

```ts
describe('recoverQueue with JOB_QUEUE_PSI=1', () => {
  const original = process.env.JOB_QUEUE_PSI
  beforeEach(() => { process.env.JOB_QUEUE_PSI = '1' })
  afterEach(() => {
    if (original === undefined) delete process.env.JOB_QUEUE_PSI
    else process.env.JOB_QUEUE_PSI = original
  })

  async function makeParent(domain: string, status: string) {
    return prisma.siteAudit.create({
      data: { domain: `qm-jobs-test-${domain}`, status, wcagLevel: 'wcag21aa' },
    })
  }

  async function cleanup(siteIds: string[]) {
    await prisma.job.deleteMany({ where: { groupKey: { in: siteIds.map((id) => `site-audit:${id}`) } } })
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'qm-jobs-test-' } } })
  }

  it('lighthouse-running parent with active group jobs survives (queued, running, and backoff-delayed)', async () => {
    const parent = await makeParent('survives.example', 'lighthouse-running')
    await prisma.job.create({
      data: { type: 'psi', status: 'queued', groupKey: `site-audit:${parent.id}`, runAfter: new Date(Date.now() + 60_000) },
    })
    try {
      await recoverQueue()
      expect((await prisma.siteAudit.findUnique({ where: { id: parent.id } }))?.status).toBe('lighthouse-running')
    } finally {
      await cleanup([parent.id])
    }
  })

  it('lighthouse-running parent with no active jobs is failed and orphans cascade', async () => {
    const parent = await makeParent('drained.example', 'lighthouse-running')
    const child = await prisma.adaAudit.create({
      data: { url: `https://qm-jobs-test-drained.example/p`, status: 'axe-complete', siteAuditId: parent.id, wcagLevel: 'wcag21aa' },
    })
    const terminalJob = await prisma.job.create({
      data: { type: 'psi', status: 'error', groupKey: `site-audit:${parent.id}` },
    })
    try {
      await recoverQueue()
      expect((await prisma.siteAudit.findUnique({ where: { id: parent.id } }))?.status).toBe('error')
      expect((await prisma.adaAudit.findUnique({ where: { id: child.id } }))?.status).toBe('error')
    } finally {
      await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://qm-jobs-test-' } } })
      await cleanup([parent.id])
    }
  })

  it('mixed-outstanding: pdfs-running parent is failed even with active PSI jobs, and its queued jobs are cancelled', async () => {
    const parent = await makeParent('mixed.example', 'pdfs-running')
    const job = await prisma.job.create({
      data: { type: 'psi', status: 'queued', groupKey: `site-audit:${parent.id}` },
    })
    try {
      await recoverQueue()
      expect((await prisma.siteAudit.findUnique({ where: { id: parent.id } }))?.status).toBe('error')
      expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe('cancelled')
    } finally {
      await cleanup([parent.id])
    }
  })

  it('flag off: lighthouse-running parent is failed even with active group jobs', async () => {
    delete process.env.JOB_QUEUE_PSI
    const parent = await makeParent('flag-off.example', 'lighthouse-running')
    const job = await prisma.job.create({
      data: { type: 'psi', status: 'queued', groupKey: `site-audit:${parent.id}` },
    })
    try {
      await recoverQueue()
      expect((await prisma.siteAudit.findUnique({ where: { id: parent.id } }))?.status).toBe('error')
      expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe('cancelled')
    } finally {
      await cleanup([parent.id])
    }
  })
})
```

Note: import `recoverQueue` at the top alongside the file's existing imports if not already imported. Mirror the existing test file's mocking — if it stubs `discoverPages`/`runAxeAudit`, keep those stubs; `recoverQueue` ends with `void processNext()`, which is why test parents must be cleaned up before assertions in other files (the `qm-jobs-test-` prefix keeps them isolated).

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run lib/ada-audit/queue-manager.test.ts`
Expected: existing tests PASS; new tests FAIL (parents are failed unconditionally today, and jobs are never cancelled).

- [ ] **Step 3: Implement flag-aware recovery in `lib/ada-audit/queue-manager.ts`**

Add imports at the top:

```ts
import { cancelJobsByGroup, countActiveJobsByGroup } from '@/lib/jobs/queue'
import { isPsiJobQueueEnabled } from './lighthouse-queue'
```

In **`recoverQueue()`**, change the orphan select to include `status`, and add the survival check + job cancellation:

```ts
export async function recoverQueue() {
  const orphans = await prisma.siteAudit.findMany({
    where: {
      status: { in: ['running', 'pdfs-running', 'lighthouse-running'] },
    },
    select: { id: true, batchId: true, status: true },
  })
  for (const o of orphans) {
    // Durable-PSI survival: a lighthouse-running parent's only outstanding
    // work is PSI, and with JOB_QUEUE_PSI=1 those jobs live in the Job table
    // (already re-queued by recoverJobsOnStartup, which runs first). The
    // worker drains them; the last settle finalizes the audit. Parents in
    // running/pdfs-running still fail — page + PDF work isn't durable until
    // Phases 2-3.
    if (o.status === 'lighthouse-running' && isPsiJobQueueEnabled()) {
      // A failed count must NOT be treated as "no active jobs" — that would
      // bias a transient DB read error toward destructively failing the
      // parent. Skip this parent for this pass; the next pass retries.
      let outstanding: number
      try {
        outstanding = await countActiveJobsByGroup(`site-audit:${o.id}`)
      } catch (err) {
        console.warn(`[queue] Startup recovery: job count failed for ${o.id}, skipping this pass:`, (err as Error).message)
        continue
      }
      if (outstanding > 0) {
        console.warn(`[queue] Startup recovery: resuming audit ${o.id} (${outstanding} durable PSI job(s) outstanding)`)
        continue
      }
    }
    console.warn(`[queue] Startup recovery: resetting orphan audit ${o.id}`)
    await prisma.siteAudit.update({
      where: { id: o.id },
      data: { status: 'error', error: 'Audit interrupted (server restarted)', completedAt: new Date() },
    }).catch(() => {})
    await failOrphanAdaAudits(o.id).catch(() => {})
    await failOrphanPdfAudits(o.id).catch(() => {})
    // Cancel queued durable jobs so they don't run pointlessly against a dead
    // parent. A running job that slips through settles harmlessly — its
    // conditional axe-complete claim matches 0 rows. No-op when none exist.
    await cancelJobsByGroup(`site-audit:${o.id}`).catch(() => {})
    if (o.batchId) {
      await closeBatchIfDrained(o.batchId).catch(() => {})
    }
  }

  // ... (rest of the function unchanged: legacy 'pending' requeue + processNext kick)
```

In **`resetStaleAudits()`**, apply the same skip + cancel (change the select to include `status`):

```ts
export async function resetStaleAudits() {
  const STALE_MS = 5 * 60 * 1000
  const staleThreshold = new Date(Date.now() - STALE_MS)
  const stale = await prisma.siteAudit.findMany({
    where: {
      status: { in: ['running', 'pdfs-running', 'lighthouse-running'] },
      updatedAt: { lt: staleThreshold },
    },
    select: { id: true, batchId: true, status: true },
  })
  for (const s of stale) {
    // PSI completions bump SiteAudit.updatedAt, but a backoff window can
    // exceed the 5-min threshold — don't kill a parent whose durable PSI
    // jobs are still outstanding.
    if (s.status === 'lighthouse-running' && isPsiJobQueueEnabled()) {
      // As in recoverQueue: a failed count means "unknown", not "zero" —
      // skip this parent for this pass rather than destructively failing it.
      let outstanding: number
      try {
        outstanding = await countActiveJobsByGroup(`site-audit:${s.id}`)
      } catch (err) {
        console.warn(`[queue] Stale check: job count failed for ${s.id}, skipping this pass:`, (err as Error).message)
        continue
      }
      if (outstanding > 0) continue
    }
    console.warn(`[queue] Resetting stale audit ${s.id}`)
    await prisma.siteAudit.update({
      where: { id: s.id },
      data: { status: 'error', error: 'Audit timed out (server may have restarted)', completedAt: new Date() },
    }).catch(() => {})
    await failOrphanAdaAudits(s.id).catch(() => {})
    await failOrphanPdfAudits(s.id).catch(() => {})
    await cancelJobsByGroup(`site-audit:${s.id}`).catch(() => {})
    if (s.batchId) {
      await closeBatchIfDrained(s.batchId).catch(() => {})
    }
  }
  if (stale.length > 0) void processNext()
}
```

Cycle check: `queue-manager → jobs/queue` is static, `jobs/queue → jobs/worker` is dynamic, `jobs/worker → jobs/handlers/psi` is dynamic — no static cycle back to `queue-manager`.

- [ ] **Step 4: Run the full file to verify all tests pass**

Run: `npx vitest run lib/ada-audit/queue-manager.test.ts`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/queue-manager.ts lib/ada-audit/queue-manager.test.ts
git commit -m "feat(jobs): lighthouse-running parents survive restart when durable PSI jobs outstanding"
```

---

### Task 12: Wire into `instrumentation.ts` + document

**Files:**
- Modify: `instrumentation.ts`
- Modify: `CLAUDE.md` (architecture patterns + env var)

- [ ] **Step 1: Wire startup + shutdown in `instrumentation.ts`**

Replace this block:

```ts
    // Recover queued/stale audits from crashes and kick the queue processor
    const { recoverQueue, resetStaleAudits } = await import('@/lib/ada-audit/queue-manager')
    void recoverQueue()
```

with:

```ts
    // Job queue boot order (each step depends on the previous):
    // 1. Register handlers — startup recovery may run onExhausted hooks,
    //    which need a populated registry.
    // 2. recoverJobsOnStartup — recoverQueue decides parent-audit survival
    //    based on active jobs in the Job table.
    // 3. recoverQueue (awaited) — parent recovery decisions are still partly
    //    non-durable in Phase 1; make them deterministic before any claims.
    // 4. startJobWorker — only now may PSI jobs start draining.
    const { registerBuiltInJobHandlers } = await import('@/lib/jobs/handlers/register')
    registerBuiltInJobHandlers()
    const { recoverJobsOnStartup } = await import('@/lib/jobs/recovery')
    await recoverJobsOnStartup()

    // Recover queued/stale audits from crashes and kick the queue processor
    const { recoverQueue, resetStaleAudits } = await import('@/lib/ada-audit/queue-manager')
    await recoverQueue()

    const { startJobWorker, stopJobWorker } = await import('@/lib/jobs/worker')
    await startJobWorker()
```

And in the `shutdown` function, stop the worker before closing the browser:

```ts
    const shutdown = async () => {
      if (shuttingDown) return
      shuttingDown = true
      clearInterval(cleanupInterval)
      clearInterval(staleCheckInterval)
      stopScreenshotSweeper()
      try {
        await stopJobWorker()
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[shutdown] Failed to stop job worker:', err)
      }
      try {
        await closeBrowser()
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[shutdown] Failed to close headless browser:', err)
        process.exitCode = 1
      } finally {
        process.exit()
      }
    }
```

- [ ] **Step 2: Document in `CLAUDE.md`**

In the **Architecture patterns** section, add after the "Stale audit recovery" bullet:

```markdown
- **Durable job queue:** `Job` + `Schedule` tables (`lib/jobs/`) with a single in-process worker — conditional-update claim, attempt-fenced heartbeat/settle, per-type concurrency/timeout/backoff, `onExhausted` domain hooks, and a 60s schedule tick (exactly-once-per-slot via `@@unique([scheduleId, scheduledFor])`). PSI runs through it when `JOB_QUEUE_PSI=1` (default off; legacy in-memory pool otherwise) — with the flag on, `lighthouse-running` site audits survive restarts and resume draining. Spec: `docs/superpowers/specs/2026-06-10-durable-job-queue-design.md`.
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (this is the first point where the whole graph exists).

- [ ] **Step 4: Commit**

```bash
git add instrumentation.ts CLAUDE.md
git commit -m "feat(jobs): start job worker + recovery at boot, stop on SIGTERM"
```

---

### Task 13: Full verification

**Files:** none new.

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all files pass (146 pre-existing + 7 new files). If `queue-manager.test.ts` or `lighthouse-queue.test.ts` interact through leftover rows, check that every new test cleans up its `Job` rows via the prefixes defined in its tasks.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 3: Commit anything outstanding**

```bash
git status --short   # should be clean; commit stragglers if any
```

---

## Out of scope for this plan (later sessions, same tracker item)

- **Phase 2:** PDF scans onto the queue (deletes `pdf-worker-pool.ts`, fire-and-forget dispatch in `pdf-orchestrator.ts`, `failOrphanPdfAudits`).
- **Phase 3:** site-audit page loop onto the queue (deletes the `processing` mutex + most of `resetStaleAudits`/`recoverQueue`/`failOrphanAdaAudits`).
- **Phase 4:** cleanup ticks + screenshot sweeper as `Schedule` rows.
- **Parity flip:** run a real site audit with `JOB_QUEUE_PSI=1` on production, compare lighthouse counters/final status/summary against a legacy run, then set the flag in `ecosystem.config.js` and delete the legacy in-memory pool.
