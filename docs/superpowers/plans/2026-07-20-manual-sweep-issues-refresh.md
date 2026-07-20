# Manual full-cohort sweep → /issues refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repurpose the "Queue all clients" button into a true full-cohort manual sweep (all registered domains, full ADA+SEO profile) that freezes a `WeeklySweep(origin='manual')` row and refreshes `/issues` silently on drain (no email), taking precedence over the last scheduled sweep.

**Architecture:** Reuse the existing weekly-sweep snapshot layer verbatim. Extract `client-sweep`'s fan-out core into a shared `runSweepFanout(origin,…)`; a new `manual-sweep` job runs it with `origin='manual'`. An advancer folded into `stale-audit-reset` computes+publishes the manual snapshot once its cohort drains (baseline = most recent SCHEDULED sweep). The Monday email path is untouched and hardened with `origin='scheduled'` filters.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, in-process durable job queue (`lib/jobs`).

**Spec:** `docs/superpowers/specs/2026-07-20-manual-sweep-issues-refresh-design.md` (Codex-reviewed, accept-with-fixes applied).

## Global Constraints

- **SQLite only**, **array-form `$transaction([...])` only** (never interactive `async tx =>`), DateTime columns are **INTEGER ms** in raw SQL, set `updatedAt` manually in raw statements.
- **Local gates are the ONLY type-check gate**: `npx tsc --noEmit` + `npx vitest run` + `npx next build` must pass; in-build type-check/lint stay DISABLED.
- **Tests self-provision per-worker SQLite DBs, run in parallel**; save/restore any env a suite sets.
- **Cookie-gated routes need NO middleware change.** No public routes added here.
- **Never** git add -A/-u at repo root; add explicit paths. No backticks in `git commit -m` messages.
- **`SiteAudit.status` terminal set = `complete | error | cancelled`** (there is NO `failed` status).
- **`SWEEP_SCAN_PROFILE` = `{ wcagLevel:'wcag21aa', seoIntent:true, seoOnly:false }`** — the manual sweep uses this exactly (full ADA+SEO).
- **UI:** client components need `dark:` variants + the mounted-guard hydration pattern; server-rendered sections need neither.
- **[Codex] House gates only:** `npm run lint` (= `tsc --noEmit`), `npm test` (= `vitest run`), `npm run build` (= `NODE_OPTIONS='--max-old-space-size=3072' next build` — never bare `npx next build`, it drops the required build-heap cap).
- **[Codex] `logError(context, err)` takes a RECORD, never a string:** `logError({ subsystem: 'sweep', scope: '<fn>' }, err)`. Import from `@/lib/log`.
- **[Codex] Env ints via `parsePositiveInt(process.env.X, fallback)`** (`@/lib/jobs/config`) — never `Number(env) || fallback` (accepts negatives).
- **[Codex] Test isolation vs the partial index:** EVERY DB suite that creates an unsnapshotted manual `WeeklySweep` MUST clear `weeklySweep` (and any `job` rows it made) in `beforeEach`/`afterEach` — the `weekly_sweep_one_inflight_manual` index makes a leftover in-flight manual row fail the next test's create. Add `beforeEach(async () => { await prisma.job.deleteMany({ where: { type: 'manual-sweep' } }); await prisma.weeklySweep.deleteMany({}) })` to Tasks 1, 3, 4, 5, 7, 9's new suites.
- Migration timestamp must be **later than `20260720160000`** and later than any viewbook-lane migration merged before this ships — **re-check `ls prisma/migrations | tail` at build time.**

---

## File structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` (modify) | Add `origin String @default("scheduled")` to `WeeklySweep`. |
| `prisma/migrations/<ts>_manual_sweep_origin/migration.sql` (create) | `ADD COLUMN origin` + partial unique in-flight-manual index. |
| `lib/sweep/types.ts` (modify) | `SweepOrigin` type + `asSweepOrigin()` fail-safe guard. |
| `lib/sweep/fanout.ts` (create) | `runSweepFanout(input, deps)` — the shared fan-out core (extracted from `client-sweep.ts`). |
| `lib/jobs/handlers/client-sweep.ts` (modify) | Scheduled wrapper: resolve `system-client-sweep` id, call `runSweepFanout({origin:'scheduled',…})`. |
| `lib/jobs/handlers/manual-sweep.ts` (create) | `manual-sweep` job: slot from payload, `runSweepFanout({origin:'manual',…})`, `onExhausted` seal/delete. |
| `lib/jobs/handlers/index.ts` / registry wiring (modify) | Register the new handler. |
| `app/api/site-audit/bulk-queue/route.ts` (modify) | Repurposed: guard + create manual row + enqueue `manual-sweep` (U2 P2002 mapping). |
| `lib/sweep/snapshot.ts` (modify) | `loadPreviousScheduledSnapshot(before)` (B1) + `origin:'scheduled'` filter on `loadPreviousSnapshot` (E1). |
| `lib/sweep/advance.ts` (create) | `advanceManualSweeps(now, deps)` — compute-on-drain (D1–D5) + `recoverManualSweeps(now)` orphan re-enqueue. |
| `lib/jobs/handlers/stale-audit-reset.ts` (modify) | Caught dynamic-import call to `advanceManualSweeps` + `recoverManualSweeps`. |
| `lib/ada-audit/queue-manager.ts` `recoverQueue()` (modify) | Call `recoverManualSweeps` at boot. |
| `lib/jobs/handlers/sweep-digest.ts` (modify) | Exact-slot lookup filtered `origin:'scheduled'` (E1). |
| `lib/sweep/retention.ts` (modify) | Origin-partition `pruneWeeklySweeps` (R2). |
| `lib/ada-audit/manual-sweep-retention.ts` (create) | `pruneManualSweepAudits(now)` (R1/R3) — keep-latest-2 per (client,domain), artifact cleanup, in-flight guard. |
| `lib/cleanup.ts` (modify) | Wire `pruneManualSweepAudits` into `runCleanup`'s prune array. |
| `lib/sweep/read.ts` (modify) | Surface `origin` + `snapshotAt` in `IssuesPayload.sweep`. |
| `components/issues/IssuesView.tsx` + `chips.tsx` (modify) | Origin label; suppress streak label when `origin='manual'` (B2). |
| `components/ada-audit/BulkQueueModal.tsx` + `ClientsAuditSummary.tsx` (modify) | Repurposed confirm copy + `started`/`409` handling. |

---

## Task 1: Schema — `origin` column + partial in-flight index

**Files:**
- Modify: `prisma/schema.prisma` (`WeeklySweep` model)
- Create: `prisma/migrations/<ts>_manual_sweep_origin/migration.sql`
- Test: `lib/sweep/origin-migration.test.ts`

**Interfaces:**
- Produces: `WeeklySweep.origin: string` (`'scheduled' | 'manual'`, default `'scheduled'`); a partial unique index `weekly_sweep_one_inflight_manual` enforcing ≤1 row with `origin='manual' AND snapshotJson IS NULL`.

- [ ] **Step 1: Re-check the latest migration timestamp**

Run: `ls prisma/migrations | tail -3`
Pick a `<ts>` strictly greater than the newest listed (e.g. `20260721000000`). Use it for the directory name below.

- [ ] **Step 2: Add the column to `schema.prisma`**

In `model WeeklySweep`, add after `scheduledFor`:

```prisma
  origin            String    @default("scheduled")   // 'scheduled' | 'manual'
```

- [ ] **Step 3: Write the migration SQL**

Create `prisma/migrations/<ts>_manual_sweep_origin/migration.sql`:

```sql
-- Manual full-cohort sweep: origin tag + one-in-flight-manual guard.
ALTER TABLE "WeeklySweep" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'scheduled';

-- At most one in-flight manual sweep: every covered row has origin='manual'
-- (a constant), so uniqueness on origin permits exactly one such row. Rows
-- with snapshotJson NOT NULL (published) and all scheduled rows are excluded.
CREATE UNIQUE INDEX "weekly_sweep_one_inflight_manual"
  ON "WeeklySweep"("origin")
  WHERE "origin" = 'manual' AND "snapshotJson" IS NULL;
```

- [ ] **Step 4: Apply the migration + regenerate the client**

Run: `npx prisma migrate dev --name manual_sweep_origin` (this applies the SQL you hand-authored if the directory matches, or creates/regenerates — if it wants to auto-generate different SQL, discard its version and keep the hand-authored file, then `npx prisma migrate deploy` + `npx prisma generate`).
Expected: migration applies; `npx prisma generate` regenerates the typed client with `origin`.

Safer explicit path:
```bash
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Step 5: Write the test (existing-row default + both unique constraints)**

```ts
// lib/sweep/origin-migration.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'

