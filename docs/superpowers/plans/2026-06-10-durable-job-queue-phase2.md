# Durable Job Queue — Phase 1 Close-out + Phase 2 (PDF Scans) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the legacy in-memory PSI pool (parity passed in production 2026-06-10), then migrate PDF scans onto the durable job queue as the `pdf-scan` job type — making `pdfs-running` site audits survive restarts.

**Architecture:** Phase 1 close-out makes the durable Job table the *only* PSI path: `enqueuePsiJob` becomes a thin facade over `enqueueJob`, the `queue`/`active`/`pump()` machinery and all `JOB_QUEUE_PSI` branching are deleted. Phase 2 replaces the fire-and-forget `withPdfSlot()` dispatch in `pdf-orchestrator.ts` with durable `pdf-scan` jobs handled by `lib/jobs/handlers/pdf-scan.ts` (mirroring the PSI handler's conditional-claim + one-transaction-settle + `onExhausted` pattern), then extends the recovery survival check so `pdfs-running` parents with outstanding group jobs resume instead of failing.

**Tech Stack:** Next.js 15, Prisma + SQLite (WAL), vitest (real Prisma against the shared dev DB, `fileParallelism: false`), single PM2 process.

**Conventions that apply to every task:**
- Run tests with `DATABASE_URL="file:./local-dev.db" npx vitest run <file>` from the repo root (the checked-in `.env` points at a path that doesn't exist on the Mac).
- All new test data uses `pdf-handler-test-` / `pdf-orch-test-` / `qm-jobs-test-` URL+domain prefixes so cleanup `deleteMany` calls can't touch real rows.
- Never hold a Prisma transaction across handler execution or network work.
- Commit after every task.

**Decisions already made (don't relitigate):**
- No flag for Phase 2. The queue infrastructure is production-proven (PSI parity + restart-resume verified 2026-06-10); the handoff doc specifies direct replacement with deletion of `pdf-worker-pool.ts`. A flag would re-introduce exactly the recovery branching this plan deletes.
- `failOrphanPdfAudits` is **kept** — it is still the cascade when a parent IS deliberately failed (e.g. a `running` parent at startup, whose page loop is not durable until Phase 3).
- `scanPdfUrl` errors are **domain results** (row settles, counters bump, job completes); only DB failures throw and trigger job retry — same split as the PSI handler.

---

### Task 1: Phase 1 close-out — delete the legacy PSI pool + flag branching

**Files:**
- Rewrite: `lib/ada-audit/lighthouse-queue.ts`
- Rewrite: `lib/ada-audit/lighthouse-queue.test.ts`
- Modify: `lib/ada-audit/queue-manager.ts` (drop the two `isPsiJobQueueEnabled()` guards)
- Modify: `lib/ada-audit/queue-manager.test.ts` (drop flag env handling + the flag-off test)
- Modify: `lib/jobs/handlers/psi.ts` (header comment only)
- Modify: `ecosystem.config.js` (remove `JOB_QUEUE_PSI`)

- [x] **Step 1: Rewrite the test file first**

The legacy pool tests (PSI_CONCURRENCY cap, runJob success/failure) die with the pool — their behavior is covered by `lib/jobs/handlers/psi.test.ts` and `lib/jobs/worker.test.ts`. The flag-on tests become the default behavior. Replace `lib/ada-audit/lighthouse-queue.test.ts` entirely with:

```ts
import { describe, it, expect, beforeEach } from 'vitest'

const { prisma } = await import('@/lib/db')
const { enqueuePsiJob } = await import('./lighthouse-queue')

async function clearTestState() {
  await prisma.job.deleteMany({ where: { type: 'psi', payload: { contains: 'psi-test-' } } })
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://psi-test-' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'psi-test-' } } })
}

describe('lighthouse-queue (durable facade)', () => {
  beforeEach(clearTestState)

  it('creates a durable Job row with dedupKey + groupKey', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: 'psi-test-enqueue.example', status: 'running', wcagLevel: 'wcag21aa', lighthouseTotal: 1 },
    })
    const row = await prisma.adaAudit.create({
      data: { url: 'https://psi-test-enqueue.example/p', status: 'axe-complete', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
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
  })

  it('double enqueue dedups to one Job row', async () => {
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

- [x] **Step 2: Run tests to verify the new file fails against the old module**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/lighthouse-queue.test.ts`
Expected: FAIL — `JOB_QUEUE_PSI` is unset in the test env, so the old `enqueuePsiJob` routes to the in-memory pool and no Job row is created.

- [x] **Step 3: Rewrite `lib/ada-audit/lighthouse-queue.ts`**

Delete `queue`/`active`/`pump()`/`runJob()`/`getPsiQueueState()`/`isPsiJobQueueEnabled()` and the `PSI_CONCURRENCY` parsing. Keep `PsiJob`, keep `enqueuePsiJob` as the facade with the enqueue-failure settle fallback (dynamic imports preserved — they keep this module dependency-light and the facade synchronous for the page loop):

```ts
// lib/ada-audit/lighthouse-queue.ts
//
// Thin facade over the durable job queue for PageSpeed Insights work. The
// page loop calls enqueuePsiJob() after each page's axe completes; the jobs
// worker drains them via lib/jobs/handlers/psi.ts (concurrency =
// PSI_CONCURRENCY). The in-memory worker pool that used to live here was
// deleted after production parity (2026-06-10) — PSI jobs are durable and
// survive restarts.

export interface PsiJob {
  adaAuditId: string
  siteAuditId: string
  url: string
  wcagLevel: string
}

export function enqueuePsiJob(job: PsiJob): void {
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
}
```

- [x] **Step 4: Drop the flag guards in `lib/ada-audit/queue-manager.ts`**

Change the import (line 25):

```ts
import { enqueuePsiJob } from './lighthouse-queue'
```

In `resetStaleAudits()`, change:

```ts
    if (s.status === 'lighthouse-running' && isPsiJobQueueEnabled()) {
```

to:

```ts
    if (s.status === 'lighthouse-running') {
```

In `recoverQueue()`, change:

```ts
    if (o.status === 'lighthouse-running' && isPsiJobQueueEnabled()) {
```

to:

```ts
    if (o.status === 'lighthouse-running') {
```

Also update the comment above the `recoverQueue` check — replace the sentence `and with JOB_QUEUE_PSI=1 those jobs live in the Job table` with `and those jobs live in the durable Job table`.

- [x] **Step 5: Update `lib/ada-audit/queue-manager.test.ts`**

In the `describe('recoverQueue with JOB_QUEUE_PSI=1', ...)` block:
- Rename to `describe('recoverQueue — durable-job survival', ...)`.
- Delete the `const original = ...`, `beforeEach(() => { process.env.JOB_QUEUE_PSI = '1' })`, and `afterEach(...)` env-juggling lines.
- Delete the entire `it('flag off: lighthouse-running parent is failed even with active group jobs', ...)` test.
- Keep the other three tests unchanged (survives-with-active-jobs, drained-is-failed, mixed-outstanding-pdfs-running-fails — the last one still passes after this task and is rewritten in Task 4).

- [x] **Step 6: Update the `lib/jobs/handlers/psi.ts` header comment**

Replace lines 3–5:

```ts
// Durable-queue PSI handler — the Job-table replacement for the in-memory
// pool in lib/ada-audit/lighthouse-queue.ts (legacy path kept behind the
// JOB_QUEUE_PSI flag until parity is proven; see spec Phase 1).
```

with:

```ts
// Durable-queue PSI handler. lib/ada-audit/lighthouse-queue.ts is the
// enqueue facade; this module owns execution. The legacy in-memory pool
// was deleted after production parity (2026-06-10).
```

- [x] **Step 7: Remove `JOB_QUEUE_PSI` from `ecosystem.config.js`**

Delete these lines from the `env` block:

```js
      // Durable job queue for PSI (spec Phase 1). Under parity validation —
      // once a flag-on site audit matches legacy counters and survives a
      // restart, the legacy in-memory pool gets deleted and this flag goes
      // away. Unset to fall back to the legacy pool.
      JOB_QUEUE_PSI: '1',
```

- [x] **Step 8: Verify no stragglers, run tests + typecheck**

Run: `grep -rn 'isPsiJobQueueEnabled\|getPsiQueueState\|JOB_QUEUE_PSI' lib app instrumentation.ts ecosystem.config.js`
Expected: no matches.

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/lighthouse-queue.test.ts lib/ada-audit/queue-manager.test.ts lib/jobs/handlers/psi.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

- [x] **Step 9: Commit**

```bash
git add lib/ada-audit/lighthouse-queue.ts lib/ada-audit/lighthouse-queue.test.ts lib/ada-audit/queue-manager.ts lib/ada-audit/queue-manager.test.ts lib/jobs/handlers/psi.ts ecosystem.config.js
git commit -m "feat(jobs): delete legacy PSI pool — durable queue is the only PSI path"
```

---

### Task 2: `lib/jobs/handlers/pdf-scan.ts` — durable PDF scan handler

**Files:**
- Create: `lib/jobs/handlers/pdf-scan.ts`
- Modify: `lib/jobs/handlers/register.ts`
- Test: `lib/jobs/handlers/pdf-scan.test.ts`

The handler identifies its PdfAudit row by the table's unique pairs (`@@unique([siteAuditId, url])` / `@@unique([adaAuditId, url])`), matching the orchestrator's insert-race semantics. Claim covers `pending` (normal) **and** `scanning` (re-run after a crashed attempt). Settle + counter bump run in one short transaction, conditional on `status='scanning'`, so recovery that already failed the row wins and retries can't double-bump.

- [x] **Step 1: Write the failing tests**

```ts
// lib/jobs/handlers/pdf-scan.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/ada-audit/pdf-runner', () => ({
  scanPdfUrl: vi.fn(),
}))
vi.mock('@/lib/ada-audit/site-audit-finalizer', () => ({
  finalizeSiteAudit: vi.fn(async () => undefined),
}))

const { prisma } = await import('@/lib/db')
const { scanPdfUrl } = await import('@/lib/ada-audit/pdf-runner')
const { finalizeSiteAudit } = await import('@/lib/ada-audit/site-audit-finalizer')
const { runPdfScanJob, onPdfScanExhausted, settlePdfFailure } = await import('./pdf-scan')

async function clearTestState() {
  await prisma.pdfAudit.deleteMany({ where: { url: { startsWith: 'https://pdf-handler-test-' } } })
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://pdf-handler-test-' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'pdf-handler-test-' } } })
}

async function seedSite(domain: string, pdfStatus = 'pending') {
  const site = await prisma.siteAudit.create({
    data: { domain: `pdf-handler-test-${domain}`, status: 'pdfs-running', wcagLevel: 'wcag21aa', pdfsTotal: 1 },
  })
  const url = `https://pdf-handler-test-${domain}/doc.pdf`
  const pdf = await prisma.pdfAudit.create({
    data: { siteAuditId: site.id, url, status: pdfStatus },
  })
  return { site, pdf, url }
}

describe('jobs/handlers/pdf-scan', () => {
  beforeEach(async () => {
    vi.mocked(scanPdfUrl).mockReset()
    vi.mocked(finalizeSiteAudit).mockReset()
    vi.mocked(finalizeSiteAudit).mockResolvedValue(undefined)
    await clearTestState()
  })

  it('success: settles row with scan fields, bumps pdfsComplete, finalizes', async () => {
    vi.mocked(scanPdfUrl).mockResolvedValue({
      url: 'x', fileSize: 1234, pageCount: 3,
      issues: [{ code: 'no-title', severity: 'medium', title: 't', description: 'd', remediation: 'r' }],
    } as never)
    const { site, url } = await seedSite('ok.example')
    await runPdfScanJob({ url, siteAuditId: site.id, sourcePageUrl: `https://pdf-handler-test-ok.example/page` })
    expect(scanPdfUrl).toHaveBeenCalledWith(url, { referer: 'https://pdf-handler-test-ok.example/page' })
    const row = await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id, url } })
    expect(row?.status).toBe('complete')
    expect(row?.fileSize).toBe(1234)
    expect(row?.pageCount).toBe(3)
    expect(JSON.parse(row!.issues!)).toHaveLength(1)
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsComplete).toBe(1)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('scan error: domain result — row error, pdfsError++, job completes (no throw)', async () => {
    vi.mocked(scanPdfUrl).mockResolvedValue({
      url: 'x', fileSize: null, pageCount: null, issues: [], scanError: 'HTTP 403',
    } as never)
    const { site, url } = await seedSite('err.example')
    await expect(runPdfScanJob({ url, siteAuditId: site.id })).resolves.toBeUndefined()
    const row = await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id, url } })
    expect(row?.status).toBe('error')
    expect(row?.scanError).toBe('HTTP 403')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsError).toBe(1)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('skip (oversize): row skipped with skipReason, pdfsSkipped++', async () => {
    vi.mocked(scanPdfUrl).mockResolvedValue({
      url: 'x', fileSize: null, pageCount: null, issues: [], skipReason: 'oversize',
    } as never)
    const { site, url } = await seedSite('skip.example')
    await runPdfScanJob({ url, siteAuditId: site.id })
    const row = await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id, url } })
    expect(row?.status).toBe('skipped')
    expect(row?.skipReason).toBe('oversize')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsSkipped).toBe(1)
  })

  it('standalone (adaAuditId only): settles the row, no finalize call', async () => {
    vi.mocked(scanPdfUrl).mockResolvedValue({
      url: 'x', fileSize: 10, pageCount: 1, issues: [],
    } as never)
    const ada = await prisma.adaAudit.create({
      data: { url: 'https://pdf-handler-test-solo.example/page', status: 'complete', wcagLevel: 'wcag21aa' },
    })
    const url = 'https://pdf-handler-test-solo.example/doc.pdf'
    await prisma.pdfAudit.create({ data: { adaAuditId: ada.id, url, status: 'pending' } })
    await runPdfScanJob({ url, adaAuditId: ada.id })
    const row = await prisma.pdfAudit.findFirst({ where: { adaAuditId: ada.id, url } })
    expect(row?.status).toBe('complete')
    expect(finalizeSiteAudit).not.toHaveBeenCalled()
  })

  it('re-run on a scanning row (crash retry): claims and settles', async () => {
    vi.mocked(scanPdfUrl).mockResolvedValue({
      url: 'x', fileSize: 10, pageCount: 1, issues: [],
    } as never)
    const { site, url } = await seedSite('rerun.example', 'scanning')
    await runPdfScanJob({ url, siteAuditId: site.id })
    expect((await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id, url } }))?.status).toBe('complete')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsComplete).toBe(1)
  })

  it('row already terminal: no scan, no counter bump, no finalize (idempotent)', async () => {
    const { site, url } = await seedSite('terminal.example', 'error')
    await runPdfScanJob({ url, siteAuditId: site.id })
    expect(scanPdfUrl).not.toHaveBeenCalled()
    const siteFinal = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(siteFinal?.pdfsComplete).toBe(0)
    expect(siteFinal?.pdfsError).toBe(0)
    expect(finalizeSiteAudit).not.toHaveBeenCalled()
  })

  it('onPdfScanExhausted: settles the row as error, bumps pdfsError, finalizes', async () => {
    const { site, url } = await seedSite('exhausted.example', 'scanning')
    await onPdfScanExhausted(
      { url, siteAuditId: site.id },
      { jobId: 'j1', attempts: 3, lastError: 'kept failing' },
    )
    const row = await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id, url } })
    expect(row?.status).toBe('error')
    expect(row?.scanError).toContain('PDF scan job failed after 3 attempts')
    expect(row?.scanError).toContain('kept failing')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsError).toBe(1)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('onPdfScanExhausted no-ops when the row is already terminal', async () => {
    const { site, url } = await seedSite('exhausted-noop.example', 'complete')
    await onPdfScanExhausted(
      { url, siteAuditId: site.id },
      { jobId: 'j1', attempts: 3, lastError: 'x' },
    )
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsError).toBe(0)
    expect(finalizeSiteAudit).not.toHaveBeenCalled()
  })

  it('settlePdfFailure claims a pending row too (enqueue-failure path)', async () => {
    const { site, url } = await seedSite('enqueue-fail.example', 'pending')
    await settlePdfFailure({ url, siteAuditId: site.id }, 'Failed to enqueue durable PDF scan job: boom')
    const row = await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id, url } })
    expect(row?.status).toBe('error')
    expect(row?.scanError).toContain('Failed to enqueue')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsError).toBe(1)
  })

  it('settle failure leaves the row reclaimable with no counter drift, and the job throws (retryable)', async () => {
    // The legacy PSI path's wedge class: row flips terminal but the counter
    // bump fails, and a retry no-ops forever. The one-transaction settle
    // makes that impossible — prove the failure half: a failed settle
    // transaction leaves the row in 'scanning' (the next attempt reclaims
    // it) and never bumps a counter.
    vi.mocked(scanPdfUrl).mockResolvedValue({
      url: 'x', fileSize: 10, pageCount: 1, issues: [],
    } as never)
    const { site, url } = await seedSite('tx-fail.example')
    const txSpy = vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    try {
      await expect(runPdfScanJob({ url, siteAuditId: site.id })).rejects.toThrow('SQLITE_BUSY')
    } finally {
      txSpy.mockRestore()
    }
    const row = await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id, url } })
    expect(row?.status).toBe('scanning') // non-terminal — the retry reclaims it
    const siteFinal = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(siteFinal?.pdfsComplete).toBe(0)
    expect(siteFinal?.pdfsError).toBe(0)
    expect(finalizeSiteAudit).not.toHaveBeenCalled()
  })

  it('rejects a malformed payload', async () => {
    await expect(runPdfScanJob({ nope: true } as never)).rejects.toThrow(/payload/i)
    await expect(runPdfScanJob({ url: 'https://x/doc.pdf' } as never)).rejects.toThrow(/payload/i)
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/pdf-scan.test.ts`
Expected: FAIL — cannot resolve `./pdf-scan`.

- [x] **Step 3: Implement `lib/jobs/handlers/pdf-scan.ts`**

```ts
// lib/jobs/handlers/pdf-scan.ts
//
// Durable-queue PDF scan handler — replaces the fire-and-forget
// withPdfSlot() dispatch that used to live in lib/ada-audit/pdf-orchestrator
// (the in-memory pool in pdf-worker-pool.ts was deleted with it). One job
// per PdfAudit row; rows are identified by the (siteAuditId, url) /
// (adaAuditId, url) unique pairs, matching the orchestrator's insert-race
// semantics, not by PdfAudit.id.
//
// Idempotency: the conditional claim on PdfAudit.status IN
// ('pending','scanning') re-scans an unfinished row on re-run (crash
// recovery, zombie attempts) and no-ops on settled rows. 'scanning' is
// claimable because a crashed attempt leaves the row there.
//
// Error semantics (mirrors handlers/psi.ts):
// - scanPdfUrl never throws — HTTP errors, parse failures, and oversize
//   skips come back as scanError/skipReason and are DOMAIN results: the row
//   settles, counters bump, the job completes. No job retry.
// - DB failures THROW → the queue retries (covers transient SQLITE_BUSY).
// - The row settle + SiteAudit counter bump run in ONE short transaction
//   (no network work inside), conditional on status='scanning', so recovery
//   that already failed the row wins and retries can't double-bump.
// - finalizeSiteAudit failure after the transaction committed
//   warns-and-continues — another settling job or stale recovery picks it
//   up, same exposure as the PSI handler.

import { prisma } from '@/lib/db'
import { scanPdfUrl } from '@/lib/ada-audit/pdf-runner'
import { finalizeSiteAudit } from '@/lib/ada-audit/site-audit-finalizer'
import { parsePositiveInt } from '../config'
import { registerJobHandler } from '../registry'
import type { JobExhaustedContext } from '../types'

export const PDF_SCAN_JOB_TYPE = 'pdf-scan'

export interface PdfScanJob {
  url: string
  siteAuditId?: string
  adaAuditId?: string
  sourcePageUrl?: string
}

function assertPdfScanPayload(payload: unknown): PdfScanJob {
  const p = payload as Partial<PdfScanJob> | null
  if (
    !p ||
    typeof p.url !== 'string' ||
    (typeof p.siteAuditId !== 'string' && typeof p.adaAuditId !== 'string')
  ) {
    throw new Error('Invalid pdf-scan job payload')
  }
  return p as PdfScanJob
}

/** The PdfAudit row for this job — keyed by the table's unique pairs. */
function rowWhere(job: PdfScanJob) {
  return job.siteAuditId
    ? { siteAuditId: job.siteAuditId, url: job.url }
    : { adaAuditId: job.adaAuditId, url: job.url }
}

interface PdfOutcome {
  status: 'complete' | 'error' | 'skipped'
  fileSize: number | null
  pageCount: number | null
  issues: string
  scanError: string | null
  skipReason: string | null
}

/**
 * Atomically settle the row and bump the matching SiteAudit counter.
 * Returns false when no row matched the claimable statuses (recovery beat
 * us / idempotent re-run). On true and a site-audit job, the caller must
 * invoke finalizeSiteAudit (outside the transaction).
 */
async function settlePdfOutcome(
  job: PdfScanJob,
  outcome: PdfOutcome,
  claimableStatuses: string[],
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.pdfAudit.updateMany({
      where: { ...rowWhere(job), status: { in: claimableStatuses } },
      data: outcome,
    })
    if (claimed.count !== 1) return false
    if (job.siteAuditId) {
      await tx.siteAudit.update({
        where: { id: job.siteAuditId },
        data:
          outcome.status === 'skipped'
            ? { pdfsSkipped: { increment: 1 } }
            : outcome.status === 'error'
              ? { pdfsError: { increment: 1 } }
              : { pdfsComplete: { increment: 1 } },
      })
    }
    return true
  })
}

