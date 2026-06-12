# C2 — Scheduled Recurring Site Audits + Score Deltas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Client-owned recurring site-audit schedules (weekly/monthly) riding the existing A1 Schedule tick, with triage-check carry-forward, cadence-aware retention for schedule-originated audits, and per-schedule score deltas on the client dashboard.

**Architecture:** Client schedules are plain `Schedule` rows (`name: null`, `clientId` set) whose `scheduled-site-audit` job calls `queueSiteAuditRequest()` — the scheduled path joins the site-audit queue exactly where the manual POST route does, so every existing invariant (one-active claim, finalizer, recovery, findings dual-write) applies unchanged. New `SiteAudit.scheduleId` (SetNull) is the attribution + retention marker; CrawlRun survival (A2 SetNull) makes hard-deleting old scheduled origin rows safe.

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite, vitest, existing durable job queue (`lib/jobs/`).

**Spec:** `docs/superpowers/specs/2026-06-11-scheduled-scans-design.md` (Codex-reviewed ×9 fixes applied).

**Conventions that bind every task:**
- Run tests with `DATABASE_URL="file:./local-dev.db" npx vitest run <file>`.
- NEVER use interactive `prisma.$transaction(async tx => …)` — array form only.
- DB-backed test files use a unique domain/name prefix per file (this plan uses `c2sched-`); clean `CrawlRun` by domain BEFORE origin rows in test setup.
- `prisma migrate dev` is interactive-only locally — migration SQL is written by hand, applied with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy`.

---

### Task 1: Schema — `SiteAudit.scheduleId`

**Files:**
- Modify: `prisma/schema.prisma` (SiteAudit ~line 114, Schedule ~line 428)
- Create: `prisma/migrations/20260612000000_c2_scheduled_scans/migration.sql`

- [ ] **Step 1: Edit `prisma/schema.prisma`**

In `model SiteAudit`, after the `batch` relation block (after `requestedBy   String?` is also fine — keep field grouping tidy), add:

```prisma
  scheduleId    String?
  schedule      Schedule?  @relation(fields: [scheduleId], references: [id], onDelete: SetNull)
```

and at the bottom of the model with the other indexes:

```prisma
  @@index([scheduleId])
```

In `model Schedule`, add the reverse relation next to the `client` relation:

```prisma
  siteAudits SiteAudit[]
```

- [ ] **Step 2: Write the migration SQL by hand**

`prisma/migrations/20260612000000_c2_scheduled_scans/migration.sql`:

```sql
-- C2: schedule-originated site audits carry their Schedule id.
-- Nullable column + index; no backfill. ON DELETE SET NULL: deleting a
-- schedule converts its historical audits to manual-class (never pruned
-- by scheduled retention).
ALTER TABLE "SiteAudit" ADD COLUMN "scheduleId" TEXT REFERENCES "Schedule" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SiteAudit_scheduleId_idx" ON "SiteAudit"("scheduleId");
```

- [ ] **Step 3: Apply + regenerate client**

```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy
npx prisma generate
```

Expected: `1 migration applied`, client regenerated without validation errors (the reverse relation makes validation pass).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no code references the new field yet).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260612000000_c2_scheduled_scans/
git commit -m "feat(c2): SiteAudit.scheduleId attribution column (SetNull, indexed)"
```

---

### Task 2: Monthly cadence + cadence classes (`lib/jobs/scheduler.ts`)

**Files:**
- Modify: `lib/jobs/scheduler.ts`
- Test: `lib/jobs/scheduler.test.ts` (exists — extend)

- [ ] **Step 1: Write failing tests**

