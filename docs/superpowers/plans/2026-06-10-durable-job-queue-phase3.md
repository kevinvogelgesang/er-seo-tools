# Durable Job Queue Phase 3 — Site-Audit Page Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the site-audit page loop onto the durable job queue (`site-audit-discover` + `site-audit-page` job types) so `running` parents survive restarts; delete the `processing` mutex and the `running`-status special-casing in recovery.

**Architecture:** Spec at `docs/superpowers/specs/2026-06-10-durable-job-queue-phase3-design.md` (Codex-reviewed, 8 fixes applied). One discover job per audit owns the claim/discovery/fan-out; one page job per URL owns axe + PDF dispatch + settle + PSI enqueue. `processNext` becomes a stateless promoter; the one-active invariant moves into the discover claim's `NOT EXISTS` guard. Browser recycling moves into `browser-pool.ts` (pages-served draining gate + 60 s idle close). `finalizeSiteAudit` gets a discovery guard + scalar-first reads.

**Tech Stack:** Next.js 15, Prisma + SQLite, vitest (real Prisma against dev DB, `fileParallelism: false`), existing `lib/jobs/` queue infra.

**Local dev quirk:** every prisma CLI / vitest command needs `DATABASE_URL="file:./local-dev.db"` prefixed (the `.env` URL points at a path that doesn't exist on the Mac).

**Hard rules (from CLAUDE.md / parent spec — violations are bugs):**
- NEVER interactive `prisma.$transaction(async tx => ...)`. Array form only; conditional logic via SQL `EXISTS`; manual `"updatedAt" = ${Date.now()}` in raw statements (storage is integer ms).
- Never hold a DB transaction or a browser page across awaits you don't control.
- Settle order inside the array transaction: raw parent counter bump FIRST (EXISTS sees pre-flip child state), conditional child flip SECOND. Settled iff the flip's `count === 1`.
- Domain errors settle (job completes); DB errors throw (queue retries).

---

### Task 0: Branch

- [ ] **Step 0.1:**

```bash
git checkout -b feat/job-queue-phase3-page-loop
```

---

### Task 1: Schema — `@@unique([siteAuditId, url])` on AdaAudit

**Files:**
- Modify: `prisma/schema.prisma` (AdaAudit model)
- Create: `prisma/migrations/<timestamp>_ada_audit_unique_site_url/migration.sql` (generated, then hand-edited)

- [ ] **Step 1.1: Add the unique to the model.** In `prisma/schema.prisma`, inside `model AdaAudit`, after the existing `@@index` lines add:

```prisma
  @@unique([siteAuditId, url])
```

(SQLite treats NULLs as distinct in unique indexes — standalone audits with `siteAuditId = NULL` are unaffected.)

- [ ] **Step 1.2: Generate the migration without applying:**

```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate dev --name ada_audit_unique_site_url --create-only
```

- [ ] **Step 1.3: Hand-edit the generated `migration.sql`** — prepend a dedupe DELETE before the `CREATE UNIQUE INDEX` Prisma generated (keep the earliest row per `(siteAuditId, url)` pair):

```sql
-- Dedupe existing (siteAuditId, url) pairs before the unique index lands.
-- Keep the earliest child per pair (createdAt, then id, ascending).
DELETE FROM "AdaAudit"
WHERE "siteAuditId" IS NOT NULL
  AND "id" NOT IN (
    SELECT "id" FROM (
      SELECT "id",
             ROW_NUMBER() OVER (
               PARTITION BY "siteAuditId", "url"
               ORDER BY "createdAt" ASC, "id" ASC
             ) AS rn
      FROM "AdaAudit"
      WHERE "siteAuditId" IS NOT NULL
    )
    WHERE rn = 1
  );

-- (Prisma-generated line follows)
CREATE UNIQUE INDEX "AdaAudit_siteAuditId_url_key" ON "AdaAudit"("siteAuditId", "url");
```

- [ ] **Step 1.4: Apply + regenerate client:**

```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate dev
```

Expected: migration applies cleanly, client regenerates.

- [ ] **Step 1.5: Commit**

```bash
git add prisma/
git commit -m "feat(schema): unique (siteAuditId, url) on AdaAudit with dedupe migration"
```

---

### Task 2: Browser pool — recycle gate + idle close

**Files:**
- Modify: `lib/ada-audit/browser-pool.ts`
- Create: `lib/ada-audit/browser-pool.test.ts`

The loop-index recycle in `runAudit` dies in Task 4; its replacement lives here. Design: count pages served; at the threshold set a draining flag; new acquirers wait; when all pages are released, close Chrome, reset, wake everyone. Separately, when the pool goes fully idle, close Chrome after 60 s.

- [ ] **Step 2.1: Write the failing tests** — `lib/ada-audit/browser-pool.test.ts`:

```ts
// lib/ada-audit/browser-pool.test.ts
//
// Pool semantics only — puppeteer is mocked. Uses vi.resetModules() so each
// test gets fresh module state (slots, counters, gate).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const newPageMock = () => ({
  setDefaultTimeout: vi.fn(),
  setCacheEnabled: vi.fn(async () => undefined),
  setBypassServiceWorker: vi.fn(async () => undefined),
  setExtraHTTPHeaders: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
})

let launchCount = 0
const makeBrowser = () => {
  const b = {
    connected: true,
    newPage: vi.fn(async () => newPageMock()),
    close: vi.fn(async () => { b.connected = false }),
    on: vi.fn(),
  }
  return b
}

vi.mock('puppeteer-core', () => ({
  default: {
    launch: vi.fn(async () => {
      launchCount++
      return makeBrowser()
    }),
  },
}))

async function loadPool(env: Record<string, string> = {}) {
  vi.resetModules()
  process.env.SITE_AUDIT_BROWSER_RECYCLE_PAGES = env.recycle ?? '3'
  process.env.BROWSER_POOL_SIZE = env.pool ?? '2'
  return import('./browser-pool')
}

describe('browser-pool recycle gate + idle close', () => {
  beforeEach(() => {
    launchCount = 0
    vi.useRealTimers()
  })

  it('recycles Chrome after N pages served, waking waiters on a fresh browser', async () => {
    const pool = await loadPool({ recycle: '2', pool: '2' })
    const p1 = await pool.acquirePage()
    const p2 = await pool.acquirePage() // pagesServed = 2 = threshold
    expect(launchCount).toBe(1)

    // Third acquire must wait behind the drain gate.
    let acquired = false
    const pending = pool.acquirePage().then((p) => { acquired = true; return p })
    await new Promise((r) => setTimeout(r, 20))
    expect(acquired).toBe(false)

    await pool.releasePage(p1)
    await new Promise((r) => setTimeout(r, 20))
    expect(acquired).toBe(false) // one page still active — gate holds

    await pool.releasePage(p2)
    const p3 = await pending // gate released after recycle
    expect(acquired).toBe(true)
    expect(launchCount).toBe(2) // fresh Chrome
    await pool.releasePage(p3)
  })

  it('does not recycle below the threshold', async () => {
    const pool = await loadPool({ recycle: '10', pool: '2' })
    const p1 = await pool.acquirePage()
    await pool.releasePage(p1)
    const p2 = await pool.acquirePage()
    await pool.releasePage(p2)
    expect(launchCount).toBe(1)
  })

  it('idle close: closes Chrome after the idle delay, cancelled by a new acquire', async () => {
    vi.useFakeTimers()
    const pool = await loadPool({ recycle: '100', pool: '2' })
    const p1 = await pool.acquirePage()
    await pool.releasePage(p1)
    // Pool fully idle — idle timer armed. Acquire again before it fires.
    await vi.advanceTimersByTimeAsync(30_000)
    const p2 = await pool.acquirePage()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(launchCount).toBe(1) // timer was cancelled; same browser
    await pool.releasePage(p2)
    await vi.advanceTimersByTimeAsync(120_000)
    const p3 = await pool.acquirePage() // after idle close, relaunches
    expect(launchCount).toBe(2)
    await pool.releasePage(p3)
  })

  it('gates at acquire time: threshold below pool capacity holds the next acquirer', async () => {
    const pool = await loadPool({ recycle: '1', pool: '4' })
    const p1 = await pool.acquirePage() // pagesServed=1 = threshold → gate set
    let acquired = false
    const pending = pool.acquirePage().then((p) => { acquired = true; return p })
    await new Promise((r) => setTimeout(r, 20))
    expect(acquired).toBe(false) // slots were free, but the gate holds
    await pool.releasePage(p1) // recycles (all pages back) → gate opens
    const p2 = await pending
    expect(launchCount).toBe(2)
    await pool.releasePage(p2)
  })

  it('restores the slot when browser launch fails', async () => {
    const pool = await loadPool({ recycle: '100', pool: '1' })
    const puppeteer = (await import('puppeteer-core')).default
    vi.mocked(puppeteer.launch).mockRejectedValueOnce(new Error('no chrome'))
    await expect(pool.acquirePage()).rejects.toThrow('no chrome')
    // Slot must be back — next acquire succeeds on the recovered mock.
    const p = await pool.acquirePage()
    await pool.releasePage(p)
  })

  it('external closeBrowser releases the gate and leaves no waiter stuck', async () => {
    const pool = await loadPool({ recycle: '1', pool: '1' })
    const p1 = await pool.acquirePage() // threshold hit immediately
    let acquired = false
    const pending = pool.acquirePage().then((p) => { acquired = true; return p })
    await new Promise((r) => setTimeout(r, 20))
    expect(acquired).toBe(false)
    await pool.releasePage(p1) // recycle path runs, gate opens
    const p2 = await pending
    expect(acquired).toBe(true)
    // Now park another waiter on the slot and call closeBrowser directly.
    const pending2 = pool.acquirePage()
    await pool.closeBrowser() // must not deadlock the waiter
    await pool.releasePage(p2)
    const p3 = await pending2
    await pool.releasePage(p3)
    expect(true).toBe(true) // reaching here = no deadlock
  })
})
```

- [ ] **Step 2.2: Run to verify failure:**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/browser-pool.test.ts
```

Expected: FAIL (gate/idle behavior doesn't exist yet; third acquire resolves immediately, launchCount stays 1).

- [ ] **Step 2.3: Implement.** Replace the semaphore + `closeBrowser` section of `lib/ada-audit/browser-pool.ts` (keep `getBrowser`, LAUNCH_ARGS, and the per-page cache hardening exactly as they are):

```ts
// ─── Concurrency semaphore + recycle gate ────────────────────────────────────
// Limits active pages to POOL_SIZE. Every RECYCLE_PAGES pages served, the pool
// drains (new acquirers wait), closes Chrome to reclaim leaked memory, and
// resumes on a fresh browser. Replaces the old loop-index recycle in the
// site-audit page loop — and unlike that one, it waits for ALL active pages
// (a concurrent standalone audit's page can no longer be killed mid-flight).
// When the pool goes fully idle, Chrome is closed after IDLE_CLOSE_MS
// (replaces the old between-site-audit closeBrowser()).

const IDLE_CLOSE_MS = 60_000

function recyclePagesThreshold(): number {
  return parsePositiveInt(process.env.SITE_AUDIT_BROWSER_RECYCLE_PAGES, 25)
}

let slots = POOL_SIZE
let pagesServed = 0
let draining = false
const waiters: Array<() => void> = []
let idleTimer: NodeJS.Timeout | null = null

function notifyWaiters(): void {
  const woken = waiters.splice(0)
  for (const w of woken) w()
}

function cancelIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

function maybeArmIdleTimer(): void {
  if (slots === POOL_SIZE && waiters.length === 0 && browser) {
    cancelIdleTimer()
    idleTimer = setTimeout(() => {
      idleTimer = null
      void closeBrowser()
    }, IDLE_CLOSE_MS)
    idleTimer.unref?.()
  }
}

export async function acquirePage(): Promise<Page> {
  cancelIdleTimer()
  while (draining || slots === 0) {
    await new Promise<void>((resolve) => waiters.push(resolve))
  }
  slots--
  pagesServed++
  // Gate at ACQUIRE time, not just release: if the threshold is reached
  // while slots remain free, a later caller must not slip in ahead of the
  // recycle. This acquirer (the one that hit the threshold) proceeds; the
  // gate holds everyone after it.
  if (pagesServed >= recyclePagesThreshold()) {
    draining = true
  }
  let page: Page
  try {
    const b = await getBrowser()
    page = await b.newPage()
  } catch (err) {
    // Restore the slot or it leaks forever (browser launch / newPage threw).
    slots++
    notifyWaiters()
    maybeArmIdleTimer()
    throw err
  }
  page.setDefaultTimeout(60_000)

  // (existing per-page cache hardening block stays here unchanged)
  await page.setCacheEnabled(false).catch(() => {})
  await page.setBypassServiceWorker(true).catch(() => {})
  await page.setExtraHTTPHeaders({
    'Cache-Control': 'no-store, no-cache, max-age=0',
    'Pragma': 'no-cache',
  }).catch(() => {})

  return page
}

export async function releasePage(page: Page): Promise<void> {
  await page.close().catch(() => {})
  slots++
  if (pagesServed >= recyclePagesThreshold()) {
    draining = true
  }
  if (draining && slots === POOL_SIZE) {
    // Last active page gone — recycle now.
    await closeBrowser()
  }
  notifyWaiters()
  maybeArmIdleTimer()
}

export async function closeBrowser(): Promise<void> {
  cancelIdleTimer()
  // Reset the recycle state on EVERY close (recycle, idle, shutdown, between
  // deploys) so no waiter can be left parked behind a stale drain gate.
  pagesServed = 0
  draining = false
  if (browser) {
    await browser.close().catch(() => {})
    browser = null
  }
  notifyWaiters()
}
```

- [ ] **Step 2.4: Run the tests:**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/browser-pool.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 2.5: Commit**

```bash
git add lib/ada-audit/browser-pool.ts lib/ada-audit/browser-pool.test.ts
git commit -m "feat(browser-pool): pages-served recycle gate + idle close (replaces loop-index recycle)"
```

---

### Task 3: Finalizer — discovery guard + scalar-first reads

**Files:**
- Modify: `lib/ada-audit/site-audit-finalizer.ts`
- Modify: `lib/ada-audit/site-audit-finalizer.test.ts` (additions)

- [ ] **Step 3.1: Write the failing tests.** Append to `lib/ada-audit/site-audit-finalizer.test.ts` (follow the file's existing seed/cleanup helpers — adapt names if they differ):

```ts
describe('finalizeSiteAudit — phase 3 guards', () => {
  it('leaves a running audit with null discoveredUrls untouched (discovery owns the row)', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: 'finalizer-guard-1.example', status: 'running', wcagLevel: 'wcag21aa' },
    })
    await finalizeSiteAudit(site.id)
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('running')
  })

  it('leaves a queued audit untouched', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: 'finalizer-guard-2.example', status: 'queued', wcagLevel: 'wcag21aa' },
    })
    await finalizeSiteAudit(site.id)
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('queued')
  })

  it('does not complete a pre-discovered running audit whose pages have not settled', async () => {
    const site = await prisma.siteAudit.create({
      data: {
        domain: 'finalizer-guard-3.example', status: 'running', wcagLevel: 'wcag21aa',
        discoveredUrls: JSON.stringify(['https://finalizer-guard-3.example/a']),
        pagesTotal: 1,
      },
    })
    await finalizeSiteAudit(site.id)
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('running')
  })

  it('completes a running audit with discoveredUrls=[] and zero pages', async () => {
    const site = await prisma.siteAudit.create({
      data: {
        domain: 'finalizer-guard-4.example', status: 'running', wcagLevel: 'wcag21aa',
        discoveredUrls: '[]', pagesTotal: 0,
      },
    })
    await finalizeSiteAudit(site.id)
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('complete')
  })
})
```

- [ ] **Step 3.2: Run to verify failure:**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/site-audit-finalizer.test.ts
```

