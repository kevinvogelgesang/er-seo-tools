# Standalone ADA Audits onto the Durable Job Queue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standalone single-page ADA audits run as durable `ada-audit` jobs (restart-survivable) instead of a fire-and-forget in-process promise, with recovery for orphaned standalone audit/PDF rows.

**Architecture:** New `ada-audit` job handler transplants `runAuditInBackground` from `app/api/ada-audit/route.ts` with site-audit-page error semantics (domain-error-settles vs DB-error-throws, all writes fenced by `status='running'`, PDFs dispatched before the complete settle). POST awaits a durable enqueue. New `lib/ada-audit/standalone-recovery.ts` (swept from `resetStaleAudits()` + `recoverQueue()`) uses job-group liveness + a 5-min `createdAt` guard as the death signal.

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite, the A1 durable job queue (`lib/jobs/`), vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-standalone-ada-durable-design.md` (Codex-reviewed ×8 fixes).

**Test command prefix (local dev quirk):** `DATABASE_URL="file:./local-dev.db" npx vitest run <file>` — `.env` points at a path that doesn't exist on the Mac.

**Branch:** `feat/standalone-ada-durable` off `main`.

---

### Task 0: Branch

- [ ] **Step 0.1:**

```bash
git checkout -b feat/standalone-ada-durable
```

---

### Task 1: `ada-audit` job handler

**Files:**
- Create: `lib/jobs/handlers/ada-audit.ts`
- Test: `lib/jobs/handlers/ada-audit.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `lib/jobs/handlers/ada-audit.test.ts`. DB-backed (mirrors `site-audit-page.test.ts`); mocks the runner, PDF orchestrator, and findings hook:

```ts
// lib/jobs/handlers/ada-audit.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/ada-audit/runner', () => ({ runAxeAudit: vi.fn() }))
vi.mock('@/lib/ada-audit/pdf-orchestrator', () => ({ dispatchPdfScans: vi.fn(async () => undefined) }))
vi.mock('@/lib/findings/ada-write', () => ({ writeAdaSingleFindings: vi.fn(async () => undefined) }))

const { prisma } = await import('@/lib/db')
const { runAxeAudit } = await import('@/lib/ada-audit/runner')
const { dispatchPdfScans } = await import('@/lib/ada-audit/pdf-orchestrator')
const { writeAdaSingleFindings } = await import('@/lib/findings/ada-write')
const { runAdaAuditJob, onAdaAuditExhausted, failStandaloneAudit } = await import('./ada-audit')

const PREFIX = 'ada-handler-test-'

async function clearTestState() {
  await prisma.adaAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
}

async function seed(name: string, status = 'pending') {
  const audit = await prisma.adaAudit.create({
    data: { url: `https://${PREFIX}${name}.example/p`, status, wcagLevel: 'wcag21aa' },
  })
  return { audit, payload: { adaAuditId: audit.id, url: audit.url, wcagLevel: 'wcag21aa' } }
}

const AXE_OK = {
  kind: 'audited' as const,
  axe: { violations: [] } as never,
  lighthouseSummary: null,
  lighthouseError: null,
  harvestedPdfUrls: [] as string[],
}