export async function runPdfScanJob(payload: unknown): Promise<void> {
  const job = assertPdfScanPayload(payload)

  // Claim before the scan: pending (normal) or scanning (crash re-run).
  // 0 rows → already settled or recovery failed it; nothing to do.
  const claimed = await prisma.pdfAudit.updateMany({
    where: { ...rowWhere(job), status: { in: ['pending', 'scanning'] } },
    data: { status: 'scanning' },
  })
  if (claimed.count !== 1) return

  const result = await scanPdfUrl(job.url, { referer: job.sourcePageUrl })
  const isSkipped = !!result.skipReason
  const isErrored = !isSkipped && !!result.scanError

  const settled = await settlePdfOutcome(
    job,
    {
      status: isSkipped ? 'skipped' : isErrored ? 'error' : 'complete',
      fileSize: result.fileSize,
      pageCount: result.pageCount,
      issues: JSON.stringify(result.issues),
      scanError: isErrored ? result.scanError! : null,
      skipReason: isSkipped ? result.skipReason! : null,
    },
    ['scanning'],
  )
  if (!settled || !job.siteAuditId) return

  try {
    await finalizeSiteAudit(job.siteAuditId)
  } catch (err) {
    console.warn('[jobs/pdf-scan] finalize after settle failed:', (err as Error).message)
  }
}