Expected: the first guard test FAILS (today a running audit with all-zero counters gets completed).

- [ ] **Step 3.3: Implement.** Rewrite `finalizeSiteAudit`'s read section in `lib/ada-audit/site-audit-finalizer.ts`:

```ts
export async function finalizeSiteAudit(id: string): Promise<void> {
  // Scalar-first: page settles call finalize once per page; loading every
  // child (with PDFs) on each call is O(pages²) over an audit. The heavy
  // include runs once, after the drain predicate passes.
  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    select: {
      status: true, batchId: true, discoveredUrls: true,
      pagesTotal: true, pagesComplete: true, pagesError: true, pagesRedirected: true,
      pdfsTotal: true, pdfsComplete: true, pdfsError: true, pdfsSkipped: true,
      lighthouseTotal: true, lighthouseComplete: true, lighthouseError: true,
    },
  })
  if (!audit) return
  if (audit.status === 'complete' || audit.status === 'error' || audit.status === 'cancelled') return
  if (audit.status === 'queued') return // promoter owns queued rows

  // Discovery guard: while the discover handler owns a 'running' row, all
  // counters are legitimately 0 and the drain predicate would be a lie.
  // discoveredUrls + pagesTotal are always written together (at creation for
  // pre-discovered audits, by the discover persist otherwise), so non-null
  // discoveredUrls means the predicate is meaningful.
  if (audit.status === 'running' && audit.discoveredUrls === null) return

  const pagesDone      = audit.pagesComplete + audit.pagesError + audit.pagesRedirected >= audit.pagesTotal
  const pdfsDone       = audit.pdfsComplete + audit.pdfsError + audit.pdfsSkipped >= audit.pdfsTotal
  const lighthouseDone = audit.lighthouseComplete + audit.lighthouseError >= audit.lighthouseTotal

  if (!pagesDone) return

  if (!pdfsDone || !lighthouseDone) {
    const next = !pdfsDone ? 'pdfs-running' : 'lighthouse-running'
    if (audit.status !== next) {
      await prisma.siteAudit.update({ where: { id }, data: { status: next } })
    }
    return
  }

  // All drained — NOW load the children for the summary build.
  const pageAudits = await prisma.adaAudit.findMany({
    where: { siteAuditId: id },
    include: { pdfAudits: true },
  })
  const summary = buildSiteAuditSummary(pageAudits)
  await prisma.siteAudit.update({
    where: { id },
    data: { status: 'complete', summary: JSON.stringify(summary), completedAt: new Date() },
  })

  await closeBatchIfDrained(audit.batchId).catch((e) => {
    console.warn('[site-audit-finalizer] closeBatchIfDrained failed for batch', audit.batchId, ':', (e as Error).message)
  })

  try {
    const { processNext } = await import('./queue-manager')
    void processNext()
  } catch (e) {
    console.warn('[site-audit-finalizer] processNext kick failed:', (e as Error).message)
  }
}
```

Check `buildSiteAuditSummary`'s parameter type against `lib/ada-audit/site-audit-helpers.ts` — it takes the pageAudits array; the standalone `findMany` returns the same shape as the old `include`.

- [ ] **Step 3.4: Run finalizer + helpers tests:**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/site-audit-finalizer.test.ts lib/ada-audit/site-audit-helpers.test.ts
```

Expected: PASS. If pre-existing finalizer tests created `running` audits with null `discoveredUrls` and expected completion, update those seeds to set `discoveredUrls: '[]'` (that is now the contract).

- [ ] **Step 3.5: Commit**

```bash
git add lib/ada-audit/site-audit-finalizer.ts lib/ada-audit/site-audit-finalizer.test.ts
git commit -m "feat(finalizer): discovery guard + queued guard + scalar-first reads"
```

---

### Task 4: site-audit-page handler

**Files:**
- Create: `lib/jobs/handlers/site-audit-page.ts`
- Create: `lib/jobs/handlers/site-audit-page.test.ts`

- [ ] **Step 4.1: Write the failing tests** — `lib/jobs/handlers/site-audit-page.test.ts`:

```ts
// lib/jobs/handlers/site-audit-page.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/ada-audit/runner', () => ({ runAxeAudit: vi.fn() }))
vi.mock('@/lib/ada-audit/pdf-orchestrator', () => ({ dispatchPdfScans: vi.fn(async () => undefined) }))
vi.mock('@/lib/ada-audit/site-audit-finalizer', () => ({ finalizeSiteAudit: vi.fn(async () => undefined) }))
vi.mock('@/lib/ada-audit/lighthouse-queue', () => ({ enqueuePsiJob: vi.fn() }))
vi.mock('@/lib/ada-audit/lighthouse-provider', () => ({ getLighthouseProvider: vi.fn(() => 'pagespeed') }))