describe('jobs/handlers/ada-audit', () => {
  beforeEach(async () => {
    vi.mocked(runAxeAudit).mockReset()
    vi.mocked(dispatchPdfScans).mockReset()
    vi.mocked(dispatchPdfScans).mockResolvedValue(undefined)
    vi.mocked(writeAdaSingleFindings).mockClear()
    vi.mocked(writeAdaSingleFindings).mockResolvedValue(undefined as never)
    await clearTestState()
  })

  afterAll(clearTestState)

  it('rejects an invalid payload', async () => {
    await expect(runAdaAuditJob({ adaAuditId: 'x' })).rejects.toThrow('Invalid ada-audit job payload')
  })

  it('audited: dispatches PDFs while still running, then settles complete and dual-writes', async () => {
    const { audit, payload } = await seed('ok')
    let statusAtDispatch: string | undefined
    vi.mocked(runAxeAudit).mockResolvedValue({
      ...AXE_OK,
      lighthouseSummary: { performance: 80 } as never,
      harvestedPdfUrls: ['https://x.example/a.pdf'],
    })
    vi.mocked(dispatchPdfScans).mockImplementation(async () => {
      const row = await prisma.adaAudit.findUnique({ where: { id: audit.id }, select: { status: true } })
      statusAtDispatch = row?.status
    })
    await runAdaAuditJob(payload)
    // Dispatch-before-settle invariant: the row was still 'running' at dispatch time.
    expect(statusAtDispatch).toBe('running')
    expect(dispatchPdfScans).toHaveBeenCalledWith({
      urls: ['https://x.example/a.pdf'],
      adaAuditId: audit.id,
      sourcePageUrl: payload.url,
    })
    const row = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(row?.status).toBe('complete')
    expect(row?.result).toBe(JSON.stringify(AXE_OK.axe))
    expect(row?.lighthouseSummary).toBe(JSON.stringify({ performance: 80 }))
    expect(row?.runnerType).toBe('browser')
    expect(row?.progress).toBe(100)
    expect(row?.completedAt).not.toBeNull()
    expect(writeAdaSingleFindings).toHaveBeenCalledWith(audit.id)
  })

  it('redirected: settles with finalUrl + runnerType browser and dual-writes', async () => {
    const { audit, payload } = await seed('redir')
    vi.mocked(runAxeAudit).mockResolvedValue({ kind: 'redirected' as const, finalUrl: 'https://moved.example/' } as never)
    await runAdaAuditJob(payload)
    const row = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(row?.status).toBe('redirected')
    expect(row?.finalUrl).toBe('https://moved.example/')
    expect(row?.redirected).toBe(true)
    expect(row?.runnerType).toBe('browser')
    expect(row?.progress).toBe(100)
    expect(writeAdaSingleFindings).toHaveBeenCalledWith(audit.id)
    expect(dispatchPdfScans).not.toHaveBeenCalled()
  })

  it('runAxeAudit throwing is a domain result: settles error, does not throw, no dual-write', async () => {
    const { audit, payload } = await seed('domerr')
    vi.mocked(runAxeAudit).mockRejectedValue(new Error('nav failed'))
    await expect(runAdaAuditJob(payload)).resolves.toBeUndefined()
    const row = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(row?.status).toBe('error')
    expect(row?.error).toBe('nav failed')
    expect(row?.completedAt).not.toBeNull()
    expect(writeAdaSingleFindings).not.toHaveBeenCalled()
  })

  it('claim no-op: a settled row is never re-audited', async () => {
    const { payload } = await seed('settled', 'complete')
    await runAdaAuditJob(payload)
    expect(runAxeAudit).not.toHaveBeenCalled()
  })

  it('re-claims a running row (crash re-run)', async () => {
    const { audit, payload } = await seed('rerun', 'running')
    vi.mocked(runAxeAudit).mockResolvedValue(AXE_OK)
    await runAdaAuditJob(payload)
    const row = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(row?.status).toBe('complete')
  })

  it('late settle no-ops: recovery flips the row terminal mid-run, settle matches zero rows', async () => {
    const { audit, payload } = await seed('late')
    vi.mocked(runAxeAudit).mockImplementation(async () => {
      // Simulate recovery winning the race while the audit runs.
      await prisma.adaAudit.update({
        where: { id: audit.id },
        data: { status: 'error', error: 'recovered', completedAt: new Date() },
      })
      return AXE_OK
    })
    await runAdaAuditJob(payload)
    const row = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(row?.status).toBe('error')
    expect(row?.error).toBe('recovered')
    expect(writeAdaSingleFindings).not.toHaveBeenCalled()
  })

  it('progress writes are fenced: zombie onProgress cannot touch a terminal row', async () => {
    const { audit, payload } = await seed('zombie')
    let captured: ((p: number, m: string) => Promise<void>) | undefined
    vi.mocked(runAxeAudit).mockImplementation(async (_u, _w, onProgress) => {
      captured = onProgress as typeof captured
      await captured?.(50, 'Halfway')
      return AXE_OK
    })
    await runAdaAuditJob(payload)
    const settled = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(settled?.status).toBe('complete')
    expect(settled?.progress).toBe(100)
    // Zombie write after terminal settle: must match zero rows.
    await captured?.(75, 'zombie write')
    const after = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(after?.progress).toBe(100)
    expect(after?.progressMessage).toBe('Complete')
  })

  it('onExhausted flips pending/running to error with the attempts message', async () => {
    const { audit, payload } = await seed('exhausted', 'running')
    await onAdaAuditExhausted(payload, { jobId: 'j1', attempts: 3, lastError: 'timeout' })
    const row = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(row?.status).toBe('error')
    expect(row?.error).toBe('Audit job failed after 3 attempts: timeout')
  })

  it('onExhausted never clobbers a terminal row', async () => {
    const { audit, payload } = await seed('exh-term', 'complete')
    await onAdaAuditExhausted(payload, { jobId: 'j1', attempts: 3, lastError: 'timeout' })
    const row = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(row?.status).toBe('complete')
    expect(row?.error).toBeNull()
  })

  it('failStandaloneAudit never touches site-audit children', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}site`, status: 'running', wcagLevel: 'wcag21aa' },
    })
    const child = await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}child.example/p`, status: 'running', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await failStandaloneAudit(child.id, 'nope')
    const row = await prisma.adaAudit.findUnique({ where: { id: child.id } })
    expect(row?.status).toBe('running')
  })

  it('the claim no-ops on a site-audit child (malformed/manual job)', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}claimsite`, status: 'running', wcagLevel: 'wcag21aa' },
    })
    const child = await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}claimchild.example/p`, status: 'pending', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await runAdaAuditJob({ adaAuditId: child.id, url: child.url, wcagLevel: 'wcag21aa' })
    expect(runAxeAudit).not.toHaveBeenCalled()
    const row = await prisma.adaAudit.findUnique({ where: { id: child.id } })
    expect(row?.status).toBe('pending')
  })
})
```

- [ ] **Step 1.2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/ada-audit.test.ts`
Expected: FAIL — `Cannot find module './ada-audit'`.

- [ ] **Step 1.3: Implement the handler**

Create `lib/jobs/handlers/ada-audit.ts`:

```ts
// lib/jobs/handlers/ada-audit.ts
//
// Durable-queue handler for standalone single-page ADA audits — replaces the
// fire-and-forget runAuditInBackground() that lived in
// app/api/ada-audit/route.ts (C1 remainder; spec
// docs/superpowers/specs/2026-06-11-standalone-ada-durable-design.md).
//
// Idempotency: the conditional claim on AdaAudit.status IN
// ('pending','running') re-audits an unfinished standalone audit on re-run
// (crash recovery) and no-ops on settled rows. Every later write — progress
// included — is fenced by status = 'running': first terminal writer wins, so
// a zombie attempt (runAxeAudit ignores the job timeout) can never clobber a
// row recovery or a retry already flipped.
//
// Error semantics (mirrors site-audit-page.ts):
// - runAxeAudit throwing is a DOMAIN result: settle 'error', job completes —
//   same one-shot semantics as the legacy route's catch.
// - DB failures THROW → the queue retries (covers transient SQLITE_BUSY).
// - dispatchPdfScans runs BEFORE the complete settle: a crash between the
//   two re-runs the audit and the dispatch dedupes; settle-first would lose
//   the PDFs forever (the claim guard won't re-enter a 'complete' row).
// - The findings dual-write stays fire-and-forget LAST (A2 invariant).

import { prisma } from '@/lib/db'
import { runAxeAudit } from '@/lib/ada-audit/runner'
import { dispatchPdfScans } from '@/lib/ada-audit/pdf-orchestrator'
import { writeAdaSingleFindings } from '@/lib/findings/ada-write'
import { parsePositiveInt } from '../config'
import { registerJobHandler } from '../registry'
import type { JobExhaustedContext } from '../types'

export const ADA_AUDIT_JOB_TYPE = 'ada-audit'

export interface AdaAuditJob {
  adaAuditId: string
  url: string
  wcagLevel: string
}

function assertAdaAuditPayload(payload: unknown): AdaAuditJob {
  const p = payload as Partial<AdaAuditJob> | null
  if (
    !p ||
    typeof p.adaAuditId !== 'string' ||
    typeof p.url !== 'string' ||
    typeof p.wcagLevel !== 'string'
  ) {
    throw new Error('Invalid ada-audit job payload')
  }
  return p as AdaAuditJob
}

function dualWriteFindings(id: string): void {
  void writeAdaSingleFindings(id).catch((e) => {
    console.error('[findings] dual-write failed for ada audit', id, e)
  })
}

export async function runAdaAuditJob(payload: unknown): Promise<void> {
  const job = assertAdaAuditPayload(payload)

  // Claim: pending (normal) or running (crash re-run). Count 0 → settled.
  // siteAuditId: null — a malformed/manual ada-audit job pointing at a
  // site-audit child must never bypass the parent counters/finalizer.
  const claimed = await prisma.adaAudit.updateMany({
    where: { id: job.adaAuditId, siteAuditId: null, status: { in: ['pending', 'running'] } },
    data: { status: 'running', startedAt: new Date(), progress: 0, progressMessage: 'Starting…' },
  })
  if (claimed.count !== 1) return

  const onProgress = async (progress: number, progressMessage: string) => {
    await prisma.adaAudit.updateMany({
      where: { id: job.adaAuditId, status: 'running' },
      data: { progress, progressMessage },
    }).catch(() => {})
  }

  let result: Awaited<ReturnType<typeof runAxeAudit>>
  try {
    result = await runAxeAudit(job.url, job.wcagLevel, onProgress, { auditId: job.adaAuditId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[jobs/ada-audit] id=${job.adaAuditId} url=${job.url} error:`, err)
    await prisma.adaAudit.updateMany({
      where: { id: job.adaAuditId, status: 'running' },
      data: { status: 'error', error: message, completedAt: new Date() },
    })
    return
  }

  if (result.kind === 'redirected') {
    const settled = await prisma.adaAudit.updateMany({
      where: { id: job.adaAuditId, status: 'running' },
      data: {
        status: 'redirected',
        finalUrl: result.finalUrl,
        redirected: true,
        progress: 100,
        progressMessage: 'Redirected',
        runnerType: 'browser',
        completedAt: new Date(),
      },
    })
    if (settled.count === 1) dualWriteFindings(job.adaAuditId)
    return
  }

  const { axe, lighthouseSummary, lighthouseError, harvestedPdfUrls } = result

  // PDFs FIRST — see header. Standalone completion is NOT gated on PDFs;
  // they update PdfAudit rows in the background via durable pdf-scan jobs.
  await dispatchPdfScans({
    urls: harvestedPdfUrls,
    adaAuditId: job.adaAuditId,
    sourcePageUrl: job.url,
  })

  const settled = await prisma.adaAudit.updateMany({
    where: { id: job.adaAuditId, status: 'running' },
    data: {
      status: 'complete',
      result: JSON.stringify(axe),
      lighthouseSummary: lighthouseSummary ? JSON.stringify(lighthouseSummary) : null,
      lighthouseError,
      progress: 100,
      progressMessage: 'Complete',
      runnerType: 'browser',
      completedAt: new Date(),
    },
  })
  if (settled.count === 1) dualWriteFindings(job.adaAuditId)
}

/**
 * Flip a standalone audit to error unless it already settled. Used by
 * onExhausted and the POST route's enqueue-failure fallback. The
 * siteAuditId: null guard means this can never touch a site-audit child.
 */
export async function failStandaloneAudit(adaAuditId: string, message: string): Promise<void> {
  await prisma.adaAudit.updateMany({
    where: { id: adaAuditId, siteAuditId: null, status: { in: ['pending', 'running'] } },
    data: { status: 'error', error: message, completedAt: new Date() },
  })
}

export async function onAdaAuditExhausted(payload: unknown, ctx: JobExhaustedContext): Promise<void> {
  const job = assertAdaAuditPayload(payload)
  await failStandaloneAudit(job.adaAuditId, `Audit job failed after ${ctx.attempts} attempts: ${ctx.lastError}`)
}