/**
 * Settle a PDF failure that happened OUTSIDE the scan path — job exhaustion
 * or a failed durable enqueue (pdf-orchestrator's fallback). Without this a
 * site-audit parent strands in pdfs-running, because finalizeSiteAudit only
 * counts pdfsComplete + pdfsError + pdfsSkipped against pdfsTotal.
 */
export async function settlePdfFailure(payload: unknown, message: string): Promise<void> {
  const job = assertPdfScanPayload(payload)
  const settled = await settlePdfOutcome(
    job,
    { status: 'error', fileSize: null, pageCount: null, issues: '[]', scanError: message, skipReason: null },
    ['pending', 'scanning'],
  )
  if (!settled || !job.siteAuditId) return
  try {
    await finalizeSiteAudit(job.siteAuditId)
  } catch (err) {
    console.warn('[jobs/pdf-scan] finalize after failure settle failed:', (err as Error).message)
  }
}

export async function onPdfScanExhausted(payload: unknown, ctx: JobExhaustedContext): Promise<void> {
  await settlePdfFailure(payload, `PDF scan job failed after ${ctx.attempts} attempts: ${ctx.lastError}`)
}

export function registerPdfScanHandler(): void {
  registerJobHandler({
    type: PDF_SCAN_JOB_TYPE,
    concurrency: parsePositiveInt(process.env.PDF_POOL_SIZE, 4),
    maxAttempts: 3,
    backoffBaseMs: 30_000,
    // scanPdfUrl self-limits (byte cap, one retry with small backoff) and
    // pdfjs parses a capped buffer; 120s also catches DB hangs.
    timeoutMs: 120_000,
    handler: runPdfScanJob,
    onExhausted: onPdfScanExhausted,
  })
}
```

- [x] **Step 4: Register the handler in `lib/jobs/handlers/register.ts`**

```ts
// lib/jobs/handlers/register.ts
//
// Single registration point for built-in job handlers. Idempotent —
// instrumentation calls it BEFORE startup recovery (recoverJobsOnStartup may
// run onExhausted hooks, which need a populated registry) and startJobWorker
// calls it again (harmless re-register).