const { prisma } = await import('@/lib/db')
const { runAxeAudit } = await import('@/lib/ada-audit/runner')
const { dispatchPdfScans } = await import('@/lib/ada-audit/pdf-orchestrator')
const { finalizeSiteAudit } = await import('@/lib/ada-audit/site-audit-finalizer')
const { enqueuePsiJob } = await import('@/lib/ada-audit/lighthouse-queue')
const { getLighthouseProvider } = await import('@/lib/ada-audit/lighthouse-provider')
const { runSiteAuditPageJob, onSiteAuditPageExhausted } = await import('./site-audit-page')

const PREFIX = 'sap-handler-test-'

async function clearTestState() {
  await prisma.adaAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
}

async function seed(name: string, childStatus = 'pending') {
  const site = await prisma.siteAudit.create({
    data: {
      domain: `${PREFIX}${name}`, status: 'running', wcagLevel: 'wcag21aa',
      discoveredUrls: JSON.stringify([`https://${PREFIX}${name}/p`]), pagesTotal: 1,
    },
  })
  const child = await prisma.adaAudit.create({
    data: { url: `https://${PREFIX}${name}/p`, status: childStatus, siteAuditId: site.id, wcagLevel: 'wcag21aa' },
  })
  return { site, child, payload: { adaAuditId: child.id, siteAuditId: site.id, url: child.url, wcagLevel: 'wcag21aa' } }
}

const AXE_OK = {
  kind: 'audited' as const,
  axe: { violations: [] } as never,
  lighthouseSummary: null,
  lighthouseError: null,
  harvestedPdfUrls: [] as string[],
}