export function registerAdaAuditHandler(): void {
  registerJobHandler({
    type: ADA_AUDIT_JOB_TYPE,
    concurrency: parsePositiveInt(process.env.ADA_AUDIT_CONCURRENCY, 2),
    maxAttempts: 3,
    backoffBaseMs: 30_000,
    // navigation (30s) + settle (5s) + axe + inline Lighthouse (standalone
    // audits run LH inside runAxeAudit regardless of provider) — same budget
    // as site-audit-page's local-LH branch.
    timeoutMs: 300_000,
    handler: runAdaAuditJob,
    onExhausted: onAdaAuditExhausted,
  })
}
```

- [ ] **Step 1.4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/ada-audit.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 1.5: Commit**

```bash
git add lib/jobs/handlers/ada-audit.ts lib/jobs/handlers/ada-audit.test.ts
git commit -m "feat(c1): durable ada-audit job handler for standalone audits"
```

---

### Task 2: Register the handler

**Files:**
- Modify: `lib/jobs/handlers/register.ts`
- Test: `lib/jobs/handlers/register.test.ts` (create)

- [ ] **Step 2.1: Write the failing test**

Create `lib/jobs/handlers/register.test.ts`:

```ts
// lib/jobs/handlers/register.test.ts
//
// Codex spec fix #3: a handler without registration enqueues forever — prove
// every built-in type (ada-audit especially) has an owner in the registry.
import { describe, it, expect } from 'vitest'
import { registerBuiltInJobHandlers } from './register'
import { getJobHandler, clearJobRegistryForTests } from '../registry'

describe('jobs/handlers/register', () => {
  it('registers all built-in job types, including ada-audit', () => {
    clearJobRegistryForTests()
    registerBuiltInJobHandlers()
    for (const type of [
      'psi', 'pdf-scan', 'site-audit-page', 'site-audit-discover',
      'cleanup', 'screenshot-sweep', 'stale-audit-reset', 'ada-audit',
    ]) {
      const h = getJobHandler(type)
      expect(h, `handler for ${type}`).toBeDefined()
      expect(h!.concurrency).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2.2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/register.test.ts`
Expected: FAIL — `handler for ada-audit` is undefined.

- [ ] **Step 2.3: Register**

In `lib/jobs/handlers/register.ts` add the import and call:

```ts
import { registerAdaAuditHandler } from './ada-audit'
```

and inside `registerBuiltInJobHandlers()` (after `registerSiteAuditDiscoverHandler()`):

```ts
  registerAdaAuditHandler()
```

- [ ] **Step 2.4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/register.test.ts`
Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add lib/jobs/handlers/register.ts lib/jobs/handlers/register.test.ts
git commit -m "feat(c1): register ada-audit handler + registration coverage test"
```

---

### Task 3: POST route enqueues durably

**Files:**
- Modify: `app/api/ada-audit/route.ts`
- Test: `app/api/ada-audit/route.test.ts` (create)

- [ ] **Step 3.1: Write the failing tests**

Create `app/api/ada-audit/route.test.ts` (mock-prisma pattern, like the mint-token route tests):

```ts
// app/api/ada-audit/route.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

const adaCreateMock = vi.fn()
const clientFindManyMock = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    adaAudit: { create: (...a: unknown[]) => adaCreateMock(...a) },
    client: { findMany: (...a: unknown[]) => clientFindManyMock(...a) },
  },
}))

const enqueueJobMock = vi.fn()
vi.mock('@/lib/jobs/queue', () => ({
  enqueueJob: (...a: unknown[]) => enqueueJobMock(...a),
}))

const failStandaloneAuditMock = vi.fn()
// Partial mock: keep the real ADA_AUDIT_JOB_TYPE export so the test can't
// drift from the actual job-type constant (Codex plan fix #4).
vi.mock('@/lib/jobs/handlers/ada-audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/handlers/ada-audit')>()
  return {
    ...actual,
    failStandaloneAudit: (...a: unknown[]) => failStandaloneAuditMock(...a),
  }
})

import { POST } from './route'
import { NextRequest } from 'next/server'
import { OPERATOR_NAME_COOKIE_NAME } from '@/lib/auth'