describe('WeeklySweep origin + in-flight index', () => {
  // [Codex] the partial index makes a leftover in-flight manual row fail the
  // next test's create — clear between every test.
  beforeEach(async () => { await prisma.weeklySweep.deleteMany({}) })

  it('defaults existing/new rows to scheduled', async () => {
    const row = await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-01-06T01:00:00Z') } })
    expect(row.origin).toBe('scheduled')
  })

  it('permits exactly one in-flight (snapshotJson null) manual row', async () => {
    await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-02-01T10:00:00Z'), origin: 'manual' } })
    await expect(
      prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-02-01T11:00:00Z'), origin: 'manual' } }),
    ).rejects.toThrow() // P2002 on the partial unique index
  })

  it('allows a second manual row once the first is snapshotted', async () => {
    await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-03-01T10:00:00Z'), origin: 'manual', snapshotJson: '{"v":1}' } })
    await expect(
      prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-03-01T11:00:00Z'), origin: 'manual' } }),
    ).resolves.toBeTruthy()
  })
})
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run lib/sweep/origin-migration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/sweep/origin-migration.test.ts
git commit -m "feat(sweep): WeeklySweep.origin + one-in-flight-manual partial index"
```

---

## Task 2: `SweepOrigin` type + fail-safe guard

**Files:**
- Modify: `lib/sweep/types.ts`
- Test: `lib/sweep/origin-type.test.ts`

**Interfaces:**
- Produces: `export type SweepOrigin = 'scheduled' | 'manual'`; `export function asSweepOrigin(s: string | null | undefined): SweepOrigin` (unknown → `'scheduled'`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/sweep/origin-type.test.ts
import { describe, it, expect } from 'vitest'
import { asSweepOrigin } from './types'

describe('asSweepOrigin', () => {
  it('passes through known values', () => {
    expect(asSweepOrigin('manual')).toBe('manual')
    expect(asSweepOrigin('scheduled')).toBe('scheduled')
  })
  it('fails safe to scheduled for anything else', () => {
    expect(asSweepOrigin(null)).toBe('scheduled')
    expect(asSweepOrigin(undefined)).toBe('scheduled')
    expect(asSweepOrigin('bogus')).toBe('scheduled')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/sweep/origin-type.test.ts`
Expected: FAIL ("asSweepOrigin is not a function").

- [ ] **Step 3: Implement in `lib/sweep/types.ts`** (near the top, after `SWEEP_SCAN_PROFILE`)

```ts
export type SweepOrigin = 'scheduled' | 'manual'

/** Fail-safe: any unknown/legacy value reads as 'scheduled' (the pre-origin default). */
export function asSweepOrigin(s: string | null | undefined): SweepOrigin {
  return s === 'manual' ? 'manual' : 'scheduled'
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/sweep/origin-type.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sweep/types.ts lib/sweep/origin-type.test.ts
git commit -m "feat(sweep): SweepOrigin type + asSweepOrigin fail-safe guard"
```

---

## Task 3: Extract `runSweepFanout` shared core (F1/F2)

**Files:**
- Create: `lib/sweep/fanout.ts`
- Modify: `lib/jobs/handlers/client-sweep.ts`
- Test: `lib/sweep/fanout.test.ts` (+ keep the existing `client-sweep.test.ts` green as the characterization gate)

**Interfaces:**
- Consumes: `buildCohort`, `registeredDomains` (`lib/sweep/cohort`); `parseMembership`, `SWEEP_SCAN_PROFILE`, `SweepOrigin` (`lib/sweep/types`); `queueSiteAuditRequest`.
- Produces:
  ```ts
  export interface SweepFanoutInput {
    slot: Date
    origin: SweepOrigin
    requestedBy: string
    scheduleId: string | null
  }
  export interface SweepFanoutDeps { queue: typeof queueSiteAuditRequest; now: () => Date }
  export async function runSweepFanout(input: SweepFanoutInput, deps?: SweepFanoutDeps): Promise<void>
  ```

- [ ] **Step 1: Create `lib/sweep/fanout.ts` by moving the body of `runClientSweep`**

Move the current logic of `runClientSweep` (client-sweep.ts:30–182) into `runSweepFanout`, parametrized. The ONLY behavioral changes vs the original: (a) the `system-client-sweep` lookup is REMOVED from the core (the caller passes `scheduleId`); (b) the upsert `create` sets `origin`; (c) **[F1]** an origin-mismatch assertion after upsert; (d) `requestedBy` comes from `input`.

```ts
// lib/sweep/fanout.ts
//
// Shared fan-out core for the weekly client sweep — used by BOTH the scheduled
// client-sweep handler (origin='scheduled') and the manual-sweep handler
// (origin='manual'). Extracted from client-sweep.ts; the scheduled path is
// behaviorally identical (client-sweep.test.ts is the characterization gate).

import { prisma } from '@/lib/db'
import { queueSiteAuditRequest } from '@/lib/ada-audit/queue-request'
import { buildCohort, registeredDomains } from '@/lib/sweep/cohort'
import { SWEEP_SCAN_PROFILE, parseMembership, type SweepOrigin } from '@/lib/sweep/types'

export interface SweepFanoutInput {
  slot: Date
  origin: SweepOrigin
  requestedBy: string
  scheduleId: string | null
}
export interface SweepFanoutDeps {
  queue: typeof queueSiteAuditRequest
  now: () => Date
}
const realDeps: SweepFanoutDeps = { queue: queueSiteAuditRequest, now: () => new Date() }

export async function runSweepFanout(input: SweepFanoutInput, deps: SweepFanoutDeps = realDeps): Promise<void> {
  // 1. Upsert the slot row (idempotent under re-fire). origin set ONLY on create.
  const sweep = await prisma.weeklySweep.upsert({
    where: { scheduledFor: input.slot },
    create: { scheduledFor: input.slot, origin: input.origin, startedAt: deps.now() },
    update: {},
  })
  // [F1] Never let a fan-out adopt a pre-created row of the OTHER origin sharing
  // the same slot. Cross-origin slot collision is a hard error, not a merge.
  if (sweep.origin !== input.origin) {
    throw new Error(`[sweep] slot ${input.slot.toISOString()} origin mismatch: row=${sweep.origin} fanout=${input.origin}`)
  }

  // 2. Freeze the cohort BEFORE any enqueue. (unchanged from client-sweep)
  let membership = parseMembership(sweep.membershipJson)
  if (!membership) {
    if (sweep.membershipJson !== null) {
      throw new Error('[sweep] membershipJson is present but failed to parse — refusing to rebuild cohort')
    }
    const clients = await prisma.client.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true, domains: true },
    })
    const built = buildCohort(clients)
    const { count } = await prisma.weeklySweep.updateMany({
      where: { id: sweep.id, membershipJson: null },
      data: { membershipJson: JSON.stringify(built), startedAt: sweep.startedAt ?? deps.now() },
    })
    if (count === 0) {
      const row = await prisma.weeklySweep.findUnique({ where: { id: sweep.id }, select: { membershipJson: true } })
      const winner = parseMembership(row?.membershipJson ?? null)
      if (!winner) throw new Error('[sweep] cohort publish raced but winner cohort is unreadable')
      membership = winner
    } else {
      membership = built
    }
  }

  // 3. Process pending/error members. (unchanged EXCEPT requestedBy/scheduleId from input)
  const byDomainAudit = new Map<string, string>()
  for (const m of membership.members) {
    if (m.siteAuditId) byDomainAudit.set(m.domain, m.siteAuditId)
  }
  for (const m of membership.members) {
    if (
      m.outcome === 'enqueued' || m.outcome === 'duplicate' || m.outcome === 'shared-domain' ||
      m.outcome.startsWith('skipped') || m.outcome === 'invalid-domain'
    ) {
      if (m.siteAuditId) byDomainAudit.set(m.domain, m.siteAuditId)
      continue
    }
    const client = await prisma.client.findUnique({
      where: { id: m.clientId },
      select: { archivedAt: true, domains: true },
    })
    if (!client || client.archivedAt) {
      m.outcome = 'skipped-archived'
    } else if (!registeredDomains(client.domains).has(m.domain)) {
      m.outcome = 'skipped-delisted'
    } else if (byDomainAudit.has(m.domain)) {
      m.outcome = 'shared-domain'
      m.siteAuditId = byDomainAudit.get(m.domain)!
    } else {
      try {
        const res = await deps.queue({
          domain: m.domain,
          clientId: m.clientId,
          ...SWEEP_SCAN_PROFILE,
          requestedBy: input.requestedBy,
          scheduleId: input.scheduleId,
        })
        if (res.kind === 'queued') {
          m.outcome = 'enqueued'; m.siteAuditId = res.id; byDomainAudit.set(m.domain, res.id)
        } else if (res.kind === 'duplicate') {
          const dup = await prisma.siteAudit.findUnique({
            where: { id: res.existingId }, select: { seoOnly: true, clientId: true },
          })
          if (dup && !dup.seoOnly && (dup.clientId === null || dup.clientId === m.clientId)) {
            m.outcome = 'duplicate'; m.siteAuditId = res.existingId; byDomainAudit.set(m.domain, res.existingId)
          } else {
            m.outcome = 'skipped-conflict'; m.reason = dup?.seoOnly ? 'seo-only-in-flight' : 'foreign-client-in-flight'
          }
        } else {
          m.outcome = 'invalid-domain'; m.reason = res.reason
        }
      } catch (err) {
        m.outcome = 'error'; m.reason = String(err)
      }
    }
    await prisma.weeklySweep.update({
      where: { id: sweep.id }, data: { membershipJson: JSON.stringify(membership) },
    })
  }

  // 4. Stamp fanoutCompletedAt iff zero errors, else throw to retry. (unchanged)
  const errors = membership.members.filter((m) => m.outcome === 'error')
  if (errors.length === 0) {
    await prisma.weeklySweep.updateMany({
      where: { id: sweep.id, fanoutCompletedAt: null }, data: { fanoutCompletedAt: deps.now() },
    })
  } else {
    throw new Error(`[sweep] ${errors.length} member(s) failed to enqueue; retrying`)
  }
}
```

