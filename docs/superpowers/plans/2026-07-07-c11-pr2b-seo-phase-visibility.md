# C11 PR 2b — SEO-phase visibility + fine-grained progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the post-terminal `broken-link-verify` job (the live-scan run builder / "SEO analysis") visible with a fine-grained progress bar, on the ADA site results page and the `seoOnly` `SeoScanForm`.

**Architecture:** Add generic nullable `Job.progress`/`progressMessage`, written by the worker's existing fenced heartbeat from an in-memory cell that handlers push into via a new `ctx.reportProgress`. `broken-link-verify` reports `resolvedCount/total` during resolution. A pure `classifySeoPhase` + a job-only DB helper resolve `{done|running|queued|failed|unavailable}`; the ADA page renders a server-side `SeoPhaseBanner` when the live-scan run is absent, and `SeoScanForm` renders a progress bar + terminal failure/stall states.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, Vitest, Tailwind (class-based dark mode).

**Spec:** `docs/superpowers/specs/2026-07-07-c11-pr2b-seo-phase-visibility-design.md`

## Global Constraints

- **Branch:** `feat/c11-pr2b-seo-phase-visibility` (already created off `origin/main` @ 0d1d481).
- **Run `npx prisma generate` after Task 1's migration and before any `tsc`/test/build** — a fresh worktree's generated client will not know the new `Job` fields (24-phantom-error trap from PR 2a).
- **`$transaction` rule:** array-form only; never interactive. (Not needed in this PR, but do not introduce it.)
- **Raw SQL sets `updatedAt` manually** — N/A here (all writes go through Prisma `updateMany`, which honors `@updatedAt`).
- **UI class:** every new/changed element carries `dark:` variants; client components stay hydration-safe (no reading `window`/storage during render).
- **`HEARTBEAT_MS = 15_000`** (`lib/jobs/config.ts`) — progress persists in ~15 s steps; do not shorten it.
- **Fence for every progress write** = `{ id, status: 'running', attempts: claimedAttempt }` — identical to the heartbeat fence.
- **`reportProgress` is best-effort** — it only mutates an in-memory cell; it must never throw into a handler loop.
- **Gate commands:** `npx tsc --noEmit`, `DATABASE_URL="file:./local-dev.db" npm test`, `npm run build`.
- **Commit cadence:** one commit per task (TDD: test → impl → green → commit).

---

### Task 1: Schema — generic `Job.progress` / `progressMessage`

**Files:**
- Modify: `prisma/schema.prisma` (Job model, ~line 335)
- Create: `prisma/migrations/20260707120000_job_progress/migration.sql`

**Interfaces:**
- Produces: `Job.progress: number | null`, `Job.progressMessage: string | null` (Prisma client fields consumed by Tasks 2, 4, 5).

- [ ] **Step 1: Add the columns to the schema**

In `prisma/schema.prisma`, inside `model Job`, after the `lastError` line (before `dedupKey`):

```prisma
  lastError    String?
  progress        Int?     // 0-100, generic per-job progress; written on the fenced heartbeat
  progressMessage String?  // human-readable status, e.g. "Checked 420/1900 links"
  dedupKey     String?   // active-window idempotency key (partial unique index, see migration)
```

- [ ] **Step 2: Hand-author the migration**

Create `prisma/migrations/20260707120000_job_progress/migration.sql`:

```sql
-- Additive nullable columns (SQLite-safe; no table rebuild).
ALTER TABLE "Job" ADD COLUMN "progress" INTEGER;
ALTER TABLE "Job" ADD COLUMN "progressMessage" TEXT;
```

- [ ] **Step 3: Apply the migration + regenerate the client**

Run:
```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && \
DATABASE_URL="file:./local-dev.db" npx prisma generate
```
Expected: `migrate deploy` reports the migration applied; `generate` reports the client generated. Both exit 0.

- [ ] **Step 4: Verify tsc sees the new fields**