Append to the existing describe blocks in `lib/jobs/scheduler.test.ts` (match the file's existing import of `parseCadence`/`nextRun`; add `cadenceClass` to that import):

```ts
describe('parseCadence — monthly', () => {
  it('parses monthly:1@06:00', () => {
    expect(parseCadence('monthly:1@06:00')).toEqual({ kind: 'monthly', dom: 1, hour: 6, minute: 0 })
  })
  it('parses monthly:28@23:59', () => {
    expect(parseCadence('monthly:28@23:59')).toEqual({ kind: 'monthly', dom: 28, hour: 23, minute: 59 })
  })
  it.each(['monthly:0@06:00', 'monthly:29@06:00', 'monthly:31@06:00'])('rejects out-of-range DOM %s', (c) => {
    expect(() => parseCadence(c)).toThrow()
  })
  it('rejects malformed monthly strings', () => {
    expect(() => parseCadence('monthly:1@6:00')).toThrow()
    expect(() => parseCadence('monthly@06:00')).toThrow()
  })
})

describe('nextRun — monthly', () => {
  it('advances to the DOM later this month when still ahead', () => {
    // from = June 5 2026 10:00 local; monthly:15@06:00 → June 15 06:00
    const from = new Date(2026, 5, 5, 10, 0, 0, 0)
    const next = nextRun('monthly:15@06:00', from)
    expect([next.getMonth(), next.getDate(), next.getHours(), next.getMinutes()]).toEqual([5, 15, 6, 0])
  })
  it('rolls to next month when the slot already passed', () => {
    const from = new Date(2026, 5, 20, 10, 0, 0, 0) // June 20
    const next = nextRun('monthly:15@06:00', from)
    expect([next.getMonth(), next.getDate()]).toEqual([6, 15]) // July 15
  })
  it('same-day later time stays today; same-day earlier time rolls a month', () => {
    const at5 = new Date(2026, 5, 15, 5, 0, 0, 0)
    expect(nextRun('monthly:15@06:00', at5).getDate()).toBe(15)
    expect(nextRun('monthly:15@06:00', at5).getMonth()).toBe(5)
    const at7 = new Date(2026, 5, 15, 7, 0, 0, 0)
    expect(nextRun('monthly:15@06:00', at7).getMonth()).toBe(6)
  })
  it('rolls across the year boundary', () => {
    const from = new Date(2026, 11, 20, 10, 0, 0, 0) // Dec 20
    const next = nextRun('monthly:15@06:00', from)
    expect([next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([2027, 0, 15])
  })
  it('collapses missed slots into one (computed from `from`)', () => {
    const from = new Date(2026, 5, 20, 10, 0, 0, 0)
    const next = nextRun('monthly:1@06:00', from)
    expect([next.getMonth(), next.getDate()]).toEqual([6, 1]) // one run, July 1
  })
})

describe('cadenceClass', () => {
  it.each([
    ['weekly:1@06:00', 'weekly'],
    ['monthly:1@06:00', 'monthly'],
    ['every:7d', 'weekly'],
    ['every:14d', 'weekly'],
  ])('%s → %s', (cadence, cls) => {
    expect(cadenceClass(cadence)).toBe(cls)
  })
  it.each(['daily@09:00', 'every:30m', 'every:6d', 'every:1d'])('%s → daily class', (cadence) => {
    expect(cadenceClass(cadence)).toBe('daily')
  })
  it('throws on unparseable cadence', () => {
    expect(() => cadenceClass('nonsense')).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/scheduler.test.ts`
Expected: FAIL — `cadenceClass` not exported; monthly strings throw `Unrecognized cadence`.

- [ ] **Step 3: Implement in `lib/jobs/scheduler.ts`**

Extend the `Cadence` union:

```ts
export type Cadence =
  | { kind: 'every'; ms: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; dow: number; hour: number; minute: number }
  | { kind: 'monthly'; dom: number; hour: number; minute: number }
```

In `parseCadence`, before the final `throw`:

```ts
  const monthly = /^monthly:(\d{1,2})@(\d{2}):(\d{2})$/.exec(cadence)
  if (monthly) {
    const dom = Number.parseInt(monthly[1], 10)
    if (dom < 1 || dom > 28) throw new Error(`Monthly day-of-month must be 1-28: ${cadence}`)
    return {
      kind: 'monthly',
      dom,
      hour: parseClock(monthly[2], 23, cadence),
      minute: parseClock(monthly[3], 59, cadence),
    }
  }
```

In `nextRun`, after the daily branch (before the weekly loop) add:

```ts
  if (c.kind === 'monthly') {
    next.setDate(c.dom)
    next.setHours(c.hour, c.minute, 0, 0)
    while (next <= from) {
      next.setMonth(next.getMonth() + 1, c.dom)
      next.setHours(c.hour, c.minute, 0, 0)
    }
    return next
  }
```

(Note: `next.setDate(c.dom)` before the loop can land in this month or — when `from` is e.g. the 31st — overflow into next month; the `while` then settles on the first slot strictly after `from`. DOM ≤ 28 makes `setMonth(m+1, dom)` overflow-free.)

After `nextRun`, add the class helper:

```ts
/**
 * Coarse cadence class for C2 gating + retention windows.
 * 'daily' = anything that can fire more than ~weekly (every:<7d, daily@…).
 */
export type CadenceClass = 'daily' | 'weekly' | 'monthly'

export function cadenceClass(cadence: string): CadenceClass {
  const c = parseCadence(cadence)
  if (c.kind === 'monthly') return 'monthly'
  if (c.kind === 'weekly') return 'weekly'
  if (c.kind === 'every' && c.ms >= 7 * 86_400_000) return 'weekly'
  return 'daily'
}
```

- [ ] **Step 4: Run tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/scheduler.test.ts`
Expected: PASS (all existing + new).

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/scheduler.ts lib/jobs/scheduler.test.ts
git commit -m "feat(c2): monthly:DOM@HH:MM cadence + cadenceClass helper"
```

---

### Task 3: Thread `scheduleId` through enqueue (born attributed)

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts` (`EnqueueAuditOptions`, `enqueueAudit`)
- Modify: `lib/ada-audit/queue-request.ts` (`QueueRequestInput`, the `enqueueAudit` call)
- Test: `lib/ada-audit/queue-request.test.ts` (exists — extend)

- [ ] **Step 1: Write the failing test**

Append to `lib/ada-audit/queue-request.test.ts` (follow the file's existing setup helpers; create a Schedule row to satisfy the FK):

```ts
it('stamps scheduleId on the SiteAudit at creation (born attributed)', async () => {
  const sched = await prisma.schedule.create({
    data: {
      jobType: 'scheduled-site-audit',
      cadence: 'weekly:1@06:00',
      payload: '{}',
      nextRunAt: new Date('2099-01-01T00:00:00Z'),
    },
  })
  const result = await queueSiteAuditRequest({
    domain: 'c2sched-born.example.edu',
    clientId: null,
    wcagLevel: 'wcag21aa',
    scheduleId: sched.id,
  })
  expect(result.kind).toBe('queued')
  const audit = await prisma.siteAudit.findUnique({
    where: { id: (result as { kind: 'queued'; id: string }).id },
    select: { scheduleId: true },
  })
  expect(audit?.scheduleId).toBe(sched.id) // set by create, not a follow-up update
})
```

Cleanup: in the test file's `afterAll`/cleanup block, also delete SiteAudits with domain prefix `c2sched-` and the created Schedule row (delete audits first or rely on SetNull — either is fine; deleting the schedule leaves the audit with `scheduleId: null`, so delete audits by domain prefix regardless).

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/queue-request.test.ts`
Expected: FAIL — `scheduleId` not in `QueueRequestInput` (type error) / audit has `scheduleId: null`.

- [ ] **Step 3: Implement**

`lib/ada-audit/queue-manager.ts` — extend the options interface and the create:

```ts
export interface EnqueueAuditOptions {
  preDiscoveredUrls?: string[]
  requestedBy?: string | null
  /** C2: set when a Schedule row created this audit — attribution + retention marker. */
  scheduleId?: string | null
}
```

In `enqueueAudit`, destructure and pass through:

```ts
  const { requestedBy, scheduleId } = opts
```

and in the `prisma.siteAudit.create` data object add:

```ts
      scheduleId: scheduleId ?? null,
```

`lib/ada-audit/queue-request.ts`:

```ts
export interface QueueRequestInput {
  domain: string
  clientId: number | null
  wcagLevel: string
  preDiscoveredUrls?: string[]
  requestedBy?: string | null
  scheduleId?: string | null
}
```

and in the `enqueueAudit` call:

```ts
  const { id } = await enqueueAudit(domain, input.clientId, wcagLevel, {
    preDiscoveredUrls: normalisedUrls,
    requestedBy: input.requestedBy ?? null,
    scheduleId: input.scheduleId ?? null,
  })
```

- [ ] **Step 4: Run tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/queue-request.test.ts lib/ada-audit/queue-manager.test.ts`
Expected: PASS (existing tests unaffected — the option is additive).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/queue-manager.ts lib/ada-audit/queue-request.ts lib/ada-audit/queue-request.test.ts
git commit -m "feat(c2): thread scheduleId through queueSiteAuditRequest/enqueueAudit"
```

---

### Task 4: `scheduled-site-audit` job handler

**Files:**
- Create: `lib/jobs/handlers/scheduled-site-audit.ts`
- Modify: `lib/jobs/handlers/register.ts`
- Test: `lib/jobs/handlers/scheduled-site-audit.test.ts` (new)
- Test: `lib/jobs/handlers/register.test.ts` (extend: assert the type is registered)

- [ ] **Step 1: Write the handler**

`lib/jobs/handlers/scheduled-site-audit.ts`:

```ts
// lib/jobs/handlers/scheduled-site-audit.ts
//
// C2: thin wrapper fired by client-owned Schedule rows. Resolves its
// Schedule via the Job row (JobHandlerContext has no scheduleId and the
// scheduler does not inject it into payloads), re-validates the client +
// domain, then enters the normal site-audit queue via queueSiteAuditRequest
// — so the one-active claim, dedup, finalizer, recovery, and findings
// dual-write all apply unchanged.
//
// Self-healing, never destructive: config rot (archived client, delisted
// domain, malformed payload) disables the schedule and completes. A
// duplicate in-flight audit consumes the slot (no catch-up run). DB errors
// throw → worker retries with backoff; the next cadence slot is the
// durable retry after exhaustion.

import { prisma } from '@/lib/db'
import { registerJobHandler } from '../registry'

export const SCHEDULED_SITE_AUDIT_JOB_TYPE = 'scheduled-site-audit'

interface ScheduledSiteAuditPayload {
  clientId: number
  domain: string
  wcagLevel: string
}

function parsePayload(payload: unknown): ScheduledSiteAuditPayload | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Record<string, unknown>
  if (typeof p.clientId !== 'number' || !Number.isInteger(p.clientId)) return null
  if (typeof p.domain !== 'string' || p.domain.length === 0) return null
  const wcagLevel = p.wcagLevel === 'wcag22aa' ? 'wcag22aa' : 'wcag21aa'
  return { clientId: p.clientId, domain: p.domain, wcagLevel }
}

async function disableSchedule(scheduleId: string, reason: string): Promise<void> {
  try {
    await prisma.schedule.update({ where: { id: scheduleId }, data: { enabled: false } })
    console.warn(`[schedule] disabled ${scheduleId}: ${reason}`)
  } catch (err) {
    console.warn(`[schedule] failed to disable ${scheduleId} (${reason}):`, (err as Error).message)
  }
}

export function registerScheduledSiteAuditHandler(): void {
  registerJobHandler({
    type: SCHEDULED_SITE_AUDIT_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 3,
    timeoutMs: 30_000, // it only enqueues
    handler: async (payload, ctx) => {
      const job = await prisma.job.findUnique({
        where: { id: ctx.jobId },
        select: { scheduleId: true },
      })
      if (!job?.scheduleId) {
        console.warn(`[schedule] job ${ctx.jobId} has no scheduleId; skipping`)
        return
      }
      const schedule = await prisma.schedule.findUnique({
        where: { id: job.scheduleId },
        select: { id: true, enabled: true },
      })
      if (!schedule || !schedule.enabled) return // deleted or paused since enqueue — no-op

      const p = parsePayload(payload)
      if (!p) {
        await disableSchedule(schedule.id, 'malformed payload')
        return
      }

      const client = await prisma.client.findUnique({
        where: { id: p.clientId },
        select: { archivedAt: true, domains: true },
      })
      let domains: string[] = []
      try {
        const parsed = client ? JSON.parse(client.domains) : []
        if (Array.isArray(parsed)) domains = parsed.filter((d): d is string => typeof d === 'string')
      } catch { /* treat as no domains */ }
      if (!client || client.archivedAt || !domains.includes(p.domain)) {
        await disableSchedule(schedule.id, 'client missing/archived or domain no longer listed')
        return
      }

      // Dynamic import: avoids a static handler → queue-manager edge
      // (same reasoning as stale-audit-reset / site-audit-discover).
      const { queueSiteAuditRequest } = await import('@/lib/ada-audit/queue-request')
      const result = await queueSiteAuditRequest({
        domain: p.domain,
        clientId: p.clientId,
        wcagLevel: p.wcagLevel,
        requestedBy: 'scheduled',
        scheduleId: schedule.id,
      })
      if (result.kind === 'duplicate') {
        console.log(`[schedule] ${schedule.id}: slot skipped — audit ${result.existingId} already in flight`)
      } else if (result.kind === 'invalid') {
        await disableSchedule(schedule.id, `request invalid: ${result.reason}`)
      }
    },
  })
}
```

- [ ] **Step 2: Register it**

`lib/jobs/handlers/register.ts` — add the import and call:

```ts
import { registerScheduledSiteAuditHandler } from './scheduled-site-audit'
```

and inside `registerBuiltInJobHandlers()`:

```ts
  registerScheduledSiteAuditHandler()
```

- [ ] **Step 3: Write the tests**

`lib/jobs/handlers/scheduled-site-audit.test.ts` — DB-backed, prefix `c2sched-h-`. Follow the structure of `lib/jobs/handlers/ada-audit.test.ts` for how handlers are invoked in tests (register into the registry, then call the captured handler directly with a payload + fake ctx). Mock `queue-request` partially:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { getJobHandler } from '../registry'
import { registerScheduledSiteAuditHandler, SCHEDULED_SITE_AUDIT_JOB_TYPE } from './scheduled-site-audit'

const queueMock = vi.hoisted(() => ({
  queueSiteAuditRequest: vi.fn(),
}))
vi.mock('@/lib/ada-audit/queue-request', () => queueMock)

const PREFIX = 'c2sched-h-'

function ctxFor(jobId: string) {
  return { jobId, attempt: 1, signal: new AbortController().signal }
}

async function makeSchedule(overrides: Record<string, unknown> = {}) {
  return prisma.schedule.create({
    data: {
      jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE,
      cadence: 'weekly:1@06:00',
      payload: '{}',
      nextRunAt: new Date('2099-01-01T00:00:00Z'),
      ...overrides,
    },
  })
}

async function makeJob(scheduleId: string | null) {
  return prisma.job.create({
    data: {
      type: SCHEDULED_SITE_AUDIT_JOB_TYPE,
      status: 'running',
      payload: '{}',
      scheduleId,
      scheduledFor: scheduleId ? new Date() : null,
    },
  })
}

describe('scheduled-site-audit handler', () => {
  let handler: (payload: unknown, ctx: ReturnType<typeof ctxFor>) => Promise<void>
  let client: { id: number }

  beforeAll(async () => {
    registerScheduledSiteAuditHandler()
    handler = getJobHandler(SCHEDULED_SITE_AUDIT_JOB_TYPE)!.handler
    client = await prisma.client.create({
      data: { name: `${PREFIX}client`, domains: JSON.stringify([`${PREFIX}ok.example.edu`]) },
    })
  })

  beforeEach(() => {
    queueMock.queueSiteAuditRequest.mockReset()
    queueMock.queueSiteAuditRequest.mockResolvedValue({ kind: 'queued', id: 'audit-1' })
  })

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { type: SCHEDULED_SITE_AUDIT_JOB_TYPE } })
    await prisma.schedule.deleteMany({ where: { jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, name: null } })
    await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
  })

  it('enqueues via queueSiteAuditRequest with scheduleId + requestedBy scheduled', async () => {
    const sched = await makeSchedule({ clientId: client.id })
    const job = await makeJob(sched.id)
    await handler(
      { clientId: client.id, domain: `${PREFIX}ok.example.edu`, wcagLevel: 'wcag21aa' },
      ctxFor(job.id),
    )
    expect(queueMock.queueSiteAuditRequest).toHaveBeenCalledWith({
      domain: `${PREFIX}ok.example.edu`,
      clientId: client.id,
      wcagLevel: 'wcag21aa',
      requestedBy: 'scheduled',
      scheduleId: sched.id,
    })
  })

  it('no-ops when the job has no scheduleId', async () => {
    const job = await makeJob(null)
    await handler({ clientId: client.id, domain: `${PREFIX}ok.example.edu`, wcagLevel: 'wcag21aa' }, ctxFor(job.id))
    expect(queueMock.queueSiteAuditRequest).not.toHaveBeenCalled()
  })

  it('no-ops when the schedule was deleted or disabled since enqueue', async () => {
    const sched = await makeSchedule({ clientId: client.id, enabled: false })
    const job = await makeJob(sched.id)
    await handler({ clientId: client.id, domain: `${PREFIX}ok.example.edu`, wcagLevel: 'wcag21aa' }, ctxFor(job.id))
    expect(queueMock.queueSiteAuditRequest).not.toHaveBeenCalled()
    const after = await prisma.schedule.findUnique({ where: { id: sched.id } })
    expect(after?.enabled).toBe(false) // not "re-disabled" — just skipped
  })

  it('disables the schedule on malformed payload', async () => {
    const sched = await makeSchedule({ clientId: client.id })
    const job = await makeJob(sched.id)
    await handler({ nonsense: true }, ctxFor(job.id))
    expect(queueMock.queueSiteAuditRequest).not.toHaveBeenCalled()
    const after = await prisma.schedule.findUnique({ where: { id: sched.id } })
    expect(after?.enabled).toBe(false)
  })

  it('disables the schedule when the client is archived', async () => {
    const archived = await prisma.client.create({
      data: {
        name: `${PREFIX}archived`,
        domains: JSON.stringify([`${PREFIX}arch.example.edu`]),
        archivedAt: new Date(),
      },
    })
    const sched = await makeSchedule({ clientId: archived.id })
    const job = await makeJob(sched.id)
    await handler({ clientId: archived.id, domain: `${PREFIX}arch.example.edu`, wcagLevel: 'wcag21aa' }, ctxFor(job.id))
    expect(queueMock.queueSiteAuditRequest).not.toHaveBeenCalled()
    expect((await prisma.schedule.findUnique({ where: { id: sched.id } }))?.enabled).toBe(false)
  })

  it('disables the schedule when the domain is no longer listed on the client', async () => {
    const sched = await makeSchedule({ clientId: client.id })
    const job = await makeJob(sched.id)
    await handler({ clientId: client.id, domain: `${PREFIX}gone.example.edu`, wcagLevel: 'wcag21aa' }, ctxFor(job.id))
    expect(queueMock.queueSiteAuditRequest).not.toHaveBeenCalled()
    expect((await prisma.schedule.findUnique({ where: { id: sched.id } }))?.enabled).toBe(false)
  })

  it('duplicate result consumes the slot quietly (schedule stays enabled)', async () => {
    queueMock.queueSiteAuditRequest.mockResolvedValue({ kind: 'duplicate', existingId: 'x' })
    const sched = await makeSchedule({ clientId: client.id })
    const job = await makeJob(sched.id)
    await handler({ clientId: client.id, domain: `${PREFIX}ok.example.edu`, wcagLevel: 'wcag21aa' }, ctxFor(job.id))
    expect((await prisma.schedule.findUnique({ where: { id: sched.id } }))?.enabled).toBe(true)
  })

  it('invalid result disables the schedule', async () => {
    queueMock.queueSiteAuditRequest.mockResolvedValue({ kind: 'invalid', reason: 'bad domain' })
    const sched = await makeSchedule({ clientId: client.id })
    const job = await makeJob(sched.id)
    await handler({ clientId: client.id, domain: `${PREFIX}ok.example.edu`, wcagLevel: 'wcag21aa' }, ctxFor(job.id))
    expect((await prisma.schedule.findUnique({ where: { id: sched.id } }))?.enabled).toBe(false)
  })

  it('DB error from queueSiteAuditRequest propagates (worker retries)', async () => {
    queueMock.queueSiteAuditRequest.mockRejectedValue(new Error('SQLITE_BUSY'))
    const sched = await makeSchedule({ clientId: client.id })
    const job = await makeJob(sched.id)
    await expect(
      handler({ clientId: client.id, domain: `${PREFIX}ok.example.edu`, wcagLevel: 'wcag21aa' }, ctxFor(job.id)),
    ).rejects.toThrow('SQLITE_BUSY')
  })
})
```

NOTE for the implementer: check `lib/jobs/registry.ts` for the actual accessor name (`getJobHandler` or similar — `registry.ts:14-23` registers into a module Map; use whatever existing handler tests use to reach the registered config). If existing handler tests capture the config via a `registerJobHandler` mock instead, follow that pattern verbatim — do not invent a new access path.

`lib/jobs/handlers/register.test.ts` — extend the existing registration assertions with `'scheduled-site-audit'` (follow the file's existing pattern listing expected registered types).

- [ ] **Step 4: Run tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/scheduled-site-audit.test.ts lib/jobs/handlers/register.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/scheduled-site-audit.ts lib/jobs/handlers/scheduled-site-audit.test.ts lib/jobs/handlers/register.ts lib/jobs/handlers/register.test.ts
git commit -m "feat(c2): scheduled-site-audit job type — schedule slots enter the site-audit queue"
```