import { registerPsiHandler } from './psi'
import { registerPdfScanHandler } from './pdf-scan'

export function registerBuiltInJobHandlers(): void {
  registerPsiHandler()
  registerPdfScanHandler()
}
```

- [x] **Step 5: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/pdf-scan.test.ts`
Expected: PASS (11 tests).

Run: `npx tsc --noEmit`
Expected: no errors.

- [x] **Step 6: Commit**

```bash
git add lib/jobs/handlers/pdf-scan.ts lib/jobs/handlers/pdf-scan.test.ts lib/jobs/handlers/register.ts
git commit -m "feat(jobs): pdf-scan handler — conditional claim, one-transaction settle, onExhausted"
```

---

### Task 3: `pdf-orchestrator.ts` — enqueue durable jobs; delete `pdf-worker-pool.ts`

**Files:**
- Modify: `lib/ada-audit/pdf-orchestrator.ts`
- Delete: `lib/ada-audit/pdf-worker-pool.ts`
- Test: `lib/ada-audit/pdf-orchestrator.test.ts` (new)

- [x] **Step 1: Write the failing tests**

```ts
// lib/ada-audit/pdf-orchestrator.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Spy-wrap enqueueJob so the failure test can reject once; default
// implementation passes through to the real queue.
vi.mock('@/lib/jobs/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/queue')>()
  return { ...actual, enqueueJob: vi.fn(actual.enqueueJob) }
})
// settlePdfFailure → finalizeSiteAudit would touch the real queue manager;
// stub the finalizer like every other ada-audit test.
vi.mock('@/lib/ada-audit/site-audit-finalizer', () => ({
  finalizeSiteAudit: vi.fn(async () => undefined),
}))

const { prisma } = await import('@/lib/db')
const { enqueueJob } = await import('@/lib/jobs/queue')
const { dispatchPdfScans } = await import('./pdf-orchestrator')

async function clearTestState() {
  await prisma.job.deleteMany({ where: { type: 'pdf-scan', payload: { contains: 'pdf-orch-test-' } } })
  await prisma.pdfAudit.deleteMany({ where: { url: { startsWith: 'https://pdf-orch-test-' } } })
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://pdf-orch-test-' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'pdf-orch-test-' } } })
}

describe('pdf-orchestrator (durable dispatch)', () => {
  beforeEach(async () => {
    vi.mocked(enqueueJob).mockClear()
    await clearTestState()
  })

  it('inserts pending rows, bumps pdfsTotal, and enqueues one pdf-scan job per URL', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: 'pdf-orch-test-site.example', status: 'running', wcagLevel: 'wcag21aa' },
    })
    const urls = [
      'https://pdf-orch-test-site.example/a.pdf',
      'https://pdf-orch-test-site.example/b.pdf',
    ]
    await dispatchPdfScans({ urls, siteAuditId: site.id, sourcePageUrl: 'https://pdf-orch-test-site.example/page' })

    const rows = await prisma.pdfAudit.findMany({ where: { siteAuditId: site.id } })
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === 'pending')).toBe(true)
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsTotal).toBe(2)

    for (const url of urls) {
      const job = await prisma.job.findFirst({
        where: { type: 'pdf-scan', dedupKey: `pdf:${site.id}:${url}` },
      })
      expect(job).not.toBeNull()
      expect(job!.groupKey).toBe(`site-audit:${site.id}`)
      expect(JSON.parse(job!.payload)).toMatchObject({
        url, siteAuditId: site.id, sourcePageUrl: 'https://pdf-orch-test-site.example/page',
      })
    }
  })

  it('dedups already-known URLs — no new row, no new job', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: 'pdf-orch-test-dedup.example', status: 'running', wcagLevel: 'wcag21aa', pdfsTotal: 1 },
    })
    const url = 'https://pdf-orch-test-dedup.example/a.pdf'
    await prisma.pdfAudit.create({ data: { siteAuditId: site.id, url, status: 'complete' } })

    await dispatchPdfScans({ urls: [url], siteAuditId: site.id })

    expect(await prisma.pdfAudit.count({ where: { siteAuditId: site.id } })).toBe(1)
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsTotal).toBe(1)
    expect(await prisma.job.count({ where: { type: 'pdf-scan', dedupKey: `pdf:${site.id}:${url}` } })).toBe(0)
  })

  it('standalone dispatch (adaAuditId) uses the ada-audit group + dedup keys', async () => {
    const ada = await prisma.adaAudit.create({
      data: { url: 'https://pdf-orch-test-solo.example/page', status: 'complete', wcagLevel: 'wcag21aa' },
    })
    const url = 'https://pdf-orch-test-solo.example/doc.pdf'
    await dispatchPdfScans({ urls: [url], adaAuditId: ada.id })

    const job = await prisma.job.findFirst({
      where: { type: 'pdf-scan', dedupKey: `pdf:ada:${ada.id}:${url}` },
    })
    expect(job).not.toBeNull()
    expect(job!.groupKey).toBe(`ada-audit:${ada.id}`)
  })

  it('enqueue failure settles the row as error + pdfsError++ (no stranded pending row)', async () => {
    vi.mocked(enqueueJob).mockRejectedValueOnce(new Error('disk full'))
    const site = await prisma.siteAudit.create({
      data: { domain: 'pdf-orch-test-fail.example', status: 'running', wcagLevel: 'wcag21aa' },
    })
    const url = 'https://pdf-orch-test-fail.example/a.pdf'
    await dispatchPdfScans({ urls: [url], siteAuditId: site.id })

    const row = await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id, url } })
    expect(row?.status).toBe('error')
    expect(row?.scanError).toContain('Failed to enqueue durable PDF scan job')
    const siteFinal = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(siteFinal?.pdfsTotal).toBe(1)
    expect(siteFinal?.pdfsError).toBe(1)
  })

  it('throws when neither siteAuditId nor adaAuditId is given', async () => {
    await expect(dispatchPdfScans({ urls: ['https://pdf-orch-test-x.example/a.pdf'] })).rejects.toThrow()
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/pdf-orchestrator.test.ts`
Expected: FAIL — no `pdf-scan` Job rows exist (old code routes through `withPdfSlot`), and the enqueue-failure test finds the row still `pending`.