describe('jobs/handlers/site-audit-page', () => {
  beforeEach(async () => {
    vi.mocked(runAxeAudit).mockReset()
    vi.mocked(dispatchPdfScans).mockClear()
    vi.mocked(finalizeSiteAudit).mockClear()
    vi.mocked(enqueuePsiJob).mockClear()
    vi.mocked(getLighthouseProvider).mockReturnValue('pagespeed')
    await clearTestState()
  })

  it('detached PSI success: axe-complete, lighthouseTotal + pagesComplete bumped, PSI enqueued, finalized', async () => {
    vi.mocked(runAxeAudit).mockResolvedValue(AXE_OK)
    const { site, child, payload } = await seed('ok')
    await runSiteAuditPageJob(payload)
    const c = await prisma.adaAudit.findUnique({ where: { id: child.id } })
    expect(c?.status).toBe('axe-complete')
    expect(c?.runnerType).toBe('browser')
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.pagesComplete).toBe(1)
    expect(s?.lighthouseTotal).toBe(1)
    expect(enqueuePsiJob).toHaveBeenCalledWith(payload)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
    // PDF dispatch happened BEFORE settle (invariant): both called, order
    // asserted via mock invocation order.
    expect(vi.mocked(dispatchPdfScans).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(enqueuePsiJob).mock.invocationCallOrder[0])
  })

  it('local provider: complete + inline LH fields, no lighthouseTotal, no PSI job', async () => {
    vi.mocked(getLighthouseProvider).mockReturnValue('local')
    vi.mocked(runAxeAudit).mockResolvedValue({
      ...AXE_OK,
      lighthouseSummary: { performance: 80 } as never,
      lighthouseError: null,
    })
    const { site, child, payload } = await seed('local')
    await runSiteAuditPageJob(payload)
    const c = await prisma.adaAudit.findUnique({ where: { id: child.id } })
    expect(c?.status).toBe('complete')
    expect(c?.lighthouseSummary).toContain('performance')
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.pagesComplete).toBe(1)
    expect(s?.lighthouseTotal).toBe(0)
    expect(enqueuePsiJob).not.toHaveBeenCalled()
  })

  it('redirected: child redirected + pagesRedirected bumped, no PDFs, no PSI', async () => {
    vi.mocked(runAxeAudit).mockResolvedValue({ kind: 'redirected', finalUrl: 'https://elsewhere.example/' })
    const { site, child, payload } = await seed('redir')
    await runSiteAuditPageJob(payload)
    const c = await prisma.adaAudit.findUnique({ where: { id: child.id } })
    expect(c?.status).toBe('redirected')
    expect(c?.finalUrl).toBe('https://elsewhere.example/')
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.pagesRedirected).toBe(1)
    expect(s?.pagesComplete).toBe(0)
    expect(dispatchPdfScans).not.toHaveBeenCalled()
    expect(enqueuePsiJob).not.toHaveBeenCalled()
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('axe throw is a DOMAIN error: child error + pagesError bumped, job completes (no throw)', async () => {
    vi.mocked(runAxeAudit).mockRejectedValue(new Error('nav timeout'))
    const { site, child, payload } = await seed('axe-err')
    await expect(runSiteAuditPageJob(payload)).resolves.toBeUndefined()
    const c = await prisma.adaAudit.findUnique({ where: { id: child.id } })
    expect(c?.status).toBe('error')
    expect(c?.error).toContain('nav timeout')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pagesError).toBe(1)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('claims a "running" child (crash re-run) and re-audits it', async () => {
    vi.mocked(runAxeAudit).mockResolvedValue(AXE_OK)
    const { child, payload } = await seed('rerun', 'running')
    await runSiteAuditPageJob(payload)
    expect((await prisma.adaAudit.findUnique({ where: { id: child.id } }))?.status).toBe('axe-complete')
  })

  it('claim-0 with axe-complete child: re-enqueues PSI + finalizes, no re-audit', async () => {
    const { site, payload } = await seed('resume-psi', 'axe-complete')
    await runSiteAuditPageJob(payload)
    expect(runAxeAudit).not.toHaveBeenCalled()
    expect(enqueuePsiJob).toHaveBeenCalledWith(payload)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('claim-0 with terminal child: finalize only', async () => {
    const { site, payload } = await seed('resume-term', 'complete')
    await runSiteAuditPageJob(payload)
    expect(runAxeAudit).not.toHaveBeenCalled()
    expect(enqueuePsiJob).not.toHaveBeenCalled()
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('onExhausted settles the child as error + pagesError + finalize; no-ops on terminal', async () => {
    const { site, child, payload } = await seed('exhausted')
    await onSiteAuditPageExhausted(payload, { jobId: 'j1', attempts: 3, lastError: 'boom' })
    const c = await prisma.adaAudit.findUnique({ where: { id: child.id } })
    expect(c?.status).toBe('error')
    expect(c?.error).toContain('failed after 3 attempts')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pagesError).toBe(1)
    // second call: terminal now — no double bump
    vi.mocked(finalizeSiteAudit).mockClear()
    await onSiteAuditPageExhausted(payload, { jobId: 'j1', attempts: 3, lastError: 'boom' })
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pagesError).toBe(1)
    expect(finalizeSiteAudit).not.toHaveBeenCalled()
  })

  it('settle bumps SiteAudit.updatedAt (stale-recovery heartbeat)', async () => {
    vi.mocked(runAxeAudit).mockResolvedValue(AXE_OK)
    const { site, payload } = await seed('heartbeat')
    const backdated = Date.now() - 60 * 60 * 1000
    await prisma.$executeRaw`UPDATE "SiteAudit" SET "updatedAt" = ${backdated} WHERE "id" = ${site.id}`
    await runSiteAuditPageJob(payload)
    const fresh = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(fresh!.updatedAt.getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  it('rejects a malformed payload', async () => {
    await expect(runSiteAuditPageJob({ nope: true } as never)).rejects.toThrow(/payload/i)
  })
})
```

- [ ] **Step 4.2: Run to verify failure:**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-page.test.ts
```

Expected: FAIL — module `./site-audit-page` doesn't exist.

- [ ] **Step 4.3: Implement** — `lib/jobs/handlers/site-audit-page.ts`:

```ts
// lib/jobs/handlers/site-audit-page.ts
//
// Durable-queue page handler for site audits — replaces the in-memory page
// loop that lived in lib/ada-audit/queue-manager.ts runAudit(). One job per
// AdaAudit child row; the site-audit-discover handler fans these out.
//
// Idempotency: the conditional claim on AdaAudit.status IN
// ('pending','running') re-audits an unfinished page on re-run (crash
// recovery, zombie attempts) and no-ops on settled rows. 'running' is
// claimable because a crashed attempt leaves the row there. The claim-0 path
// repairs the legacy lost-PSI-enqueue window: an 'axe-complete' child whose
// PSI job vanished (crash between settle and enqueue) gets its PSI job
// re-enqueued (dedupKey psi:<adaAuditId> absorbs the case where it exists).
//
// Error semantics (mirrors handlers/psi.ts and pdf-scan.ts):
// - runAxeAudit throwing (navigation failure, axe crash) is a DOMAIN result:
//   the child settles as 'error', pagesError bumps, the job completes — same
//   no-retry-per-page semantics as the legacy loop's catch.
// - DB failures THROW → the queue retries (covers transient SQLITE_BUSY).
// - dispatchPdfScans runs BEFORE the page settle so pdfsTotal is current
//   before pagesComplete signals "this page is settled" (drain invariant).
// - The child settle + SiteAudit counter bumps run in ONE short array-form
//   transaction, raw parent bump FIRST (EXISTS over pre-flip child state),
//   conditional child flip second. NEVER interactive transactions
//   (2026-06-10 write-lock starvation incident). updatedAt is set manually —
//   raw SQL bypasses @updatedAt; storage is integer ms.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { runAxeAudit } from '@/lib/ada-audit/runner'
import { dispatchPdfScans } from '@/lib/ada-audit/pdf-orchestrator'
import { finalizeSiteAudit } from '@/lib/ada-audit/site-audit-finalizer'
import { enqueuePsiJob } from '@/lib/ada-audit/lighthouse-queue'
import { getLighthouseProvider } from '@/lib/ada-audit/lighthouse-provider'
import { parsePositiveInt } from '../config'
import { registerJobHandler } from '../registry'
import type { JobExhaustedContext } from '../types'

export const SITE_AUDIT_PAGE_JOB_TYPE = 'site-audit-page'

export interface SiteAuditPageJob {
  adaAuditId: string
  siteAuditId: string
  url: string
  wcagLevel: string
}

function assertSiteAuditPagePayload(payload: unknown): SiteAuditPageJob {
  const p = payload as Partial<SiteAuditPageJob> | null
  if (
    !p ||
    typeof p.adaAuditId !== 'string' ||
    typeof p.siteAuditId !== 'string' ||
    typeof p.url !== 'string' ||
    typeof p.wcagLevel !== 'string'
  ) {
    throw new Error('Invalid site-audit-page job payload')
  }
  return p as SiteAuditPageJob
}

// Parent counters this handler may bump — fixed allowlist, never user input,
// safe to splice into raw SQL via Prisma.raw.
type PageCounter = 'pagesComplete' | 'pagesError' | 'pagesRedirected' | 'lighthouseTotal'

/**
 * Atomically settle the child row and bump the matching SiteAudit counters.
 * Returns false when no row matched the claimable statuses (recovery beat
 * us / idempotent re-run). On true, the caller must invoke finalizeSiteAudit
 * (outside the transaction).
 */
async function settlePage(
  job: SiteAuditPageJob,
  counters: PageCounter[], // never empty — every settle bumps at least one
  childData: Prisma.AdaAuditUpdateManyMutationInput,
  claimable: string[],
): Promise<boolean> {
  const bumps = counters.map((c) => `"${c}" = "${c}" + 1`).join(', ')
  const [, flipped] = await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE "SiteAudit"
      SET ${Prisma.raw(bumps)}, "updatedAt" = ${Date.now()}
      WHERE "id" = ${job.siteAuditId}
        AND EXISTS (
          SELECT 1 FROM "AdaAudit"
          WHERE "id" = ${job.adaAuditId} AND "status" IN (${Prisma.join(claimable)})
        )`,
    prisma.adaAudit.updateMany({
      where: { id: job.adaAuditId, status: { in: claimable } },
      data: childData,
    }),
  ])
  return flipped.count === 1
}

async function finalizeWarn(siteAuditId: string, context: string): Promise<void> {
  try {
    await finalizeSiteAudit(siteAuditId)
  } catch (err) {
    console.warn(`[jobs/site-audit-page] finalize after ${context} failed:`, (err as Error).message)
  }
}

export async function runSiteAuditPageJob(payload: unknown): Promise<void> {
  const job = assertSiteAuditPagePayload(payload)

  // Claim: pending (normal) or running (crash re-run).
  const claimed = await prisma.adaAudit.updateMany({
    where: { id: job.adaAuditId, status: { in: ['pending', 'running'] } },
    data: { status: 'running', startedAt: new Date() },
  })
  if (claimed.count !== 1) {
    // Already settled (or cascaded by recovery). Repair the two crash
    // windows that leave settled state without follow-through:
    //  - axe-complete with no PSI job (crash between settle and enqueue)
    //  - settled but finalize never ran (crash between settle and finalize)
    const child = await prisma.adaAudit.findUnique({
      where: { id: job.adaAuditId },
      select: { status: true },
    })
    if (child?.status === 'axe-complete') {
      enqueuePsiJob(job)
    }
    await finalizeWarn(job.siteAuditId, 'claim no-op')
    return
  }

  const detachPsi = getLighthouseProvider() === 'pagespeed'

  let runResult: Awaited<ReturnType<typeof runAxeAudit>>
  try {
    runResult = await runAxeAudit(job.url, job.wcagLevel, undefined, {
      auditId: job.adaAuditId,
      siteAudit: detachPsi,
    })
  } catch (err) {
    // Domain failure: settle and complete the job — no per-page retry,
    // matching the legacy loop's catch.
    const msg = err instanceof Error ? err.message : 'Audit failed'
    const settled = await settlePage(
      job,
      ['pagesError'],
      { status: 'error', error: msg, completedAt: new Date() },
      ['running'],
    )
    if (settled) await finalizeWarn(job.siteAuditId, 'axe-error settle')
    return
  }

  if (runResult.kind === 'redirected') {
    const settled = await settlePage(
      job,
      ['pagesRedirected'],
      {
        status: 'redirected',
        finalUrl: runResult.finalUrl,
        redirected: true,
        completedAt: new Date(),
        runnerType: 'browser',
      },
      ['running'],
    )
    if (settled) await finalizeWarn(job.siteAuditId, 'redirect settle')
    return
  }

  const { axe, lighthouseSummary, lighthouseError, harvestedPdfUrls } = runResult

  // PDFs FIRST: dispatchPdfScans commits PdfAudit rows + pdfsTotal++ and
  // enqueues durable pdf-scan jobs before returning. This must land before
  // the page settle below so the finalizer can never observe
  // pagesComplete=total with pdfsTotal still missing rows.
  await dispatchPdfScans({
    urls: harvestedPdfUrls,
    siteAuditId: job.siteAuditId,
    adaAuditId: job.adaAuditId,
    sourcePageUrl: job.url,
  })

  if (detachPsi) {
    const settled = await settlePage(
      job,
      ['lighthouseTotal', 'pagesComplete'],
      { status: 'axe-complete', result: JSON.stringify(axe), runnerType: 'browser' },
      ['running'],
    )
    if (!settled) return
    enqueuePsiJob(job)
  } else {
    const settled = await settlePage(
      job,
      ['pagesComplete'],
      {
        status: 'complete',
        result: JSON.stringify(axe),
        lighthouseSummary: lighthouseSummary ? JSON.stringify(lighthouseSummary) : null,
        lighthouseError,
        runnerType: 'browser',
        completedAt: new Date(),
      },
      ['running'],
    )
    if (!settled) return
  }

  await finalizeWarn(job.siteAuditId, 'page settle')
}

/**
 * Settle a page failure that happened OUTSIDE the audit path — job
 * exhaustion, or a failed durable enqueue (discover handler's fallback).
 * Without this the parent strands in 'running' because finalizeSiteAudit
 * only counts pagesComplete + pagesError + pagesRedirected.
 */
export async function settlePageFailure(payload: unknown, message: string): Promise<void> {
  const job = assertSiteAuditPagePayload(payload)
  const settled = await settlePage(
    job,
    ['pagesError'],
    { status: 'error', error: message, completedAt: new Date() },
    ['pending', 'running'],
  )
  if (!settled) return
  await finalizeWarn(job.siteAuditId, 'failure settle')
}

export async function onSiteAuditPageExhausted(payload: unknown, ctx: JobExhaustedContext): Promise<void> {
  await settlePageFailure(payload, `Page audit job failed after ${ctx.attempts} attempts: ${ctx.lastError}`)
}

export function registerSiteAuditPageHandler(): void {
  registerJobHandler({
    type: SITE_AUDIT_PAGE_JOB_TYPE,
    concurrency: parsePositiveInt(process.env.SITE_AUDIT_CONCURRENCY, 1),
    maxAttempts: 3,
    backoffBaseMs: 30_000,
    // navigation (30s) + settle (5s) + axe on heavy DOMs + a possible
    // browser-recycle drain wait; with LIGHTHOUSE_PROVIDER=local the inline
    // Lighthouse run holds the page longer — the budget covers that branch.
    timeoutMs: 300_000,
    handler: runSiteAuditPageJob,
    onExhausted: onSiteAuditPageExhausted,
  })
}
```

- [ ] **Step 4.4: Run the tests:**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-page.test.ts
```

Expected: PASS (11 tests).

- [ ] **Step 4.5: Commit**

```bash
git add lib/jobs/handlers/site-audit-page.ts lib/jobs/handlers/site-audit-page.test.ts
git commit -m "feat(jobs): site-audit-page handler — durable per-page axe + settle + PSI/PDF dispatch"
```

---

### Task 5: site-audit-discover handler

**Files:**
- Create: `lib/jobs/handlers/site-audit-discover.ts`
- Create: `lib/jobs/handlers/site-audit-discover.test.ts`

Depends on `failSiteAudit` which lands in Task 6 — to keep tasks committable in order, the discover handler imports it from `queue-manager` where it will exist after Task 6; in THIS task create it first as part of queue-manager (small addition, no deletions yet).

- [ ] **Step 5.1: Add `failSiteAudit` to `lib/ada-audit/queue-manager.ts`** (pure addition; the rewrite comes in Task 6). Place it after `failOrphanPdfAudits`:

```ts
/**
 * Shared destructive path for a site audit that cannot proceed: flip the
 * parent to error (conditionally — never clobber a terminal row), cascade
 * orphan children + PDFs, cancel outstanding durable jobs, close the batch
 * if drained, and kick the promoter so the queue slot is released.
 */
export async function failSiteAudit(id: string, message: string): Promise<void> {
  let flipped: number
  try {
    const res = await prisma.siteAudit.updateMany({
      where: { id, status: { notIn: ['complete', 'error', 'cancelled'] } },
      data: { status: 'error', error: message, completedAt: new Date() },
    })
    flipped = res.count
  } catch {
    flipped = 0
  }
  if (flipped === 0) {
    // Parent already terminal (or flip failed) — do not cascade-fail the
    // children/jobs of an audit that completed or was cancelled cleanly.
    void processNext()
    return
  }
  await failOrphanAdaAudits(id).catch(() => {})
  await failOrphanPdfAudits(id).catch(() => {})
  await cancelJobsByGroup(`site-audit:${id}`).catch(() => {})
  const row = await prisma.siteAudit.findUnique({
    where: { id },
    select: { batchId: true },
  }).catch(() => null)
  if (row?.batchId) {
    await closeBatchIfDrained(row.batchId).catch(() => {})
  }
  void processNext()
}
```

- [ ] **Step 5.2: Write the failing tests** — `lib/jobs/handlers/site-audit-discover.test.ts`:

```ts
// lib/jobs/handlers/site-audit-discover.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/ada-audit/sitemap-crawler', () => ({ discoverPages: vi.fn() }))
vi.mock('@/lib/ada-audit/site-audit-finalizer', () => ({ finalizeSiteAudit: vi.fn(async () => undefined) }))
// queue-manager is NOT mocked for failSiteAudit (onExhausted test asserts DB
// effects), but processNext is kicked via dynamic import — stub the module's
// promoter to keep tests hermetic.
vi.mock('@/lib/ada-audit/queue-manager', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/ada-audit/queue-manager')>()
  return { ...mod, processNext: vi.fn(async () => undefined) }
})

const { prisma } = await import('@/lib/db')
const { discoverPages } = await import('@/lib/ada-audit/sitemap-crawler')
const { finalizeSiteAudit } = await import('@/lib/ada-audit/site-audit-finalizer')
const { runSiteAuditDiscoverJob, onSiteAuditDiscoverExhausted } = await import('./site-audit-discover')

const PREFIX = 'sad-handler-test-'

async function clearTestState() {
  // groupKeys are site-audit:<id> and payloads carry IDs, not domains —
  // resolve the test sites' IDs first, then delete their jobs by groupKey.
  const sites = await prisma.siteAudit.findMany({
    where: { domain: { startsWith: PREFIX } },
    select: { id: true },
  })
  if (sites.length > 0) {
    await prisma.job.deleteMany({
      where: { groupKey: { in: sites.map((s) => `site-audit:${s.id}`) } },
    })
  }
  await prisma.adaAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
}

async function seedQueued(name: string, extra: Record<string, unknown> = {}) {
  return prisma.siteAudit.create({
    data: { domain: `${PREFIX}${name}`, status: 'queued', wcagLevel: 'wcag21aa', ...extra },
  })
}

describe('jobs/handlers/site-audit-discover', () => {
  beforeEach(async () => {
    vi.mocked(discoverPages).mockReset()
    vi.mocked(finalizeSiteAudit).mockClear()
    await clearTestState()
  })

  it('fresh claim: discovers, persists discoveredUrls+pagesTotal, creates children, enqueues page jobs', async () => {
    const site = await seedQueued('fresh')
    const urls = [`https://${PREFIX}fresh/a`, `https://${PREFIX}fresh/b`]
    vi.mocked(discoverPages).mockResolvedValue(urls)
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })

    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.status).toBe('running')
    expect(s?.pagesTotal).toBe(2)
    expect(JSON.parse(s!.discoveredUrls!)).toEqual(urls)
    const children = await prisma.adaAudit.findMany({ where: { siteAuditId: site.id } })
    expect(children).toHaveLength(2)
    expect(children.every((c) => c.status === 'pending')).toBe(true)
    const jobs = await prisma.job.findMany({ where: { groupKey: `site-audit:${site.id}`, type: 'site-audit-page' } })
    expect(jobs).toHaveLength(2)
  })

  it('one-active guard: claim no-ops while another audit is transient; audit stays queued', async () => {
    await prisma.siteAudit.create({
      data: { domain: `${PREFIX}active`, status: 'running', wcagLevel: 'wcag21aa' },
    })
    const site = await seedQueued('blocked')
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('queued')
    expect(discoverPages).not.toHaveBeenCalled()
    expect(await prisma.job.count({ where: { groupKey: `site-audit:${site.id}` } })).toBe(0)
  })

  it('resume: running row with partial children/jobs gets topped up without duplicates', async () => {
    const urls = [`https://${PREFIX}resume/a`, `https://${PREFIX}resume/b`]
    const site = await prisma.siteAudit.create({
      data: {
        domain: `${PREFIX}resume`, status: 'running', wcagLevel: 'wcag21aa',
        discoveredUrls: JSON.stringify(urls), pagesTotal: 2,
      },
    })
    // Simulate a crash after one child was created (no jobs enqueued).
    await prisma.adaAudit.create({
      data: { url: urls[0], status: 'pending', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })
    expect(discoverPages).not.toHaveBeenCalled() // stored set reused
    const children = await prisma.adaAudit.findMany({ where: { siteAuditId: site.id } })
    expect(children).toHaveLength(2)
    const jobs = await prisma.job.findMany({ where: { groupKey: `site-audit:${site.id}`, type: 'site-audit-page' } })
    expect(jobs).toHaveLength(2)
    // Re-run again (zombie): nothing duplicates, jobs dedup via active window.
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })
    expect(await prisma.adaAudit.count({ where: { siteAuditId: site.id } })).toBe(2)
    expect(await prisma.job.count({ where: { groupKey: `site-audit:${site.id}`, type: 'site-audit-page' } })).toBe(2)
  })

  it('does not enqueue jobs for already-settled children on resume', async () => {
    const urls = [`https://${PREFIX}settled/a`, `https://${PREFIX}settled/b`]
    const site = await prisma.siteAudit.create({
      data: {
        domain: `${PREFIX}settled`, status: 'running', wcagLevel: 'wcag21aa',
        discoveredUrls: JSON.stringify(urls), pagesTotal: 2, pagesComplete: 1,
      },
    })
    await prisma.adaAudit.create({
      data: { url: urls[0], status: 'complete', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })
    const jobs = await prisma.job.findMany({ where: { groupKey: `site-audit:${site.id}`, type: 'site-audit-page' } })
    expect(jobs).toHaveLength(1) // only the unsettled URL
    expect(JSON.parse(jobs[0].payload).url).toBe(urls[1])
  })

  it('dedupes duplicate URLs from discovery (pagesTotal matches unique children)', async () => {
    const site = await seedQueued('dupes')
    vi.mocked(discoverPages).mockResolvedValue([
      `https://${PREFIX}dupes/a`, `https://${PREFIX}dupes/a`, `https://${PREFIX}dupes/b`,
    ])
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.pagesTotal).toBe(2)
    expect(await prisma.adaAudit.count({ where: { siteAuditId: site.id } })).toBe(2)
  })

  it('zero URLs: finalizes immediately', async () => {
    const site = await seedQueued('empty')
    vi.mocked(discoverPages).mockResolvedValue([])
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('pre-discovered URLs skip discovery', async () => {
    const urls = [`https://${PREFIX}prediscovered/a`]
    const site = await seedQueued('prediscovered', {
      discoveredUrls: JSON.stringify(urls), pagesTotal: 1,
    })
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })
    expect(discoverPages).not.toHaveBeenCalled()
    expect(await prisma.adaAudit.count({ where: { siteAuditId: site.id } })).toBe(1)
  })

  it('terminal status: no-op', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}cancelled`, status: 'cancelled', wcagLevel: 'wcag21aa' },
    })
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })
    expect(discoverPages).not.toHaveBeenCalled()
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('cancelled')
  })

  it('discoverPages throw propagates (queue retries)', async () => {
    const site = await seedQueued('boom')
    vi.mocked(discoverPages).mockRejectedValue(new Error('dns fail'))
    await expect(runSiteAuditDiscoverJob({ siteAuditId: site.id })).rejects.toThrow('dns fail')
  })

  it('onExhausted fails the audit and cascades', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}exhausted`, status: 'running', wcagLevel: 'wcag21aa' },
    })
    await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}exhausted/a`, status: 'pending', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await onSiteAuditDiscoverExhausted({ siteAuditId: site.id }, { jobId: 'j1', attempts: 3, lastError: 'dns fail' })
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.status).toBe('error')
    expect(s?.error).toContain('dns fail')
    const child = await prisma.adaAudit.findFirst({ where: { siteAuditId: site.id } })
    expect(child?.status).toBe('error')
  })

  it('rejects a malformed payload', async () => {
    await expect(runSiteAuditDiscoverJob({ nope: true } as never)).rejects.toThrow(/payload/i)
  })
})
```