function makeRequest(body: unknown, operator?: string) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (operator) headers.set('cookie', `${OPERATOR_NAME_COOKIE_NAME}=${operator}`)
  return new NextRequest('http://localhost/api/ada-audit', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('POST /api/ada-audit', () => {
  beforeEach(() => {
    adaCreateMock.mockReset()
    clientFindManyMock.mockReset()
    enqueueJobMock.mockReset()
    failStandaloneAuditMock.mockReset()
    clientFindManyMock.mockResolvedValue([])
    adaCreateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'audit-1', ...data,
    }))
    enqueueJobMock.mockResolvedValue({ id: 'job-1', deduped: false })
    failStandaloneAuditMock.mockResolvedValue(undefined)
  })

  it('creates the row (normalized URL, matched client, requestedBy) and enqueues a durable job', async () => {
    clientFindManyMock.mockResolvedValue([
      { id: 7, domains: JSON.stringify(['example.com']) },
      { id: 9, domains: JSON.stringify(['other.com']) },
    ])
    const res = await POST(makeRequest({ url: 'www.example.com/page' }, 'Kevin'))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ id: 'audit-1', status: 'pending' })
    // Archived clients are excluded at the query (Codex spec fix #7).
    expect(clientFindManyMock).toHaveBeenCalledWith({
      where: { archivedAt: null },
      select: { id: true, domains: true },
    })
    expect(adaCreateMock).toHaveBeenCalledWith({
      data: {
        url: 'https://www.example.com/page',
        status: 'pending',
        clientId: 7,
        wcagLevel: 'wcag21aa',
        requestedBy: 'Kevin',
      },
    })
    expect(enqueueJobMock).toHaveBeenCalledWith({
      type: 'ada-audit',
      payload: { adaAuditId: 'audit-1', url: 'https://www.example.com/page', wcagLevel: 'wcag21aa' },
      dedupKey: 'ada-audit:audit-1',
      groupKey: 'ada-audit:audit-1',
    })
  })

  it('respects wcag22aa', async () => {
    await POST(makeRequest({ url: 'example.com', wcagLevel: 'wcag22aa' }))
    expect(adaCreateMock.mock.calls[0][0].data.wcagLevel).toBe('wcag22aa')
    expect(enqueueJobMock.mock.calls[0][0].payload.wcagLevel).toBe('wcag22aa')
  })

  it('enqueue failure: awaits the error fallback and returns 500', async () => {
    enqueueJobMock.mockRejectedValue(new Error('db down'))
    const res = await POST(makeRequest({ url: 'example.com' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to queue audit' })
    expect(failStandaloneAuditMock).toHaveBeenCalledWith('audit-1', 'Failed to enqueue audit job')
  })

  it('enqueue failure with a failing fallback still returns 500', async () => {
    enqueueJobMock.mockRejectedValue(new Error('db down'))
    failStandaloneAuditMock.mockRejectedValue(new Error('also down'))
    const res = await POST(makeRequest({ url: 'example.com' }))
    expect(res.status).toBe(500)
  })

  it('rejects invalid JSON and missing url without enqueuing', async () => {
    const bad = new NextRequest('http://localhost/api/ada-audit', { method: 'POST', body: 'not json' })
    expect((await POST(bad)).status).toBe(400)
    expect((await POST(makeRequest({}))).status).toBe(400)
    expect((await POST(makeRequest({ url: 'ftp://x.example/a' }))).status).toBe(400)
    expect((await POST(makeRequest({ url: 'localhost' }))).status).toBe(400)
    expect(enqueueJobMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3.2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/ada-audit/route.test.ts`
Expected: FAIL — the route still runs `runAuditInBackground` (no enqueue; the runner mock isn't wired, so the first test fails on `enqueueJobMock` not called).

- [ ] **Step 3.3: Rewire the route**

In `app/api/ada-audit/route.ts`:

1. **Delete** the whole `runAuditInBackground` function (lines 11–100) and the now-unused imports `runAxeAudit` and `writeAdaSingleFindings`. (`computeScore` stays — the GET scorecard uses it.)
2. Add imports:

```ts
import { enqueueJob } from '@/lib/jobs/queue'
import { ADA_AUDIT_JOB_TYPE, failStandaloneAudit } from '@/lib/jobs/handlers/ada-audit'
```

3. Replace the fire-and-forget block at the end of POST:

```ts
  const audit = await prisma.adaAudit.create({
    data: { url: parsed.toString(), status: 'pending', clientId, wcagLevel, requestedBy },
  })

  // Durable enqueue (C1): the worker claims the job and runs the audit; a
  // deploy mid-audit pauses it instead of destroying it. dedup/group key
  // ada-audit:<id> is shared with the standalone PDF dispatch group, so
  // countActiveJobsByGroup measures whole-audit liveness for recovery.
  try {
    await enqueueJob({
      type: ADA_AUDIT_JOB_TYPE,
      payload: { adaAuditId: audit.id, url: audit.url, wcagLevel },
      dedupKey: `ada-audit:${audit.id}`,
      groupKey: `ada-audit:${audit.id}`,
    })
  } catch (err) {
    console.error('[ada-audit] durable enqueue failed for', audit.id, ':', (err as Error).message)
    try {
      await failStandaloneAudit(audit.id, 'Failed to enqueue audit job')
    } catch (settleErr) {
      console.error('[ada-audit] enqueue-failure settle also failed for', audit.id, ':', (settleErr as Error).message)
    }
    return NextResponse.json({ error: 'Failed to queue audit' }, { status: 500 })
  }

  return NextResponse.json({ id: audit.id, status: 'pending' }, { status: 202 })
```

The creation block above the enqueue (URL normalization/validation, archived-excluded client match, `wcagLevel` whitelist, `requestedBy` cookie) stays byte-for-byte as it is today.

4. **Dead-import check (Codex plan fix #5):** after the rewire, verify the old fire-and-forget path is unreachable:

```bash
grep -n "runAxeAudit\|writeAdaSingleFindings\|runAuditInBackground" app/api/ada-audit/route.ts
```

Expected: no matches.

- [ ] **Step 3.4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/ada-audit/route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 3.5: Commit**

```bash
git add app/api/ada-audit/route.ts app/api/ada-audit/route.test.ts
git commit -m "feat(c1): POST /api/ada-audit enqueues a durable ada-audit job"
```

---

### Task 4: Standalone recovery module

**Files:**
- Create: `lib/ada-audit/standalone-recovery.ts`
- Test: `lib/ada-audit/standalone-recovery.test.ts`

- [ ] **Step 4.1: Write the failing tests**

Create `lib/ada-audit/standalone-recovery.test.ts`. DB-backed with REAL Job rows (job liveness is the thing under test); only the throw case mocks the count:

```ts
// lib/ada-audit/standalone-recovery.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

const countMock = vi.fn()
vi.mock('@/lib/jobs/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/queue')>()
  return { ...actual, countActiveJobsByGroup: (...a: unknown[]) => countMock(...a) }
})

const { prisma } = await import('@/lib/db')
const realQueue = await vi.importActual<typeof import('@/lib/jobs/queue')>('@/lib/jobs/queue')
const { recoverStandaloneAudits } = await import('./standalone-recovery')

const PREFIX = 'ada-recovery-test-'
const OLD = new Date(Date.now() - 10 * 60 * 1000)   // 10 min ago — past the 5-min guard

async function clearTestState() {
  const audits = await prisma.adaAudit.findMany({
    where: { url: { contains: PREFIX } }, select: { id: true },
  })
  if (audits.length > 0) {
    await prisma.job.deleteMany({
      where: { groupKey: { in: audits.map((a) => `ada-audit:${a.id}`) } },
    })
  }
  await prisma.pdfAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
}

async function seedAudit(name: string, status: string, createdAt: Date) {
  return prisma.adaAudit.create({
    data: { url: `https://${PREFIX}${name}.example/p`, status, createdAt, wcagLevel: 'wcag21aa' },
  })
}

describe('ada-audit/standalone-recovery', () => {
  beforeEach(async () => {
    countMock.mockReset()
    countMock.mockImplementation(realQueue.countActiveJobsByGroup)
    await clearTestState()
  })

  afterAll(clearTestState)

  it('flips an old pending standalone audit with no jobs in its group', async () => {
    const a = await seedAudit('dead', 'pending', OLD)
    await recoverStandaloneAudits()
    const row = await prisma.adaAudit.findUnique({ where: { id: a.id } })
    expect(row?.status).toBe('error')
    expect(row?.error).toBe('Audit interrupted (server restarted or job lost)')
    expect(row?.completedAt).not.toBeNull()
  })

  it('flips when the only Job row is terminal (failed onExhausted window)', async () => {
    const a = await seedAudit('terminal-job', 'running', OLD)
    await prisma.job.create({
      data: { type: 'ada-audit', status: 'error', groupKey: `ada-audit:${a.id}`, payload: '{}' },
    })
    await recoverStandaloneAudits()
    const row = await prisma.adaAudit.findUnique({ where: { id: a.id } })
    expect(row?.status).toBe('error')
  })

  it('resumes (leaves alone) an audit with an active job — even one in backoff', async () => {
    const a = await seedAudit('alive', 'running', OLD)
    await prisma.job.create({
      data: {
        type: 'ada-audit', status: 'queued', groupKey: `ada-audit:${a.id}`,
        payload: '{}', runAfter: new Date(Date.now() + 60_000),
      },
    })
    await recoverStandaloneAudits()
    const row = await prisma.adaAudit.findUnique({ where: { id: a.id } })
    expect(row?.status).toBe('running')
  })

  it('never touches young rows (create→enqueue race guard)', async () => {
    const a = await seedAudit('young', 'pending', new Date())
    await recoverStandaloneAudits()
    const row = await prisma.adaAudit.findUnique({ where: { id: a.id } })
    expect(row?.status).toBe('pending')
  })

  it('never touches site-audit children', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}site`, status: 'running', wcagLevel: 'wcag21aa' },
    })
    await prisma.adaAudit.create({
      data: {
        url: `https://${PREFIX}child.example/p`, status: 'pending',
        createdAt: OLD, siteAuditId: site.id, wcagLevel: 'wcag21aa',
      },
    })
    await recoverStandaloneAudits()
    const row = await prisma.adaAudit.findFirst({ where: { url: { contains: `${PREFIX}child` } } })
    expect(row?.status).toBe('pending')
  })

  it('a job-count read error skips the row this pass (never biases destructive)', async () => {
    const a = await seedAudit('count-err', 'running', OLD)
    countMock.mockRejectedValue(new Error('db read failed'))
    await recoverStandaloneAudits()
    const row = await prisma.adaAudit.findUnique({ where: { id: a.id } })
    expect(row?.status).toBe('running')
  })

  // ── PDF sweep (Codex spec fix #5: mixed group states) ──

  async function seedPdf(audit: { id: string }, name: string, createdAt: Date) {
    return prisma.pdfAudit.create({
      data: {
        adaAuditId: audit.id, url: `https://${PREFIX}${name}.example/doc.pdf`,
        status: 'pending', createdAt,
      },
    })
  }

  it('flips stale standalone PDF rows when the group is drained', async () => {
    const a = await seedAudit('pdf-dead', 'complete', OLD)
    const p = await seedPdf(a, 'pdf-dead', OLD)
    await recoverStandaloneAudits()
    const row = await prisma.pdfAudit.findUnique({ where: { id: p.id } })
    expect(row?.status).toBe('error')
    expect(row?.scanError).toBe('PDF scan interrupted (server restarted or job lost)')
  })

  it('defers stale PDFs while the ada-audit job is still active', async () => {
    const a = await seedAudit('pdf-wait-audit', 'running', OLD)
    const p = await seedPdf(a, 'pdf-wait-audit', OLD)
    await prisma.job.create({
      data: { type: 'ada-audit', status: 'running', groupKey: `ada-audit:${a.id}`, payload: '{}' },
    })
    await recoverStandaloneAudits()
    expect((await prisma.pdfAudit.findUnique({ where: { id: p.id } }))?.status).toBe('pending')
  })

  it('defers stale PDFs while a sibling pdf-scan job is still active', async () => {
    const a = await seedAudit('pdf-wait-sib', 'complete', OLD)
    const p = await seedPdf(a, 'pdf-wait-sib', OLD)
    await prisma.job.create({
      data: { type: 'pdf-scan', status: 'queued', groupKey: `ada-audit:${a.id}`, payload: '{}' },
    })
    await recoverStandaloneAudits()
    expect((await prisma.pdfAudit.findUnique({ where: { id: p.id } }))?.status).toBe('pending')
  })

  it('leaves young and site-audit-attached PDFs alone', async () => {
    const a = await seedAudit('pdf-young', 'complete', OLD)
    const young = await seedPdf(a, 'pdf-young', new Date())
    const site = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}pdfsite`, status: 'pdfs-running', wcagLevel: 'wcag21aa' },
    })
    const siteAttached = await prisma.pdfAudit.create({
      data: {
        siteAuditId: site.id, url: `https://${PREFIX}site-attached.example/doc.pdf`,
        status: 'pending', createdAt: OLD,
      },
    })
    await recoverStandaloneAudits()
    expect((await prisma.pdfAudit.findUnique({ where: { id: young.id } }))?.status).toBe('pending')
    expect((await prisma.pdfAudit.findUnique({ where: { id: siteAttached.id } }))?.status).toBe('pending')
  })
})
```

- [ ] **Step 4.2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/standalone-recovery.test.ts`
Expected: FAIL — `Cannot find module './standalone-recovery'`.