- [x] **Step 3: Rewrite the dispatch tail of `lib/ada-audit/pdf-orchestrator.ts`**

Replace the import of `withPdfSlot`/`scanPdfUrl` block at the top:

```ts
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { enqueueJob } from '@/lib/jobs/queue'
import { PDF_SCAN_JOB_TYPE, settlePdfFailure } from '@/lib/jobs/handlers/pdf-scan'
import type { PdfScanJob } from '@/lib/jobs/handlers/pdf-scan'
```

(`scanPdfUrl` is no longer imported here — the handler owns it.)

Update the module header comment, replacing the second paragraph (lines 3–10) with:

```ts
// Takes harvested PDF URLs from a page, dedupes against existing PdfAudit
// rows for this audit, inserts pending rows, and enqueues one durable
// 'pdf-scan' job per row (lib/jobs/handlers/pdf-scan.ts owns scan +
// settle + counters + finalize). pdfsTotal is bumped here, at insert time,
// so the finalizer's drain predicate is correct before the page settles.
```

Then replace everything from `if (inserted.length === 0) return` to the end of the function with:

```ts
  if (inserted.length === 0) return

  // Enqueue one durable job per inserted row. Awaited — these are cheap DB
  // inserts, and a failed enqueue must settle its row NOW: pdfsTotal already
  // committed above, so a row with no job would strand the audit in
  // pdfs-running forever. settlePdfFailure flips the row to error, bumps
  // pdfsError, and finalizes — mirroring the PSI enqueue-failure fallback.
  for (const url of inserted) {
    const job: PdfScanJob = { url, siteAuditId, adaAuditId, sourcePageUrl }
    try {
      await enqueueJob({
        type: PDF_SCAN_JOB_TYPE,
        payload: job,
        dedupKey: siteAuditId ? `pdf:${siteAuditId}:${url}` : `pdf:ada:${adaAuditId}:${url}`,
        groupKey: siteAuditId ? `site-audit:${siteAuditId}` : `ada-audit:${adaAuditId}`,
      })
    } catch (err) {
      console.error('[pdf-orchestrator] durable PDF enqueue failed for', url, ':', (err as Error).message)
      try {
        await settlePdfFailure(job, `Failed to enqueue durable PDF scan job: ${(err as Error).message}`)
      } catch (settleErr) {
        console.error('[pdf-orchestrator] PDF enqueue-failure settle also failed for', url, ':', (settleErr as Error).message)
      }
    }
  }
}
```