- [ ] **Step 2: Rewrite `client-sweep.ts` to delegate (F2 keeps schedule resolution here)**

Replace `runClientSweep`'s body with a thin wrapper that resolves the schedule id and calls the core. Keep `runClientSweep` exported (existing tests import it).

```ts
// lib/jobs/handlers/client-sweep.ts (runClientSweep body)
import { runSweepFanout, type SweepFanoutDeps } from '@/lib/sweep/fanout'
// ...
export interface ClientSweepDeps { queue: typeof queueSiteAuditRequest; now: () => Date }
const realDeps: ClientSweepDeps = { queue: queueSiteAuditRequest, now: () => new Date() }

export async function runClientSweep(slot: Date, deps: ClientSweepDeps = realDeps): Promise<void> {
  const sweepSchedule = await prisma.schedule.findUnique({
    where: { name: 'system-client-sweep' }, select: { id: true },
  })
  if (!sweepSchedule) throw new Error('[sweep] system-client-sweep schedule row missing')
  await runSweepFanout(
    { slot, origin: 'scheduled', requestedBy: 'sweep', scheduleId: sweepSchedule.id },
    deps as SweepFanoutDeps,
  )
}
```

Leave `registerClientSweepHandler` unchanged (it still reads `job.scheduledFor` and calls `runClientSweep`).

- [ ] **Step 3: Run the existing characterization gate**

Run: `npx vitest run lib/jobs/handlers/client-sweep.test.ts`
Expected: PASS — the scheduled path is byte-identical (same queue args `{...SWEEP_SCAN_PROFILE, requestedBy:'sweep', scheduleId}`, same membership JSON, same fanoutCompletedAt gate).

- [ ] **Step 4: Add a manual-origin test for the core**

```ts
// lib/sweep/fanout.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { runSweepFanout } from './fanout'

describe('runSweepFanout', () => {
  beforeEach(async () => { await prisma.weeklySweep.deleteMany({}); await prisma.client.deleteMany({}) })

  it('manual origin: queues SWEEP_SCAN_PROFILE audits, requestedBy=manual-sweep, scheduleId=null, stamps origin+fanoutCompletedAt', async () => {
    const client = await prisma.client.create({ data: { name: 'Acme', domains: JSON.stringify(['acme.edu']) } })
    const queue = vi.fn().mockResolvedValue({ kind: 'queued', id: 'sa1' })
    const slot = new Date('2030-04-10T15:00:00Z')
    await runSweepFanout({ slot, origin: 'manual', requestedBy: 'manual-sweep', scheduleId: null }, { queue, now: () => slot })
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'acme.edu', clientId: client.id, wcagLevel: 'wcag21aa', seoIntent: true, seoOnly: false,
      requestedBy: 'manual-sweep', scheduleId: null,
    }))
    const row = await prisma.weeklySweep.findUnique({ where: { scheduledFor: slot } })
    expect(row?.origin).toBe('manual')
    expect(row?.fanoutCompletedAt).not.toBeNull()
  })

  it('[F1] throws on cross-origin slot collision', async () => {
    const slot = new Date('2030-04-11T15:00:00Z')
    await prisma.weeklySweep.create({ data: { scheduledFor: slot, origin: 'scheduled' } })
    await expect(
      runSweepFanout({ slot, origin: 'manual', requestedBy: 'manual-sweep', scheduleId: null },
        { queue: vi.fn(), now: () => slot }),
    ).rejects.toThrow(/origin mismatch/)
  })
})
```

- [ ] **Step 5: Run**

Run: `npx vitest run lib/sweep/fanout.test.ts lib/jobs/handlers/client-sweep.test.ts`
Expected: PASS (both).

- [ ] **Step 6: Commit**

```bash
git add lib/sweep/fanout.ts lib/sweep/fanout.test.ts lib/jobs/handlers/client-sweep.ts
git commit -m "refactor(sweep): extract runSweepFanout shared core (F1 origin guard, F2 schedule stays in wrapper)"
```

---

## Task 4: `manual-sweep` job handler (+ onExhausted)

**Files:**
- Create: `lib/jobs/handlers/manual-sweep.ts`
- Modify: `lib/jobs/handlers/register.ts` (import + call `registerManualSweepHandler()` beside `registerClientSweepHandler()`) — **[Codex] must be in the commit or the job type is never registered.**
- Test: `lib/jobs/handlers/manual-sweep.test.ts`

**Interfaces:**
- Consumes: `runSweepFanout` (Task 3).
- Produces: `export const MANUAL_SWEEP_JOB_TYPE = 'manual-sweep'`; `export function registerManualSweepHandler(): void`; the job payload shape `{ scheduledFor: string /* ISO */ }`.

- [ ] **Step 1: Write the handler**

```ts
// lib/jobs/handlers/manual-sweep.ts
//
// Manual full-cohort sweep fan-out. Enqueued by the repurposed
// POST /api/site-audit/bulk-queue. Reads its slot from the PAYLOAD (a manual
// job carries no schedule slot), runs the shared fan-out core with
// origin='manual', requestedBy='manual-sweep', scheduleId=null. No email, no
// snapshot here — advanceManualSweeps (stale-audit-reset) computes on drain.

import { prisma } from '@/lib/db'
import { registerJobHandler } from '../registry'
import { runSweepFanout } from '@/lib/sweep/fanout'
import { logError } from '@/lib/log'

export const MANUAL_SWEEP_JOB_TYPE = 'manual-sweep'

function slotFromPayload(payload: unknown): Date {
  const iso = (payload as { scheduledFor?: string })?.scheduledFor
  const d = iso ? new Date(iso) : new Date(NaN)
  if (Number.isNaN(d.getTime())) throw new Error('[manual-sweep] payload missing valid scheduledFor')
  return d
}

/**
 * [Codex] Exhaustion = ABANDON, not seal. onExhausted can fire after a TIMEOUT,
 * where the timed-out handler may STILL be queuing members — sealing
 * (stamping fanoutCompletedAt) would let the advancer publish a snapshot from a
 * half-frozen membership. So we DELETE the unsnapshotted manual row outright
 * (fenced), freeing the in-flight-manual slot. Any members that already enqueued
 * simply run as ordinary audits (harmless); the operator can re-click, and a
 * re-run reuses those in-flight audits via the duplicate/shared-domain path.
 * Exported for direct unit testing (the tests call this, not the worker).
 */
export async function sealOrAbandonManualSweep(slot: Date): Promise<void> {
  try {
    // Fenced delete: only an unsnapshotted MANUAL row for this exact slot.
    await prisma.weeklySweep.deleteMany({ where: { scheduledFor: slot, origin: 'manual', snapshotJson: null } })
  } catch (err) {
    logError({ subsystem: 'sweep', scope: 'manual-sweep.onExhausted' }, err)
  }
}

export function registerManualSweepHandler(): void {
  registerJobHandler({
    type: MANUAL_SWEEP_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 3,
    timeoutMs: 120_000,
    handler: async (payload) => {
      const slot = slotFromPayload(payload)
      await runSweepFanout({ slot, origin: 'manual', requestedBy: 'manual-sweep', scheduleId: null })
    },
    // ctx is available (JobExhaustedContext) but unused — signature is (payload, ctx).
    onExhausted: async (payload) => {
      try {
        await sealOrAbandonManualSweep(slotFromPayload(payload))
      } catch (err) {
        logError({ subsystem: 'sweep', scope: 'manual-sweep.onExhausted' }, err)
      }
    },
  })
}
```

> `registerJobHandler` supports `onExhausted?: (payload, ctx: JobExhaustedContext) => Promise<void>` (verified in `lib/jobs/registry.ts:63`, mirrors `broken-link-verify`).

- [ ] **Step 2: Register the handler**

Find where `registerClientSweepHandler()` is invoked and add `registerManualSweepHandler()` beside it.

Run: `grep -rn "registerClientSweepHandler" --include=*.ts | grep -v test`

- [ ] **Step 3: Write tests**