- [ ] **Step 4.3: Implement**

Create `lib/ada-audit/standalone-recovery.ts`:

```ts
// lib/ada-audit/standalone-recovery.ts
//
// Recovery for standalone (siteAuditId = null) ADA audits and their PDF
// rows. AdaAudit/PdfAudit have no updatedAt — durable-job state is the
// liveness source of truth: active jobs include queued-in-backoff rows, so
// any legitimately in-flight audit has ≥1 active job in its ada-audit:<id>
// group. The createdAt threshold only guards the seconds-wide
// create→enqueue races (POST route; PDF insert→enqueue).
//
// Conservative by design (same rule as recoverOrFailTransient): a job-count
// read error skips the row this pass — a transient read error must never
// bias toward the destructive path — and any live job in the group defers
// PDF flips to a later pass. The sweep runs every 10 min.

import { prisma } from '@/lib/db'
import { countActiveJobsByGroup } from '@/lib/jobs/queue'

const RACE_GUARD_MS = 5 * 60 * 1000

async function activeJobsOrNull(groupKey: string, label: string): Promise<number | null> {
  try {
    return await countActiveJobsByGroup(groupKey)
  } catch (err) {
    console.warn(`[ada-recovery] job count failed for ${label}, skipping this pass:`, (err as Error).message)
    return null
  }
}

export async function recoverStandaloneAudits(now: Date = new Date()): Promise<void> {
  const threshold = new Date(now.getTime() - RACE_GUARD_MS)

  const audits = await prisma.adaAudit.findMany({
    where: {
      siteAuditId: null,
      status: { in: ['pending', 'running'] },
      createdAt: { lt: threshold },
    },
    select: { id: true },
  })
  for (const a of audits) {
    const active = await activeJobsOrNull(`ada-audit:${a.id}`, a.id)
    if (active === null || active > 0) continue
    console.warn(`[ada-recovery] failing orphaned standalone audit ${a.id}`)
    await prisma.adaAudit.updateMany({
      where: { id: a.id, status: { in: ['pending', 'running'] } },
      data: {
        status: 'error',
        error: 'Audit interrupted (server restarted or job lost)',
        completedAt: new Date(),
      },
    })
  }

  // Standalone-attached PDF rows whose pdf-scan job was lost (crash between
  // row insert and enqueue). Group-level liveness check per parent audit.
  const pdfs = await prisma.pdfAudit.findMany({
    where: {
      siteAuditId: null,
      adaAuditId: { not: null },
      status: { in: ['pending', 'scanning'] },
      createdAt: { lt: threshold },
    },
    select: { id: true, adaAuditId: true },
  })
  const byAudit = new Map<string, string[]>()
  for (const p of pdfs) {
    const key = p.adaAuditId as string
    byAudit.set(key, [...(byAudit.get(key) ?? []), p.id])
  }
  for (const [adaAuditId, ids] of byAudit) {
    const active = await activeJobsOrNull(`ada-audit:${adaAuditId}`, `pdf group ${adaAuditId}`)
    if (active === null || active > 0) continue
    console.warn(`[ada-recovery] failing ${ids.length} orphaned standalone PDF row(s) for audit ${adaAuditId}`)
    await prisma.pdfAudit.updateMany({
      where: { id: { in: ids }, status: { in: ['pending', 'scanning'] } },
      data: { status: 'error', scanError: 'PDF scan interrupted (server restarted or job lost)' },
    })
  }
}
```