---

### Task 5: Triage-check carry-forward

**Files:**
- Create: `lib/ada-audit/carry-forward-checks.ts`
- Modify: `lib/ada-audit/site-audit-finalizer.ts` (invoke before the findings hook)
- Test: `lib/ada-audit/carry-forward-checks.test.ts` (new)
- Test: `lib/ada-audit/site-audit-finalizer.test.ts` (extend wiring assertions)

- [ ] **Step 1: Write the module**

`lib/ada-audit/carry-forward-checks.ts`:

```ts
// lib/ada-audit/carry-forward-checks.ts
//
// C2: copy SiteAuditCheck rows from the previous completed audit of the
// same domain to a just-completed audit. Keys are content-derived sha256
// digests, so identical findings hash identically across runs — analysts
// don't re-dismiss the same finding monthly.
//
// Domain-keyed, not client-keyed (a dismissal is about the finding, not
// the client record). Keys with no matching finding in the new run are
// inert rows that die with the audit. Fire-and-forget from the finalizer:
// a failure logs and never affects the audit.

import { prisma } from '@/lib/db'

const CHUNK = 50

export async function carryForwardSiteAuditChecks(siteAuditId: string): Promise<void> {
  const audit = await prisma.siteAudit.findUnique({
    where: { id: siteAuditId },
    select: { domain: true, completedAt: true },
  })
  if (!audit?.completedAt) return

  const prev = await prisma.siteAudit.findFirst({
    where: {
      domain: audit.domain,
      status: 'complete',
      id: { not: siteAuditId },
      completedAt: { lt: audit.completedAt },
    },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  })
  if (!prev) return

  const [prevChecks, existing] = await Promise.all([
    prisma.siteAuditCheck.findMany({
      where: { siteAuditId: prev.id },
      select: { scope: true, key: true, checkedBy: true },
    }),
    prisma.siteAuditCheck.findMany({
      where: { siteAuditId },
      select: { scope: true, key: true },
    }),
  ])
  const have = new Set(existing.map((c) => `${c.scope}\n${c.key}`))
  const toCopy = prevChecks.filter((c) => !have.has(`${c.scope}\n${c.key}`))
  if (toCopy.length === 0) return

  for (let i = 0; i < toCopy.length; i += CHUNK) {
    const chunk = toCopy.slice(i, i + CHUNK)
    try {
      await prisma.siteAuditCheck.createMany({
        data: chunk.map((c) => ({ siteAuditId, scope: c.scope, key: c.key, checkedBy: c.checkedBy })),
      })
    } catch {
      // SQLite createMany has no skipDuplicates; a concurrent insert of the
      // same (siteAuditId, scope, key) fails the whole chunk. Fall back to
      // row-by-row, tolerating unique-index hits.
      for (const c of chunk) {
        try {
          await prisma.siteAuditCheck.create({
            data: { siteAuditId, scope: c.scope, key: c.key, checkedBy: c.checkedBy },
          })
        } catch { /* duplicate — already present, fine */ }
      }
    }
  }
  console.log(`[checks] carried ${toCopy.length} check(s) forward from ${prev.id} to ${siteAuditId}`)
}
```

- [ ] **Step 2: Write module tests**

`lib/ada-audit/carry-forward-checks.test.ts` — DB-backed, prefix `c2sched-cf-`. Helper to create completed audits:

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { carryForwardSiteAuditChecks } from './carry-forward-checks'

const PREFIX = 'c2sched-cf-'

let seq = 0
async function makeAudit(domain: string, completedAt: Date | null, status = 'complete') {
  seq += 1
  return prisma.siteAudit.create({
    data: { domain, status, wcagLevel: 'wcag21aa', completedAt },
  })
}

function key(n: number): string {
  return n.toString(16).padStart(64, '0') // 64-char lowercase hex, like real keys
}