- [x] **Step 4: Delete the worker pool**

```bash
git rm lib/ada-audit/pdf-worker-pool.ts
```

Then update the stale comment in `lib/ada-audit/queue-manager.ts` (around line 113–119) — replace:

```ts
          // AWAITED on purpose: dispatchPdfScans returns after it has
          // inserted PdfAudit rows and incremented SiteAudit.pdfsTotal. It
          // does NOT wait for actual scans — those run via withPdfSlot()
          // fire-and-forget inside dispatchPdfScans. Awaiting here closes a
          // race where the finalizer (called by a fast PSI return or by
          // end-of-page-loop) could observe pdfsTotal=0 and finalize the
          // audit before any PdfAudit rows landed.
```

with:

```ts
          // AWAITED on purpose: dispatchPdfScans returns after it has
          // inserted PdfAudit rows, incremented SiteAudit.pdfsTotal, and
          // enqueued the durable pdf-scan jobs. It does NOT wait for actual
          // scans — the jobs worker drains those. Awaiting here closes a
          // race where the finalizer (called by a fast PSI return or by
          // end-of-page-loop) could observe pdfsTotal=0 and finalize the
          // audit before any PdfAudit rows landed.
```

- [x] **Step 5: Verify no stragglers, run tests + typecheck**

Run: `grep -rn 'withPdfSlot\|pdf-worker-pool\|PDF_POOL_SIZE' lib app instrumentation.ts ecosystem.config.js`
Expected: `PDF_POOL_SIZE` only in `lib/jobs/handlers/pdf-scan.ts`; no other matches.

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/pdf-orchestrator.test.ts lib/jobs/handlers/pdf-scan.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

- [x] **Step 6: Commit**

```bash
git add lib/ada-audit/pdf-orchestrator.ts lib/ada-audit/pdf-orchestrator.test.ts lib/ada-audit/queue-manager.ts
git commit -m "feat(jobs): PDF scans enqueue durable pdf-scan jobs; delete pdf-worker-pool"
```

---

### Task 4: Recovery — `pdfs-running` parents survive restarts

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts` (`recoverQueue` + `resetStaleAudits`)
- Modify: `lib/ada-audit/queue-manager.test.ts`

`finalizeSiteAudit` gives `pdfs-running` precedence when both PDFs and PSI are outstanding, so a crash mid-drain usually leaves the parent in `pdfs-running` with **both** `pdf-scan` and `psi` jobs in its group. `countActiveJobsByGroup` is type-agnostic — one check covers the mixed case. `running` parents still fail (the page loop is not durable until Phase 3).

**Finalize-before-fail (Codex review fix):** a transient parent with **zero** active group jobs is not necessarily dead — a valid crash window exists where the last durable job committed its row + counters but the process died before `finalizeSiteAudit` ran. Counters may already be fully drained. Both recovery paths therefore give the finalizer one chance: call `finalizeSiteAudit(id)`, re-read the parent, and only fail it if it is still transient.

- [x] **Step 1: Update the tests first**

In `lib/ada-audit/queue-manager.test.ts`, inside `describe('recoverQueue — durable-job survival', ...)`:

The file already mocks `@/lib/ada-audit/site-audit-finalizer` at the top; add this import next to the other top-level imports so the finalize-attempt tests can drive the mock:

```ts
const { finalizeSiteAudit } = await import('@/lib/ada-audit/site-audit-finalizer')
```

(The mock's default implementation is a no-op, which models a not-yet-drained audit: finalize runs but doesn't flip the status. The "drained" tests override it once to actually flip the row, simulating the real finalizer on drained counters.) Also add `vi.mocked(finalizeSiteAudit).mockReset()` in a `beforeEach` inside this describe so overrides don't leak between tests.

**Replace** the mixed-outstanding test (`it('mixed-outstanding: pdfs-running parent is failed even with active PSI jobs, ...')`) with these five tests:

```ts
  it('pdfs-running parent with active pdf-scan group jobs survives', async () => {
    const parent = await makeParent('pdf-survives.example', 'pdfs-running')
    await prisma.job.create({
      data: { type: 'pdf-scan', status: 'queued', groupKey: `site-audit:${parent.id}` },
    })
    try {
      await recoverQueue()
      expect((await prisma.siteAudit.findUnique({ where: { id: parent.id } }))?.status).toBe('pdfs-running')
    } finally {
      await cleanup([parent.id])
    }
  })

  it('mixed-outstanding: pdfs-running parent with active PSI jobs survives (both types are durable)', async () => {
    const parent = await makeParent('mixed.example', 'pdfs-running')
    await prisma.job.create({
      data: { type: 'psi', status: 'queued', groupKey: `site-audit:${parent.id}` },
    })
    try {
      await recoverQueue()
      expect((await prisma.siteAudit.findUnique({ where: { id: parent.id } }))?.status).toBe('pdfs-running')
    } finally {
      await cleanup([parent.id])
    }
  })

  it('drained pdfs-running parent with no active jobs is finalized, not failed', async () => {
    // Crash window: last job committed counters, process died before
    // finalize. Recovery must give the finalizer one chance.
    const parent = await makeParent('pdf-finalize.example', 'pdfs-running')
    vi.mocked(finalizeSiteAudit).mockImplementationOnce(async (id: string) => {
      await prisma.siteAudit.update({ where: { id }, data: { status: 'complete', completedAt: new Date() } })
    })
    try {
      await recoverQueue()
      expect(finalizeSiteAudit).toHaveBeenCalledWith(parent.id)
      expect((await prisma.siteAudit.findUnique({ where: { id: parent.id } }))?.status).toBe('complete')
    } finally {
      await cleanup([parent.id])
    }
  })

  it('drained lighthouse-running parent with no active jobs is finalized, not failed', async () => {
    const parent = await makeParent('lh-finalize.example', 'lighthouse-running')
    vi.mocked(finalizeSiteAudit).mockImplementationOnce(async (id: string) => {
      await prisma.siteAudit.update({ where: { id }, data: { status: 'complete', completedAt: new Date() } })
    })
    try {
      await recoverQueue()
      expect((await prisma.siteAudit.findUnique({ where: { id: parent.id } }))?.status).toBe('complete')
    } finally {
      await cleanup([parent.id])
    }
  })

  it('not-drained pdfs-running parent with no active jobs is failed after the finalize attempt; orphans cascade', async () => {
    // Default finalizer mock no-ops (models "counters not drained") —
    // recovery must fall through to the fail path with full cascade.
    const parent = await makeParent('pdf-drained.example', 'pdfs-running')
    const pdf = await prisma.pdfAudit.create({
      data: { siteAuditId: parent.id, url: 'https://qm-jobs-test-pdf-drained.example/a.pdf', status: 'scanning' },
    })
    await prisma.job.create({
      data: { type: 'pdf-scan', status: 'error', groupKey: `site-audit:${parent.id}` },
    })
    try {
      await recoverQueue()
      expect(finalizeSiteAudit).toHaveBeenCalledWith(parent.id)
      expect((await prisma.siteAudit.findUnique({ where: { id: parent.id } }))?.status).toBe('error')
      expect((await prisma.pdfAudit.findUnique({ where: { id: pdf.id } }))?.status).toBe('error')
    } finally {
      await prisma.pdfAudit.deleteMany({ where: { url: { startsWith: 'https://qm-jobs-test-' } } })
      await cleanup([parent.id])
    }
  })

  it('running parent is failed even with active group jobs (page loop is not durable)', async () => {
    const parent = await makeParent('page-loop.example', 'running')
    const job = await prisma.job.create({
      data: { type: 'pdf-scan', status: 'queued', groupKey: `site-audit:${parent.id}` },
    })
    try {
      await recoverQueue()
      expect((await prisma.siteAudit.findUnique({ where: { id: parent.id } }))?.status).toBe('error')
      expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe('cancelled')
    } finally {
      await cleanup([parent.id])
    }
  })