```ts
// lib/jobs/handlers/manual-sweep.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { sealOrAbandonManualSweep } from './manual-sweep'

describe('manual-sweep sealOrAbandonManualSweep (exhaustion = abandon)', () => {
  beforeEach(async () => {
    await prisma.job.deleteMany({ where: { type: 'manual-sweep' } })
    await prisma.weeklySweep.deleteMany({})
  })

  it('deletes the unsnapshotted manual row (frees the in-flight slot) — even with enqueued members', async () => {
    const slot = new Date('2030-05-01T12:00:00Z')
    await prisma.weeklySweep.create({ data: {
      scheduledFor: slot, origin: 'manual',
      membershipJson: JSON.stringify({ v: 1, expectedCount: 1, members: [
        { clientId: 1, clientName: 'A', domain: 'a.edu', siteAuditId: 'sa1', outcome: 'enqueued' },
      ] }),
    } })
    await sealOrAbandonManualSweep(slot)
    expect(await prisma.weeklySweep.findUnique({ where: { scheduledFor: slot } })).toBeNull()
  })

  it('does NOT delete a snapshotted manual row (fence)', async () => {
    const slot = new Date('2030-05-02T12:00:00Z')
    await prisma.weeklySweep.create({ data: { scheduledFor: slot, origin: 'manual', snapshotJson: '{"v":1}' } })
    await sealOrAbandonManualSweep(slot)
    expect(await prisma.weeklySweep.findUnique({ where: { scheduledFor: slot } })).not.toBeNull()
  })

  it('never touches a scheduled row at the same slot', async () => {
    const slot = new Date('2030-05-03T01:00:00Z')
    await prisma.weeklySweep.create({ data: { scheduledFor: slot, origin: 'scheduled' } })
    await sealOrAbandonManualSweep(slot)
    expect(await prisma.weeklySweep.findUnique({ where: { scheduledFor: slot } })).not.toBeNull()
  })
})
```

- [ ] **Step 4: Run**

Run: `npx vitest run lib/jobs/handlers/manual-sweep.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/manual-sweep.ts lib/jobs/handlers/manual-sweep.test.ts
git commit -m "feat(sweep): manual-sweep fan-out job + onExhausted seal/abandon"
```

---

## Task 5: Repurpose `POST /api/site-audit/bulk-queue`

**Files:**
- Modify: `app/api/site-audit/bulk-queue/route.ts`
- Test: `app/api/site-audit/bulk-queue/route.test.ts`

**Interfaces:**
- Consumes: `MANUAL_SWEEP_JOB_TYPE` (Task 4), `enqueueJob` (`lib/jobs/queue`).
- Produces: response `{ started: true, scheduledFor: string }` on success; `409 { error: 'manual_sweep_in_progress' }` when one is in flight.

- [ ] **Step 1: Write the route (U2 precise P2002 mapping)**

```ts
// app/api/site-audit/bulk-queue/route.ts
//
// "Queue all clients" — repurposed (2026-07-20) into a MANUAL full-cohort sweep:
// freezes a WeeklySweep(origin='manual') row and enqueues the manual-sweep
// fan-out. Refreshes /issues silently on drain (no email). Domainless clients
// are skipped by buildCohort (no hard 400 anymore).

import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { withRoute } from '@/lib/api/with-route'          // [Codex] house route kit
import { HttpError } from '@/lib/api/errors'
import { enqueueJob } from '@/lib/jobs/queue'
import { MANUAL_SWEEP_JOB_TYPE } from '@/lib/jobs/handlers/manual-sweep'

export const dynamic = 'force-dynamic'

function isP2002(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}
async function inFlightManual() {
  return prisma.weeklySweep.findFirst({ where: { origin: 'manual', snapshotJson: null }, select: { id: true } })
}

export const POST = withRoute(async () => {
  if (await inFlightManual()) throw new HttpError(409, 'manual_sweep_in_progress')

  // Create the manual slot row. [Codex] Deterministic retry slots from ONE base
  // (baseMs+attempt) — two immediate new Date() can repeat the same ms. On the
  // partial-index P2002, 409 iff an in-flight manual row exists; on a bare
  // scheduledFor ms-collision, retry; if both retries collide with NO in-flight
  // manual row, RETHROW the last P2002 (never a false 409).
  const baseMs = Date.now()
  let row: { id: number; scheduledFor: Date } | null = null
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3 && !row; attempt++) {
    const slot = new Date(baseMs + attempt)
    try {
      row = await prisma.weeklySweep.create({
        data: { scheduledFor: slot, origin: 'manual', startedAt: slot },
        select: { id: true, scheduledFor: true },
      })
    } catch (err) {
      if (!isP2002(err)) throw err
      lastErr = err
      if (await inFlightManual()) throw new HttpError(409, 'manual_sweep_in_progress')
      // else bare scheduledFor collision — loop retries with baseMs+attempt.
    }
  }
  if (!row) throw lastErr ?? new HttpError(500, 'manual_sweep_create_failed')

  const iso = row.scheduledFor.toISOString()
  try {
    await enqueueJob({
      type: MANUAL_SWEEP_JOB_TYPE,
      payload: { scheduledFor: iso },
      dedupKey: `manual-sweep:${iso}`,
      groupKey: `manual-sweep:${iso}`,
    })
  } catch (err) {
    // Enqueue failed — delete the just-created row so the partial index doesn't
    // block future manual sweeps. (A crash BEFORE this line is covered by
    // recoverManualSweeps in Task 7, which waits out a grace period.)
    await prisma.weeklySweep.deleteMany({ where: { id: row.id, snapshotJson: null, membershipJson: null } })
    throw err
  }

  return NextResponse.json({ started: true, scheduledFor: iso })
})
```

> Verify `HttpError(status, code)` shape + `withRoute` import path in `lib/api/` when implementing (CLAUDE.md A3 route kit). `withRoute` maps `HttpError`→status+code and unknown→500.

- [ ] **Step 2: Write tests**

```ts
// app/api/site-audit/bulk-queue/route.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'

describe('POST /api/site-audit/bulk-queue (manual sweep)', () => {
  beforeEach(async () => {
    await prisma.job.deleteMany({ where: { type: 'manual-sweep' } })
    await prisma.weeklySweep.deleteMany({})
  })

  it('creates a manual WeeklySweep row and enqueues manual-sweep', async () => {
    const { POST } = await import('./route')
    const res = await POST(new Request('http://x/api/site-audit/bulk-queue', { method: 'POST' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.started).toBe(true)
    const row = await prisma.weeklySweep.findUnique({ where: { scheduledFor: new Date(body.scheduledFor) } })
    expect(row?.origin).toBe('manual')
    const job = await prisma.job.findFirst({ where: { type: 'manual-sweep' } })
    expect(job).not.toBeNull()
  })

  it('returns 409 when a manual sweep is already in flight', async () => {
    await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-06-01T10:00:00Z'), origin: 'manual' } })
    const { POST } = await import('./route')
    const res = await POST(new Request('http://x', { method: 'POST' }) as any)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('manual_sweep_in_progress')
  })
})
```

- [ ] **Step 3: Run**

Run: `npx vitest run app/api/site-audit/bulk-queue/route.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/site-audit/bulk-queue/route.ts app/api/site-audit/bulk-queue/route.test.ts
git commit -m "feat(sweep): repurpose bulk-queue as manual full-cohort sweep trigger (U2 P2002 mapping)"
```

---

## Task 6: `loadPreviousScheduledSnapshot` (B1) + email baseline hardening (E1)

**Files:**
- Modify: `lib/sweep/snapshot.ts`
- Test: `lib/sweep/previous-scheduled.test.ts`

**Interfaces:**
- Produces: `export async function loadPreviousScheduledSnapshot(before: Date): Promise<SweepSnapshot | null>`.
- Modifies: `loadPreviousSnapshot(scheduledFor)` gains an `origin:'scheduled'` filter.

- [ ] **Step 1: Write the failing test**

```ts
// lib/sweep/previous-scheduled.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'
import { loadPreviousScheduledSnapshot } from './snapshot'

const SNAP = (at: string) => JSON.stringify({
  v: 1, snapshotAt: at,
  totals: { actionable: 0, delta: null, comparablePairs: 0, newCount: 0, worsenedCount: 0, resolvedCount: 0, scanned: 0, expected: 0, comparableDomains: 0, partialDomains: 0, failedDomains: 0 },
  coverage: [], groups: [], staleGroups: [], resolvedGroups: [], shortlist: [], semanticKeys: [],
})

describe('loadPreviousScheduledSnapshot', () => {
  it('returns the newest scheduled snapshot before `before`, ignoring manual + unsnapshotted', async () => {
    await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-07-01T01:00:00Z'), origin: 'scheduled', snapshotJson: SNAP('sun') } })
    await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-07-03T15:00:00Z'), origin: 'manual', snapshotJson: SNAP('wed') } })
    const prev = await loadPreviousScheduledSnapshot(new Date('2030-07-04T15:00:00Z'))
    expect(prev?.snapshotAt).toBe('sun') // NOT the manual 'wed'
  })

  it('falls through a corrupt newest scheduled row to the next valid one [B1]', async () => {
    await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-08-01T01:00:00Z'), origin: 'scheduled', snapshotJson: SNAP('older') } })
    await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-08-08T01:00:00Z'), origin: 'scheduled', snapshotJson: '{bad json' } })
    const prev = await loadPreviousScheduledSnapshot(new Date('2030-08-10T00:00:00Z'))
    expect(prev?.snapshotAt).toBe('older')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/sweep/previous-scheduled.test.ts`