afterAll(async () => {
  const audits = await prisma.siteAudit.findMany({
    where: { domain: { startsWith: PREFIX } },
    select: { id: true },
  })
  await prisma.siteAuditCheck.deleteMany({ where: { siteAuditId: { in: audits.map((a) => a.id) } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
})

describe('carryForwardSiteAuditChecks', () => {
  it('copies checks by content key from the latest previous completed same-domain audit', async () => {
    const domain = `${PREFIX}a.example.edu`
    const oldest = await makeAudit(domain, new Date('2026-01-01T00:00:00Z'))
    const prev = await makeAudit(domain, new Date('2026-02-01T00:00:00Z'))
    const current = await makeAudit(domain, new Date('2026-03-01T00:00:00Z'))
    await prisma.siteAuditCheck.createMany({
      data: [
        { siteAuditId: oldest.id, scope: 'page', key: key(1), checkedBy: 'ancient' },
        { siteAuditId: prev.id, scope: 'page', key: key(2), checkedBy: 'kevin' },
        { siteAuditId: prev.id, scope: 'page-violation', key: key(3), checkedBy: null },
      ],
    })
    await carryForwardSiteAuditChecks(current.id)
    const copied = await prisma.siteAuditCheck.findMany({
      where: { siteAuditId: current.id },
      orderBy: { key: 'asc' },
    })
    expect(copied.map((c) => [c.scope, c.key, c.checkedBy])).toEqual([
      ['page', key(2), 'kevin'],
      ['page-violation', key(3), null],
    ]) // from prev only — NOT from oldest
  })

  it('skips keys already present on the new audit', async () => {
    const domain = `${PREFIX}b.example.edu`
    const prev = await makeAudit(domain, new Date('2026-02-01T00:00:00Z'))
    const current = await makeAudit(domain, new Date('2026-03-01T00:00:00Z'))
    await prisma.siteAuditCheck.createMany({
      data: [
        { siteAuditId: prev.id, scope: 'page', key: key(10), checkedBy: 'old' },
        { siteAuditId: current.id, scope: 'page', key: key(10), checkedBy: 'new' },
      ],
    })
    await carryForwardSiteAuditChecks(current.id)
    const rows = await prisma.siteAuditCheck.findMany({ where: { siteAuditId: current.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].checkedBy).toBe('new') // not clobbered
  })

  it('no previous completed audit → no-op', async () => {
    const current = await makeAudit(`${PREFIX}c.example.edu`, new Date('2026-03-01T00:00:00Z'))
    await expect(carryForwardSiteAuditChecks(current.id)).resolves.toBeUndefined()
    expect(await prisma.siteAuditCheck.count({ where: { siteAuditId: current.id } })).toBe(0)
  })

  it('ignores non-complete and not-yet-completed audits when picking the source', async () => {
    const domain = `${PREFIX}d.example.edu`
    const errored = await makeAudit(domain, new Date('2026-02-15T00:00:00Z'), 'error')
    await prisma.siteAuditCheck.create({
      data: { siteAuditId: errored.id, scope: 'page', key: key(20), checkedBy: 'x' },
    })
    const current = await makeAudit(domain, new Date('2026-03-01T00:00:00Z'))
    await carryForwardSiteAuditChecks(current.id)
    expect(await prisma.siteAuditCheck.count({ where: { siteAuditId: current.id } })).toBe(0)
  })

  it('audit without completedAt → no-op (never runs pre-completion)', async () => {
    const running = await makeAudit(`${PREFIX}e.example.edu`, null, 'running')
    await expect(carryForwardSiteAuditChecks(running.id)).resolves.toBeUndefined()
  })

  it('is re-entrant: second invocation adds nothing', async () => {
    const domain = `${PREFIX}f.example.edu`
    const prev = await makeAudit(domain, new Date('2026-02-01T00:00:00Z'))
    const current = await makeAudit(domain, new Date('2026-03-01T00:00:00Z'))
    await prisma.siteAuditCheck.create({
      data: { siteAuditId: prev.id, scope: 'page', key: key(30), checkedBy: 'k' },
    })
    await carryForwardSiteAuditChecks(current.id)
    await carryForwardSiteAuditChecks(current.id)
    expect(await prisma.siteAuditCheck.count({ where: { siteAuditId: current.id } })).toBe(1)
  })
})
```

- [ ] **Step 3: Run module tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/carry-forward-checks.test.ts`
Expected: PASS.

- [ ] **Step 4: Wire into the finalizer**

`lib/ada-audit/site-audit-finalizer.ts` — add the import:

```ts
import { carryForwardSiteAuditChecks } from './carry-forward-checks'
```

and insert AFTER the `processNext` kick block and BEFORE the findings dual-write block (the findings hook stays the LAST invocation — load-bearing invariant; "before" is invocation order only, both are unawaited and touch disjoint tables):

```ts
  // Carry triage checks forward from the previous completed same-domain
  // audit (C2). Fire-and-forget; invoked before the findings hook so the
  // findings hook stays LAST. Disjoint tables — overlap is harmless.
  void carryForwardSiteAuditChecks(id).catch((e) => {
    console.error('[checks] carry-forward failed for site audit', id, e)
  })
```

- [ ] **Step 5: Extend finalizer tests**

In `lib/ada-audit/site-audit-finalizer.test.ts`, mock the new module alongside the file's existing mocks (`vi.mock('./carry-forward-checks', () => ({ carryForwardSiteAuditChecks: vi.fn().mockResolvedValue(undefined) }))` — match the file's established mock style, e.g. `vi.hoisted` if that's what neighbors use) and add two tests following the existing completion-path tests:

```ts
it('invokes carry-forward on completion, before the findings hook', async () => {
  // drive an audit through the existing completion-path helper used by
  // neighboring tests, then:
  expect(carryForwardSiteAuditChecks).toHaveBeenCalledWith(auditId)
  // invocation-order assertion: carry-forward call index < writeFindingsRun call index
  const cfOrder = (carryForwardSiteAuditChecks as Mock).mock.invocationCallOrder[0]
  const findingsOrder = (writeFindingsRun as Mock).mock.invocationCallOrder[0]
  expect(cfOrder).toBeLessThan(findingsOrder)
})

it('carry-forward rejection does not fail finalization', async () => {
  ;(carryForwardSiteAuditChecks as Mock).mockRejectedValueOnce(new Error('boom'))
  // completion still flips status to complete (assert via the pattern the
  // file already uses for the findings-hook-failure test)
})
```

(Adapt identifiers to the test file's actual helpers — it already has completion-path and findings-hook tests to copy from; `site-audit-finalizer.findings.test.ts` shows the findings-mock pattern. Non-finalizer test files that complete audits may also need the new mock if they assert on console output — run the suite and fix fallout.)

- [ ] **Step 6: Run tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/site-audit-finalizer.test.ts lib/ada-audit/site-audit-finalizer.findings.test.ts lib/ada-audit/carry-forward-checks.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/ada-audit/carry-forward-checks.ts lib/ada-audit/carry-forward-checks.test.ts lib/ada-audit/site-audit-finalizer.ts lib/ada-audit/site-audit-finalizer.test.ts
git commit -m "feat(c2): carry triage checks forward across same-domain site audits"
```

---

### Task 6: Cadence-aware retention for scheduled audits

**Files:**
- Create: `lib/ada-audit/scheduled-retention.ts`
- Modify: `lib/cleanup.ts` (register in `runCleanup()`)
- Test: `lib/ada-audit/scheduled-retention.test.ts` (new)

- [ ] **Step 1: Write the module**

`lib/ada-audit/scheduled-retention.ts`:

```ts
// lib/ada-audit/scheduled-retention.ts
//
// C2 cadence-aware retention (the DB-growth gate): schedule-originated
// SiteAudits accumulate without human intent, so they get a deletion
// policy manual audits don't have. Deleting the origin row cascades the
// blob-heavy children (AdaAudit + checks + PdfAudits); the CrawlRun
// subtree survives (origin FK SetNull) — scores/findings/trends are
// permanent, only the blob-backed results view ages out. On-disk
// screenshots are collected by the existing screenshot sweep (it removes
// directories whose AdaAudit row is gone).
//
// Active immediately (no inert flag): scheduleId is new in this PR, so no
// pre-existing rows can match. Orphaned scheduled audits (schedule deleted
// → SetNull) are manual-class and never pruned here.

import { prisma } from '@/lib/db'
import { cadenceClass, type CadenceClass } from '@/lib/jobs/scheduler'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'

/** ≈ a dozen retained runs per schedule at any cadence. 'daily' is
 * unreachable in v1 (CRUD rejects daily-class cadences) but priced in. */
export const RETENTION_DAYS: Record<CadenceClass, number> = {
  daily: 14,
  weekly: 90,
  monthly: 365,
}

/** Most recent completed audits per schedule that are never pruned —
 * preserves the latest results view and the carry-forward source. */
export const KEEP_LATEST_COMPLETED = 2

const TERMINAL = ['complete', 'error', 'cancelled']
const DAY_MS = 86_400_000
const CHUNK = 25

export async function pruneScheduledSiteAudits(now: Date = new Date()): Promise<void> {
  const schedules = await prisma.schedule.findMany({
    where: { jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, siteAudits: { some: {} } },
    select: { id: true, cadence: true },
  })
  for (const sched of schedules) {
    let cls: CadenceClass
    try {
      cls = cadenceClass(sched.cadence)
    } catch {
      cls = 'monthly' // unparseable cadence → most conservative window
    }
    const cutoff = new Date(now.getTime() - RETENTION_DAYS[cls] * DAY_MS)

    const keep = await prisma.siteAudit.findMany({
      where: { scheduleId: sched.id, status: 'complete' },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      take: KEEP_LATEST_COMPLETED,
      select: { id: true },
    })
    const candidates = await prisma.siteAudit.findMany({
      where: {
        scheduleId: sched.id,
        status: { in: TERMINAL },
        createdAt: { lt: cutoff },
        id: { notIn: keep.map((k) => k.id) },
      },
      select: { id: true },
    })
    if (candidates.length === 0) continue

    for (let i = 0; i < candidates.length; i += CHUNK) {
      const ids = candidates.slice(i, i + CHUNK).map((c) => c.id)
      // Children cascade at the DB level (AdaAudit/PdfAudit/checks);
      // CrawlRun.siteAuditId is SetNull — findings survive.
      await prisma.siteAudit.deleteMany({ where: { id: { in: ids } } })
    }
    console.log(`[retention] pruned ${candidates.length} scheduled audit(s) (schedule ${sched.id}, ${cls} window)`)
  }
}
```

- [ ] **Step 2: Write tests**

`lib/ada-audit/scheduled-retention.test.ts` — DB-backed, prefix `c2sched-r-`. The fixed "now" keeps windows deterministic:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { pruneScheduledSiteAudits, RETENTION_DAYS } from './scheduled-retention'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'

const PREFIX = 'c2sched-r-'
const NOW = new Date('2026-06-12T00:00:00Z')
const DAY_MS = 86_400_000

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS)
}

async function makeSchedule(cadence: string) {
  return prisma.schedule.create({
    data: { jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, cadence, payload: '{}', nextRunAt: new Date('2099-01-01T00:00:00Z') },
  })
}

async function makeAudit(opts: {
  scheduleId: string | null
  status: string
  createdAt: Date
  domain?: string
  withChildren?: boolean
}) {
  const audit = await prisma.siteAudit.create({
    data: {
      domain: opts.domain ?? `${PREFIX}site.example.edu`,
      status: opts.status,
      wcagLevel: 'wcag21aa',
      scheduleId: opts.scheduleId,
      createdAt: opts.createdAt,
      completedAt: opts.status === 'complete' ? opts.createdAt : null,
    },
  })
  if (opts.withChildren) {
    const child = await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}site.example.edu/p`, status: 'complete', siteAuditId: audit.id },
    })
    await prisma.siteAuditCheck.create({
      data: { siteAuditId: audit.id, scope: 'page', key: 'f'.repeat(64) },
    })
    await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'site-audit', status: 'complete', domain: `${PREFIX}site.example.edu`, siteAuditId: audit.id, score: 90 },
    })
    return { audit, childId: child.id }
  }
  return { audit, childId: null }
}