```

**Add** a stale-sweep survival test as a new top-level describe (after the existing `resetStaleAudits — orphan child cleanup` block; it reuses `clearOrphanTestState`):

```ts
describe('resetStaleAudits — durable-job survival', () => {
  beforeEach(clearOrphanTestState)

  it('stale pdfs-running parent with active group jobs survives the sweep', async () => {
    const sixMinAgo = new Date(Date.now() - 6 * 60 * 1000)
    const parent = await prisma.siteAudit.create({
      data: { domain: 'orphan-test-stale-pdf.example', status: 'pdfs-running', wcagLevel: 'wcag21aa' },
    })
    await prisma.$executeRaw`UPDATE "SiteAudit" SET "updatedAt" = ${sixMinAgo} WHERE "id" = ${parent.id}`
    const job = await prisma.job.create({
      data: { type: 'pdf-scan', status: 'queued', groupKey: `site-audit:${parent.id}`, runAfter: new Date(Date.now() + 60_000) },
    })
    try {
      await resetStaleAudits()
      expect((await prisma.siteAudit.findUnique({ where: { id: parent.id } }))?.status).toBe('pdfs-running')
    } finally {
      await prisma.job.delete({ where: { id: job.id } }).catch(() => {})
    }
  })

  it('stale drained pdfs-running parent with no active jobs is finalized, not failed', async () => {
    const sixMinAgo = new Date(Date.now() - 6 * 60 * 1000)
    const parent = await prisma.siteAudit.create({
      data: { domain: 'orphan-test-stale-finalize.example', status: 'pdfs-running', wcagLevel: 'wcag21aa' },
    })
    await prisma.$executeRaw`UPDATE "SiteAudit" SET "updatedAt" = ${sixMinAgo} WHERE "id" = ${parent.id}`
    vi.mocked(finalizeSiteAudit).mockImplementationOnce(async (id: string) => {
      await prisma.siteAudit.update({ where: { id }, data: { status: 'complete', completedAt: new Date() } })
    })
    await resetStaleAudits()
    expect((await prisma.siteAudit.findUnique({ where: { id: parent.id } }))?.status).toBe('complete')
  })
})
```

(This describe also needs a `beforeEach` resetting `vi.mocked(finalizeSiteAudit)` like the recoverQueue one.)

(The `clearOrphanTestState` helper already deletes `orphan-test-` prefixed SiteAudits.)

- [x] **Step 2: Run tests to verify the new ones fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/queue-manager.test.ts`
Expected: FAIL — the three new survival tests find the parent flipped to `error` (current code only spares `lighthouse-running`).

- [x] **Step 3: Extend the survival checks in `lib/ada-audit/queue-manager.ts`**

(`finalizeSiteAudit` is already statically imported in this file.)

In `resetStaleAudits()`, replace the existing `lighthouse-running` survival block (from the `// PSI completions bump SiteAudit.updatedAt` comment through `if (outstanding > 0) continue` and its closing brace) with:

```ts
    // Job settles bump SiteAudit.updatedAt, but a backoff window can exceed
    // the 5-min threshold — don't kill a parent whose durable jobs (PSI or
    // PDF scans) are still outstanding. The group count is type-agnostic,
    // which also covers the mixed case (finalizeSiteAudit shows
    // pdfs-running when both PDFs and PSI are outstanding).
    if (s.status === 'lighthouse-running' || s.status === 'pdfs-running') {
      // A failed count must NOT be treated as "no active jobs" — that would
      // bias a transient DB read error toward destructively failing the
      // parent. Skip this parent for this pass; the next pass retries.
      let outstanding: number
      try {
        outstanding = await countActiveJobsByGroup(`site-audit:${s.id}`)
      } catch (err) {
        console.warn(`[queue] Stale check: job count failed for ${s.id}, skipping this pass:`, (err as Error).message)
        continue
      }
      if (outstanding > 0) continue
      // No active jobs ≠ dead: the last job may have committed its row +
      // counters and the process (or the finalize call) died before
      // finalizeSiteAudit ran. Give the finalizer one chance; only fall
      // through to the fail path if the parent is still transient.
      try {
        await finalizeSiteAudit(s.id)
      } catch (err) {
        console.warn(`[queue] Stale check: finalize attempt failed for ${s.id}:`, (err as Error).message)
      }
      const refreshed = await prisma.siteAudit.findUnique({ where: { id: s.id }, select: { status: true } })
      if (refreshed?.status === 'complete') {
        console.warn(`[queue] Stale check: finalized drained audit ${s.id}`)
        continue
      }
    }
```