- [ ] **Step 5.3: Run to verify failure:**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-discover.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 5.4: Implement** — `lib/jobs/handlers/site-audit-discover.ts`:

```ts
// lib/jobs/handlers/site-audit-discover.ts
//
// Durable-queue discovery + fan-out handler for site audits. One job per
// audit (dedupKey discover:<id>); owns the queued→running claim, page
// discovery, child-row creation, and site-audit-page fan-out. Making this a
// job (not inline work in processNext) is what makes the enqueue step itself
// crash-safe: a restart mid-fan-out re-queues the job, which resumes
// idempotently off the persisted discoveredUrls + the (siteAuditId, url)
// unique index on AdaAudit.
//
// One-at-a-time: the claim carries a NOT EXISTS guard over the transient
// statuses — the stateless promoter alone cannot enforce the invariant (two
// concurrent processNext calls can promote two different audits; see the
// Phase 3 spec). A claim that matches 0 rows on a still-queued audit means
// another audit is active: complete the job as a no-op; the active audit's
// finalize will re-promote this one with a fresh discover job.
//
// Zombie safety: discoveredUrls is persisted first-writer-wins (conditional
// on discoveredUrls IS NULL), so every attempt fans out the SAME URL list;
// child creation is per-row create with P2002 catch-and-skip
// (createMany.skipDuplicates is not supported on SQLite).

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { discoverPages } from '@/lib/ada-audit/sitemap-crawler'
import { finalizeSiteAudit } from '@/lib/ada-audit/site-audit-finalizer'
import { enqueueJob } from '../queue'
import { registerJobHandler } from '../registry'
import type { JobExhaustedContext } from '../types'
import {
  SITE_AUDIT_PAGE_JOB_TYPE,
  settlePageFailure,
  type SiteAuditPageJob,
} from './site-audit-page'

export const SITE_AUDIT_DISCOVER_JOB_TYPE = 'site-audit-discover'

export interface SiteAuditDiscoverJob {
  siteAuditId: string
}

function assertDiscoverPayload(payload: unknown): SiteAuditDiscoverJob {
  const p = payload as Partial<SiteAuditDiscoverJob> | null
  if (!p || typeof p.siteAuditId !== 'string') {
    throw new Error('Invalid site-audit-discover job payload')
  }
  return p as SiteAuditDiscoverJob
}

function kickPromoter(): void {
  // Dynamic import mirrors site-audit-finalizer.ts — avoids a static
  // handler → queue-manager → jobs/queue → … cycle.
  void import('@/lib/ada-audit/queue-manager')
    .then((m) => m.processNext())
    .catch(() => {})
}

export async function runSiteAuditDiscoverJob(payload: unknown): Promise<void> {
  const { siteAuditId } = assertDiscoverPayload(payload)

  // Conditional claim with the one-active guard. Raw SQL: updatedAt and
  // startedAt set manually (integer ms — raw SQL bypasses @updatedAt).
  const claimed = await prisma.$executeRaw`
    UPDATE "SiteAudit"
    SET "status" = 'running', "startedAt" = ${Date.now()}, "updatedAt" = ${Date.now()}
    WHERE "id" = ${siteAuditId}
      AND "status" = 'queued'
      AND NOT EXISTS (
        SELECT 1 FROM "SiteAudit"
        WHERE "status" IN ('running', 'pdfs-running', 'lighthouse-running')
      )`

  const audit = await prisma.siteAudit.findUnique({
    where: { id: siteAuditId },
    select: { status: true, domain: true, clientId: true, wcagLevel: true, discoveredUrls: true },
  })
  if (!audit) return

  if (claimed !== 1) {
    if (audit.status === 'queued') {
      // Another audit holds the slot — no-op; the next finalize kick
      // re-promotes this audit with a fresh discover job.
      return
    }
    if (audit.status !== 'running') {
      // Terminal (cancelled/error/complete) — release the slot decision to
      // the promoter and bail.
      kickPromoter()
      return
    }
    // status === 'running' → crash-resume: fall through.
  }

  // Resolve the URL list. First-writer-wins persist makes every attempt fan
  // out the same set.
  let urls: string[] | null = null
  if (audit.discoveredUrls !== null) {
    try {
      urls = JSON.parse(audit.discoveredUrls)
    } catch {
      urls = null // corrupt legacy value — re-discover below
    }
  }
  if (urls === null) {
    const discovered = [...new Set(await discoverPages(audit.domain))]
    const persisted = await prisma.siteAudit.updateMany({
      where: { id: siteAuditId, discoveredUrls: null },
      data: { discoveredUrls: JSON.stringify(discovered), pagesTotal: discovered.length },
    })
    if (persisted.count === 1) {
      urls = discovered
    } else {
      // A racing attempt persisted first (or the stored value was corrupt
      // and non-null) — re-read and use/repair the stored set.
      const reread = await prisma.siteAudit.findUnique({
        where: { id: siteAuditId },
        select: { discoveredUrls: true },
      })
      try {
        urls = reread?.discoveredUrls ? JSON.parse(reread.discoveredUrls) : discovered
      } catch {
        urls = discovered
      }
      if (!Array.isArray(urls)) urls = discovered
    }
  }
  // Dedupe defensively (stored legacy sets may contain duplicates — the
  // unique child index would otherwise make pagesTotal undrainable) and
  // make pagesTotal authoritative. Also repairs a corrupt non-null
  // discoveredUrls (re-discovered above): re-store the clean set so every
  // future attempt fans out the same list. Deterministic across attempts
  // because the stored set is.
  urls = [...new Set(urls)]
  const ensured = await prisma.siteAudit.updateMany({
    where: { id: siteAuditId, status: 'running' },
    data: { discoveredUrls: JSON.stringify(urls), pagesTotal: urls.length },
  })
  if (ensured.count === 0) {
    // Parent is no longer running (cancelled/failed/completed under a stale
    // attempt) — do NOT create children or enqueue work for a dead parent.
    kickPromoter()
    return
  }

  // Create missing children. Per-row create with P2002 skip — idempotent
  // under any zombie/retry interleaving thanks to @@unique([siteAuditId, url]).
  const existing = await prisma.adaAudit.findMany({
    where: { siteAuditId },
    select: { id: true, url: true, status: true },
  })
  const byUrl = new Map(existing.map((c) => [c.url, c]))
  for (const url of urls) {
    if (byUrl.has(url)) continue
    try {
      const child = await prisma.adaAudit.create({
        data: {
          url,
          status: 'pending',
          clientId: audit.clientId,
          siteAuditId,
          wcagLevel: audit.wcagLevel,
        },
        select: { id: true, url: true, status: true },
      })
      byUrl.set(url, child)
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const dup = await prisma.adaAudit.findFirst({
          where: { siteAuditId, url },
          select: { id: true, url: true, status: true },
        })
        if (dup) byUrl.set(url, dup)
        continue
      }
      throw e
    }
  }

  // Fan out one page job per unsettled child. Active-window dedup absorbs
  // re-runs; a duplicate job against a settled child no-ops via the child
  // claim. A failed enqueue settles its child NOW (mirrors the PSI/PDF
  // enqueue-failure fallback) — a child with no job would strand the audit.
  for (const url of urls) {
    const child = byUrl.get(url)
    if (!child || (child.status !== 'pending' && child.status !== 'running')) continue
    const pageJob: SiteAuditPageJob = {
      adaAuditId: child.id,
      siteAuditId,
      url,
      wcagLevel: audit.wcagLevel,
    }
    try {
      await enqueueJob({
        type: SITE_AUDIT_PAGE_JOB_TYPE,
        payload: pageJob,
        dedupKey: `page:${siteAuditId}:${url}`,
        groupKey: `site-audit:${siteAuditId}`,
      })
    } catch (err) {
      console.error('[jobs/site-audit-discover] page enqueue failed for', url, ':', (err as Error).message)
      try {
        await settlePageFailure(pageJob, `Failed to enqueue durable page job: ${(err as Error).message}`)
      } catch (settleErr) {
        console.error('[jobs/site-audit-discover] enqueue-failure settle also failed for', url, ':', (settleErr as Error).message)
      }
    }
  }

  if (urls.length === 0) {
    try {
      await finalizeSiteAudit(siteAuditId)
    } catch (err) {
      console.warn('[jobs/site-audit-discover] finalize of empty audit failed:', (err as Error).message)
    }
  }
}

export async function onSiteAuditDiscoverExhausted(payload: unknown, ctx: JobExhaustedContext): Promise<void> {
  const { siteAuditId } = assertDiscoverPayload(payload)
  const { failSiteAudit } = await import('@/lib/ada-audit/queue-manager')
  await failSiteAudit(siteAuditId, `Site audit discovery failed after ${ctx.attempts} attempts: ${ctx.lastError}`)
}

export function registerSiteAuditDiscoverHandler(): void {
  registerJobHandler({
    type: SITE_AUDIT_DISCOVER_JOB_TYPE,
    concurrency: 1, // never a reason to run two discovers
    maxAttempts: 3,
    backoffBaseMs: 30_000,
    timeoutMs: 300_000, // 1000-page sitemap discovery + ~2000 inserts fits
    handler: runSiteAuditDiscoverJob,
    onExhausted: onSiteAuditDiscoverExhausted,
  })
}
```