Expected: FAIL ("loadPreviousScheduledSnapshot is not a function").

- [ ] **Step 3: Implement in `lib/sweep/snapshot.ts`**

Add `SCAN_LIMIT` if not present, and:

```ts
const PREV_SCHEDULED_SCAN_LIMIT = 10

export async function loadPreviousScheduledSnapshot(before: Date): Promise<SweepSnapshot | null> {
  const rows = await prisma.weeklySweep.findMany({
    where: { origin: 'scheduled', snapshotJson: { not: null }, scheduledFor: { lt: before } },
    orderBy: { scheduledFor: 'desc' },
    take: PREV_SCHEDULED_SCAN_LIMIT,
    select: { snapshotJson: true },
  })
  for (const r of rows) {
    const parsed = parseSnapshot(r.snapshotJson)
    if (parsed) return parsed
  }
  return null
}
```

And harden the existing `loadPreviousSnapshot` (the −7d email resolver):

```ts
export async function loadPreviousSnapshot(scheduledFor: Date): Promise<SweepSnapshot | null> {
  const prevSlot = new Date(scheduledFor.getTime() - WEEK_MS)
  const row = await prisma.weeklySweep.findFirst({
    where: { scheduledFor: prevSlot, origin: 'scheduled' }, // [E1] origin filter
  })
  return parseSnapshot(row?.snapshotJson ?? null)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/sweep/previous-scheduled.test.ts`
Expected: PASS. Also run `npx vitest run lib/sweep/snapshot.test.ts` (if present) to confirm the `loadPreviousSnapshot` change didn't regress the scheduled path.

- [ ] **Step 5: Commit**

```bash
git add lib/sweep/snapshot.ts lib/sweep/previous-scheduled.test.ts
git commit -m "feat(sweep): loadPreviousScheduledSnapshot (B1 fall-through) + origin filter on -7d resolver (E1)"
```

---

## Task 7: `advanceManualSweeps` compute-on-drain (D1–D5) + recovery (Task-8 combined)

**Files:**
- Create: `lib/sweep/advance.ts`
- Modify: `lib/jobs/handlers/stale-audit-reset.ts`, `lib/ada-audit/queue-manager.ts` (`recoverQueue`)
- Test: `lib/sweep/advance.test.ts`

**Interfaces:**
- Consumes: `computeSweepSnapshot`, `publishSweepSnapshot`, `loadPreviousScheduledSnapshot` (Task 6); `parseMembership` (`lib/sweep/types`).
- Produces:
  ```ts
  export const MANUAL_SWEEP_MAX_WAIT_MS: number
  export async function advanceManualSweeps(now?: Date): Promise<void>
  export async function recoverManualSweeps(now?: Date): Promise<void>
  ```

- [ ] **Step 1: Write `lib/sweep/advance.ts`**

```ts
// lib/sweep/advance.ts
//
// Compute-on-drain for manual sweeps + orphan recovery. Called from
// stale-audit-reset (10 min) and recoverQueue (boot). Never throws into its
// caller — the caller wraps it in a caught dynamic import.

import { prisma } from '@/lib/db'
import { parseMembership, type SweepMember } from '@/lib/sweep/types'
import { computeSweepSnapshot, publishSweepSnapshot, loadPreviousScheduledSnapshot } from '@/lib/sweep/snapshot'
import { enqueueJob } from '@/lib/jobs/queue'
import { MANUAL_SWEEP_JOB_TYPE } from '@/lib/jobs/handlers/manual-sweep'
import { parsePositiveInt } from '@/lib/jobs/config'
import { logError } from '@/lib/log'

const TERMINAL = ['complete', 'error', 'cancelled'] // [D1] no 'failed' status
// [Codex] parsePositiveInt — never Number(env)||fallback (accepts negatives).
export const MANUAL_SWEEP_MAX_WAIT_MS = parsePositiveInt(process.env.MANUAL_SWEEP_MAX_WAIT_MS, 13 * 60 * 60 * 1000) // [D4] 13h
// A manual row younger than this is still inside the route's create→enqueue
// window — recovery must not race it. [Codex]
const RECOVERY_GRACE_MS = 2 * 60 * 1000

interface AuditSettle { status: string; hasAda: boolean; hasSeo: boolean; seoOnly: boolean }

/** [D2/D5] Load status + run existence for a set of siteAuditIds, ONCE each. */
async function loadAuditSettles(ids: string[]): Promise<Map<string, AuditSettle>> {
  const out = new Map<string, AuditSettle>()
  if (ids.length === 0) return out
  const audits = await prisma.siteAudit.findMany({
    where: { id: { in: ids } }, select: { id: true, status: true, seoOnly: true },
  })
  const runs = await prisma.crawlRun.findMany({
    where: { siteAuditId: { in: ids }, tool: { in: ['ada-audit', 'seo-parser'] } },
    select: { siteAuditId: true, tool: true },
  })
  const runsBy = new Map<string, Set<string>>()
  for (const r of runs) {
    if (!r.siteAuditId) continue
    const s = runsBy.get(r.siteAuditId) ?? new Set<string>()
    s.add(r.tool); runsBy.set(r.siteAuditId, s)
  }
  for (const a of audits) {
    const s = runsBy.get(a.id) ?? new Set<string>()
    out.set(a.id, { status: a.status, seoOnly: a.seoOnly, hasAda: s.has('ada-audit'), hasSeo: s.has('seo-parser') })
  }
  return out
}

/**
 * True when every in-cohort member has settled. [D1/D2/D3, Codex]
 * - skipped-archived / skipped-delisted → out of cohort (never block).
 * - siteAuditId === null: invalid-domain / skipped-conflict / error → settled-failed;
 *   pending / enqueued / duplicate / shared-domain with a null id is an INVARIANT
 *   VIOLATION → block + log (should never happen post-fanout).
 * - siteAuditId set but audit row GONE → settled-failed immediately (it cannot
 *   reappear; computeSweepSnapshot classifies its runs as missing → failed coverage).
 * - complete full (¬seoOnly) audit → needs BOTH ada-audit AND seo-parser runs [D2].
 * - complete seoOnly audit → needs the seo-parser run.
 * Returns { drained, invariantViolations } so the caller can log.
 */
function drainState(members: SweepMember[], settles: Map<string, AuditSettle>): { drained: boolean; violations: string[] } {
  const violations: string[] = []
  let drained = true
  for (const m of members) {
    if (m.outcome === 'skipped-archived' || m.outcome === 'skipped-delisted') continue
    if (m.siteAuditId === null) {
      if (m.outcome === 'invalid-domain' || m.outcome === 'skipped-conflict' || m.outcome === 'error') continue // settled-failed
      violations.push(`${m.domain}:${m.outcome}:null-id`); drained = false; continue
    }
    const st = settles.get(m.siteAuditId)
    if (!st) continue // [Codex] audit row gone → settled-failed (cannot reappear)
    if (!TERMINAL.includes(st.status)) { drained = false; continue }
    if (st.status === 'complete') {
      if (st.seoOnly) { if (!st.hasSeo) drained = false }
      else if (!(st.hasAda && st.hasSeo)) drained = false // [D2]
    }
  }
  return { drained, violations }
}

export async function advanceManualSweeps(now: Date = new Date()): Promise<void> {
  // The partial unique index guarantees AT MOST ONE unsnapshotted manual row,
  // so `candidates` has length ≤ 1 — the loop is defensive, not for concurrency.
  const candidates = await prisma.weeklySweep.findMany({
    where: { origin: 'manual', snapshotJson: null, fanoutCompletedAt: { not: null } },
  })
  for (const sweep of candidates) {
    try {
      const membership = parseMembership(sweep.membershipJson)
      if (!membership) {
        // [Codex] corrupt (non-null, unparseable) membership on a fanout-completed
        // row would otherwise loop forever. Abandon it under an origin/snapshot fence.
        if (sweep.membershipJson !== null) {
          logError({ subsystem: 'sweep', scope: 'advanceManualSweeps.corruptMembership' }, new Error(`manual sweep ${sweep.id} membership corrupt — abandoning`))
          await prisma.weeklySweep.deleteMany({ where: { id: sweep.id, origin: 'manual', snapshotJson: null } })
        }
        continue
      }
      const ids = Array.from(new Set(membership.members.map((m) => m.siteAuditId).filter((x): x is string => !!x)))
      const settles = await loadAuditSettles(ids)
      const { drained, violations } = drainState(membership.members, settles)
      const maxWaitExceeded = now.getTime() - sweep.fanoutCompletedAt!.getTime() > MANUAL_SWEEP_MAX_WAIT_MS
      if (violations.length > 0) {
        logError({ subsystem: 'sweep', scope: 'advanceManualSweeps.invariant' }, new Error(`manual sweep ${sweep.id} null-id members: ${violations.join(',')}`))
      }
      if (!drained && !maxWaitExceeded) continue
      if (!drained && maxWaitExceeded) {
        logError({ subsystem: 'sweep', scope: 'advanceManualSweeps.maxWait' }, new Error(`manual sweep ${sweep.id} not drained after max-wait; computing anyway`))
      }
      const previous = await loadPreviousScheduledSnapshot(sweep.scheduledFor)
      const snapshot = await computeSweepSnapshot(sweep, previous, now)
      await publishSweepSnapshot(sweep.id, snapshot) // NO email
    } catch (err) {
      logError({ subsystem: 'sweep', scope: 'advanceManualSweeps' }, err) // fault isolation
    }
  }
}

/**
 * [Codex] Recover a manual fan-out stranded by a crash BETWEEN the route's
 * row-create and enqueue: membership never frozen. Guards:
 *  - GRACE: ignore rows younger than RECOVERY_GRACE_MS (still inside the route window).
 *  - Query ALL jobs for the group (any status), not just active. Re-enqueue ONLY
 *    when NO job row ever landed (true crash-before-enqueue). If a TERMINAL job
 *    exists (the handler ran and failed/exhausted), do NOT re-enqueue forever —
 *    abandon the still-membership-null row (fenced delete) to free the slot.
 */
export async function recoverManualSweeps(now: Date = new Date()): Promise<void> {
  try {
    const graceCutoff = new Date(now.getTime() - RECOVERY_GRACE_MS)
    const stranded = await prisma.weeklySweep.findMany({
      where: { origin: 'manual', snapshotJson: null, membershipJson: null, createdAt: { lt: graceCutoff } },
      select: { id: true, scheduledFor: true },
    })
    for (const s of stranded) {
      const iso = s.scheduledFor.toISOString()
      const anyJob = await prisma.job.findFirst({
        where: { type: MANUAL_SWEEP_JOB_TYPE, groupKey: `manual-sweep:${iso}` },
        select: { id: true, status: true },
      })
      if (!anyJob) {
        // True crash-before-enqueue — re-enqueue the fan-out.
        await enqueueJob({
          type: MANUAL_SWEEP_JOB_TYPE, payload: { scheduledFor: iso },
          dedupKey: `manual-sweep:${iso}`, groupKey: `manual-sweep:${iso}`,
        })
      } else if (anyJob.status === 'error' || anyJob.status === 'cancelled' || anyJob.status === 'complete') {
        // A terminal job ran but membership is still null (exhausted/failed and
        // onExhausted didn't delete, or a complete job that froze nothing) —
        // abandon rather than re-enqueue forever.
        await prisma.weeklySweep.deleteMany({ where: { id: s.id, origin: 'manual', snapshotJson: null, membershipJson: null } })
      }
      // active job (queued/running) → leave it alone.
    }
  } catch (err) {
    logError({ subsystem: 'sweep', scope: 'recoverManualSweeps' }, err)
  }
}
```