beforeAll(async () => {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
})

afterAll(async () => {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.schedule.deleteMany({ where: { jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, name: null } })
})

describe('pruneScheduledSiteAudits', () => {
  it('prunes past-window terminal scheduled audits; CrawlRun survives with SetNull', async () => {
    const sched = await makeSchedule('weekly:1@06:00')
    const { audit, childId } = await makeAudit({
      scheduleId: sched.id, status: 'complete', createdAt: daysAgo(RETENTION_DAYS.weekly + 10), withChildren: true,
    })
    // two newer completed audits so the keep-latest guard doesn't save it
    await makeAudit({ scheduleId: sched.id, status: 'complete', createdAt: daysAgo(2) })
    await makeAudit({ scheduleId: sched.id, status: 'complete', createdAt: daysAgo(1) })

    await pruneScheduledSiteAudits(NOW)

    expect(await prisma.siteAudit.findUnique({ where: { id: audit.id } })).toBeNull()
    expect(await prisma.adaAudit.findUnique({ where: { id: childId! } })).toBeNull() // cascaded
    const run = await prisma.crawlRun.findFirst({ where: { domain: `${PREFIX}site.example.edu` } })
    expect(run).not.toBeNull()
    expect(run!.siteAuditId).toBeNull() // SetNull — findings/trends survive
    expect(run!.score).toBe(90)
  })

  it('keeps the 2 most recent completed audits regardless of age', async () => {
    const sched = await makeSchedule('weekly:1@06:00')
    const old1 = await makeAudit({ scheduleId: sched.id, status: 'complete', createdAt: daysAgo(400), domain: `${PREFIX}keep.example.edu` })
    const old2 = await makeAudit({ scheduleId: sched.id, status: 'complete', createdAt: daysAgo(300), domain: `${PREFIX}keep.example.edu` })
    await pruneScheduledSiteAudits(NOW)
    expect(await prisma.siteAudit.findUnique({ where: { id: old1.audit.id } })).not.toBeNull()
    expect(await prisma.siteAudit.findUnique({ where: { id: old2.audit.id } })).not.toBeNull()
  })

  it('never prunes non-terminal scheduled audits', async () => {
    const sched = await makeSchedule('weekly:1@06:00')
    const running = await makeAudit({ scheduleId: sched.id, status: 'running', createdAt: daysAgo(400), domain: `${PREFIX}run.example.edu` })
    await pruneScheduledSiteAudits(NOW)
    expect(await prisma.siteAudit.findUnique({ where: { id: running.audit.id } })).not.toBeNull()
  })

  it('never touches manual audits or orphaned scheduled audits (scheduleId null)', async () => {
    await makeSchedule('weekly:1@06:00') // a schedule exists, but these rows aren't its
    const manual = await makeAudit({ scheduleId: null, status: 'complete', createdAt: daysAgo(800), domain: `${PREFIX}manual.example.edu` })
    await pruneScheduledSiteAudits(NOW)
    expect(await prisma.siteAudit.findUnique({ where: { id: manual.audit.id } })).not.toBeNull()
  })

  it('window is cadence-aware: a 100-day-old audit dies under weekly but survives under monthly', async () => {
    const weekly = await makeSchedule('weekly:1@06:00')
    const monthly = await makeSchedule('monthly:1@06:00')
    const underWeekly = await makeAudit({ scheduleId: weekly.id, status: 'error', createdAt: daysAgo(100), domain: `${PREFIX}w.example.edu` })
    const underMonthly = await makeAudit({ scheduleId: monthly.id, status: 'error', createdAt: daysAgo(100), domain: `${PREFIX}m.example.edu` })
    await pruneScheduledSiteAudits(NOW)
    expect(await prisma.siteAudit.findUnique({ where: { id: underWeekly.audit.id } })).toBeNull()
    expect(await prisma.siteAudit.findUnique({ where: { id: underMonthly.audit.id } })).not.toBeNull()
  })

  it('error/cancelled audits are pruned by the window without the completed-keep guard', async () => {
    const sched = await makeSchedule('weekly:1@06:00')
    const errored = await makeAudit({ scheduleId: sched.id, status: 'error', createdAt: daysAgo(120), domain: `${PREFIX}err.example.edu` })
    await pruneScheduledSiteAudits(NOW)
    expect(await prisma.siteAudit.findUnique({ where: { id: errored.audit.id } })).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/scheduled-retention.test.ts`
Expected: PASS.

- [ ] **Step 4: Register in `runCleanup()`**

`lib/cleanup.ts` — add the import:

```ts
import { pruneScheduledSiteAudits } from '@/lib/ada-audit/scheduled-retention';
```

and add to the `Promise.allSettled` array in `runCleanup()` after `pruneArchivedBlobs(),`:

```ts
    pruneScheduledSiteAudits(),
```

- [ ] **Step 5: Run cleanup tests + typecheck**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/cleanup.test.ts lib/jobs/handlers/cleanup.test.ts && npx tsc --noEmit`
Expected: PASS / clean. (If `lib/cleanup.test.ts` asserts the exact task list, extend it.)

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/scheduled-retention.ts lib/ada-audit/scheduled-retention.test.ts lib/cleanup.ts
git commit -m "feat(c2): cadence-aware retention for schedule-originated site audits"
```

---

### Task 7: `client-schedules` service

**Files:**
- Create: `lib/services/client-schedules.ts`
- Test: `lib/services/client-schedules.test.ts` (new)

- [ ] **Step 1: Write the service**

`lib/services/client-schedules.ts`:

```ts
// lib/services/client-schedules.ts
//
// C2: per-client scan schedules joined with last-run info for the
// ScheduledScansCard and the schedules CRUD GET. Scores come from
// CrawlRun.score joined by siteAuditId — the finalizer does not persist
// SiteAudit.score; CrawlRun is the ADA score source of truth (B1).

import { prisma } from '@/lib/db'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'

export interface ClientScheduleRow {
  id: string
  domain: string
  wcagLevel: string
  cadence: string
  enabled: boolean
  nextRunAt: string
  lastRun: { id: string; status: string; completedAt: string | null; score: number | null } | null
  /** lastRun score minus the previous completed scheduled run's score; null when <2 scored runs. */
  lastDelta: number | null
}

export async function getClientSchedules(clientId: number): Promise<ClientScheduleRow[]> {
  const schedules = await prisma.schedule.findMany({
    where: { clientId, jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  if (schedules.length === 0) return []

  const audits = await prisma.siteAudit.findMany({
    where: { scheduleId: { in: schedules.map((s) => s.id) } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      scheduleId: true,
      status: true,
      completedAt: true,
      crawlRun: { select: { score: true } },
    },
  })

  return schedules.map((s) => {
    let domain = ''
    let wcagLevel = 'wcag21aa'
    try {
      const p = JSON.parse(s.payload) as Record<string, unknown>
      if (typeof p?.domain === 'string') domain = p.domain
      if (p?.wcagLevel === 'wcag22aa') wcagLevel = 'wcag22aa'
    } catch { /* malformed payload — render the row anyway */ }

    const mine = audits.filter((a) => a.scheduleId === s.id)
    const last = mine[0] ?? null
    const lastScore = last?.crawlRun?.score ?? null
    const prevScore =
      mine.slice(1).find((a) => a.status === 'complete' && typeof a.crawlRun?.score === 'number')
        ?.crawlRun?.score ?? null

    return {
      id: s.id,
      domain,
      wcagLevel,
      cadence: s.cadence,
      enabled: s.enabled,
      nextRunAt: s.nextRunAt.toISOString(),
      lastRun: last
        ? {
            id: last.id,
            status: last.status,
            completedAt: last.completedAt?.toISOString() ?? null,
            score: lastScore,
          }
        : null,
      lastDelta:
        last?.status === 'complete' && lastScore !== null && prevScore !== null
          ? lastScore - prevScore
          : null,
    }
  })
}
```

- [ ] **Step 2: Write tests**

`lib/services/client-schedules.test.ts` — DB-backed, prefix `c2sched-svc-`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { getClientSchedules } from './client-schedules'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'

const PREFIX = 'c2sched-svc-'
let clientId: number

beforeAll(async () => {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  const client = await prisma.client.create({
    data: { name: `${PREFIX}client`, domains: JSON.stringify([`${PREFIX}a.example.edu`]) },
  })
  clientId = client.id
})

afterAll(async () => {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.schedule.deleteMany({ where: { clientId } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

async function makeScheduledAudit(scheduleId: string, createdAt: Date, status: string, score: number | null) {
  const audit = await prisma.siteAudit.create({
    data: {
      domain: `${PREFIX}a.example.edu`, status, wcagLevel: 'wcag21aa',
      scheduleId, createdAt, completedAt: status === 'complete' ? createdAt : null,
    },
  })
  if (score !== null) {
    await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'site-audit', status: 'complete', domain: `${PREFIX}a.example.edu`, siteAuditId: audit.id, score },
    })
  }
  return audit
}

describe('getClientSchedules', () => {
  it('returns [] for a client with no schedules', async () => {
    expect(await getClientSchedules(clientId)).toEqual([])
  })

  it('joins last run + CrawlRun score + delta vs previous completed scheduled run', async () => {
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId, cadence: 'weekly:1@06:00',
        payload: JSON.stringify({ clientId, domain: `${PREFIX}a.example.edu`, wcagLevel: 'wcag22aa' }),
        nextRunAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    await makeScheduledAudit(sched.id, new Date('2026-04-01T00:00:00Z'), 'complete', 70)
    await makeScheduledAudit(sched.id, new Date('2026-05-01T00:00:00Z'), 'complete', 82)

    const rows = await getClientSchedules(clientId)
    expect(rows).toHaveLength(1)
    expect(rows[0].domain).toBe(`${PREFIX}a.example.edu`)
    expect(rows[0].wcagLevel).toBe('wcag22aa')
    expect(rows[0].lastRun?.score).toBe(82)
    expect(rows[0].lastDelta).toBe(12)
  })

  it('lastDelta is null when the latest run is not complete or only one scored run exists', async () => {
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId, cadence: 'monthly:1@06:00',
        payload: JSON.stringify({ clientId, domain: `${PREFIX}a.example.edu`, wcagLevel: 'wcag21aa' }),
        nextRunAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    await makeScheduledAudit(sched.id, new Date('2026-05-20T00:00:00Z'), 'complete', 75)
    const oneRun = (await getClientSchedules(clientId)).find((r) => r.id === sched.id)!
    expect(oneRun.lastRun?.score).toBe(75)
    expect(oneRun.lastDelta).toBeNull()

    await makeScheduledAudit(sched.id, new Date('2026-06-01T00:00:00Z'), 'error', null)
    const afterError = (await getClientSchedules(clientId)).find((r) => r.id === sched.id)!
    expect(afterError.lastRun?.status).toBe('error')
    expect(afterError.lastDelta).toBeNull()
  })

  it('does not surface system or non-scan schedules', async () => {
    await prisma.schedule.create({
      data: { jobType: 'cleanup', clientId, cadence: 'daily@09:00', payload: '{}', nextRunAt: new Date('2099-01-01T00:00:00Z') },
    })
    const rows = await getClientSchedules(clientId)
    expect(rows.every((r) => r.cadence !== 'daily@09:00')).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/client-schedules.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/services/client-schedules.ts lib/services/client-schedules.test.ts
git commit -m "feat(c2): client-schedules service (last-run join, CrawlRun.score deltas)"
```

---

### Task 8: Schedule CRUD routes + middleware guard test

**Files:**
- Create: `app/api/clients/[id]/schedules/route.ts` (GET, POST)
- Create: `app/api/clients/[id]/schedules/[scheduleId]/route.ts` (PATCH, DELETE)
- Test: `app/api/clients/[id]/schedules/route.test.ts` (new — covers both route files)
- Modify: `middleware.test.ts` (assert routes stay non-public)

- [ ] **Step 1: Write the collection route**

`app/api/clients/[id]/schedules/route.ts`:

```ts
// GET  /api/clients/[id]/schedules — list scan schedules + last-run info
// POST /api/clients/[id]/schedules — create a scan schedule
//
// Internal UI-facing routes: cookie-gated by the middleware (NOT in
// isPublicPath). One schedule per (client, domain) is best-effort v1 —
// app-level check; duplicates from racing POSTs are visible/deletable in
// the card UI.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { parseCadence, cadenceClass, nextRun } from '@/lib/jobs/scheduler'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'
import { getClientSchedules } from '@/lib/services/client-schedules'

type Params = { params: Promise<{ id: string }> }

function parseClientId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function GET(_request: NextRequest, { params }: Params) {
  const clientId = parseClientId((await params).id)
  if (clientId === null) return NextResponse.json({ error: 'invalid_client' }, { status: 400 })
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } })
  if (!client) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ schedules: await getClientSchedules(clientId) })
}

export async function POST(request: NextRequest, { params }: Params) {
  const clientId = parseClientId((await params).id)
  if (clientId === null) return NextResponse.json({ error: 'invalid_client' }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { archivedAt: true, domains: true },
  })
  if (!client) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (client.archivedAt) return NextResponse.json({ error: 'client_archived' }, { status: 409 })

  let domains: string[] = []
  try {
    const parsed = JSON.parse(client.domains)
    if (Array.isArray(parsed)) domains = parsed.filter((d): d is string => typeof d === 'string')
  } catch { /* no domains */ }
  const domain = typeof body.domain === 'string' ? body.domain.trim() : ''
  if (!domain || !domains.includes(domain)) {
    return NextResponse.json({ error: 'domain_not_listed' }, { status: 400 })
  }

  const cadence = typeof body.cadence === 'string' ? body.cadence : ''
  try {
    parseCadence(cadence)
  } catch {
    return NextResponse.json({ error: 'cadence_invalid' }, { status: 400 })
  }
  if (cadenceClass(cadence) === 'daily') {
    // DB-growth gate: daily-class scans stay off until blobs are
    // prunable-on-arrival (C3). Retention is already cadence-aware.
    return NextResponse.json({ error: 'cadence_not_allowed' }, { status: 400 })
  }

  const wcagLevel = body.wcagLevel === 'wcag22aa' ? 'wcag22aa' : 'wcag21aa'

  // Best-effort uniqueness (named in spec §7): one schedule per (client, domain).
  const existing = await prisma.schedule.findMany({
    where: { clientId, jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE },
    select: { payload: true },
  })
  const taken = existing.some((s) => {
    try {
      return (JSON.parse(s.payload) as Record<string, unknown>)?.domain === domain
    } catch {
      return false
    }
  })
  if (taken) return NextResponse.json({ error: 'schedule_exists' }, { status: 409 })

  const created = await prisma.schedule.create({
    data: {
      jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE,
      clientId,
      cadence,
      payload: JSON.stringify({ clientId, domain, wcagLevel }),
      nextRunAt: nextRun(cadence, new Date()), // never immediate
    },
  })
  return NextResponse.json({ id: created.id }, { status: 201 })
}
```

- [ ] **Step 2: Write the item route**

`app/api/clients/[id]/schedules/[scheduleId]/route.ts`:

```ts
// PATCH  /api/clients/[id]/schedules/[scheduleId] — { enabled: boolean }
// DELETE /api/clients/[id]/schedules/[scheduleId]
//
// Both scope the lookup to (clientId, jobType: scheduled-site-audit) so
// these routes can never touch system-* or other job types' Schedule rows.
// DELETE: historical audits become manual-class via SetNull (retained as
// manual history — deleting a schedule never schedules data destruction).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { nextRun } from '@/lib/jobs/scheduler'
import { cancelJobsByGroup } from '@/lib/jobs/queue'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'

type Params = { params: Promise<{ id: string; scheduleId: string }> }

async function findOwnedSchedule(rawClientId: string, scheduleId: string) {
  const clientId = Number(rawClientId)
  if (!Number.isInteger(clientId) || clientId <= 0) return null
  return prisma.schedule.findFirst({
    where: { id: scheduleId, clientId, jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE },
  })
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, scheduleId } = await params
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled_required' }, { status: 400 })
  }
  const sched = await findOwnedSchedule(id, scheduleId)
  if (!sched) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await prisma.schedule.update({
    where: { id: sched.id },
    data: body.enabled
      ? // Re-enable recomputes the slot from now — a long-paused schedule
        // must not fire instantly on a stale nextRunAt.
        { enabled: true, nextRunAt: nextRun(sched.cadence, new Date()) }
      : { enabled: false },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id, scheduleId } = await params
  const sched = await findOwnedSchedule(id, scheduleId)
  if (!sched) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await cancelJobsByGroup(`schedule:${sched.id}`)
  await prisma.schedule.delete({ where: { id: sched.id } })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Write route tests**

`app/api/clients/[id]/schedules/route.test.ts` — DB-backed, prefix `c2sched-rt-`. Follow the repo's route-test pattern (call exported handlers with a `NextRequest` and `{ params: Promise.resolve(...) }`; see `app/api/quarter-plan/route.test.ts` for the established style):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET, POST } from './route'
import { PATCH, DELETE } from './[scheduleId]/route'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'

const PREFIX = 'c2sched-rt-'
let clientId: number

function jsonReq(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/clients/x/schedules', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function p(id: number | string, scheduleId?: string) {
  return scheduleId
    ? { params: Promise.resolve({ id: String(id), scheduleId }) }
    : { params: Promise.resolve({ id: String(id) }) }
}

beforeAll(async () => {
  const client = await prisma.client.create({
    data: { name: `${PREFIX}client`, domains: JSON.stringify([`${PREFIX}a.example.edu`, `${PREFIX}b.example.edu`]) },
  })
  clientId = client.id
})

afterAll(async () => {
  await prisma.job.deleteMany({ where: { type: SCHEDULED_SITE_AUDIT_JOB_TYPE } })
  await prisma.schedule.deleteMany({ where: { clientId } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

describe('POST /api/clients/[id]/schedules', () => {
  it('creates a weekly schedule with server-built payload and future nextRunAt', async () => {
    const res = await POST(jsonReq('POST', { domain: `${PREFIX}a.example.edu`, cadence: 'weekly:1@06:00', wcagLevel: 'wcag22aa' }), p(clientId))
    expect(res.status).toBe(201)
    const { id } = await res.json()
    const sched = await prisma.schedule.findUnique({ where: { id } })
    expect(sched?.jobType).toBe(SCHEDULED_SITE_AUDIT_JOB_TYPE)
    expect(sched?.clientId).toBe(clientId)
    expect(sched?.name).toBeNull()
    expect(JSON.parse(sched!.payload)).toEqual({ clientId, domain: `${PREFIX}a.example.edu`, wcagLevel: 'wcag22aa' })
    expect(sched!.nextRunAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('409 schedule_exists for a second schedule on the same domain', async () => {
    const res = await POST(jsonReq('POST', { domain: `${PREFIX}a.example.edu`, cadence: 'monthly:1@06:00' }), p(clientId))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('schedule_exists')
  })

  it('400 domain_not_listed for a domain not on the client', async () => {
    const res = await POST(jsonReq('POST', { domain: 'evil.example.com', cadence: 'weekly:1@06:00' }), p(clientId))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('domain_not_listed')
  })

  it('400 cadence_invalid for unparseable cadence', async () => {
    const res = await POST(jsonReq('POST', { domain: `${PREFIX}b.example.edu`, cadence: 'sometimes' }), p(clientId))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('cadence_invalid')
  })

  it.each(['daily@06:00', 'every:30m', 'every:1d'])('400 cadence_not_allowed for daily-class %s', async (cadence) => {
    const res = await POST(jsonReq('POST', { domain: `${PREFIX}b.example.edu`, cadence }), p(clientId))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('cadence_not_allowed')
  })

  it('409 client_archived for an archived client', async () => {
    const archived = await prisma.client.create({
      data: { name: `${PREFIX}archived`, domains: JSON.stringify([`${PREFIX}c.example.edu`]), archivedAt: new Date() },
    })
    const res = await POST(jsonReq('POST', { domain: `${PREFIX}c.example.edu`, cadence: 'weekly:1@06:00' }), p(archived.id))
    expect(res.status).toBe(409)
  })

  it('404 for unknown client, 400 for bad id, 400 for bad JSON', async () => {
    expect((await POST(jsonReq('POST', { domain: 'x.edu', cadence: 'weekly:1@06:00' }), p(999_999))).status).toBe(404)
    expect((await POST(jsonReq('POST', { domain: 'x.edu', cadence: 'weekly:1@06:00' }), p('abc'))).status).toBe(400)
    const badJson = new NextRequest('http://localhost/api/x', { method: 'POST', body: '{nope' })
    expect((await POST(badJson, p(clientId))).status).toBe(400)
  })
})

describe('GET /api/clients/[id]/schedules', () => {
  it('lists schedules with payload-derived domain', async () => {
    const res = await GET(jsonReq('GET'), p(clientId))
    expect(res.status).toBe(200)
    const { schedules } = await res.json()
    expect(schedules.some((s: { domain: string }) => s.domain === `${PREFIX}a.example.edu`)).toBe(true)
  })
})

describe('PATCH/DELETE /api/clients/[id]/schedules/[scheduleId]', () => {
  it('pause sets enabled=false; resume recomputes nextRunAt from now', async () => {
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId, cadence: 'weekly:1@06:00',
        payload: JSON.stringify({ clientId, domain: `${PREFIX}b.example.edu`, wcagLevel: 'wcag21aa' }),
        nextRunAt: new Date('2020-01-01T00:00:00Z'), // stale past slot
        enabled: true,
      },
    })
    const off = await PATCH(jsonReq('PATCH', { enabled: false }), p(clientId, sched.id))
    expect(off.status).toBe(200)
    expect((await prisma.schedule.findUnique({ where: { id: sched.id } }))?.enabled).toBe(false)

    const on = await PATCH(jsonReq('PATCH', { enabled: true }), p(clientId, sched.id))
    expect(on.status).toBe(200)
    const after = await prisma.schedule.findUnique({ where: { id: sched.id } })
    expect(after?.enabled).toBe(true)
    expect(after!.nextRunAt.getTime()).toBeGreaterThan(Date.now()) // not the stale 2020 slot
  })

  it('DELETE removes the schedule, cancels its queued jobs, SetNulls its audits', async () => {
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId, cadence: 'weekly:1@06:00',
        payload: JSON.stringify({ clientId, domain: `${PREFIX}b.example.edu`, wcagLevel: 'wcag21aa' }),
        nextRunAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    const job = await prisma.job.create({
      data: { type: SCHEDULED_SITE_AUDIT_JOB_TYPE, status: 'queued', payload: '{}', groupKey: `schedule:${sched.id}`, scheduleId: sched.id, scheduledFor: new Date() },
    })
    const audit = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}b.example.edu`, status: 'complete', wcagLevel: 'wcag21aa', scheduleId: sched.id, completedAt: new Date() },
    })

    const res = await DELETE(jsonReq('DELETE'), p(clientId, sched.id))
    expect(res.status).toBe(200)
    expect(await prisma.schedule.findUnique({ where: { id: sched.id } })).toBeNull()
    expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe('cancelled')
    expect((await prisma.siteAudit.findUnique({ where: { id: audit.id } }))?.scheduleId).toBeNull()
    await prisma.siteAudit.delete({ where: { id: audit.id } })
  })

  it('404 when the schedule belongs to another client or another jobType', async () => {
    const other = await prisma.client.create({ data: { name: `${PREFIX}other`, domains: '[]' } })
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId: other.id, cadence: 'weekly:1@06:00',
        payload: '{}', nextRunAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    expect((await PATCH(jsonReq('PATCH', { enabled: false }), p(clientId, sched.id))).status).toBe(404)
    expect((await DELETE(jsonReq('DELETE'), p(clientId, sched.id))).status).toBe(404)
  })
})
```

- [ ] **Step 4: Extend the middleware test**

In `middleware.test.ts`, add to the existing "keeps non-handoff route %s gated" `it.each` list:

```ts
    // C2 schedule CRUD is dashboard-triggered → stays cookie-gated
    '/api/clients/7/schedules',
    '/api/clients/7/schedules/abc123',