Run: `npx tsc --noEmit`
Expected: PASS (0 errors). If you see phantom errors about `progress` not existing on `JobUncheckedUpdateInput`, re-run `npx prisma generate`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260707120000_job_progress/
git commit -m "feat(jobs): add nullable Job.progress + progressMessage columns"
```

---

### Task 2: Worker — `ctx.reportProgress` + heartbeat flush + progress lifecycle

**Files:**
- Modify: `lib/jobs/types.ts` (`JobHandlerContext`, ~line 10)
- Modify: `lib/jobs/worker.ts` (`claimNext` ~88-107, `executeJob` ~112-175)
- Test: `lib/jobs/worker.progress.test.ts` (create)

**Interfaces:**
- Produces: `JobHandlerContext.reportProgress: (progress: number | null, message: string | null) => void` (consumed by Task 3).

- [ ] **Step 1: Write the failing tests**

Create `lib/jobs/worker.progress.test.ts`. Use the **real** harness helpers (verified in `lib/jobs/worker.test.ts`): `clearJobRegistryForTests`, `resetWorkerForTests`, `runWorkerTickOnce`, `enqueueJob`, `registerJobHandler`, plus a local `deferred()`. Two tests: (a) the success-settle contract (`progress:100`, message null) — deterministic, real timers; (b) the **heartbeat flush** using fake timers + `advanceTimersByTimeAsync` so a mid-run `reportProgress(42,…)` lands on the row under the fence.

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { registerJobHandler, clearJobRegistryForTests } from './registry'
import { enqueueJob } from './queue'
import { runWorkerTickOnce, resetWorkerForTests } from './worker'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => { resolve = res })
  return { promise, resolve }
}
async function waitFor(pred: () => Promise<boolean>, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) { if (await pred()) return; await new Promise((r) => setTimeout(r, 25)) }
  throw new Error('waitFor timed out')
}

describe('worker progress', () => {
  beforeEach(async () => {
    clearJobRegistryForTests()
    resetWorkerForTests()
    await prisma.job.deleteMany({ where: { type: { startsWith: 'test-prog' } } })
  })
  afterEach(() => { vi.useRealTimers() })

  it('sets progress:100 and clears message on successful settle', async () => {
    registerJobHandler({ type: 'test-prog-ok', concurrency: 1, handler: async (_p, ctx) => { ctx.reportProgress(42, 'Checked 42/100 links') } })
    const { id } = await enqueueJob({ type: 'test-prog-ok', payload: {} })
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.status === 'complete')
    const row = await prisma.job.findUnique({ where: { id } })
    expect(row?.progress).toBe(100)
    expect(row?.progressMessage).toBeNull()
  })

  it('flushes reported progress to the row on the fenced heartbeat', async () => {
    vi.useFakeTimers()
    const gate = deferred()
    registerJobHandler({
      type: 'test-prog-hb', concurrency: 1,
      handler: async (_p, ctx) => { ctx.reportProgress(42, 'Checked 42/100 links'); await gate.promise },
    })
    const { id } = await enqueueJob({ type: 'test-prog-hb', payload: {} })
    void runWorkerTickOnce()
    await vi.advanceTimersByTimeAsync(15_000) // one HEARTBEAT_MS tick flushes the cell
    const mid = await prisma.job.findUnique({ where: { id } })
    expect(mid?.progress).toBe(42)
    expect(mid?.progressMessage).toBe('Checked 42/100 links')
    gate.resolve()
    await vi.advanceTimersByTimeAsync(0)
  })
})
```