> Verify `SweepMember` export (`lib/sweep/types`), `parsePositiveInt` (`@/lib/jobs/config`), and `CrawlRun.tool`/`.siteAuditId` during implementation (all confirmed present).

- [ ] **Step 2: Hook into `stale-audit-reset.ts`** (add before/after the existing recovery imports)

```ts
      await import('@/lib/sweep/advance')
        .then((m) => Promise.all([m.recoverManualSweeps(new Date()), m.advanceManualSweeps(new Date())]))
        .catch((err) => console.warn('[stale-audit-reset] manual-sweep advance/recover failed:', (err as Error).message))
```

- [ ] **Step 3: Hook `recoverManualSweeps` into `recoverQueue()`** (`lib/ada-audit/queue-manager.ts`, boot recovery — mirror how `recoverBrokenLinkVerifies()` is called there, caught)

```ts
  await import('@/lib/sweep/advance')
    .then((m) => m.recoverManualSweeps(new Date()))
    .catch((err) => console.warn('[recoverQueue] manual-sweep recovery failed:', (err as Error).message))
```

- [ ] **Step 4: Write tests**

```ts
// lib/sweep/advance.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { advanceManualSweeps, recoverManualSweeps } from './advance'

beforeEach(async () => {
  await prisma.job.deleteMany({ where: { type: 'manual-sweep' } })
  await prisma.weeklySweep.deleteMany({}) // partial index: only ONE in-flight manual row allowed
})

// helper: create the single in-flight manual sweep (fanoutCompletedAt set) with N
// members, plus backing SiteAudit + CrawlRun rows in the requested states.
// ...build fixtures...

describe('advanceManualSweeps (only ever ≤1 in-flight manual candidate)', () => {
  it('does NOT publish while a complete member has only the seo-parser run [D2]', async () => { /* complete audit + seo run only → snapshotJson stays null */ })
  it('publishes once BOTH ada-audit AND seo-parser runs exist [D2], scheduled baseline, digestSentAt null', async () => { /* → snapshotJson set, digestSentAt null */ })
  it('a running member blocks drain [D1]', async () => { /* status running → no publish */ })
  it('skipped-archived/delisted members do not block drain', async () => { /* → publishes */ })
  it('invalid-domain/skipped-conflict/error null-id members settle failed (do not block) [D3]', async () => { /* → publishes */ })
  it('a residual pending member blocks until max-wait [D3]', async () => { /* → no publish */ })
  it('a set siteAuditId whose audit row is GONE settles failed (does not block) [Codex]', async () => { /* member.siteAuditId points to a deleted audit → publishes */ })
  it('max-wait exceeded publishes anyway [D4] (fanoutCompletedAt-anchored)', async () => { /* fanoutCompletedAt far in past → publishes */ })
  it('already-snapshotted candidate is a no-op', async () => { /* snapshotJson set → not a candidate, unchanged */ })
  it('a corrupt (non-null unparseable) membership on a fanout-completed row is abandoned (deleted) [Codex]', async () => {
    await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-09-10T10:00:00Z'), origin: 'manual', membershipJson: '{bad', fanoutCompletedAt: new Date() } })
    await advanceManualSweeps(new Date())
    expect(await prisma.weeklySweep.count({ where: { origin: 'manual' } })).toBe(0)
  })
})

describe('recoverManualSweeps', () => {
  it('re-enqueues a manual-sweep job for an AGED membership-null row with NO job ever landed', async () => {
    await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-09-01T10:00:00Z'), origin: 'manual', createdAt: new Date('2030-09-01T10:00:00Z') } })
    await recoverManualSweeps(new Date('2030-09-01T10:10:00Z')) // past the 2-min grace
    expect(await prisma.job.count({ where: { type: 'manual-sweep' } })).toBe(1)
  })
  it('does NOT re-enqueue a FRESH membership-null row (inside the grace window) [Codex race]', async () => {
    const t = new Date('2030-09-02T10:00:00Z')
    await prisma.weeklySweep.create({ data: { scheduledFor: t, origin: 'manual', createdAt: t } })
    await recoverManualSweeps(new Date(t.getTime() + 30_000)) // 30s < grace
    expect(await prisma.job.count({ where: { type: 'manual-sweep' } })).toBe(0)
  })
  it('does NOT re-enqueue forever when a TERMINAL job exists — abandons the membership-null row [Codex]', async () => {
    const t = new Date('2030-09-03T10:00:00Z'); const iso = t.toISOString()
    await prisma.weeklySweep.create({ data: { scheduledFor: t, origin: 'manual', createdAt: t } })
    await prisma.job.create({ data: { type: 'manual-sweep', groupKey: `manual-sweep:${iso}`, status: 'error', payload: '{}' } })
    await recoverManualSweeps(new Date(t.getTime() + 10 * 60_000))
    expect(await prisma.weeklySweep.count({ where: { origin: 'manual' } })).toBe(0) // abandoned
    expect(await prisma.job.count({ where: { type: 'manual-sweep', status: { in: ['queued', 'running'] } } })).toBe(0)
  })
})
```

- [ ] **Step 5: Run**

Run: `npx vitest run lib/sweep/advance.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add lib/sweep/advance.ts lib/sweep/advance.test.ts lib/jobs/handlers/stale-audit-reset.ts lib/ada-audit/queue-manager.ts
git commit -m "feat(sweep): advanceManualSweeps compute-on-drain (D1-D5) + recoverManualSweeps orphan re-enqueue"
```

---

## Task 8: Email isolation — digest exact-slot origin filter (E1)

**Files:**
- Modify: `lib/jobs/handlers/sweep-digest.ts`
- Test: `lib/jobs/handlers/sweep-digest.test.ts` (extend)