- [ ] **Step 5.5: Register both handlers.** In `lib/jobs/handlers/register.ts`:

```ts
import { registerPsiHandler } from './psi'
import { registerPdfScanHandler } from './pdf-scan'
import { registerSiteAuditPageHandler } from './site-audit-page'
import { registerSiteAuditDiscoverHandler } from './site-audit-discover'

export function registerBuiltInJobHandlers(): void {
  registerPsiHandler()
  registerPdfScanHandler()
  registerSiteAuditPageHandler()
  registerSiteAuditDiscoverHandler()
}
```

- [ ] **Step 5.6: Run the tests:**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-discover.test.ts
```

Expected: PASS (12 tests).

- [ ] **Step 5.7: Commit**

```bash
git add lib/jobs/handlers/site-audit-discover.ts lib/jobs/handlers/site-audit-discover.test.ts lib/jobs/handlers/register.ts lib/ada-audit/queue-manager.ts
git commit -m "feat(jobs): site-audit-discover handler — durable claim/discovery/fan-out + failSiteAudit helper"
```

---

### Task 6: queue-manager rewrite — promoter, recovery generalization, deletions

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts` (major rewrite)
- Modify: `lib/ada-audit/queue-manager.test.ts` (full rewrite)

- [ ] **Step 6.1: Rewrite `lib/ada-audit/queue-manager.ts`.** Delete: `runAudit`, the `processing` mutex, `SITE_AUDIT_CONCURRENCY` / `SITE_AUDIT_BROWSER_RECYCLE_PAGES` constants and `parsePositiveInt`, the imports of `discoverPages`, `runAxeAudit`, `dispatchPdfScans`, `closeBrowser`, `enqueuePsiJob`, `getLighthouseProvider`. Keep: `failOrphanAdaAudits`, `failOrphanPdfAudits`, `failSiteAudit` (from Task 5), `getQueueStatus`, `enqueueAudit`. The new file in full (excluding `getQueueStatus`, `failOrphanAdaAudits`, `failOrphanPdfAudits`, `failSiteAudit`, which stay as they are):