- [ ] **Step 4.4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/standalone-recovery.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 4.5: Commit**

```bash
git add lib/ada-audit/standalone-recovery.ts lib/ada-audit/standalone-recovery.test.ts
git commit -m "feat(c1): standalone audit/PDF recovery via job-group liveness"
```

---

### Task 5: Wire recovery into the sweep + startup

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts` (`resetStaleAudits()`, `recoverQueue()`)
- Test: `lib/ada-audit/queue-manager.test.ts` (extend)

- [ ] **Step 5.1: Write the failing test**

In `lib/ada-audit/queue-manager.test.ts`, add the mock next to the existing `site-audit-finalizer` mock at the top:

```ts
vi.mock('@/lib/ada-audit/standalone-recovery', () => ({
  recoverStandaloneAudits: vi.fn(async () => undefined),
}))
```

import it with the other awaited imports:

```ts
const { recoverStandaloneAudits } = await import('./standalone-recovery')
```

and add a test at the end of the describe block:

```ts
  it('resetStaleAudits and recoverQueue both run standalone recovery', async () => {
    vi.mocked(recoverStandaloneAudits).mockClear()
    await resetStaleAudits()
    expect(recoverStandaloneAudits).toHaveBeenCalledTimes(1)
    await recoverQueue()
    expect(recoverStandaloneAudits).toHaveBeenCalledTimes(2)
  })

  it('a standalone-recovery failure never blocks site-audit recovery (both call sites)', async () => {
    vi.mocked(recoverStandaloneAudits).mockRejectedValueOnce(new Error('boom'))
    await expect(resetStaleAudits()).resolves.toBeUndefined()
    vi.mocked(recoverStandaloneAudits).mockRejectedValueOnce(new Error('boom'))
    await expect(recoverQueue()).resolves.toBeUndefined()
  })