**Interfaces:** none new — hardens the existing resolver.

- [ ] **Step 1: Write the failing test**

```ts
// add to sweep-digest.test.ts
it('never resolves a manual row even if one shares the exact Monday slot', async () => {
  const slot = new Date('2030-10-07T01:00:00Z') // a Monday 01:00
  await prisma.weeklySweep.create({ data: { scheduledFor: slot, origin: 'manual', snapshotJson: MANUAL_SNAP } })
  // run the digest for that slot; expect it to find NO scheduled sweep → logError + no send
  // assert digestSentAt is null on the manual row and no email deps called
})
```

- [ ] **Step 2: Run to verify it fails** (the current `findUnique({scheduledFor})` would match the manual row)

Run: `npx vitest run lib/jobs/handlers/sweep-digest.test.ts`
Expected: FAIL.

- [ ] **Step 3: Change the digest lookup in `sweep-digest.ts`**

```ts
  const sweep = await prisma.weeklySweep.findFirst({
    where: { scheduledFor: sweepSlot, origin: 'scheduled' }, // [E1]
  })
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/jobs/handlers/sweep-digest.test.ts`
Expected: PASS (new + all existing).

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/sweep-digest.ts lib/jobs/handlers/sweep-digest.test.ts
git commit -m "fix(sweep): digest resolves scheduled-origin sweep only (E1 email isolation)"
```

---

## Task 9: Retention — `pruneManualSweepAudits` (R1/R3) + origin-partition `pruneWeeklySweeps` (R2)

**Files:**
- Create: `lib/ada-audit/manual-sweep-retention.ts`
- Modify: `lib/sweep/retention.ts`, `lib/jobs/handlers/cleanup.ts`
- Test: `lib/ada-audit/manual-sweep-retention.test.ts`, `lib/sweep/retention.test.ts` (extend)

**Interfaces:**
- Produces: `export async function pruneManualSweepAudits(now?: Date): Promise<void>`; `WEEKLY_SWEEP_MANUAL_SNAPSHOT_KEEP` const in `retention.ts`.

- [ ] **Step 1: Write `pruneManualSweepAudits` (mirror `pruneScheduledSiteAudits`'s artifact seam [R3] + in-flight guard [R1])**

```ts
// lib/ada-audit/manual-sweep-retention.ts
import { prisma } from '@/lib/db'
import { deleteReportFile } from '@/lib/report/report-file'
import { deleteHeroScreenshot } from '@/lib/sales/hero-screenshot'
import { parseMembership } from '@/lib/sweep/types'
import { parsePositiveInt } from '@/lib/jobs/config'
import { logError } from '@/lib/log'

export const MANUAL_SWEEP_AUDIT_KEEP = parsePositiveInt(process.env.MANUAL_SWEEP_AUDIT_KEEP, 2)
export const MANUAL_SWEEP_AUDIT_TTL_MS = parsePositiveInt(process.env.MANUAL_SWEEP_AUDIT_TTL_MS, 14 * 24 * 60 * 60 * 1000)
const TERMINAL = ['complete', 'error', 'cancelled']
const CHUNK = 25

export async function pruneManualSweepAudits(now: Date = new Date()): Promise<void> {
  // [R1] Never delete an audit still referenced by an unsnapshotted manual sweep.
  const live = await prisma.weeklySweep.findMany({
    where: { origin: 'manual', snapshotJson: null }, select: { membershipJson: true },
  })
  const protectedIds = new Set<string>()
  for (const s of live) {
    // [Codex] Fail CLOSED on a corrupt (non-null, unparseable) membership — a
    // silently-skipped row would leave protectedIds incomplete and violate R1.
    if (s.membershipJson !== null && parseMembership(s.membershipJson) === null) {
      logError({ subsystem: 'sweep', scope: 'pruneManualSweepAudits.corruptMembership' }, new Error('aborting prune pass — corrupt in-flight manual membership'))
      return
    }
    const m = parseMembership(s.membershipJson)
    m?.members.forEach((mem) => mem.siteAuditId && protectedIds.add(mem.siteAuditId))
  }

  const completed = await prisma.siteAudit.findMany({
    where: { requestedBy: 'manual-sweep', status: 'complete' },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, domain: true, clientId: true },
  })
  const keptPerKey = new Map<string, number>()
  const keepIds = new Set<string>()
  for (const a of completed) {
    const key = `${a.clientId ?? 'null'}\x00${a.domain}`
    const count = keptPerKey.get(key) ?? 0
    if (count >= MANUAL_SWEEP_AUDIT_KEEP) continue
    keepIds.add(a.id); keptPerKey.set(key, count + 1)
  }

  const cutoff = new Date(now.getTime() - MANUAL_SWEEP_AUDIT_TTL_MS)
  const candidates = await prisma.siteAudit.findMany({
    where: {
      requestedBy: 'manual-sweep', status: { in: TERMINAL }, createdAt: { lt: cutoff },
      id: { notIn: [...keepIds, ...protectedIds] },
    },
    select: { id: true },
  })
  if (candidates.length === 0) return
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const ids = candidates.slice(i, i + CHUNK).map((c) => c.id)
    await prisma.siteAudit.deleteMany({ where: { id: { in: ids } } })
    const cleanup = await Promise.allSettled(ids.flatMap((rid) => [deleteReportFile(rid), deleteHeroScreenshot(rid)]))
    for (const r of cleanup) if (r.status === 'rejected') console.warn('[manual-sweep-retention] file cleanup failed:', r.reason)
  }
  console.log(`[manual-sweep-retention] pruned ${candidates.length} manual-sweep audit(s)`)
}
```

- [ ] **Step 2: Origin-partition `pruneWeeklySweeps` [R2]** in `lib/sweep/retention.ts`

Add a manual keep constant and make the snapshot-keep rule origin-aware — keep the newest 26 SCHEDULED snapshotted rows AND the newest N MANUAL snapshotted rows independently:

```ts
import { parsePositiveInt } from '@/lib/jobs/config'
export const WEEKLY_SWEEP_MANUAL_SNAPSHOT_KEEP = parsePositiveInt(process.env.WEEKLY_SWEEP_MANUAL_SNAPSHOT_KEEP, 4)

// Replace the single snapshotPruned DELETE with two origin-scoped keep-sets:
const scheduledPruned = await prisma.$executeRaw`
  DELETE FROM "WeeklySweep"
  WHERE "snapshotJson" IS NOT NULL AND "origin" = 'scheduled'
    AND "id" NOT IN (
      SELECT "id" FROM "WeeklySweep"
      WHERE "snapshotJson" IS NOT NULL AND "origin" = 'scheduled'
      ORDER BY "scheduledFor" DESC LIMIT ${WEEKLY_SWEEP_SNAPSHOT_KEEP}
    )
`
const manualPruned = await prisma.$executeRaw`
  DELETE FROM "WeeklySweep"
  WHERE "snapshotJson" IS NOT NULL AND "origin" = 'manual'
    AND "id" NOT IN (
      SELECT "id" FROM "WeeklySweep"
      WHERE "snapshotJson" IS NOT NULL AND "origin" = 'manual'
      ORDER BY "scheduledFor" DESC LIMIT ${WEEKLY_SWEEP_MANUAL_SNAPSHOT_KEEP}
    )
`
```

Keep the dead-row `deleteMany` rule unchanged (it already targets `snapshotJson: null, digestSentAt: null` past TTL — correct for both origins; a manual row never sets `digestSentAt`).

**[Codex] Also update the log line** — the old `snapshotPruned` variable is gone; reference `scheduledPruned + manualPruned` (else the file won't type-check):

```ts
  const totalSnapshotPruned = scheduledPruned + manualPruned
  if (totalSnapshotPruned > 0 || deadPruned.count > 0) {
    console.log(`[sweep] retention pruned ${totalSnapshotPruned} old snapshot(s), ${deadPruned.count} dead sweep(s)`)
  }
```

Add `WEEKLY_SWEEP_MANUAL_SNAPSHOT_KEEP` via `parsePositiveInt(process.env.WEEKLY_SWEEP_MANUAL_SNAPSHOT_KEEP, 4)` (import `parsePositiveInt` from `@/lib/jobs/config`).

- [ ] **Step 3: Wire into `runCleanup`** (`lib/cleanup.ts` — NOT the handler; the handler just calls `runCleanup`). Add the import beside `pruneScheduledSiteAudits`/`pruneWeeklySweeps` and add the call to the `Promise.allSettled([...])` array (`runCleanup` swallows per-task failures):

```ts
import { pruneManualSweepAudits } from '@/lib/ada-audit/manual-sweep-retention'
// ...in the prune array:
    pruneManualSweepAudits(),