```

- [ ] **Step 5: Run tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/clients/\[id\]/schedules/route.test.ts middleware.test.ts`
Expected: PASS (middleware needs no code change — the assertion documents protection-by-omission).

- [ ] **Step 6: Commit**

```bash
git add app/api/clients/\[id\]/schedules/ middleware.test.ts
git commit -m "feat(c2): schedule CRUD routes (create/pause/resume/delete, gated cadences)"
```

---

### Task 9: UI — ScheduledScansCard, header humanization, timeline attribution

**Files:**
- Create: `components/clients/ScheduledScansCard.tsx`
- Modify: `app/clients/[id]/page.tsx` (fetch + render the card)
- Modify: `components/clients/ClientHeader.tsx` (humanize jobType)
- Modify: `lib/services/client-dashboard.ts` (timeline " · scheduled" suffix)
- Test: `components/clients/ScheduledScansCard.test.tsx` (new)
- Test: `lib/services/client-dashboard.test.ts` (extend, if present — otherwise the suffix is covered by the card test file's scope note)

- [ ] **Step 1: Write the card component**

`components/clients/ScheduledScansCard.tsx`:

```tsx
'use client'

// C2: per-client scan-schedule management. Mutations hit the schedule CRUD
// routes and re-fetch GET to refresh local state. Delta chip reuses the
// Scorecard delta styling (green up / red down).

import { useCallback, useState } from 'react'
import type { ClientScheduleRow } from '@/lib/services/client-schedules'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function humanizeCadence(cadence: string): string {
  const weekly = /^weekly:([0-6])@(\d{2}:\d{2})$/.exec(cadence)
  if (weekly) return `Weekly · ${DOW[Number(weekly[1])]} ${weekly[2]}`
  const monthly = /^monthly:(\d{1,2})@(\d{2}:\d{2})$/.exec(cadence)
  if (monthly) return `Monthly · day ${monthly[1]} ${monthly[2]}`
  return cadence
}

interface Props {
  clientId: number
  domains: string[]
  archived: boolean
  initial: ClientScheduleRow[]
}

export function ScheduledScansCard({ clientId, domains, archived, initial }: Props) {
  const [schedules, setSchedules] = useState<ClientScheduleRow[]>(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [domain, setDomain] = useState(domains[0] ?? '')
  const [freq, setFreq] = useState<'weekly' | 'monthly'>('weekly')
  const [day, setDay] = useState('1')
  const [time, setTime] = useState('06:00')
  const [level, setLevel] = useState('wcag21aa')

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/schedules`)
    if (res.ok) setSchedules((await res.json()).schedules)
  }, [clientId])

  async function mutate(run: () => Promise<Response>) {
    setBusy(true)
    setError(null)
    try {
      const res = await run()
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `Request failed (${res.status})`)
        return
      }
      await refresh()
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    mutate(() =>
      fetch(`/api/clients/${clientId}/schedules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain,
          cadence: freq === 'weekly' ? `weekly:${day}@${time}` : `monthly:${day}@${time}`,
          wcagLevel: level,
        }),
      }),
    ).then(() => setShowForm(false))

  const setEnabled = (id: string, enabled: boolean) =>
    mutate(() =>
      fetch(`/api/clients/${clientId}/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }),
    )

  const remove = (id: string) => {
    if (!window.confirm('Delete this schedule? Past scheduled audits are kept as manual history.')) return
    void mutate(() => fetch(`/api/clients/${clientId}/schedules/${id}`, { method: 'DELETE' }))
  }

  return (
    <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80">Scheduled scans</h2>
        {!archived && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
          >
            {showForm ? 'Cancel' : '+ Add schedule'}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>}

      {showForm && (
        <div className="flex flex-wrap items-end gap-2 mb-4 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 dark:text-white/50">Domain</span>
            <select value={domain} onChange={(e) => setDomain(e.target.value)} className="border border-gray-300 dark:border-navy-border rounded px-2 py-1 bg-white dark:bg-navy-deep">
              {domains.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 dark:text-white/50">Frequency</span>
            <select value={freq} onChange={(e) => { setFreq(e.target.value as 'weekly' | 'monthly'); setDay('1') }} className="border border-gray-300 dark:border-navy-border rounded px-2 py-1 bg-white dark:bg-navy-deep">
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 dark:text-white/50">{freq === 'weekly' ? 'Day of week' : 'Day of month'}</span>
            <select value={day} onChange={(e) => setDay(e.target.value)} className="border border-gray-300 dark:border-navy-border rounded px-2 py-1 bg-white dark:bg-navy-deep">
              {freq === 'weekly'
                ? DOW.map((label, i) => <option key={i} value={String(i)}>{label}</option>)
                : Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 dark:text-white/50">Time</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="border border-gray-300 dark:border-navy-border rounded px-2 py-1 bg-white dark:bg-navy-deep" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 dark:text-white/50">WCAG level</span>
            <select value={level} onChange={(e) => setLevel(e.target.value)} className="border border-gray-300 dark:border-navy-border rounded px-2 py-1 bg-white dark:bg-navy-deep">
              <option value="wcag21aa">Required (2.1 AA)</option>
              <option value="wcag22aa">Aspirational (2.2 AA)</option>
            </select>
          </label>
          <button
            onClick={() => void create()}
            disabled={busy || !domain}
            className="px-3 py-1.5 rounded bg-blue-600 text-white font-semibold disabled:opacity-50"
          >
            Create
          </button>
        </div>
      )}

      {schedules.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-white/40">No scheduled scans.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-navy-border">
          {schedules.map((s) => (
            <li key={s.id} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="font-semibold text-gray-800 dark:text-white/90">{s.domain || '(unknown domain)'}</span>
              <span className="text-gray-500 dark:text-white/50">{humanizeCadence(s.cadence)}</span>
              <span className="text-gray-400 dark:text-white/40">{s.wcagLevel === 'wcag22aa' ? 'WCAG 2.2 AA' : 'WCAG 2.1 AA'}</span>
              {s.enabled ? (
                <span className="text-gray-400 dark:text-white/40">next {new Date(s.nextRunAt).toLocaleString()}</span>
              ) : (
                <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50 font-semibold">Paused</span>
              )}
              {s.lastRun && (
                <span className="text-gray-500 dark:text-white/50">
                  last:{' '}
                  <a href={`/ada-audit/site/${s.lastRun.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                    {s.lastRun.status}
                    {s.lastRun.score !== null ? ` · ${s.lastRun.score}` : ''}
                  </a>
                  {s.lastDelta !== null && s.lastDelta !== 0 && (
                    <span className={`ml-1 font-semibold ${s.lastDelta > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {s.lastDelta > 0 ? `▲ ${s.lastDelta}` : `▼ ${Math.abs(s.lastDelta)}`}
                    </span>
                  )}
                </span>
              )}
              <span className="ml-auto flex gap-2">
                <button onClick={() => void setEnabled(s.id, !s.enabled)} disabled={busy} className="text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50">
                  {s.enabled ? 'Pause' : 'Resume'}
                </button>
                <button onClick={() => remove(s.id)} disabled={busy} className="text-red-600 dark:text-red-400 hover:underline disabled:opacity-50">
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire into the dashboard page**

`app/clients/[id]/page.tsx`:

- Add imports:

```tsx
import { ScheduledScansCard } from '@/components/clients/ScheduledScansCard'
import { getClientSchedules } from '@/lib/services/client-schedules'
```

- Extend the `Promise.all`:

```tsx
  const [dash, history, findings, quarter, scanSchedules] = await Promise.all([
    getClientDashboard(clientId),
    getClientSeoHistory(clientId),
    getClientFindings(clientId),
    getClientQuarterContext(clientId),
    getClientSchedules(clientId),
  ])
```

- Render between the scorecard grid `</div>` and `<FindingsPanel …>`:

```tsx
        <ScheduledScansCard
          clientId={clientId}
          domains={dash.client.domains}
          archived={dash.client.archivedAt !== null}
          initial={scanSchedules}
        />
```

- [ ] **Step 3: Humanize the header line**

`components/clients/ClientHeader.tsx` — above the component, add:

```tsx
const JOB_TYPE_LABELS: Record<string, string> = { 'scheduled-site-audit': 'site audit' }
```

and change the schedules line to:

```tsx
  {schedules.length === 0
    ? 'No scheduled scans'
    : `Scheduled: ${schedules.map((s) => `${JOB_TYPE_LABELS[s.jobType] ?? s.jobType} (${s.cadence})`).join(' · ')}`}
```

- [ ] **Step 4: Timeline attribution**

`lib/services/client-dashboard.ts`:

- In the `siteAudit.findMany` select (~line 93), add `scheduleId: true,`.
- In the site-audit timeline push (~line 170), change `title: a.domain` to:

```ts
      type: 'site-audit', id: a.id, title: a.scheduleId ? `${a.domain} · scheduled` : a.domain, status: a.status,
```

If `lib/services/client-dashboard.test.ts` exists, add one test: a SiteAudit row with `scheduleId` set yields a timeline item titled `<domain> · scheduled`, and one without keeps the bare domain.

- [ ] **Step 5: Card tests**

`components/clients/ScheduledScansCard.test.tsx` — jsdom + testing-library, mock `fetch`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScheduledScansCard, humanizeCadence } from './ScheduledScansCard'
import type { ClientScheduleRow } from '@/lib/services/client-schedules'

const row: ClientScheduleRow = {
  id: 'sched1', domain: 'a.example.edu', wcagLevel: 'wcag21aa',
  cadence: 'weekly:1@06:00', enabled: true, nextRunAt: '2026-06-15T06:00:00.000Z',
  lastRun: { id: 'audit1', status: 'complete', completedAt: '2026-06-08T06:10:00.000Z', score: 82 },
  lastDelta: 12,
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ schedules: [] }) }))
})