```

(Mocking the module here also keeps the real sweep from flipping other test files' stray standalone rows in the shared dev DB.)

- [ ] **Step 5.2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/queue-manager.test.ts`
Expected: the two new tests FAIL (`recoverStandaloneAudits` not called); existing tests still pass.

- [ ] **Step 5.3: Wire it in**

In `lib/ada-audit/queue-manager.ts` add the import — **alias form, so it
matches the test's `vi.mock('@/lib/ada-audit/standalone-recovery', …)`
specifier** (Codex plan fix #1, same style as the `site-audit-finalizer`
mock):

```ts
import { recoverStandaloneAudits } from '@/lib/ada-audit/standalone-recovery'
```

At the end of `resetStaleAudits()` (after the `if (stale.length > 0) void processNext()` line) and at the end of `recoverQueue()` (before the final `void processNext()`), add the same guarded call:

```ts
  // Standalone (siteAuditId = null) audits + their PDF rows — C1 remainder.
  // Caught: a standalone-recovery failure must never block site-audit recovery.
  await recoverStandaloneAudits().catch((err) => {
    console.warn('[queue] standalone recovery failed:', (err as Error).message)
  })
```

- [ ] **Step 5.4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/queue-manager.test.ts`
Expected: PASS (all, including the two new tests).

- [ ] **Step 5.5: Commit**

```bash
git add lib/ada-audit/queue-manager.ts lib/ada-audit/queue-manager.test.ts
git commit -m "feat(c1): sweep + startup recovery cover standalone audits"
```

---

### Task 6: Full verification + docs

**Files:**
- Modify: `CLAUDE.md` (Architecture patterns: ADA audit polling bullet; Durable job queue bullet)

- [ ] **Step 6.1: Update CLAUDE.md**

In the **ADA audit polling** bullet, replace "POST creates record → background runner updates" with "POST creates record + enqueues a durable `ada-audit` job → the job handler updates". In the **Durable job queue** bullet, add `ada-audit` to the job-type list and note standalone audits survive restarts; mention `ADA_AUDIT_CONCURRENCY` (default 2) next to the other concurrency env vars.

- [ ] **Step 6.2: Full suite, typecheck, build**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run
npx tsc --noEmit
npm run build
```

Expected: suite green (2,015 existing + ~28 new), tsc clean, build clean.

- [ ] **Step 6.3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(c1): CLAUDE.md — standalone ADA audits are durable"
```

- [ ] **Step 6.4: PR**

```bash
git push -u origin feat/standalone-ada-durable
gh pr create --title "feat(c1): standalone ADA audits onto the durable job queue" --body "C1 remainder (spec docs/superpowers/specs/2026-06-11-standalone-ada-durable-design.md, Codex ×8):
- new durable ada-audit job type — handler transplants runAuditInBackground with site-audit-page semantics (status-fenced claims/settles/progress, domain-error settles, PDFs dispatched before the complete settle, A2 dual-write fire-and-forget last)
- POST /api/ada-audit awaits the enqueue (dedup/group ada-audit:<id>); enqueue failure flips the row + 500
- lib/ada-audit/standalone-recovery.ts: job-group liveness + 5-min createdAt guard fails orphaned standalone audits and stale standalone PDF rows; wired into resetStaleAudits() and recoverQueue()
- no schema changes, no UI changes

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

### Task 7: Deploy + production verification

- [ ] **Step 7.1:** Merge PR, `ssh seo@144.126.213.242 "~/deploy.sh"` (push first — server pulls from GitHub). No migration in this change.
- [ ] **Step 7.2:** Boot log clean (`/home/seo/logs/`), no handler-registration errors.
- [ ] **Step 7.3:** Run a real standalone audit from `/ada-audit`: poller shows live progress → `complete`; `Job` row for `ada-audit` settles `complete` (verify via node + Prisma from `/home/seo/webapps/seo-tools` — no `sqlite3` CLI on the server).
- [ ] **Step 7.4:** Restart drill: start a standalone audit on a slow site, `pm2 restart` mid-run → boot recovery re-queues the job, audit resumes and completes (status `complete`, poller recovers).
- [ ] **Step 7.5:** Orphan cleanup check: any pre-existing standalone `pending`/`running` rows flip to `error` after the first sweep (≤ 15 min post-deploy).
- [ ] **Step 7.6:** PDF check: a standalone audit of a page with PDF links reaches `complete` while `pdf-scan` jobs continue; PdfAudit rows settle.