> Implementer note: if the fake-timer + real-SQLite interaction proves flaky (the `updateMany` promise not settling under `advanceTimersByTimeAsync`), the **success-settle test is the required one**; downgrade the heartbeat test to poll with real timers only if you first lower the wait by confirming an earlier flush — do NOT change `HEARTBEAT_MS`. Verify the exact harness helper names against `lib/jobs/worker.test.ts` before writing.

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/worker.progress.test.ts`
Expected: FAIL — `ctx.reportProgress is not a function` (type + runtime).

- [ ] **Step 3: Add `reportProgress` to the context type**

In `lib/jobs/types.ts`, extend `JobHandlerContext`:

```ts
export interface JobHandlerContext {
  jobId: string
  attempt: number
  signal: AbortSignal
  /** Best-effort progress reporter. Mutates an in-memory cell the worker
   *  flushes on its next fenced heartbeat. Never throws. progress is 0-100
   *  (clamped) or null to clear. */
  reportProgress: (progress: number | null, message: string | null) => void
}
```

- [ ] **Step 4: Wire the cell + heartbeat flush + ctx in `executeJob`**

In `lib/jobs/worker.ts`, replace the top of `executeJob` (the `fence`/`abort`/`heartbeat` block and the `cfg.handler(...)` call). New form:

```ts
async function executeJob(cfg: ResolvedJobHandlerConfig, job: ClaimedJob): Promise<void> {
  const fence = { id: job.id, status: 'running', attempts: job.attempts }
  const abort = new AbortController()
  // Per-execution progress cell; the heartbeat is the only DB writer.
  let progressCell: { progress: number | null; message: string | null } = { progress: null, message: null }
  const heartbeat = setInterval(() => {
    void prisma.job
      .updateMany({ where: fence, data: { heartbeatAt: new Date(), progress: progressCell.progress, progressMessage: progressCell.message } })
      .catch(() => {})
  }, HEARTBEAT_MS)

  const ctx: JobHandlerContext = {
    jobId: job.id,
    attempt: job.attempts,
    signal: abort.signal,
    reportProgress: (progress, message) => {
      progressCell = {
        progress: progress == null ? null : Math.max(0, Math.min(100, Math.round(progress))),
        message: message ?? null,
      }
    },
  }
```

Then change the handler invocation from the inline object to `ctx`:

```ts
      await runWithTimeout(
        cfg.handler(payload, ctx),
        cfg.timeoutMs,
        abort,
      )
```

Add the `JobHandlerContext` import if not already present:
```ts
import type { JobHandlerContext } from './types'
```

- [ ] **Step 5: Add progress lifecycle to the three settle writes**

In the settle block of `executeJob`, extend the `data` of each write:

Success:
```ts
        await prisma.job.updateMany({
          where: fence,
          data: { status: 'complete', completedAt: new Date(), progress: 100, progressMessage: null },
        })
```
Final error:
```ts
        const res = await prisma.job.updateMany({
          where: fence,
          data: { status: 'error', lastError: error, completedAt: new Date(), progress: null, progressMessage: null },
        })
```
Retry re-queue:
```ts
        await prisma.job.updateMany({
          where: fence,
          data: {
            status: 'queued',
            lastError: error,
            runAfter: new Date(Date.now() + backoffMs(cfg.backoffBaseMs, job.attempts)),
            heartbeatAt: null,
            progress: null,
            progressMessage: null,
          },
        })
```

- [ ] **Step 6: Reset progress on claim**

In `claimNext` (`lib/jobs/worker.ts`), add the two fields to the claim `updateMany` data:

```ts
      data: {
        status: 'running',
        attempts: { increment: 1 },
        startedAt: new Date(),
        heartbeatAt: new Date(),
        progress: null,
        progressMessage: null,
      },
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/worker.progress.test.ts`
Expected: PASS.

Also run the full jobs suite to confirm no regression:
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/`
Expected: PASS (fix any typed-ctx fixture that now lacks `reportProgress` — add `reportProgress: () => {}` or `vi.fn()`; see Task 3 sweep).

- [ ] **Step 8: Commit**

```bash
git add lib/jobs/types.ts lib/jobs/worker.ts lib/jobs/worker.progress.test.ts
git commit -m "feat(jobs): ctx.reportProgress flushed on fenced heartbeat + progress lifecycle"
```

---

### Task 3: `broken-link-verify` — receive ctx + report resolution progress

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts` (signature ~124, resolution loop ~245-266, registration ~511-521)
- Test: `lib/jobs/handlers/broken-link-verify.progress.test.ts` (create)
- Modify (fixtures): any test constructing a typed `JobHandlerContext` (sweep)

**Interfaces:**
- Consumes: `JobHandlerContext.reportProgress` (Task 2).
- Produces: no new exports; `runBrokenLinkVerify(payload, deps?, ctx?)` — `ctx` optional 3rd param.

- [ ] **Step 1: Write the failing test**

Create `lib/jobs/handlers/broken-link-verify.progress.test.ts`. Reuse the stub-deps pattern from `broken-link-verify.test.ts` (read it first for the `VerifyDeps` stub + fixture-row setup). Assert `reportProgress` is called with a "Checked X/Y links" message and a numeric progress during resolution.

```ts
import { describe, it, expect, vi } from 'vitest'
import { runBrokenLinkVerify, type VerifyDeps } from './broken-link-verify'
// ...import/prepare the same DB fixtures the sibling test uses:
//   a SiteAudit + a few HarvestedLink rows so allToResolve is non-empty.

describe('runBrokenLinkVerify — progress reporting', () => {
  it('reports "Checked X/Y links" progress during resolution', async () => {
    const reportProgress = vi.fn()
    const ctx = { jobId: 'j1', attempt: 1, signal: new AbortController().signal, reportProgress }
    const stubDeps: VerifyDeps = {
      resolve: async () => ({ result: 'ok', finalUrl: null, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
      resolveExternal: async () => ({ result: 'ok', finalUrl: null, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
      now: () => 0,
      sleep: async () => {},
    }
    // ... create SiteAudit + >=2 HarvestedLink rows (see sibling test helper) ...
    await runBrokenLinkVerify({ siteAuditId: SITE_AUDIT_ID, domain: 'example.com' }, stubDeps, ctx)
    expect(reportProgress).toHaveBeenCalled()
    const msgs = reportProgress.mock.calls.map((c) => c[1]).filter(Boolean) as string[]
    expect(msgs.some((m) => /Checked \d+\/\d+ links/.test(m))).toBe(true)
    // finalize phase reports the building message:
    expect(reportProgress.mock.calls.some((c) => c[1] === 'Building SEO report…')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.progress.test.ts`
Expected: FAIL — `runBrokenLinkVerify` takes 2 args / `reportProgress` never called.

- [ ] **Step 3: Add the optional ctx param + a local reporter**

In `lib/jobs/handlers/broken-link-verify.ts`, change the signature:

```ts
import type { JobHandlerContext } from '@/lib/jobs/types'

export async function runBrokenLinkVerify(
  payload: unknown,
  deps: VerifyDeps = productionDeps,
  ctx?: JobHandlerContext,
): Promise<void> {
```

After `allToResolve` is constructed (and before `cacheWorker` is defined), add a **safe** reporter (must never throw into the loop — Global Constraint):

```ts
  // Best-effort; never throws into the resolution loop.
  const report = (progress: number | null, message: string | null) => {
    try { ctx?.reportProgress(progress, message) } catch { /* ignore */ }
  }
  const totalToResolve = allToResolve.length
  let resolvedCount = 0
  const reportResolveProgress = () => {
    const pct = totalToResolve ? Math.floor((resolvedCount / totalToResolve) * 90) : 0
    report(pct, `Checked ${resolvedCount}/${totalToResolve} links`)
  }
```

- [ ] **Step 4: Increment + report inside `cacheWorker`**

In `cacheWorker`, the URL-parse-fail branch and the normal end-of-iteration both must count. Update:

```ts
      try {
        host = new URL(url).hostname
      } catch {
        cache.set(normalizeFindingUrl(url), unconfirmedResult())
        resolvedCount++; reportResolveProgress()
        continue
      }
      try {
        await throttle.wait(host)
        cache.set(normalizeFindingUrl(url), await deps.resolve(url))
      } catch {
        cache.set(normalizeFindingUrl(url), unconfirmedResult())
      }
      resolvedCount++; reportResolveProgress()
```

- [ ] **Step 5: Report the finalize phase**

Pin the placement (Codex fix): report **after** the internal + external + validation resolution passes are complete and **before** the graph/findings/score/coverage/content-similarity bundle assembly begins — so the UI shows "building" during *all* post-network work, not only the instant before the DB write. Grep for `writeFindingsRun` to locate the write, then walk **up** to the first line of bundle assembly (the first `map*Findings` / `computeContentSimilarity` / `computeDiscoveryCoverage` / `scoreLiveSeo` call after the external pass) and insert just above it:

```ts
  report(95, 'Building SEO report…')
```

(Uses the safe `report` wrapper from Step 3.)

- [ ] **Step 6: Forward ctx in the registration**

In `registerBrokenLinkVerifyHandler`, change:

```ts
    handler: (payload, ctx) => runBrokenLinkVerify(payload, undefined, ctx),
```

- [ ] **Step 7: Sweep typed-ctx fixtures**

Run: `grep -rln "signal: .*AbortController\|jobId:.*attempt:" lib --include=*.test.ts`
For each test that builds a `JobHandlerContext` object literal and passes it where the type is required, add `reportProgress: () => {}` (or `vi.fn()`). Then:
Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify`
Expected: PASS (progress test + the existing broken-link-verify suite green).

- [ ] **Step 9: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.progress.test.ts
git commit -m "feat(broken-link-verify): report resolution progress via ctx.reportProgress"
```

---

### Task 4: `seo-phase.ts` — pure classifier + job-only DB helper

**Files:**
- Create: `lib/ada-audit/seo-phase.ts`
- Test: `lib/ada-audit/seo-phase.test.ts`

**Interfaces:**
- Produces:
  - `type SeoPhaseState = 'done' | 'running' | 'queued' | 'failed' | 'unavailable'`
  - `interface SeoPhase { state: SeoPhaseState; progress: number | null; message: string | null }`
  - `classifySeoPhase(input: { liveScanRunId: string | null; job: { status: string; progress: number | null; progressMessage: string | null } | null }): SeoPhase`
  - `getLatestSeoVerifyJob(siteAuditId: string): Promise<{ status: string; progress: number | null; progressMessage: string | null } | null>`
  - `getSeoPhase(siteAuditId: string): Promise<SeoPhase>`
- Consumed by: Tasks 5 (API), 7 (ADA page).

- [ ] **Step 1: Write the failing test**

Create `lib/ada-audit/seo-phase.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { classifySeoPhase } from './seo-phase'

describe('classifySeoPhase', () => {
  it('done wins over any job', () => {
    expect(classifySeoPhase({ liveScanRunId: 'run1', job: { status: 'running', progress: 40, progressMessage: 'x' } }))
      .toEqual({ state: 'done', progress: null, message: null })
  })
  it('running carries progress + message', () => {
    expect(classifySeoPhase({ liveScanRunId: null, job: { status: 'running', progress: 40, progressMessage: 'Checked 4/10 links' } }))
      .toEqual({ state: 'running', progress: 40, message: 'Checked 4/10 links' })
  })
  it('queued', () => {
    expect(classifySeoPhase({ liveScanRunId: null, job: { status: 'queued', progress: null, progressMessage: null } }))
      .toEqual({ state: 'queued', progress: null, message: null })
  })
  it('error -> failed', () => {
    expect(classifySeoPhase({ liveScanRunId: null, job: { status: 'error', progress: null, progressMessage: null } }))
      .toEqual({ state: 'failed', progress: null, message: null })
  })
  it('complete-but-no-run -> unavailable', () => {
    expect(classifySeoPhase({ liveScanRunId: null, job: { status: 'complete', progress: 100, progressMessage: null } }))
      .toEqual({ state: 'unavailable', progress: null, message: null })
  })
  it('cancelled -> unavailable', () => {
    expect(classifySeoPhase({ liveScanRunId: null, job: { status: 'cancelled', progress: null, progressMessage: null } }))
      .toEqual({ state: 'unavailable', progress: null, message: null })
  })
  it('no run + no job -> unavailable', () => {
    expect(classifySeoPhase({ liveScanRunId: null, job: null }))
      .toEqual({ state: 'unavailable', progress: null, message: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo-phase.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/ada-audit/seo-phase.ts`:

```ts
import { prisma } from '@/lib/db'
import { BROKEN_LINK_VERIFY_JOB_TYPE } from '@/lib/jobs/handlers/broken-link-verify'

export type SeoPhaseState = 'done' | 'running' | 'queued' | 'failed' | 'unavailable'

export interface SeoPhase {
  state: SeoPhaseState
  progress: number | null
  message: string | null
}

type VerifyJob = { status: string; progress: number | null; progressMessage: string | null }

/** Pure. liveScanRunId present == SEO phase done, regardless of any Job row. */
export function classifySeoPhase(input: { liveScanRunId: string | null; job: VerifyJob | null }): SeoPhase {
  if (input.liveScanRunId) return { state: 'done', progress: null, message: null }
  const job = input.job
  if (!job) return { state: 'unavailable', progress: null, message: null }
  switch (job.status) {
    case 'running':
      return { state: 'running', progress: job.progress, message: job.progressMessage }
    case 'queued':
      return { state: 'queued', progress: null, message: null }
    case 'error':
      return { state: 'failed', progress: null, message: null }
    // 'complete' with no run is anomalous (builder always writes a run, even
    // empty-harvest); 'cancelled' likewise -> not done.
    default:
      return { state: 'unavailable', progress: null, message: null }
  }
}

/** The latest broken-link-verify job for this audit (job-only; callers already
 *  know the live-scan run id and pass it to classifySeoPhase). */
export async function getLatestSeoVerifyJob(siteAuditId: string): Promise<VerifyJob | null> {
  return prisma.job.findFirst({
    where: { type: BROKEN_LINK_VERIFY_JOB_TYPE, groupKey: `site-audit:${siteAuditId}` },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], // id tiebreaker → deterministic on same-ms rows
    select: { status: true, progress: true, progressMessage: true },
  })
}

/** Convenience for callers without a preloaded run id. */
export async function getSeoPhase(siteAuditId: string): Promise<SeoPhase> {
  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
    select: { id: true },
  })
  if (run) return { state: 'done', progress: null, message: null }
  return classifySeoPhase({ liveScanRunId: null, job: await getLatestSeoVerifyJob(siteAuditId) })
}
```

- [ ] **Step 4: Add a DB-backed test for `getLatestSeoVerifyJob` + `getSeoPhase`**

Append to `lib/ada-audit/seo-phase.test.ts` a `describe` that creates a SiteAudit + a `broken-link-verify` Job row (groupKey `site-audit:<id>`) and asserts `getSeoPhase` returns `running`; then create a `CrawlRun` (tool `seo-parser`, siteAuditId) and assert it returns `done`. (Follow the DB-fixture style of a nearby `lib/ada-audit/*.test.ts`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo-phase.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/seo-phase.ts lib/ada-audit/seo-phase.test.ts
git commit -m "feat(seo-phase): classifySeoPhase + getLatestSeoVerifyJob + getSeoPhase"
```

---

### Task 5: `GET /api/site-audit/[id]` — expose `seoPhase`

**Files:**
- Modify: `app/api/site-audit/[id]/route.ts` (GET, ~13-128 — the response object + its inline `satisfies` extension)
- Test: `app/api/site-audit/[id]/route.seo-phase.test.ts` (create)

**Interfaces:**
- Consumes: `classifySeoPhase`, `getLatestSeoVerifyJob`, `SeoPhase` (Task 4).
- Produces: `seoPhase: SeoPhase` on the GET response (added to the route's **inline** `satisfies SiteAuditDetail & {...}` extension — NOT to the shared `SiteAuditDetail` interface, which other routes return; Codex fix #5).

- [ ] **Step 1: Write the failing test**

Create `app/api/site-audit/[id]/route.seo-phase.test.ts` (follow `route.fallback.test.ts` for GET-route test setup). Assert: (a) audit with a live-scan `CrawlRun` → `seoPhase.state === 'done'`; (b) audit with a running verify job and no run → `seoPhase.state === 'running'` with progress; (c) audit with neither → `'unavailable'`.

```ts
// model on route.fallback.test.ts imports + GET invocation
import { GET } from './route'
// ... create fixtures, call GET(new NextRequest(...), { params: Promise.resolve({ id }) })
// ... const json = await res.json(); expect(json.seoPhase.state).toBe(...)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/site-audit/\[id\]/route.seo-phase.test.ts`
Expected: FAIL — `json.seoPhase` is undefined.

- [ ] **Step 3: Implement**

In `app/api/site-audit/[id]/route.ts`, add imports:
```ts
import { classifySeoPhase, getLatestSeoVerifyJob, type SeoPhase } from '@/lib/ada-audit/seo-phase'
```

Before the `return NextResponse.json({...})`, compute (short-circuit the job lookup when done):
```ts
  const liveScanRunId = audit.crawlRuns[0]?.id ?? null
  const seoPhase: SeoPhase = liveScanRunId
    ? { state: 'done', progress: null, message: null }
    : classifySeoPhase({ liveScanRunId: null, job: await getLatestSeoVerifyJob(audit.id) })
```

Reuse `liveScanRunId` in the response (replace the inline `audit.crawlRuns[0]?.id ?? null`) and add `seoPhase`:
```ts
    seoOnly: audit.seoOnly,
    liveScanRunId,
    seoPhase,
```

- [ ] **Step 4: Extend the route's inline response type (NOT shared `SiteAuditDetail`)**

In the same file, the return already ends with `} satisfies SiteAuditDetail & { queuePosition: number | null; activeAudit: typeof activeAudit; liveScanRunId: string | null }`. Add `seoPhase` to that inline extension only:
```ts
  } satisfies SiteAuditDetail & {
    queuePosition: number | null
    activeAudit: typeof activeAudit
    liveScanRunId: string | null
    seoPhase: SeoPhase
  })
```
Do **not** touch `lib/ada-audit/types.ts` — leaving `SiteAuditDetail` unchanged keeps every other route that returns it compiling. `SeoScanForm` reads `d.seoPhase` off the parsed JSON (no shared-type dependency).

- [ ] **Step 5: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/site-audit/\[id\]/`
Expected: PASS (new test + existing route tests green).

- [ ] **Step 6: Commit**

```bash
git add "app/api/site-audit/[id]/route.ts" "app/api/site-audit/[id]/route.seo-phase.test.ts"
git commit -m "feat(api): expose seoPhase on GET /api/site-audit/[id]"
```

---

### Task 6: `SeoPhaseBanner` — server-rendered status card

**Files:**
- Create: `components/site-audit/SeoPhaseBanner.tsx`
- Test: `components/site-audit/SeoPhaseBanner.test.tsx`

**Interfaces:**
- Consumes: `SeoPhase` (Task 4).
- Produces: `SeoPhaseBanner({ phase }: { phase: SeoPhase })` (default or named export — match sibling section components; `BrokenLinksSection` uses a named export, so use `export function SeoPhaseBanner`).

- [ ] **Step 1: Write the failing test**

Create `components/site-audit/SeoPhaseBanner.test.tsx`. Match house style (verified in `BrokenLinksSection.test.tsx`): the `// @vitest-environment jsdom` directive on line 1, `afterEach(cleanup)`, and `.toBeTruthy()`/`.toBeNull()` assertions — the repo does **not** configure `@testing-library/jest-dom`, so `toBeInTheDocument()` is unavailable.

```tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { SeoPhaseBanner } from './SeoPhaseBanner'

afterEach(cleanup)

describe('SeoPhaseBanner', () => {
  it('running shows counts + refresh hint', () => {
    render(<SeoPhaseBanner phase={{ state: 'running', progress: 40, message: 'Checked 4/10 links' }} />)
    expect(screen.getByText(/SEO analysis running/i)).toBeTruthy()
    expect(screen.getByText(/Checked 4\/10 links/)).toBeTruthy()
    expect(screen.getByText(/refresh/i)).toBeTruthy()
  })
  it('queued', () => {
    render(<SeoPhaseBanner phase={{ state: 'queued', progress: null, message: null }} />)
    expect(screen.getByText(/SEO analysis queued/i)).toBeTruthy()
  })
  it('failed', () => {
    render(<SeoPhaseBanner phase={{ state: 'failed', progress: null, message: null }} />)
    expect(screen.getByText(/SEO analysis failed/i)).toBeTruthy()
  })
  it('unavailable', () => {
    render(<SeoPhaseBanner phase={{ state: 'unavailable', progress: null, message: null }} />)
    expect(screen.getByText(/not available/i)).toBeTruthy()
  })
  it('done renders nothing', () => {
    const { container } = render(<SeoPhaseBanner phase={{ state: 'done', progress: null, message: null }} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/SeoPhaseBanner.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `components/site-audit/SeoPhaseBanner.tsx` (server component — no `'use client'`). Match the card styling of a sibling (open `BrokenLinksSection.tsx` for the wrapper classes). `done` renders nothing (caller only mounts it when the run is absent).

```tsx
import type { SeoPhase } from '@/lib/ada-audit/seo-phase'

export function SeoPhaseBanner({ phase }: { phase: SeoPhase }) {
  if (phase.state === 'done') return null

  const isActive = phase.state === 'running' || phase.state === 'queued'
  const title =
    phase.state === 'running' ? 'SEO analysis running'
    : phase.state === 'queued' ? 'SEO analysis queued'
    : phase.state === 'failed' ? 'SEO analysis failed'
    : 'SEO analysis not available'
  const body =
    phase.state === 'running' ? (phase.message ?? 'Checking links…')
    : phase.state === 'queued' ? 'Waiting to start…'
    : phase.state === 'failed' ? 'The SEO analysis did not complete. Re-run the audit to try again.'
    : 'This audit has no SEO analysis (it may predate the feature or the analysis was never completed).'

  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      <div className="flex items-center gap-2 mb-2">
        <span className={
          phase.state === 'failed'
            ? 'inline-block w-2.5 h-2.5 rounded-full bg-red-500'
            : isActive
              ? 'inline-block w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse'
              : 'inline-block w-2.5 h-2.5 rounded-full bg-slate-400'
        } />
        <h2 className="font-display font-bold text-[15px] text-navy dark:text-white">{title}</h2>
      </div>
      <p className="text-[13px] font-body text-navy/60 dark:text-white/60">{body}</p>
      {phase.state === 'running' && phase.progress != null && (
        <div className="mt-3 h-2 w-full rounded-full bg-gray-100 dark:bg-navy-deep overflow-hidden">
          <div className="h-full rounded-full bg-orange transition-all" style={{ width: `${phase.progress}%` }} />
        </div>
      )}
      {isActive && (
        <p className="mt-3 text-[12px] font-body text-navy/40 dark:text-white/40">
          This runs after the audit completes. Refresh this page to see the latest status.
        </p>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/SeoPhaseBanner.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/site-audit/SeoPhaseBanner.tsx components/site-audit/SeoPhaseBanner.test.tsx
git commit -m "feat(site-audit): SeoPhaseBanner server-rendered status card"
```

---

### Task 7: ADA site page — gate SEO sections vs banner

**Files:**
- Modify: `app/(app)/ada-audit/site/[id]/page.tsx` (liveScanRun select ~167-180, JSX ~227-241)

**Interfaces:**
- Consumes: `getLatestSeoVerifyJob`, `classifySeoPhase` (Task 4), `SeoPhaseBanner` (Task 6).

- [ ] **Step 1: Add `id` to the liveScanRun select + compute the phase**

In `app/(app)/ada-audit/site/[id]/page.tsx`, add `id: true` to the `liveScanRun` `select` (so we have the run id for the classifier). Then after `onPageAnalyzed` is computed, add:

```ts
import { classifySeoPhase, getLatestSeoVerifyJob } from '@/lib/ada-audit/seo-phase'
import { SeoPhaseBanner } from '@/components/site-audit/SeoPhaseBanner'
// ...
  const seoPhase = liveScanRun
    ? ({ state: 'done', progress: null, message: null } as const)
    : classifySeoPhase({ liveScanRunId: null, job: await getLatestSeoVerifyJob(audit.id) })
```

- [ ] **Step 2: Gate the six SEO sections as one block**

Replace the six section elements (`<BrokenLinksSection …/>` through `<ContentSimilaritySection …/>`, lines ~227-240) with a single conditional:

```tsx
      {liveScanRun ? (
        <>
          <BrokenLinksSection run={liveScanRun} />
          <OnPageSeoSection
            run={liveScanRun}
            analyzed={onPageAnalyzed}
            score={liveScanRun?.score ?? null}
            observed={observedPages}
            indexable={indexablePages}
            attempted={audit.pagesTotal}
            breakdown={liveScanRun?.scoreBreakdown ?? null}
          />
          <TechnicalSeoSection run={liveScanRun} analyzed={onPageAnalyzed} />
          <DiscoveryCoverageSection run={liveScanRun} />
          <ReachabilitySection run={liveScanRun} />
          <ContentSimilaritySection run={liveScanRun} />
        </>
      ) : (
        <SeoPhaseBanner phase={seoPhase} />
      )}
```

(`SiteAuditExportBar`, `SiteAuditDiffPanel`, and `SiteAuditResultsView` stay outside the gate — ADA results always render.)

- [ ] **Step 3: Verify build + typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (The sections' props all handle `liveScanRun` as their existing non-null type inside the truthy branch.)

- [ ] **Step 4: Manual sanity via build**

Run: `npm run build`
Expected: PASS (the page compiles as a server component; no client hooks added).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/ada-audit/site/[id]/page.tsx"
git commit -m "feat(site-audit): gate SEO sections behind SeoPhaseBanner when live-scan run absent"
```

---

### Task 8: `SeoScanForm` — progress bar + failed/unavailable terminals

**Files:**
- Modify: `components/seo-parser/SeoScanForm.tsx`
- Test: `components/seo-parser/SeoScanForm.test.tsx` (extend)

**Interfaces:**
- Consumes: `seoPhase` on the GET response (Task 5).

- [ ] **Step 1: Write the failing tests**

Extend `components/seo-parser/SeoScanForm.test.tsx` (read it first for the `fetch` mock pattern). Add cases:
- poll returns `{ status: 'complete', liveScanRunId: null, seoPhase: { state: 'running', progress: 60, message: 'Checked 6/10 links' } }` → renders a progress bar + "Checked 6/10 links".
- poll returns `{ status: 'complete', liveScanRunId: null, seoPhase: { state: 'failed' } }` → renders "SEO analysis failed" and stops polling (sessionStorage cleared).
- poll returns `{ status: 'complete', liveScanRunId: null, seoPhase: { state: 'unavailable' } }` → renders an "unavailable" terminal.
- poll returns `{ status: 'complete', liveScanRunId: 'run1' }` → renders "View SEO results →" (unchanged).

```tsx
it('renders progress bar while SEO analysis is running', async () => {
  mockFetchOnce({ status: 'complete', liveScanRunId: null, seoPhase: { state: 'running', progress: 60, message: 'Checked 6/10 links' } })
  // ...render, set auditId via ?scan=, advance timers...
  expect(await screen.findByText(/Checked 6\/10 links/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo-parser/SeoScanForm.test.tsx`
Expected: FAIL — no failed/unavailable handling; no progress bar.

- [ ] **Step 3: Add phases + progress state**

In `components/seo-parser/SeoScanForm.tsx`, extend the `Phase` type and add progress state:

```ts
type Phase = 'idle' | 'submitting' | 'running' | 'building' | 'ready' | 'error'
// add:
const [progress, setProgress] = useState<number | null>(null)
const [progressMsg, setProgressMsg] = useState<string | null>(null)
```

In `poll`, replace the `d.status === 'complete'` branch logic with `seoPhase`-driven handling. **Readiness is `liveScanRunId`, not `seoPhase.state === 'done'`** (Codex fix #7 — the UI needs the id to render the results link; the API keeps them aligned but the id is the source of truth). Clear stale progress on every terminal/non-building transition (Codex fix #8):

```ts
    const clearProgress = () => { setProgress(null); setProgressMsg(null) }
    if (d.status === 'error' || d.status === 'cancelled') {
      setError('SEO scan failed — please try again.')
      setPhase('error'); clearProgress()
      try { sessionStorage.removeItem(STORAGE_KEY) } catch {}
      return
    }
    if (d.status === 'complete') {
      const st = d.seoPhase?.state
      if (d.liveScanRunId) {
        setRunId(d.liveScanRunId)
        setPhase('ready'); clearProgress()
        try { sessionStorage.removeItem(STORAGE_KEY) } catch {}
      } else if (st === 'failed') {
        setError('SEO analysis failed — please try again.')
        setPhase('error'); clearProgress()
        try { sessionStorage.removeItem(STORAGE_KEY) } catch {}
      } else if (st === 'unavailable') {
        setError('SEO analysis is unavailable for this scan.')
        setPhase('error'); clearProgress()
        try { sessionStorage.removeItem(STORAGE_KEY) } catch {}
      } else {
        // running | queued — verifier in flight
        setProgress(d.seoPhase?.progress ?? null)
        setProgressMsg(d.seoPhase?.message ?? null)
        setPhase('building')
      }
      return
    }
    setPhase('running'); clearProgress()
```

Also clear progress when a **new scan** is adopted/submitted: in the mount effect (the `?scan=` / stored-id adoption) and in `submit`'s 202/409 success branches, add `setProgress(null); setProgressMsg(null)` alongside the existing `setPhase('running')` so a re-used mounted form never shows the prior scan's counts.

- [ ] **Step 4: Render the progress bar in the `building` state**

Replace the `building` block:

```tsx
      {phase === 'building' && (
        <div className="mt-3">
          <StatusPill tone="running" label="Building SEO report…" />
          {progressMsg && (
            <p className="mt-2 text-[12px] text-navy/50 dark:text-white/50">{progressMsg}</p>
          )}
          {progress != null && (
            <div className="mt-2 h-2 w-full rounded-full bg-gray-100 dark:bg-navy-deep overflow-hidden">
              <div className="h-full rounded-full bg-orange transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      )}
```

(The `error` block already renders `error` text — the failed/unavailable messages reuse it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo-parser/SeoScanForm.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/seo-parser/SeoScanForm.tsx components/seo-parser/SeoScanForm.test.tsx
git commit -m "feat(seo-parser): SeoScanForm progress bar + failed/unavailable terminals"
```

---

### Task 9: Full gates + integration check

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: PASS (0 errors).

- [ ] **Step 2: Full test suite**

Run: `DATABASE_URL="file:./local-dev.db" npm test`
Expected: PASS (no regressions; pre-existing failures, if any, must match the known-baseline — confirm against `main`).

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: No-commit (gates already green from per-task commits).** If any gate forced a fix, commit it:

```bash
git add -A && git commit -m "chore(c11): gate fixes for PR 2b"
```

---

## Notes for the implementer

- **Prisma client staleness:** if `tsc` reports `progress`/`progressMessage` don't exist on `Job*Input`, run `npx prisma generate` — the fresh worktree's client is stale until Task 1's generate.
- **Test harness discovery:** before Tasks 2/3/4/5/8, open the nearest existing test in the same directory to copy the exact import paths and DB-fixture helpers (registry reset, `enqueueJob`, `NextRequest` construction, `fetch` mock). The plan shows intent; the sibling tests show the house conventions.
- **`checked` vs `resolvedCount`:** do not repurpose the existing post-`Promise.all` `checked` variable — it is derived after resolution and cannot drive a live bar. `resolvedCount` (Task 3) is the live counter.
- **No middleware change:** `GET /api/site-audit/[id]` is already auth-gated; no `isPublicPath` entry, no `middleware.test.ts` case.
- **Migration auto-applies on deploy** — call it out in the PR body; no new required env var, so no Kevin pre-deploy step.