In `recoverQueue()`, replace the existing `lighthouse-running` survival block (from the `// Durable-PSI survival:` comment through the `if (outstanding > 0) { ... continue }` and its closing brace) with:

```ts
    // Durable-job survival: a pdfs-running / lighthouse-running parent's
    // outstanding work (PDF scans, PSI) lives in the durable Job table —
    // already re-queued by recoverJobsOnStartup, which runs first. The
    // worker drains them; the last settle finalizes the audit. The group
    // count is type-agnostic, covering the mixed case (finalizeSiteAudit
    // shows pdfs-running when both are outstanding). Parents in 'running'
    // still fail — the page loop isn't durable until Phase 3.
    if (o.status === 'lighthouse-running' || o.status === 'pdfs-running') {
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
        console.warn(`[queue] Startup recovery: resuming audit ${o.id} (${outstanding} durable job(s) outstanding)`)
        continue
      }
      // No active jobs ≠ dead: the last job may have committed its row +
      // counters and the process died before finalizeSiteAudit ran. Give
      // the finalizer one chance; only fall through to the fail path if
      // the parent is still transient.
      try {
        await finalizeSiteAudit(o.id)
      } catch (err) {
        console.warn(`[queue] Startup recovery: finalize attempt failed for ${o.id}:`, (err as Error).message)
      }
      const refreshed = await prisma.siteAudit.findUnique({ where: { id: o.id }, select: { status: true } })
      if (refreshed?.status === 'complete') {
        console.warn(`[queue] Startup recovery: finalized drained audit ${o.id}`)
        continue
      }
    }
```

Also update the `recoverQueue` JSDoc paragraph — replace `the previous Node process is gone and its in-memory page-work state (and the in-process PSI queue) with it. So every such row is flipped to \`error\` immediately, no threshold.` with `the previous Node process is gone and its in-memory page-work state with it. \`pdfs-running\` / \`lighthouse-running\` parents with outstanding durable jobs are resumed instead of failed; drained transient parents get one finalize attempt; everything still transient after that is flipped to \`error\` immediately, no threshold.`

- [x] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/queue-manager.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add lib/ada-audit/queue-manager.ts lib/ada-audit/queue-manager.test.ts
git commit -m "feat(jobs): pdfs-running site audits survive restarts via durable job survival check"
```

---

### Task 5: Full verification + docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-06-10-durable-job-queue-design.md` (phase table status note)

- [x] **Step 1: Full test suite, typecheck, build, repo-wide straggler grep**

Run: `grep -rn 'JOB_QUEUE_PSI\|getPsiQueueState\|isPsiJobQueueEnabled\|pdf-worker-pool\|withPdfSlot' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.md' . | grep -v node_modules | grep -v '.next/'`
Expected: matches only in `docs/superpowers/` historical specs/plans/handoffs (and this plan). No matches in code, `CLAUDE.md`, or `ecosystem.config.js`.

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run`
Expected: all green (≈1,670+ tests — 1,659 baseline minus deleted legacy-pool tests plus ~16 new).

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [x] **Step 2: Update `CLAUDE.md`**

Replace the **Durable job queue** bullet's last sentence:

> PSI runs through it when `JOB_QUEUE_PSI=1` (default off; legacy in-memory pool otherwise) — with the flag on, `lighthouse-running` site audits survive restarts and resume draining. Spec: `docs/superpowers/specs/2026-06-10-durable-job-queue-design.md`.

with:

> PSI and PDF scans run through it unconditionally (`psi` + `pdf-scan` job types; the legacy in-memory PSI pool and `pdf-worker-pool.ts` are deleted) — `lighthouse-running` and `pdfs-running` site audits survive restarts and resume draining. PDF scan concurrency = `PDF_POOL_SIZE` (default 4). Spec: `docs/superpowers/specs/2026-06-10-durable-job-queue-design.md`.

Replace, in the **Stale audit recovery** bullet:

> `recoverQueue()` runs once at startup and immediately fails any `running` / `pdfs-running` / `lighthouse-running` parent (a fresh Node process cannot resume in-memory page work or the in-process PSI queue).

with:

> `recoverQueue()` runs once at startup; `pdfs-running` / `lighthouse-running` parents with outstanding durable jobs are resumed, while `running` parents (and drained transient parents) are failed immediately — a fresh Node process cannot resume in-memory page work.

- [x] **Step 3: Annotate the spec's phase table**

In `docs/superpowers/specs/2026-06-10-durable-job-queue-design.md`, change the line below the phase table from:

> Phases 0–1 are this implementation; 2–4 are follow-up sessions under the same tracker item.

to:

> Phases 0–1 shipped 2026-06-10 (PR #50; parity + restart-resume verified in production; legacy pool deleted). Phase 2 shipped 2026-06-10. Phases 3–4 are follow-up sessions under the same tracker item.

- [x] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-06-10-durable-job-queue-design.md
git commit -m "docs: job queue Phase 2 (PDF scans) + legacy PSI pool deletion"
```

---

## Self-review notes

- **Spec coverage:** Phase 2 row of the spec's phase table — `pdf-scan` type at `PDF_POOL_SIZE` concurrency (Task 2), deletes `pdf-worker-pool.ts` + fire-and-forget dispatch (Task 3). `failOrphanPdfAudits` is deliberately kept (see Decisions). Recovery interplay (handoff doc) — Task 4. Phase 1 "delete the legacy pool after parity" — Task 1.
- **Standalone single-page audits** (`app/api/ada-audit/route.ts`) keep working with zero route changes: `dispatchPdfScans({ urls, adaAuditId, sourcePageUrl })` now enqueues jobs with `ada-audit:<id>` group keys; the handler skips counters/finalize when `siteAuditId` is absent (Tasks 2–3 tests cover it).
- **Counter integrity:** `pdfsTotal` bumps at insert (unchanged); each row settles exactly once into complete/error/skipped via the `status='scanning'`-fenced transaction; enqueue failure and job exhaustion settle through `settlePdfFailure`, so `finalizeSiteAudit`'s drain predicate always converges.
- **Type consistency:** `PdfScanJob`, `PDF_SCAN_JOB_TYPE`, `runPdfScanJob`, `settlePdfFailure`, `onPdfScanExhausted`, `registerPdfScanHandler` are defined in Task 2 and used with those exact names in Tasks 3–4.
- **Codex review (2026-06-10, accept with named fixes — all applied):** (1) finalize-before-fail for drained transient parents in `recoverQueue` (crash window between last job settle and finalize); (2) same rule in `resetStaleAudits`; (3) settle-transaction wedge-prevention test in the pdf-scan handler suite; (4) recovery comments updated to match; (5) repo-wide straggler grep incl. docs in Task 5.