```
(`pruneWeeklySweeps()` is already in that array — the R2 origin-partition change in Step 2 needs no new wiring.)

- [ ] **Step 4: Write tests**

```ts
// lib/ada-audit/manual-sweep-retention.test.ts
describe('pruneManualSweepAudits', () => {
  it('keeps latest 2 completed per (client,domain), deletes older past TTL', async () => { /* ... */ })
  it('never deletes an audit referenced by an unsnapshotted manual WeeklySweep [R1]', async () => { /* ... */ })
})
// lib/sweep/retention.test.ts (extend)
describe('pruneWeeklySweeps origin partition [R2]', () => {
  it('many manual snapshots do NOT evict the newest scheduled rows', async () => { /* create 30 manual snaps + 2 scheduled; assert both scheduled survive */ })
  it('a dead manual row (snapshot+digest null) is swept at 14d', async () => { /* ... */ })
})
```

- [ ] **Step 5: Run**

Run: `npx vitest run lib/ada-audit/manual-sweep-retention.test.ts lib/sweep/retention.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/manual-sweep-retention.ts lib/sweep/retention.ts lib/jobs/handlers/cleanup.ts lib/ada-audit/manual-sweep-retention.test.ts lib/sweep/retention.test.ts
git commit -m "feat(sweep): manual-sweep audit retention (R1/R3) + origin-partitioned WeeklySweep keep (R2)"
```

---

## Task 10: `/issues` — surface `origin` + suppress manual streak label (B2)

**Files:**
- Modify: `lib/sweep/read.ts`, `components/issues/IssuesView.tsx`, `components/issues/chips.tsx`
- Test: `lib/sweep/read.test.ts` (extend), `components/issues/IssuesView.test.tsx` (extend)

**Interfaces:**
- Modifies: `IssuesPayload.sweep` gains `origin: SweepOrigin`.

- [ ] **Step 1: Surface `origin` in `read.ts`**

In `loadIssuesPayload`, add `origin: true` to the `select`, carry it onto the served row, and add `origin` to `IssuesPayload.sweep`:

```ts
// select: { scheduledFor: true, startedAt: true, snapshotJson: true, origin: true }
// served: { scheduledFor, startedAt, origin: asSweepOrigin(row.origin) }
// IssuesPayload.sweep: { ...; origin: SweepOrigin }
```

Import `asSweepOrigin, type SweepOrigin` from `./types`. Track `origin` alongside `scheduledFor`/`startedAt` in the loop's `served` object and include it in the returned `sweep`.

- [ ] **Step 2: Write the read test**

```ts
// lib/sweep/read.test.ts (extend)
it('serves the newest snapshot of ANY origin and reports its origin', async () => {
  await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2031-01-05T01:00:00Z'), origin: 'scheduled', snapshotJson: SNAP('sun') } })
  await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2031-01-07T15:00:00Z'), origin: 'manual', snapshotJson: SNAP('wed') } })
  const p = await loadIssuesPayload()
  expect(p.sweep?.origin).toBe('manual')
  expect(p.sweep?.snapshotAt).toBe('wed')
})
```

- [ ] **Step 3: Suppress the streak label for manual in the UI [B2]**

In `IssuesView.tsx`, read `payload.sweep?.origin`, show an origin label ("Weekly sweep" vs "Manual refresh · <date>"), and pass `hideStreak={payload.sweep?.origin === 'manual'}` to wherever the streak chip renders (`chips.tsx`). In `chips.tsx`, guard the "N weeks" streak label: `if (hideStreak) return null` (or omit the streak element). Match the existing chip prop/render structure.

- [ ] **Step 4: Write the component test**

```ts
// components/issues/IssuesView.test.tsx (extend)
it('hides the consecutive-week streak label when origin is manual [B2]', () => {
  // render IssuesView with a payload whose sweep.origin='manual' and a group with streak>1
  // assert the streak/"weeks" label is NOT in the document
})
```

- [ ] **Step 5: Run**

Run: `npx vitest run lib/sweep/read.test.ts components/issues/IssuesView.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/sweep/read.ts components/issues/IssuesView.tsx components/issues/chips.tsx lib/sweep/read.test.ts components/issues/IssuesView.test.tsx
git commit -m "feat(sweep): /issues surfaces snapshot origin + suppresses manual streak label (B2)"
```

---

## Task 11: BulkQueueModal + ClientsAuditSummary — repurposed UX

**Files:**
- Modify: `components/ada-audit/BulkQueueModal.tsx`, `components/ada-audit/ClientsAuditSummary.tsx`
- Test: `components/ada-audit/ClientsAuditSummary.test.tsx` (extend, if it covers the modal)

**Interfaces:** the modal now posts and expects `{ started, scheduledFor }` or `409`.

- [ ] **Step 1: Rewrite the modal phases**

Replace the `missing`/`done(queued,skipped)` model with: `confirm → running → started | already-running | error`.

- `confirm` copy: "Scan **all client domains** (Accessibility + SEO) and refresh the Issues page? This runs a full sweep — it can take a while — and does **not** send an email."
- `submit()`: `POST /api/site-audit/bulk-queue`; on `res.ok` → phase `started` ("Sweep started. The Issues page will update automatically when scans finish." + `<Link href="/issues">Go to Issues</Link>`); on `res.status === 409` → phase `already-running` ("A manual refresh is already running."); else → `error`.
- Drop the `missing` (400) phase and the `clientsWithoutDomains`/`skipped`/`queued` props no longer needed. Update the `Props` interface + `ClientsAuditSummary` call site accordingly (remove `onConfirmed(queued, skipped)`; keep `open`/`onClose`; `eligibleCount` may still show an approximate count or be dropped).

Keep all `dark:` variants and the click-outside/`stopPropagation` structure intact.

- [ ] **Step 2: Update `ClientsAuditSummary.tsx`** to match the new modal props (remove the queued/skipped result handling; the button just opens the modal).

- [ ] **Step 3: Gate the UI**

Run: `npx tsc --noEmit` (catches prop mismatches) and `npx vitest run components/ada-audit/ClientsAuditSummary.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ada-audit/BulkQueueModal.tsx components/ada-audit/ClientsAuditSummary.tsx components/ada-audit/ClientsAuditSummary.test.tsx
git commit -m "feat(sweep): repurpose Queue-all modal — full ADA+SEO sweep + /issues refresh, 409 handling"
```

---

## Task 12: Full gate + smoke

**Files:** none (verification only).

- [ ] **Step 1: Type-check** — Run: `npm run lint` (= `tsc --noEmit`). Expected: no errors.

- [ ] **Step 2: Full test suite** — Run: `npm test` (= `vitest run`). Expected: all green (note any PRE-EXISTING failures separately — do not fix unrelated).

- [ ] **Step 3: Build** — Run: `npm run build` (= `NODE_OPTIONS='--max-old-space-size=3072' next build` — the house heap cap; never bare `npx next build`). Expected: build succeeds.

- [ ] **Step 4: Smoke (optional, needs worktree node_modules symlink already in place)**

Run: `npm run smoke` — if it fails at the single-page audit with ENOENT axe.min.js, the symlink is missing; `ln -s ../../../node_modules node_modules` in the worktree and retry.

- [ ] **Step 5: Commit any gate-fix churn**

```bash
git add -p   # explicit paths only, never -A
git commit -m "chore(sweep): gate green — tsc + vitest + build"
```

---

## Self-review (checklist)

**Spec coverage:** §4.1 origin col → T1; §4.2 partial index → T1; §4.3 types → T2; §5.1 runSweepFanout F1/F2 → T3; §5.2 manual-sweep handler → T4; §5.9 onExhausted → T4; §5.5 route U2 → T5; §5.4 loadPreviousScheduledSnapshot B1 + §7 E1 → T6; §5.3 advancer D1–D5 → T7; §5.9 orphan recovery → T7; §7 digest E1 → T8; §5.8 R1/R2/R3 → T9; §5.7 origin label + B2 streak → T10; §5.6 UI → T11; §6 env defaults appear in T7/T9. All spec sections mapped.

**Placeholder scan:** The advancer/retention test bodies in T7/T9 use `/* ... */` sketches for fixture-heavy DB setup — the implementer must write the fixtures, but the assertions and the code-under-test are fully specified. Every code step that ships production code shows complete code. Acceptable per house convention (DB-fixture builders are boilerplate), but flagged.

**Type consistency:** `runSweepFanout(SweepFanoutInput, SweepFanoutDeps)`, `MANUAL_SWEEP_JOB_TYPE`, `advanceManualSweeps`/`recoverManualSweeps`, `loadPreviousScheduledSnapshot`, `pruneManualSweepAudits`, `SweepOrigin`/`asSweepOrigin`, `IssuesPayload.sweep.origin` are used consistently across tasks. `requestedBy='manual-sweep'` is the single machine marker keyed by retention.

**Open verification items for the implementer** (confirm during build, don't assume): the exact `onExhausted` hook signature in `lib/jobs/registry.ts`; `JOB_ACTIVE_STATUSES` export; `CrawlRun.tool`/`.siteAuditId` field names; the `chips.tsx` streak-render prop shape; the `runCleanup` call site in `cleanup.ts`; the migration timestamp re-check.