```ts
/**
 * Global site audit queue manager.
 *
 * Only one site audit holds the queue slot at a time, enforced by the
 * site-audit-discover handler's conditional claim (a NOT EXISTS guard over
 * the transient statuses). The slot is held through 'running' (page jobs in
 * flight), 'pdfs-running', and 'lighthouse-running'; finalizeSiteAudit is
 * the sole place that flips a SiteAudit to 'complete' and kicks processNext.
 *
 * Status transitions:
 *   queued → running → (pdfs-running | lighthouse-running) → complete
 *                   ↓ (no PDFs and no LH outstanding)
 *                   complete
 *                   ↓ (top-level error)
 *                   error
 *
 * All page work is durable (Phase 3): discovery + fan-out run as a
 * site-audit-discover job, each page as a site-audit-page job. A restart
 * mid-audit resumes instead of failing — recovery below only destroys
 * parents with zero outstanding durable jobs that still won't finalize.
 */

import { prisma } from '@/lib/db'
import { finalizeSiteAudit } from '@/lib/ada-audit/site-audit-finalizer'
import { cancelJobsByGroup, countActiveJobsByGroup, enqueueJob } from '@/lib/jobs/queue'
import { closeBatchIfDrained, ensureOpenBatch } from './audit-batch-helpers'
import type { QueueStatusWithBatch } from './types'

const TRANSIENT_STATUSES = ['running', 'pdfs-running', 'lighthouse-running'] as const

// ─── Queue processing ────────────────────────────────────────────────────────

/**
 * Stateless promoter: if no audit holds the slot, enqueue a discover job for
 * the oldest queued audit. Safe under concurrent callers without a mutex:
 * both pick the SAME oldest row (dedupKey discover:<id> collapses the
 * enqueues), and the one-active invariant is enforced by the discover
 * handler's claim, not here — a stray promotion of a second audit no-ops at
 * claim time and gets re-promoted by the next finalize kick.
 */
export async function processNext() {
  try {
    const active = await prisma.siteAudit.findFirst({
      where: { status: { in: [...TRANSIENT_STATUSES] } },
      select: { id: true },
    })
    if (active) return

    const next = await prisma.siteAudit.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (!next) return

    await enqueueJob({
      type: 'site-audit-discover',
      payload: { siteAuditId: next.id },
      dedupKey: `discover:${next.id}`,
      groupKey: `site-audit:${next.id}`,
    })
  } catch (err) {
    console.error('[queue] processNext error:', err)
  }
}

// ─── Enqueue ─────────────────────────────────────────────────────────────────

export interface EnqueueAuditOptions {
  preDiscoveredUrls?: string[]
  requestedBy?: string | null
}

export async function enqueueAudit(
  domain: string,
  clientId: number | null,
  wcagLevel: string,
  opts: EnqueueAuditOptions = {},
): Promise<{ id: string; status: string }> {
  const { requestedBy } = opts
  // Dedupe up front: pagesTotal must equal the number of UNIQUE children the
  // discover handler will fan out (the (siteAuditId,url) index collapses
  // duplicates). Written together with discoveredUrls so the finalizer's
  // discovery guard is meaningful from birth.
  const preDiscoveredUrls = opts.preDiscoveredUrls
    ? [...new Set(opts.preDiscoveredUrls)]
    : undefined

  const batchId = await ensureOpenBatch()

  const audit = await prisma.siteAudit.create({
    data: {
      domain,
      status: 'queued',
      clientId,
      wcagLevel,
      discoveredUrls: preDiscoveredUrls ? JSON.stringify(preDiscoveredUrls) : null,
      pagesTotal: preDiscoveredUrls ? preDiscoveredUrls.length : 0,
      batchId,
      requestedBy: requestedBy ?? null,
    },
  })

  // (existing batch race-recovery verify/reassign block stays unchanged)
  const verify = await prisma.auditBatch.findUnique({
    where: { id: batchId },
    select: { closedAt: true },
  })
  if (verify?.closedAt) {
    const newBatchId = await ensureOpenBatch()
    await prisma.siteAudit.update({
      where: { id: audit.id },
      data: { batchId: newBatchId },
    })
  }

  void processNext()

  return { id: audit.id, status: 'queued' }
}
```

(Note: the old `setTimeout(() => void processNext(), 2000)` retry kick existed because the mutex could swallow a kick mid-execution; the stateless promoter has no mutex, so it goes.)

- [ ] **Step 6.2: Replace both recovery functions with the generic treatment** (same file). `resetStaleAudits` and `recoverQueue` share a per-audit helper:

```ts
// ─── Recovery ────────────────────────────────────────────────────────────────

/**
 * Generic transient-parent recovery (all of running / pdfs-running /
 * lighthouse-running — Phase 3 made the page loop durable, so 'running' is
 * no longer special):
 *   outstanding durable jobs → resume (leave alone);
 *   zero jobs → one finalize attempt (drained-but-unfinalized completes);
 *   still transient after that → failSiteAudit.
 * A failed job count NEVER destroys the parent (transient read errors must
 * not bias toward the destructive path) — skip and let the next pass retry.
 */
async function recoverOrFailTransient(
  audit: { id: string; status: string },
  source: string,
  failMessage: string,
): Promise<void> {
  let outstanding: number
  try {
    outstanding = await countActiveJobsByGroup(`site-audit:${audit.id}`)
  } catch (err) {
    console.warn(`[queue] ${source}: job count failed for ${audit.id}, skipping this pass:`, (err as Error).message)
    return
  }
  if (outstanding > 0) {
    console.warn(`[queue] ${source}: resuming audit ${audit.id} (${outstanding} durable job(s) outstanding)`)
    return
  }
  try {
    await finalizeSiteAudit(audit.id)
  } catch (err) {
    console.warn(`[queue] ${source}: finalize attempt failed for ${audit.id}:`, (err as Error).message)
  }
  const refreshed = await prisma.siteAudit.findUnique({
    where: { id: audit.id },
    select: { status: true },
  })
  if (refreshed?.status === 'complete') {
    console.warn(`[queue] ${source}: finalized drained audit ${audit.id}`)
    return
  }
  if (!refreshed || !(TRANSIENT_STATUSES as readonly string[]).includes(refreshed.status)) return
  console.warn(`[queue] ${source}: failing audit ${audit.id}`)
  await failSiteAudit(audit.id, failMessage)
}

/**
 * Resets transient audits with no DB activity for 5+ minutes and no
 * outstanding durable jobs. Called every 10 min from instrumentation.ts.
 * Job settles bump SiteAudit.updatedAt, so a healthy audit never trips this.
 */
export async function resetStaleAudits() {
  const STALE_MS = 5 * 60 * 1000
  const staleThreshold = new Date(Date.now() - STALE_MS)
  const stale = await prisma.siteAudit.findMany({
    where: {
      status: { in: [...TRANSIENT_STATUSES] },
      updatedAt: { lt: staleThreshold },
    },
    select: { id: true, status: true },
  })
  for (const s of stale) {
    await recoverOrFailTransient(s, 'Stale check', 'Audit timed out (server may have restarted)')
  }
  if (stale.length > 0) void processNext()
}

/**
 * Called once at server startup, AFTER recoverJobsOnStartup() (boot order in
 * instrumentation.ts) — orphaned durable jobs are already re-queued, so a
 * transient parent with outstanding jobs resumes seamlessly. Parents with no
 * jobs get finalize-then-fail. Legacy 'pending' audits are re-queued.
 */
export async function recoverQueue() {
  const orphans = await prisma.siteAudit.findMany({
    where: { status: { in: [...TRANSIENT_STATUSES] } },
    select: { id: true, status: true },
  })
  for (const o of orphans) {
    await recoverOrFailTransient(o, 'Startup recovery', 'Audit interrupted (server restarted)')
  }

  await prisma.siteAudit.updateMany({
    where: { status: 'pending' },
    data: { status: 'queued' },
  })

  void processNext()
}
```

(`failOrphanAdaAudits` / `failOrphanPdfAudits` / `failSiteAudit` / `getQueueStatus` stay exactly as they are. The `batchId` select in the old loops is no longer needed here — `failSiteAudit` reads it itself.)

- [ ] **Step 6.3: Rewrite `lib/ada-audit/queue-manager.test.ts`** in full:

```ts
// lib/ada-audit/queue-manager.test.ts
//
// Phase 3: the promoter is stateless (no mutex) — one-at-a-time is enforced
// by the discover handler's claim. These tests cover the promoter's enqueue
// behavior, generic transient recovery (running included), and failSiteAudit.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/ada-audit/site-audit-finalizer', () => ({
  finalizeSiteAudit: vi.fn(async () => undefined),
}))

const { prisma } = await import('@/lib/db')
const { finalizeSiteAudit } = await import('@/lib/ada-audit/site-audit-finalizer')
const { processNext, recoverQueue, resetStaleAudits, failSiteAudit } = await import('./queue-manager')

const PREFIX = 'qm3-test-'

async function clearTestState() {
  // groupKeys are site-audit:<id> and payloads carry IDs, not domains —
  // resolve the test sites' IDs first, then delete their jobs by groupKey.
  const sites = await prisma.siteAudit.findMany({
    where: { domain: { startsWith: PREFIX } },
    select: { id: true },
  })
  if (sites.length > 0) {
    await prisma.job.deleteMany({
      where: { groupKey: { in: sites.map((s) => `site-audit:${s.id}`) } },
    })
  }
  await prisma.pdfAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.auditBatch.updateMany({ where: { closedAt: null }, data: { closedAt: new Date() } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
}

async function seedSite(name: string, status: string, extra: Record<string, unknown> = {}) {
  return prisma.siteAudit.create({
    data: { domain: `${PREFIX}${name}`, status, wcagLevel: 'wcag21aa', ...extra },
  })
}

function discoverJobsFor(siteAuditId: string) {
  return prisma.job.findMany({
    where: { type: 'site-audit-discover', groupKey: `site-audit:${siteAuditId}` },
  })
}

describe('processNext — stateless promoter', () => {
  beforeEach(async () => {
    vi.mocked(finalizeSiteAudit).mockClear()
    await clearTestState()
  })

  it('enqueues a discover job for the oldest queued audit when idle', async () => {
    const older = await seedSite('older', 'queued', { createdAt: new Date(Date.now() - 60_000) })
    await seedSite('newer', 'queued')
    await processNext()
    expect(await discoverJobsFor(older.id)).toHaveLength(1)
  })

  it('double-call dedups to one discover job', async () => {
    const site = await seedSite('dedup', 'queued')
    await processNext()
    await processNext()
    expect(await discoverJobsFor(site.id)).toHaveLength(1)
  })

  it.each(['running', 'pdfs-running', 'lighthouse-running'])(
    'does not promote while an audit is %s',
    async (status) => {
      await seedSite(`active-${status}`, status)
      const queued = await seedSite(`queued-${status}`, 'queued')
      await processNext()
      expect(await discoverJobsFor(queued.id)).toHaveLength(0)
    },
  )

  it('no-ops when nothing is queued', async () => {
    await expect(processNext()).resolves.toBeUndefined()
  })
})

describe('recovery — generic transient treatment', () => {
  beforeEach(async () => {
    vi.mocked(finalizeSiteAudit).mockClear()
    await clearTestState()
  })

  it.each(['running', 'pdfs-running', 'lighthouse-running'])(
    'recoverQueue resumes a %s parent with outstanding durable jobs',
    async (status) => {
      const site = await seedSite(`resume-${status}`, status, { discoveredUrls: '[]' })
      await prisma.job.create({
        data: { type: 'site-audit-page', payload: '{}', status: 'queued', groupKey: `site-audit:${site.id}` },
      })
      await recoverQueue()
      expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe(status)
    },
  )

  it('recoverQueue gives a drained running parent one finalize attempt before failing', async () => {
    const site = await seedSite('finalize-first', 'running', { discoveredUrls: '[]' })
    // finalize mock flips it to complete — simulates a drained audit.
    vi.mocked(finalizeSiteAudit).mockImplementationOnce(async (id: string) => {
      await prisma.siteAudit.update({ where: { id }, data: { status: 'complete' } })
    })
    await recoverQueue()
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('complete')
  })

  it('recoverQueue fails a running parent with zero jobs that will not finalize, cascading children', async () => {
    const site = await seedSite('dead-running', 'running', { discoveredUrls: '[]', pagesTotal: 2 })
    await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}dead-running/a`, status: 'pending', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}dead-running/b`, status: 'axe-complete', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await recoverQueue()
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.status).toBe('error')
    const children = await prisma.adaAudit.findMany({ where: { siteAuditId: site.id } })
    expect(children.every((c) => c.status === 'error')).toBe(true)
  })

  it('resetStaleAudits skips fresh transient audits and fails stale drained ones', async () => {
    const fresh = await seedSite('fresh', 'running', { discoveredUrls: '[]', pagesTotal: 1 })
    const stale = await seedSite('stale', 'running', { discoveredUrls: '[]', pagesTotal: 1 })
    const backdated = Date.now() - 10 * 60 * 1000
    await prisma.$executeRaw`UPDATE "SiteAudit" SET "updatedAt" = ${backdated} WHERE "id" = ${stale.id}`
    await resetStaleAudits()
    expect((await prisma.siteAudit.findUnique({ where: { id: fresh.id } }))?.status).toBe('running')
    expect((await prisma.siteAudit.findUnique({ where: { id: stale.id } }))?.status).toBe('error')
  })

  it('resetStaleAudits resumes a stale parent that still has active jobs (backoff window)', async () => {
    const site = await seedSite('backoff', 'running', { discoveredUrls: '[]', pagesTotal: 1 })
    await prisma.job.create({
      data: {
        type: 'site-audit-page', payload: '{}', status: 'queued',
        runAfter: new Date(Date.now() + 10 * 60 * 1000), // backoff-delayed
        groupKey: `site-audit:${site.id}`,
      },
    })
    const backdated = Date.now() - 10 * 60 * 1000
    await prisma.$executeRaw`UPDATE "SiteAudit" SET "updatedAt" = ${backdated} WHERE "id" = ${site.id}`
    await resetStaleAudits()
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('running')
  })

  it('recoverQueue re-queues legacy pending audits', async () => {
    const site = await seedSite('legacy', 'pending')
    await recoverQueue()
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('queued')
  })
})

describe('failSiteAudit', () => {
  beforeEach(clearTestState)

  it('flips parent, cascades children + pdfs, cancels queued group jobs', async () => {
    const site = await seedSite('fail', 'running', { discoveredUrls: '[]', pagesTotal: 1 })
    const child = await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}fail/a`, status: 'running', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await prisma.pdfAudit.create({
      data: { url: `https://${PREFIX}fail/a.pdf`, status: 'pending', siteAuditId: site.id },
    })
    const job = await prisma.job.create({
      data: { type: 'site-audit-page', payload: '{}', status: 'queued', groupKey: `site-audit:${site.id}` },
    })
    await failSiteAudit(site.id, 'test failure')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('error')
    expect((await prisma.adaAudit.findUnique({ where: { id: child.id } }))?.status).toBe('error')
    expect((await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id } }))?.status).toBe('error')
    expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe('cancelled')
  })

  it('never clobbers a terminal parent — and does not cascade its children or jobs', async () => {
    const site = await seedSite('terminal', 'complete')
    const child = await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}terminal/a`, status: 'complete', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    const job = await prisma.job.create({
      data: { type: 'site-audit-page', payload: '{}', status: 'queued', groupKey: `site-audit:${site.id}` },
    })
    await failSiteAudit(site.id, 'should not land')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('complete')
    expect((await prisma.adaAudit.findUnique({ where: { id: child.id } }))?.status).toBe('complete')
    expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe('queued')
  })
})
```

- [ ] **Step 6.4: Run the rewritten tests:**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/queue-manager.test.ts
```

Expected: PASS.

- [ ] **Step 6.5: Grep for orphaned references** to deleted exports — code AND comments (stale comments pointing at a deleted control path mislead future debugging):

```bash
grep -rn "runAudit" app lib instrumentation.ts --include="*.ts" --include="*.tsx" | grep -v "runAxeAudit"
```

Expected: only comment hits. Fix each — known ones: `lib/ada-audit/runner.ts` (the `RunAxeOptions.siteAudit` doc comment names `queue-manager.ts:runAudit` as the caller; point it at `lib/jobs/handlers/site-audit-page.ts`), and any in `pdf-orchestrator.ts`/`lighthouse-queue.ts` headers that describe "the page loop".

- [ ] **Step 6.6: Commit**

```bash
git add lib/ada-audit/queue-manager.ts lib/ada-audit/queue-manager.test.ts
git commit -m "feat(queue): stateless promoter + generic transient recovery — page loop and mutex deleted"
```

---

### Task 7: Integration pass — instrumentation comment, full suite, types, build

**Files:**
- Modify: `instrumentation.ts` (comment only)
- Possibly touch: any test broken by the finalizer guard / enqueueAudit `pagesTotal` change

- [ ] **Step 7.1: Update the boot-order comment in `instrumentation.ts`** (behavior unchanged):

```ts
    // Job queue boot order (each step depends on the previous):
    // 1. Register handlers — startup recovery may run onExhausted hooks,
    //    which need a populated registry.
    // 2. recoverJobsOnStartup — recoverQueue decides parent-audit survival
    //    based on active jobs in the Job table.
    // 3. recoverQueue (awaited) — resumes transient parents with outstanding
    //    durable jobs (incl. 'running' since Phase 3), finalizes drained
    //    ones, fails the rest. Deterministic before any claims.
    // 4. startJobWorker — only now may jobs start draining.
```

- [ ] **Step 7.2: Type-check + full suite + build:**

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npx vitest run
npm run build
```

Expected: all green. Likely breakage spots to fix if they appear:
- Site-audit API route tests that asserted `pagesTotal: 0` on freshly enqueued audits with pre-discovered URLs (now set at creation).
- Finalizer tests seeding `running` audits without `discoveredUrls` (set `discoveredUrls: '[]'`).
- Any test importing `runAudit` (rewrite against the new promoter / handlers).

- [ ] **Step 7.3: Commit**

```bash
git add -A
git commit -m "chore(phase3): integration pass — boot comment, test alignment, build green"
```

---

### Task 8: Docs + tracker + handoff + PR

**Files:**
- Modify: `CLAUDE.md` (architecture patterns: site-audit queue, browser recycle, recovery)
- Modify: `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`
- Modify: `docs/superpowers/todos/HANDOFF-improvement-roadmap.md`

- [ ] **Step 8.1: Update CLAUDE.md** — in "Architecture patterns", rewrite the "Site audit queue" and "Stale audit recovery" bullets to describe: discover/page job types, the NOT EXISTS one-active claim, stateless promoter, pool-level browser recycling + idle close, generic transient recovery (running survivable). In "ADA Audit specifics", update the browser-recycle sentence (pool-global, drain gate).
- [ ] **Step 8.2: Update the tracker** (status-log line: Phase 3 built, PR opened) and rewrite the handoff doc (next item: merge/deploy + restart-test mid-`running`, then Phase 4).
- [ ] **Step 8.3: Commit docs, push branch, open PR:**

```bash
git add CLAUDE.md docs/
git commit -m "docs: Phase 3 architecture notes + tracker/handoff update"
git push -u origin feat/job-queue-phase3-page-loop
gh pr create --title "feat: A1 Phase 3 — site-audit page loop on the durable job queue" --body "..."
```

---

## Self-review checklist (run after Task 8)

- Spec coverage: discover claim guard ✓ (5.4), first-writer-wins persist ✓ (5.4), unique index + dedupe migration ✓ (1), page handler semantics ✓ (4.3), promoter ✓ (6.1), browser pool ✓ (2.3), finalizer guards + scalar ✓ (3.3), recovery generalization + failSiteAudit ✓ (5.1/6.2), enqueueAudit pagesTotal ✓ (6.1), cancellation unchanged ✓ (no edits to cancel route).
- All counters in `settlePage` come from the fixed `PageCounter` union — no user input reaches `Prisma.raw`.
- `enqueuePsiJob(job)` passes the full page-job payload — its shape is a superset of `PsiJob` (adaAuditId, siteAuditId, url, wcagLevel all present). Verify the types line up; if `PsiJob` is exact, construct the object explicitly.
