# Durable Job Queue Phase 4 — Cleanup Ticks as Scheduled Jobs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the three recurring timers (`runCleanup` daily, `resetStaleAudits` 10-min, screenshot sweeper 30-min) out of `instrumentation.ts` onto seeded `Schedule` rows + thin job handlers, and add Job-row retention.

**Architecture:** A new nullable-unique `Schedule.name` column gives system schedules a stable identity; `seedSystemSchedules()` upserts three code-owned `system-*` rows at boot (and disables/cancels retired ones). Three thin handlers (`cleanup`, `screenshot-sweep`, `stale-audit-reset`, all concurrency 1 / maxAttempts 1) delegate to the existing domain functions. `cleanOldTerminalJobs()` (raw-SQL delete with a slot-record guard) joins `runCleanup()`'s task list. All `setInterval`s leave `instrumentation.ts`.

**Tech Stack:** Next.js 15 / TypeScript / Prisma + SQLite / vitest. Spec: `docs/superpowers/specs/2026-06-10-durable-job-queue-phase4-design.md` (Codex-reviewed).

**Conventions that apply to every task:**
- Branch: `feat/job-queue-phase4-cleanup-ticks` off `main`.
- Run vitest/prisma with `DATABASE_URL="file:./local-dev.db"` prefixed (the checked-in `.env` points at a path that doesn't exist locally).
- Array-form `$transaction` only; no interactive transactions. Raw SQL sets/compares `updatedAt` as integer milliseconds (`Date.now()`-style values) — SQLite storage is integer ms.
- Real-DB tests use the shared dev DB; clean up your own rows in `beforeEach` and be mindful that other test files only clear `test-*`-prefixed types.

---

### Task 0: Branch + migration (Schedule.name)

**Files:**
- Modify: `prisma/schema.prisma` (Schedule model, ~line 323)
- Create: `prisma/migrations/20260610230000_schedule_name/migration.sql`

- [ ] **Step 1: Create the branch**

```bash
git checkout -b feat/job-queue-phase4-cleanup-ticks
```

- [ ] **Step 2: Add `name` to the Schedule model**

In `prisma/schema.prisma`, add one field to `model Schedule` (after `id`):

```prisma
model Schedule {
  id        String    @id @default(cuid())
  name      String?   @unique // stable identity for code-owned system schedules; NULL for ad-hoc/client schedules
  jobType   String
  ...rest unchanged...
}
```

- [ ] **Step 3: Write the migration by hand**

`prisma migrate dev` is interactive-only in this environment. Create the folder + file `prisma/migrations/20260610230000_schedule_name/migration.sql`:

```sql
-- Add nullable unique name to Schedule. SQLite treats NULLs as distinct,
-- so only named (system) schedules are bound by the index.
ALTER TABLE "Schedule" ADD COLUMN "name" TEXT;
CREATE UNIQUE INDEX "Schedule_name_key" ON "Schedule"("name");
```

- [ ] **Step 4: Apply + regenerate client**

```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy
DATABASE_URL="file:./local-dev.db" npx prisma generate
```

Expected: migration `20260610230000_schedule_name` applied; client regenerated without errors.

- [ ] **Step 5: Verify schema parity**

```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma
```

Expected: "No difference detected."

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260610230000_schedule_name/
git commit -m "feat(jobs): add nullable unique Schedule.name for system-schedule identity"
```

---

### Task 1: Job-row retention (`cleanOldTerminalJobs`)

**Files:**
- Create: `lib/jobs/retention.ts`
- Create: `lib/jobs/retention.test.ts`
- Modify: `lib/cleanup.ts` (add task to `runCleanup`)

- [ ] **Step 1: Write the failing tests**

Create `lib/jobs/retention.test.ts`. Note: `updatedAt` can't be backdated through Prisma (`@updatedAt` overwrites it), so backdate with raw SQL — integer ms, matching storage.

```ts
// lib/jobs/retention.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { cleanOldTerminalJobs } from './retention'

const TYPE = 'test-retention'
const DAY = 24 * 60 * 60 * 1000

async function clearTestState() {
  await prisma.job.deleteMany({ where: { type: { startsWith: 'test-' } } })
  await prisma.schedule.deleteMany({ where: { jobType: { startsWith: 'test-' } } })
}

async function makeJob(
  status: string,
  ageDays: number,
  extra: Partial<Prisma.JobUncheckedCreateInput> = {},
): Promise<string> {
  const job = await prisma.job.create({ data: { type: TYPE, status, ...extra } })
  await prisma.$executeRaw`UPDATE "Job" SET "updatedAt" = ${Date.now() - ageDays * DAY} WHERE "id" = ${job.id}`
  return job.id
}

async function survives(id: string): Promise<boolean> {
  return (await prisma.job.findUnique({ where: { id } })) !== null
}

describe('cleanOldTerminalJobs', () => {
  beforeEach(clearTestState)

  it('deletes old complete/cancelled, keeps young ones', async () => {
    const oldComplete = await makeJob('complete', 8)
    const oldCancelled = await makeJob('cancelled', 8)
    const youngComplete = await makeJob('complete', 6)
    await cleanOldTerminalJobs()
    expect(await survives(oldComplete)).toBe(false)
    expect(await survives(oldCancelled)).toBe(false)
    expect(await survives(youngComplete)).toBe(true)
  })

  it('keeps errors under 30 days, deletes older', async () => {
    const youngError = await makeJob('error', 8)
    const oldError = await makeJob('error', 31)
    await cleanOldTerminalJobs()
    expect(await survives(youngError)).toBe(true)
    expect(await survives(oldError)).toBe(false)
  })

  it('never touches queued or running rows', async () => {
    const queued = await makeJob('queued', 60)
    const running = await makeJob('running', 60)
    await cleanOldTerminalJobs()
    expect(await survives(queued)).toBe(true)
    expect(await survives(running)).toBe(true)
  })

  it('keeps a job referenced by Schedule.lastJobId', async () => {
    const id = await makeJob('complete', 60)
    await prisma.schedule.create({
      data: { jobType: TYPE, cadence: 'every:10m', nextRunAt: new Date(), lastJobId: id },
    })
    await cleanOldTerminalJobs()
    expect(await survives(id)).toBe(true)
  })

  it("keeps a job holding its schedule's current nextRunAt slot, deletes other slots", async () => {
    const slot = new Date('2026-06-01T00:00:00Z')
    const sched = await prisma.schedule.create({
      data: { jobType: TYPE, cadence: 'every:10m', nextRunAt: slot },
    })
    const slotJob = await makeJob('complete', 60, { scheduleId: sched.id, scheduledFor: slot })
    const otherSlotJob = await makeJob('complete', 60, {
      scheduleId: sched.id,
      scheduledFor: new Date('2026-05-01T00:00:00Z'),
    })
    await cleanOldTerminalJobs()
    expect(await survives(slotJob)).toBe(true)
    expect(await survives(otherSlotJob)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/retention.test.ts
```

Expected: FAIL — `Cannot find module './retention'` (or equivalent).

- [ ] **Step 3: Implement `lib/jobs/retention.ts`**

```ts
// lib/jobs/retention.ts
//
// Job-row retention: terminal rows are deleted by age so the Job table
// doesn't grow without bound (one row per audited page + ~150 scheduled-job
// rows/day). Runs as a task inside runCleanup().
//
// Slot-record guard: scheduled jobs double as the durable
// exactly-once-per-slot record (@@unique([scheduleId, scheduledFor])).
// Never delete a job referenced by Schedule.lastJobId, or one whose
// (scheduleId, scheduledFor) matches its schedule's CURRENT nextRunAt — a
// stuck/unadvanced schedule would lose its slot record and re-run the slot.

import { prisma } from '@/lib/db'

const DAY_MS = 24 * 60 * 60 * 1000
/** complete/cancelled rows are kept 7 days. */
export const TERMINAL_JOB_RETENTION_MS = 7 * DAY_MS
/** error rows are kept 30 days (introspection surfaces recent failures). */
export const ERROR_JOB_RETENTION_MS = 30 * DAY_MS

export async function cleanOldTerminalJobs(now: Date = new Date()): Promise<void> {
  // Raw SQL: conditional logic in SQL per house style; updatedAt comparisons
  // are integer ms (SQLite storage format).
  const completeCutoff = now.getTime() - TERMINAL_JOB_RETENTION_MS
  const errorCutoff = now.getTime() - ERROR_JOB_RETENTION_MS
  await prisma.$executeRaw`
    DELETE FROM "Job"
    WHERE (
      ("status" IN ('complete', 'cancelled') AND "updatedAt" < ${completeCutoff})
      OR ("status" = 'error' AND "updatedAt" < ${errorCutoff})
    )
    AND "id" NOT IN (SELECT "lastJobId" FROM "Schedule" WHERE "lastJobId" IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM "Schedule" s
      WHERE s."id" = "Job"."scheduleId" AND s."nextRunAt" = "Job"."scheduledFor"
    )`
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/retention.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Wire into `runCleanup()`**

In `lib/cleanup.ts`: add the import and the task. (`lib/cleanup.test.ts` never calls `runCleanup()` — it tests the individual sweeps — so no test-mock changes are needed.)

```ts
import { cleanOldTerminalJobs } from '@/lib/jobs/retention';
```

and in `runCleanup()`:

```ts
  const results = await Promise.allSettled([
    cleanOrphanUploads(),
    cleanOrphanUploadDirectories(),
    cleanConsumedCompleteSessionUploads(),
    cleanExpiredSessions(),
    cleanExpiredShareLinks(),
    cleanExpiredAdaShareTokens(),
    cleanExpiredScreenshots(),
    cleanOldTerminalJobs(),
  ]);
```

Also update the docblock on `runCleanup` ("Called at startup and once per day from instrumentation.ts") to:

```ts
/**
 * Run all cleanup tasks. Called inline at startup (instrumentation.ts) and
 * daily via the 'cleanup' scheduled job (lib/jobs/handlers/cleanup.ts).
 * Each task is independent — a failure in one does not abort the others.
 */
```

- [ ] **Step 6: Run the cleanup tests (regression)**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/cleanup.test.ts lib/jobs/retention.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add lib/jobs/retention.ts lib/jobs/retention.test.ts lib/cleanup.ts
git commit -m "feat(jobs): terminal Job-row retention with slot-record guard"
```

---

### Task 2: The three job handlers

**Files:**
- Create: `lib/jobs/handlers/cleanup.ts`
- Create: `lib/jobs/handlers/screenshot-sweep.ts`
- Create: `lib/jobs/handlers/stale-audit-reset.ts`
- Create: `lib/jobs/handlers/cleanup.test.ts`
- Create: `lib/jobs/handlers/screenshot-sweep.test.ts`
- Create: `lib/jobs/handlers/stale-audit-reset.test.ts`
- Modify: `lib/jobs/handlers/register.ts`

- [ ] **Step 1: Write the failing tests (all three files)**

Create `lib/jobs/handlers/cleanup.test.ts`:

All three follow the local mock pattern (`screenshot-sweeper.test.ts`):
declare the `vi.fn()`, give `vi.mock` a delegating factory, then load the
module under test with top-level `await import()` — a static import would be
hoisted above the `const` and hit the temporal dead zone.

```ts
// lib/jobs/handlers/cleanup.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const runCleanup = vi.fn()
vi.mock('@/lib/cleanup', () => ({ runCleanup: (...a: unknown[]) => runCleanup(...a) }))

const { registerCleanupHandler, CLEANUP_JOB_TYPE } = await import('./cleanup')
const { getJobHandler, clearJobRegistryForTests } = await import('../registry')

const ctx = { jobId: 'j1', attempt: 1, signal: new AbortController().signal }

describe('jobs/handlers/cleanup', () => {
  beforeEach(() => {
    clearJobRegistryForTests()
    runCleanup.mockReset()
  })

  it('registers with the right config', () => {
    registerCleanupHandler()
    const cfg = getJobHandler(CLEANUP_JOB_TYPE)
    expect(cfg).toBeDefined()
    expect(cfg!.concurrency).toBe(1)
    expect(cfg!.maxAttempts).toBe(1)
    expect(cfg!.timeoutMs).toBe(10 * 60 * 1000)
    expect(cfg!.onExhausted).toBeUndefined()
  })

  it('delegates to runCleanup', async () => {
    runCleanup.mockResolvedValue(undefined)
    registerCleanupHandler()
    await getJobHandler(CLEANUP_JOB_TYPE)!.handler({}, ctx)
    expect(runCleanup).toHaveBeenCalledTimes(1)
  })

  it('propagates a throw (unexpected failure fails the job)', async () => {
    runCleanup.mockRejectedValue(new Error('db down'))
    registerCleanupHandler()
    await expect(getJobHandler(CLEANUP_JOB_TYPE)!.handler({}, ctx)).rejects.toThrow('db down')
  })
})
```

Create `lib/jobs/handlers/screenshot-sweep.test.ts`:

```ts
// lib/jobs/handlers/screenshot-sweep.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sweep = vi.fn()
vi.mock('@/lib/ada-audit/screenshot-sweeper', () => ({
  sweepExpiredScreenshots: (...a: unknown[]) => sweep(...a),
}))

const { registerScreenshotSweepHandler, SCREENSHOT_SWEEP_JOB_TYPE } = await import('./screenshot-sweep')
const { getJobHandler, clearJobRegistryForTests } = await import('../registry')

const ctx = { jobId: 'j1', attempt: 1, signal: new AbortController().signal }

describe('jobs/handlers/screenshot-sweep', () => {
  beforeEach(() => {
    clearJobRegistryForTests()
    sweep.mockReset()
  })

  it('registers with the right config', () => {
    registerScreenshotSweepHandler()
    const cfg = getJobHandler(SCREENSHOT_SWEEP_JOB_TYPE)
    expect(cfg).toBeDefined()
    expect(cfg!.concurrency).toBe(1)
    expect(cfg!.maxAttempts).toBe(1)
    expect(cfg!.timeoutMs).toBe(10 * 60 * 1000)
  })

  it('delegates to sweepExpiredScreenshots', async () => {
    sweep.mockResolvedValue({ checked: 0, deleted: 0 })
    registerScreenshotSweepHandler()
    await getJobHandler(SCREENSHOT_SWEEP_JOB_TYPE)!.handler({}, ctx)
    expect(sweep).toHaveBeenCalledTimes(1)
  })

  it('propagates a throw', async () => {
    sweep.mockRejectedValue(new Error('fs error'))
    registerScreenshotSweepHandler()
    await expect(getJobHandler(SCREENSHOT_SWEEP_JOB_TYPE)!.handler({}, ctx)).rejects.toThrow('fs error')
  })
})
```

Create `lib/jobs/handlers/stale-audit-reset.test.ts`:

```ts
// lib/jobs/handlers/stale-audit-reset.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const reset = vi.fn()
vi.mock('@/lib/ada-audit/queue-manager', () => ({
  resetStaleAudits: (...a: unknown[]) => reset(...a),
}))

const { registerStaleAuditResetHandler, STALE_AUDIT_RESET_JOB_TYPE } = await import('./stale-audit-reset')
const { getJobHandler, clearJobRegistryForTests } = await import('../registry')

const ctx = { jobId: 'j1', attempt: 1, signal: new AbortController().signal }

describe('jobs/handlers/stale-audit-reset', () => {
  beforeEach(() => {
    clearJobRegistryForTests()
    reset.mockReset()
  })

  it('registers with the right config', () => {
    registerStaleAuditResetHandler()
    const cfg = getJobHandler(STALE_AUDIT_RESET_JOB_TYPE)
    expect(cfg).toBeDefined()
    expect(cfg!.concurrency).toBe(1)
    expect(cfg!.maxAttempts).toBe(1)
    expect(cfg!.timeoutMs).toBe(5 * 60 * 1000) // registry default
  })

  it('delegates to resetStaleAudits', async () => {
    reset.mockResolvedValue(undefined)
    registerStaleAuditResetHandler()
    await getJobHandler(STALE_AUDIT_RESET_JOB_TYPE)!.handler({}, ctx)
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('propagates a throw', async () => {
    reset.mockRejectedValue(new Error('busy'))
    registerStaleAuditResetHandler()
    await expect(getJobHandler(STALE_AUDIT_RESET_JOB_TYPE)!.handler({}, ctx)).rejects.toThrow('busy')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/cleanup.test.ts lib/jobs/handlers/screenshot-sweep.test.ts lib/jobs/handlers/stale-audit-reset.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three handlers**

Create `lib/jobs/handlers/cleanup.ts`:

```ts
// lib/jobs/handlers/cleanup.ts
//
// Scheduled-job wrapper around runCleanup() (Phase 4 — replaces the daily
// setInterval that lived in instrumentation.ts; the inline startup call
// remains there). maxAttempts 1: the next daily slot IS the retry, matching
// the old interval semantics. runCleanup swallows per-task failures
// internally (Promise.allSettled), so a throw here is unexpected (DB/FS
// down) and correctly fails the job — visible in introspection.

import { runCleanup } from '@/lib/cleanup'
import { registerJobHandler } from '../registry'

export const CLEANUP_JOB_TYPE = 'cleanup'

export function registerCleanupHandler(): void {
  registerJobHandler({
    type: CLEANUP_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 1,
    // FS-heavy passes over 180-day-old sessions can be slow on the VPS.
    timeoutMs: 10 * 60 * 1000,
    handler: async () => {
      await runCleanup()
    },
  })
}
```

Create `lib/jobs/handlers/screenshot-sweep.ts`:

```ts
// lib/jobs/handlers/screenshot-sweep.ts
//
// Scheduled-job wrapper around sweepExpiredScreenshots() (Phase 4 — replaces
// the sweeper's own 30-min setInterval module state). maxAttempts 1: the
// next slot is the retry. The sweep walks SCREENSHOTS_DIR with one DB lookup
// per directory and per-directory try/catch, so a throw is unexpected.

import { sweepExpiredScreenshots } from '@/lib/ada-audit/screenshot-sweeper'
import { registerJobHandler } from '../registry'

export const SCREENSHOT_SWEEP_JOB_TYPE = 'screenshot-sweep'

export function registerScreenshotSweepHandler(): void {
  registerJobHandler({
    type: SCREENSHOT_SWEEP_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 1,
    // One DB lookup per screenshot dir; large fleets can outgrow 5 min.
    timeoutMs: 10 * 60 * 1000,
    handler: async () => {
      await sweepExpiredScreenshots()
    },
  })
}
```

Create `lib/jobs/handlers/stale-audit-reset.ts`:

```ts
// lib/jobs/handlers/stale-audit-reset.ts
//
// Scheduled-job wrapper around resetStaleAudits() (Phase 4 — replaces the
// 10-min setInterval in instrumentation.ts). It is a thin safety net since
// Phase 3; if the scheduler itself is wedged, audits aren't progressing
// either, and boot-time recoverQueue() is the real backstop.

import { registerJobHandler } from '../registry'

export const STALE_AUDIT_RESET_JOB_TYPE = 'stale-audit-reset'

export function registerStaleAuditResetHandler(): void {
  registerJobHandler({
    type: STALE_AUDIT_RESET_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 1,
    handler: async () => {
      // Dynamic import avoids a static handler → queue-manager → jobs/queue
      // edge (same reasoning as site-audit-discover).
      const { resetStaleAudits } = await import('@/lib/ada-audit/queue-manager')
      await resetStaleAudits()
    },
  })
}
```

- [ ] **Step 4: Register them in `lib/jobs/handlers/register.ts`**

```ts
// lib/jobs/handlers/register.ts
//
// Single registration point for built-in job handlers. Idempotent —
// instrumentation calls it BEFORE startup recovery (recoverJobsOnStartup may
// run onExhausted hooks, which need a populated registry) and startJobWorker
// calls it again (harmless re-register).

import { registerPsiHandler } from './psi'
import { registerPdfScanHandler } from './pdf-scan'
import { registerSiteAuditPageHandler } from './site-audit-page'
import { registerSiteAuditDiscoverHandler } from './site-audit-discover'
import { registerCleanupHandler } from './cleanup'
import { registerScreenshotSweepHandler } from './screenshot-sweep'
import { registerStaleAuditResetHandler } from './stale-audit-reset'

export function registerBuiltInJobHandlers(): void {
  registerPsiHandler()
  registerPdfScanHandler()
  registerSiteAuditPageHandler()
  registerSiteAuditDiscoverHandler()
  registerCleanupHandler()
  registerScreenshotSweepHandler()
  registerStaleAuditResetHandler()
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/cleanup.test.ts lib/jobs/handlers/screenshot-sweep.test.ts lib/jobs/handlers/stale-audit-reset.test.ts
```

Expected: 9 passed.

- [ ] **Step 6: Commit**

```bash
git add lib/jobs/handlers/cleanup.ts lib/jobs/handlers/screenshot-sweep.ts lib/jobs/handlers/stale-audit-reset.ts lib/jobs/handlers/cleanup.test.ts lib/jobs/handlers/screenshot-sweep.test.ts lib/jobs/handlers/stale-audit-reset.test.ts lib/jobs/handlers/register.ts
git commit -m "feat(jobs): cleanup, screenshot-sweep, stale-audit-reset job handlers"
```

---

### Task 3: `seedSystemSchedules()`

**Files:**
- Create: `lib/jobs/system-schedules.ts`
- Create: `lib/jobs/system-schedules.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/jobs/system-schedules.test.ts`. **Global-state discipline:** these tests create real `system-*` Schedule rows and real-typed Job rows in the shared dev DB — `clearTestState` must delete both, plus the usual `test-*` rows.

```ts
// lib/jobs/system-schedules.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { seedSystemSchedules, SYSTEM_SCHEDULES } from './system-schedules'
import { tickSchedules } from './scheduler'

const SYSTEM_TYPES = SYSTEM_SCHEDULES.map((s) => s.jobType)

async function clearTestState() {
  await prisma.job.deleteMany({ where: { type: { in: [...SYSTEM_TYPES, 'test-sys-retired'] } } })
  await prisma.job.deleteMany({ where: { type: { startsWith: 'test-' } } })
  await prisma.schedule.deleteMany({ where: { name: { startsWith: 'system-' } } })
  await prisma.schedule.deleteMany({ where: { jobType: { startsWith: 'test-' } } })
}

describe('seedSystemSchedules', () => {
  beforeEach(clearTestState)
  afterEach(clearTestState)

  it('creates all system schedules; cleanup starts at its next slot, the rest immediately', async () => {
    const now = new Date()
    await seedSystemSchedules(now)
    const rows = await prisma.schedule.findMany({ where: { name: { startsWith: 'system-' } } })
    expect(rows).toHaveLength(SYSTEM_SCHEDULES.length)
    for (const expected of SYSTEM_SCHEDULES) {
      const row = rows.find((r) => r.name === expected.name)!
      expect(row.jobType).toBe(expected.jobType)
      expect(row.cadence).toBe(expected.cadence)
      expect(row.enabled).toBe(true)
    }
    const sweep = rows.find((r) => r.name === 'system-screenshot-sweep')!
    const staleReset = rows.find((r) => r.name === 'system-stale-audit-reset')!
    const cleanup = rows.find((r) => r.name === 'system-cleanup')!
    expect(sweep.nextRunAt.getTime()).toBeLessThanOrEqual(now.getTime())
    expect(staleReset.nextRunAt.getTime()).toBeLessThanOrEqual(now.getTime())
    expect(cleanup.nextRunAt.getTime()).toBeGreaterThan(now.getTime())
  })

  it('re-seed is idempotent: no duplicates, nextRunAt preserved when cadence unchanged', async () => {
    await seedSystemSchedules()
    const before = await prisma.schedule.findMany({ where: { name: { startsWith: 'system-' } } })
    await seedSystemSchedules()
    const after = await prisma.schedule.findMany({ where: { name: { startsWith: 'system-' } } })
    expect(after).toHaveLength(before.length)
    for (const b of before) {
      const a = after.find((r) => r.id === b.id)!
      expect(a.nextRunAt.getTime()).toBe(b.nextRunAt.getTime())
    }
  })

  it('recomputes nextRunAt when the stored cadence differs', async () => {
    await seedSystemSchedules()
    const past = new Date(Date.now() - 60 * 60 * 1000)
    await prisma.schedule.update({
      where: { name: 'system-screenshot-sweep' },
      data: { cadence: 'every:5m', nextRunAt: past },
    })
    const now = new Date()
    await seedSystemSchedules(now)
    const row = await prisma.schedule.findUnique({ where: { name: 'system-screenshot-sweep' } })
    expect(row!.cadence).toBe('every:30m')
    expect(row!.nextRunAt.getTime()).toBe(now.getTime() + 30 * 60_000)
  })

  it('refreshes payload and re-enables a manually disabled row', async () => {
    await seedSystemSchedules()
    await prisma.schedule.update({
      where: { name: 'system-cleanup' },
      data: { enabled: false, payload: '{"drifted":true}' },
    })
    await seedSystemSchedules()
    const row = await prisma.schedule.findUnique({ where: { name: 'system-cleanup' } })
    expect(row!.enabled).toBe(true)
    expect(row!.payload).toBe('{}')
  })

  it('disables retired system-* schedules and cancels their queued jobs', async () => {
    const retired = await prisma.schedule.create({
      data: {
        name: 'system-retired-thing',
        jobType: 'test-sys-retired',
        cadence: 'every:10m',
        nextRunAt: new Date(),
      },
    })
    const queued = await prisma.job.create({
      data: { type: 'test-sys-retired', status: 'queued', scheduleId: retired.id },
    })
    const running = await prisma.job.create({
      data: { type: 'test-sys-retired', status: 'running', scheduleId: retired.id },
    })
    await seedSystemSchedules()
    const schedRow = await prisma.schedule.findUnique({ where: { id: retired.id } })
    expect(schedRow!.enabled).toBe(false)
    expect((await prisma.job.findUnique({ where: { id: queued.id } }))!.status).toBe('cancelled')
    expect((await prisma.job.findUnique({ where: { id: running.id } }))!.status).toBe('running')
  })

  it('concurrent seeding still yields exactly one row per schedule', async () => {
    const now = new Date()
    await Promise.all([seedSystemSchedules(now), seedSystemSchedules(now)])
    const rows = await prisma.schedule.findMany({ where: { name: { startsWith: 'system-' } } })
    expect(rows).toHaveLength(SYSTEM_SCHEDULES.length)
  })

  it('leaves NULL-name schedules alone', async () => {
    const adHoc = await prisma.schedule.create({
      data: { jobType: 'test-adhoc', cadence: 'every:10m', nextRunAt: new Date() },
    })
    await seedSystemSchedules()
    const row = await prisma.schedule.findUnique({ where: { id: adHoc.id } })
    expect(row!.enabled).toBe(true)
  })

  it('integration: tickSchedules enqueues one job per due system schedule', async () => {
    await seedSystemSchedules()
    const past = new Date(Date.now() - 60_000)
    await prisma.schedule.updateMany({
      where: { name: { startsWith: 'system-' } },
      data: { nextRunAt: past },
    })
    await tickSchedules()
    for (const s of SYSTEM_SCHEDULES) {
      const sched = await prisma.schedule.findUnique({ where: { name: s.name } })
      const jobs = await prisma.job.findMany({ where: { scheduleId: sched!.id } })
      expect(jobs).toHaveLength(1)
      expect(jobs[0].type).toBe(s.jobType)
      expect(jobs[0].status).toBe('queued')
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/system-schedules.test.ts
```

Expected: FAIL — `Cannot find module './system-schedules'`.

- [ ] **Step 3: Implement `lib/jobs/system-schedules.ts`**

```ts
// lib/jobs/system-schedules.ts
//
// Code-owned recurring schedules, seeded idempotently at every boot
// (instrumentation.ts, after recovery, before startJobWorker so the first
// tick sees them). Phase 4 of the durable-job-queue spec — these replace the
// setIntervals that lived in instrumentation.ts.
//
// 'system-' is a RESERVED namespace and the seed is the source of truth: a
// manual DB disable of a system-* row is temporary by design (re-enabled at
// next boot). An operator kill switch, if ever needed, is an env flag — not
// DB mutation. C2/D5 client schedules will use name = NULL (exempt from the
// unique index and from the retired-row sweep).

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { CLEANUP_JOB_TYPE } from './handlers/cleanup'
import { SCREENSHOT_SWEEP_JOB_TYPE } from './handlers/screenshot-sweep'
import { STALE_AUDIT_RESET_JOB_TYPE } from './handlers/stale-audit-reset'
import { nextRun } from './scheduler'

interface SystemScheduleDef {
  name: string
  jobType: string
  cadence: string
  /** false → first run waits for the next cadence slot instead of now. */
  immediate: boolean
}

export const SYSTEM_SCHEDULES: SystemScheduleDef[] = [
  // NOT immediate: the inline startup runCleanup() in instrumentation.ts
  // already covers "cleanup soon after deploy" — an immediate seed would
  // race two concurrent cleanups at first boot (idempotent but noisy).
  // daily@09:00 server-local = overnight for US clients (server runs UTC).
  { name: 'system-cleanup', jobType: CLEANUP_JOB_TYPE, cadence: 'daily@09:00', immediate: false },
  { name: 'system-screenshot-sweep', jobType: SCREENSHOT_SWEEP_JOB_TYPE, cadence: 'every:30m', immediate: true },
  { name: 'system-stale-audit-reset', jobType: STALE_AUDIT_RESET_JOB_TYPE, cadence: 'every:10m', immediate: true },
]

export async function seedSystemSchedules(now: Date = new Date()): Promise<void> {
  for (const def of SYSTEM_SCHEDULES) {
    let existing = await prisma.schedule.findUnique({ where: { name: def.name } })
    if (!existing) {
      try {
        await prisma.schedule.create({
          data: {
            name: def.name,
            jobType: def.jobType,
            cadence: def.cadence,
            payload: '{}',
            enabled: true,
            nextRunAt: def.immediate ? now : nextRun(def.cadence, now),
          },
        })
        continue
      } catch (err) {
        // Lost a concurrent-create race on the name unique index — fall
        // through to the update path against the winner's row. Race-safety
        // matters here: this is the reusable C2/D5 seeding primitive.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err
        existing = await prisma.schedule.findUniqueOrThrow({ where: { name: def.name } })
      }
    }
    await prisma.schedule.update({
      where: { id: existing.id },
      data: {
        jobType: def.jobType,
        cadence: def.cadence,
        payload: '{}',
        enabled: true,
        // Preserve scheduling continuity across restarts; recompute only
        // when the cadence itself changed in code.
        ...(existing.cadence !== def.cadence ? { nextRunAt: nextRun(def.cadence, now) } : {}),
      },
    })
  }

  // Retired system schedules: a renamed/removed entry must not keep
  // enqueuing jobs no handler will claim — and its already-queued orphans
  // would sit 'queued' forever (retention never touches queued rows).
  const retired = await prisma.schedule.findMany({
    where: { name: { startsWith: 'system-', notIn: SYSTEM_SCHEDULES.map((s) => s.name) } },
    select: { id: true, name: true },
  })
  if (retired.length > 0) {
    const ids = retired.map((r) => r.id)
    await prisma.schedule.updateMany({ where: { id: { in: ids } }, data: { enabled: false } })
    await prisma.job.updateMany({
      where: { scheduleId: { in: ids }, status: 'queued' },
      data: { status: 'cancelled', completedAt: now },
    })
    console.warn(`[jobs] disabled retired system schedule(s): ${retired.map((r) => r.name).join(', ')}`)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/system-schedules.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/system-schedules.ts lib/jobs/system-schedules.test.ts
git commit -m "feat(jobs): idempotent system-schedule seeding with retired-row sweep"
```

---

### Task 4: Rewire `instrumentation.ts`, delete the intervals

**Files:**
- Modify: `instrumentation.ts`
- Modify: `lib/ada-audit/screenshot-sweeper.ts` (delete the interval machinery)

- [ ] **Step 1: Strip the interval machinery from the sweeper**

`lib/ada-audit/screenshot-sweeper.ts` keeps `sweepExpiredScreenshots()` and loses everything interval-related. Delete `SWEEP_INTERVAL_MS`, `intervalHandle`, `startScreenshotSweeper`, and `stopScreenshotSweeper`. The file becomes:

```ts
import { promises as fs } from 'fs'
import { prisma } from '@/lib/db'
import { SCREENSHOTS_DIR, SCREENSHOT_RETENTION_MS, deleteScreenshots } from './screenshot-helpers'

// Runs every 30 min via the 'screenshot-sweep' scheduled job
// (lib/jobs/handlers/screenshot-sweep.ts) — Phase 4 replaced this module's
// own setInterval.
export async function sweepExpiredScreenshots(): Promise<{ checked: number; deleted: number }> {
  // ... existing body unchanged ...
}
```

(`screenshot-sweeper.test.ts` only tests `sweepExpiredScreenshots` — no test changes.)

- [ ] **Step 2: Rewire `instrumentation.ts`**

Three deletions and one addition. The resulting middle section (from the cleanup block through the shutdown handler) becomes:

```ts
    // Close the headless browser cleanly on shutdown so Chrome doesn't orphan.
    // fuser -k in the deploy command sends SIGTERM before starting the new process.
    const { closeBrowser } = await import('@/lib/ada-audit/browser-pool')

    // Inline startup cleanup ("run at boot" isn't a cadence). The daily
    // recurrence runs via the 'cleanup' scheduled job — see
    // lib/jobs/system-schedules.ts. Same for the 10-min stale-audit reset
    // and 30-min screenshot sweep; instrumentation owns no setIntervals.
    const { runCleanup } = await import('@/lib/cleanup')
    void runCleanup()

    // Job queue boot order (each step depends on the previous):
    // 1. Register handlers — startup recovery may run onExhausted hooks,
    //    which need a populated registry.
    // 2. recoverJobsOnStartup — recoverQueue decides parent-audit survival
    //    based on active jobs in the Job table.
    // 3. recoverQueue (awaited) — resumes transient parents with outstanding
    //    durable jobs (incl. 'running' since Phase 3), finalizes drained
    //    ones, fails the rest. Deterministic before any claims.
    // 4. seedSystemSchedules — upsert the code-owned system-* Schedule rows
    //    so the worker's first tick sees them.
    // 5. startJobWorker — only now may jobs start draining.
    const { registerBuiltInJobHandlers } = await import('@/lib/jobs/handlers/register')
    registerBuiltInJobHandlers()
    const { recoverJobsOnStartup } = await import('@/lib/jobs/recovery')
    await recoverJobsOnStartup()

    // Recover queued/stale audits from crashes and kick the queue processor
    const { recoverQueue } = await import('@/lib/ada-audit/queue-manager')
    await recoverQueue()

    const { seedSystemSchedules } = await import('@/lib/jobs/system-schedules')
    await seedSystemSchedules()

    const { startJobWorker, stopJobWorker } = await import('@/lib/jobs/worker')
    await startJobWorker()

    let shuttingDown = false
    const shutdown = async () => {
      if (shuttingDown) return
      shuttingDown = true
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
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
```

Specifically deleted relative to the current file: `cleanupInterval` (and its `setInterval`), `resetStaleAudits` from the queue-manager import and `staleCheckInterval`, the entire `startScreenshotSweeper`/`stopScreenshotSweeper` import + calls, and the three corresponding cleanup lines at the top of `shutdown()`.

- [ ] **Step 3: Grep for stragglers**

```bash
grep -rn "startScreenshotSweeper\|stopScreenshotSweeper\|staleCheckInterval\|cleanupInterval" --include='*.ts' . | grep -v node_modules | grep -v .claude/worktrees
```

Expected: no output.

- [ ] **Step 4: Typecheck + full suite + build**

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npx vitest run
npm run build
```

Expected: tsc clean; full suite green (~1,720+ tests); build succeeds.

- [ ] **Step 5: Commit**

```bash
git add instrumentation.ts lib/ada-audit/screenshot-sweeper.ts
git commit -m "feat(jobs): instrumentation owns no setIntervals — cleanup ticks run as scheduled jobs"
```

---

### Task 5: Docs (CLAUDE.md) + integration pass

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

In **Key files**, add after the `queue-manager.ts` line:

```markdown
- `lib/jobs/system-schedules.ts` — code-owned `system-*` Schedule rows (cleanup daily@09:00, screenshot-sweep every:30m, stale-audit-reset every:10m), seeded idempotently at boot; `system-` is a reserved namespace
```

In **Architecture patterns** → the "Stale audit recovery" bullet, replace `Both resetStaleAudits() (every 10 min, 5-min threshold)` with `Both resetStaleAudits() (every 10 min via the stale-audit-reset scheduled job, 5-min threshold)`.

In **Architecture patterns** → the "Durable job queue" bullet, replace the sentence ending `— running, pdfs-running, and lighthouse-running site audits all survive restarts and resume draining.` so the bullet also covers Phase 4. New ending:

```markdown
— `running`, `pdfs-running`, and `lighthouse-running` site audits all survive restarts and resume draining. Recurring maintenance (daily `runCleanup`, 10-min `resetStaleAudits`, 30-min screenshot sweep) runs as scheduled jobs seeded from `lib/jobs/system-schedules.ts` — `instrumentation.ts` owns no `setInterval`s (startup `runCleanup()` stays inline). Terminal Job rows are pruned by `lib/jobs/retention.ts` (complete/cancelled 7 d, error 30 d, slot-record guard). PDF scan concurrency = `PDF_POOL_SIZE` (default 4). Specs: `docs/superpowers/specs/2026-06-10-durable-job-queue-design.md` + `2026-06-10-durable-job-queue-phase3-design.md` + `2026-06-10-durable-job-queue-phase4-design.md`.
```

(Delete the now-duplicated `PDF scan concurrency` + `Specs:` text from the old ending so it appears once.)

- [ ] **Step 2: Final verification**

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npx vitest run
npm run build
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md — Phase 4 scheduled maintenance jobs + Job retention"
```

---

### Task 6: PR + tracker/handoff

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/job-queue-phase4-cleanup-ticks
gh pr create --title "A1 Phase 4: cleanup ticks + screenshot sweeper as scheduled jobs" --body "$(cat <<'EOF'
## Summary
- `Schedule.name` (nullable unique) + `seedSystemSchedules()`: three code-owned `system-*` schedules (cleanup daily@09:00, screenshot-sweep every:30m, stale-audit-reset every:10m), seeded idempotently at boot; retired `system-*` rows are disabled and their queued jobs cancelled
- Three thin job handlers (`cleanup`, `screenshot-sweep`, `stale-audit-reset`), concurrency 1 / maxAttempts 1 (next slot is the retry)
- `instrumentation.ts` owns no `setInterval`s anymore (startup `runCleanup()` stays inline); screenshot-sweeper interval module machinery deleted
- Job-row retention: `cleanOldTerminalJobs()` in `runCleanup()` — complete/cancelled > 7 d, error > 30 d, never queued/running, with a slot-record guard protecting `Schedule.lastJobId` and current `(scheduleId, nextRunAt)` slot jobs

Spec: `docs/superpowers/specs/2026-06-10-durable-job-queue-phase4-design.md` (Codex-reviewed, accept-with-fixes ×5 applied)

## Test plan
- [ ] Full suite green
- [ ] Post-deploy: three `system-*` rows seeded, scheduler enqueues + worker drains `screenshot-sweep`/`stale-audit-reset` within minutes; `cleanup` fires at 09:00 UTC

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Update tracker + handoff doc (same commit), per the improvement-roadmap handoff protocol in CLAUDE.md**

Mark A1 Phase 4 built (PR open) in `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md` (status-log line; A1 stays `[~]` until merged/deployed/verified), rewrite `docs/superpowers/todos/HANDOFF-improvement-roadmap.md` (next action: merge/deploy + post-deploy verification of the seeded schedules, then A1 → `[x]`), and commit both together.

---

## Post-merge production verification (Kevin / next session)

After deploy, on the server:
1. Boot log shows no errors from `seedSystemSchedules`.
2. `sqlite3 /home/seo/data/seo-tools/db.sqlite "SELECT name, jobType, cadence, enabled, datetime(nextRunAt/1000,'unixepoch') FROM Schedule WHERE name LIKE 'system-%'"` → three enabled rows.
3. Within ~2 min: `SELECT type, status, COUNT(*) FROM Job WHERE type IN ('screenshot-sweep','stale-audit-reset') GROUP BY 1,2` shows completed runs (cleanup waits for its 09:00 slot).
4. Next day: a `cleanup` job completed at the 09:00 slot; terminal Job rows older than 7 d are gone.