describe('humanizeCadence', () => {
  it.each([
    ['weekly:1@06:00', 'Weekly · Mon 06:00'],
    ['monthly:15@23:30', 'Monthly · day 15 23:30'],
    ['every:30m', 'every:30m'], // unknown shape falls through raw
  ])('%s → %s', (cadence, label) => {
    expect(humanizeCadence(cadence)).toBe(label)
  })
})

describe('ScheduledScansCard', () => {
  it('renders schedule rows with cadence, last run score, and delta', () => {
    render(<ScheduledScansCard clientId={1} domains={['a.example.edu']} archived={false} initial={[row]} />)
    expect(screen.getByText('a.example.edu')).toBeTruthy()
    expect(screen.getByText('Weekly · Mon 06:00')).toBeTruthy()
    expect(screen.getByText(/complete · 82/)).toBeTruthy()
    expect(screen.getByText('▲ 12')).toBeTruthy()
  })

  it('renders the empty state and hides Add for archived clients', () => {
    render(<ScheduledScansCard clientId={1} domains={['a.example.edu']} archived={true} initial={[]} />)
    expect(screen.getByText('No scheduled scans.')).toBeTruthy()
    expect(screen.queryByText('+ Add schedule')).toBeNull()
  })

  it('create flow POSTs the composed cadence and refreshes from GET', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'new' }) }) // POST
      .mockResolvedValueOnce({ ok: true, json: async () => ({ schedules: [row] }) }) // refresh GET
    vi.stubGlobal('fetch', fetchMock)
    render(<ScheduledScansCard clientId={1} domains={['a.example.edu']} archived={false} initial={[]} />)
    fireEvent.click(screen.getByText('+ Add schedule'))
    fireEvent.click(screen.getByText('Create'))
    await screen.findByText('a.example.edu')
    expect(fetchMock).toHaveBeenCalledWith('/api/clients/1/schedules', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.cadence).toBe('weekly:1@06:00')
  })

  it('surfaces API errors inline', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'schedule_exists' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ScheduledScansCard clientId={1} domains={['a.example.edu']} archived={false} initial={[]} />)
    fireEvent.click(screen.getByText('+ Add schedule'))
    fireEvent.click(screen.getByText('Create'))
    await screen.findByText('schedule_exists')
  })
})
```

(Adjust matchers to the repo's component-test conventions — e.g. if neighbors use `@testing-library/jest-dom` matchers, use `toBeInTheDocument()`. Remember: vitest jsdom has no working localStorage, but this component doesn't touch it.)

- [ ] **Step 6: Run tests + typecheck**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/ScheduledScansCard.test.tsx lib/services/client-dashboard.test.ts && npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add components/clients/ScheduledScansCard.tsx components/clients/ScheduledScansCard.test.tsx app/clients/\[id\]/page.tsx components/clients/ClientHeader.tsx lib/services/client-dashboard.ts lib/services/client-dashboard.test.ts
git commit -m "feat(c2): ScheduledScansCard + header humanization + timeline scheduled attribution"
```

---

### Task 10: Full verification + branch finish

- [ ] **Step 1: Full suite**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run`
Expected: all green (≈2,050 pre-existing + ~60 new). Fix any fallout (likely suspects: tests that complete site audits now also trigger carry-forward — they hit real DB tables and succeed silently; `queue-manager.test.ts` mocks may need the carry-forward module neutralized if console noise breaks strict assertions).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 3: Dead-import + invariant greps**

```bash
grep -rn "transaction(async" lib/ app/ --include="*.ts" | grep -v test   # must be empty
grep -rn "SiteAudit.score" lib/services/client-schedules.ts              # must be empty (CrawlRun.score only)
```

- [ ] **Step 4: Commit any stragglers, then finish the branch**

Use the `superpowers:finishing-a-development-branch` flow (PR to main, like C1's PR #65). After merge + deploy, follow the spec §15 rollout verification and the improvement-roadmap handoff protocol (tracker checkbox + status log + handoff doc rewrite).
