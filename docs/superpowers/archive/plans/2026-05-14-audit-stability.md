# Audit Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop site audits from dying at single-page peaks under the current concurrency=1 settings, and stop process restarts from leaving the queue (and per-page pollers) wedged. This is a stability fix, not a throughput change — concurrency stays at 1 and the browser pool stays at 2.

**Architecture:** Config-only changes in `ecosystem.config.js`. Code changes in `lib/ada-audit/queue-manager.ts`: drop the 5-minute staleness threshold from `recoverQueue` (a fresh Node process cannot resume in-memory work from the old one), and cascade-fail orphan child rows — both `AdaAudit` and `PdfAudit` — whenever a parent SiteAudit is forced to `error`.

**Tech Stack:** PM2 · Node 22 · Prisma + SQLite · vitest

**Smoking gun for this PR:** 2026-05-14 fei.edu audit died at page 8/34 with `Audit timed out (server may have restarted)`. `pm2 describe` showed the Node process restarted at the same instant Chrome went to zero. dmesg showed no kernel OOM — confirms PM2's `max_memory_restart: 1200M` SIGKILL'd Node mid-Lighthouse. Concurrency=1 was already in effect; this is the floor, not the ceiling.

**Companion PRs (separate, sequenced after this lands):**
1. `docs/superpowers/plans/2026-05-14-live-audit-page.md` — UX work
2. `docs/superpowers/plans/2026-05-14-audit-throughput-tuning.md` — concurrency=2 + browser pool=4, only after we have stability data

---

## Why these specific values

| Knob | Today | New | Why |
|---|---|---|---|
| `max_memory_restart` (PM2) | `1200M` | `2400M` | The fei.edu incident proves 1200M is below the legitimate per-page Lighthouse peak. Node ~1.5 GB + Chrome ~1.0 GB at the current pool size 2; PM2 only watches Node RSS, but 2.4 GB covers the GC-churn peak. The 2 GB swap remains as the kernel-level safety net underneath. |
| `NODE_OPTIONS --max-old-space-size` | `1536` | `2048` | Raises the V8 heap ceiling so it can grow before GC thrashes. Not a floor — Node only uses what it needs. |
| `SITE_AUDIT_BROWSER_RECYCLE_PAGES` | `25` | `15` | Recycle Chrome sooner under the same concurrency=1. Conservative: smaller per-recycle batches → less per-recycle memory creep. Costs one extra cold-Chrome launch per 15 pages; negligible. |
| `BROWSER_POOL_SIZE` | `2` | **unchanged** `2` | Throughput knob — deferred. |
| `SITE_AUDIT_CONCURRENCY` | `1` | **unchanged** `1` | Throughput knob — deferred. |

Expected peak resident: **Node ~1.6–2.0 GB**, **Chrome ~300–600 MB** at pool size 2, total system ~2.4–2.8 GB. 2 GB swap untouched in steady state.

## Code change: stale-recovery semantics

Three related bugs the fei.edu incident exposed:

**Bug 1 — startup recovery is too forgiving.** `recoverQueue` today only resets audits stuck `running` / `pdfs-running` for **5+ minutes**. But on startup, the Node process is fresh — it has no Chrome connection, no in-memory page-work state, no way to resume. Any `running` row at startup is by definition orphaned. Waiting 5 minutes before flagging it wedges the queue for that whole window. **Fix:** drop the threshold at startup; flag all `running` / `pdfs-running` rows immediately.

**Bug 2 — orphan child AdaAudit rows leak.** When `resetStaleAudits` or `recoverQueue` flips a parent SiteAudit to `error`, its child `AdaAudit` rows in `pending` / `running` stay that way forever. If anyone opens the child page's URL, they see a spinning "scanning…" UI that polls forever (`AuditPoller` only stops on terminal status). **Fix:** new `failOrphanAdaAudits(siteAuditId)` helper, called from both recovery paths.

**Bug 3 — orphan PdfAudit rows leak too.** Parents interrupted during the `pdfs-running` phase have child `PdfAudit` rows in `pending` / `scanning` that also never reach a terminal state. Same class of bug as #2 — different table. **Fix:** sibling `failOrphanPdfAudits(siteAuditId)` helper, called from the same two recovery paths.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `ecosystem.config.js` | Modify | Update `max_memory_restart`, `NODE_OPTIONS`, `SITE_AUDIT_BROWSER_RECYCLE_PAGES` |
| `lib/ada-audit/queue-manager.ts` | Modify | New `failOrphanAdaAudits` + `failOrphanPdfAudits` helpers; drop staleness threshold from `recoverQueue`; call both helpers from both recovery paths |
| `lib/ada-audit/queue-manager.test.ts` | Modify | Tests for both helpers + the new `recoverQueue` semantics |
| `CLAUDE.md` | Modify | Update recycle bullet (25 → 15) and stale-recovery semantics |
| `docs/SERVER_SETUP.md` | Modify | Update env-var table + `max_memory_restart` callout |

No new files. No schema change.

---

### Task 1: Branch + working tree

**Files:** none

- [ ] **Step 1: Pull latest main**

```bash
git checkout main && git pull origin main
```

- [ ] **Step 2: Create the feature branch**

```bash
git checkout -b fix/audit-stability
```

---

### Task 2: Update `ecosystem.config.js`

**Files:**
- Modify: `ecosystem.config.js`

- [ ] **Step 1: Read current values**

```bash
grep -nE 'BROWSER_POOL_SIZE|SITE_AUDIT_|NODE_OPTIONS|max_memory_restart' ecosystem.config.js
```

Expected:
```
max_memory_restart: '1200M',
NODE_OPTIONS: '--max-old-space-size=1536',
BROWSER_POOL_SIZE: '2',
SITE_AUDIT_CONCURRENCY: '1',
SITE_AUDIT_BROWSER_RECYCLE_PAGES: '25',
```

- [ ] **Step 2: Apply the three changes**

In `ecosystem.config.js`, change exactly these three values (leave `BROWSER_POOL_SIZE` and `SITE_AUDIT_CONCURRENCY` alone):

```javascript
    max_memory_restart: '2400M',
    env: {
      // …other env unchanged…
      NODE_OPTIONS: '--max-old-space-size=2048',
      BROWSER_POOL_SIZE: '2',                    // unchanged
      SITE_AUDIT_CONCURRENCY: '1',               // unchanged
      SITE_AUDIT_BROWSER_RECYCLE_PAGES: '15',
    },
```

- [ ] **Step 3: Verify config still parses**

```bash
node -e "console.log(JSON.stringify(require('./ecosystem.config.js'), null, 2))"
```

Expected: prints full config with the three changed values. No throw.

- [ ] **Step 4: Verify path overrides still flow through (regression-check of PR #12)**

```bash
APP_HOME=/tmp/x DATA_HOME=/tmp/y LOG_HOME=/tmp/z node -e "console.log(JSON.stringify(require('./ecosystem.config.js'), null, 2))"
```

Expected: paths flip to `/tmp/...`; new env values present.

- [ ] **Step 5: Commit**

```bash
git add ecosystem.config.js
git commit -m "fix(perf): raise PM2/Node memory ceiling to prevent SIGKILL during Lighthouse peaks"
```

---

### Task 3: Add failing test for `failOrphanAdaAudits` helper

**Files:**
- Modify: `lib/ada-audit/queue-manager.test.ts`

- [ ] **Step 1: Append the test block**

Open `lib/ada-audit/queue-manager.test.ts` and append at the end of the file (after the existing `describe('runAudit — conditional claim race', …)` block):

```typescript
const { failOrphanAdaAudits } = await import('./queue-manager')

async function clearOrphanTestState() {
  await prisma.pdfAudit.deleteMany({ where: { url: { startsWith: 'https://orphan-test-' } } })
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://orphan-test-' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'orphan-test-' } } })
}

describe('failOrphanAdaAudits', () => {
  beforeEach(clearOrphanTestState)

  it('marks pending and running children as error; leaves complete/error children alone', async () => {
    const parent = await prisma.siteAudit.create({
      data: { domain: 'orphan-test-mixed.example', status: 'error', wcagLevel: 'wcag21aa' },
    })
    await prisma.adaAudit.create({
      data: { url: 'https://orphan-test-mixed.example/a', status: 'running', wcagLevel: 'wcag21aa', siteAuditId: parent.id },
    })
    await prisma.adaAudit.create({
      data: { url: 'https://orphan-test-mixed.example/b', status: 'pending', wcagLevel: 'wcag21aa', siteAuditId: parent.id },
    })
    await prisma.adaAudit.create({
      data: { url: 'https://orphan-test-mixed.example/c', status: 'complete', wcagLevel: 'wcag21aa', siteAuditId: parent.id, result: '{}' },
    })
    await prisma.adaAudit.create({
      data: { url: 'https://orphan-test-mixed.example/d', status: 'error', wcagLevel: 'wcag21aa', siteAuditId: parent.id, error: 'pre-existing' },
    })

    await failOrphanAdaAudits(parent.id)

    const after = await prisma.adaAudit.findMany({ where: { siteAuditId: parent.id }, orderBy: { url: 'asc' } })
    const byUrl = Object.fromEntries(after.map((c) => [c.url, c]))

    expect(byUrl['https://orphan-test-mixed.example/a'].status).toBe('error')
    expect(byUrl['https://orphan-test-mixed.example/a'].error).toMatch(/site audit/i)
    expect(byUrl['https://orphan-test-mixed.example/b'].status).toBe('error')
    expect(byUrl['https://orphan-test-mixed.example/b'].error).toMatch(/site audit/i)
    expect(byUrl['https://orphan-test-mixed.example/c'].status).toBe('complete')      // untouched
    expect(byUrl['https://orphan-test-mixed.example/d'].error).toBe('pre-existing')   // untouched
  })

  it('is a no-op when there are no orphan children', async () => {
    const parent = await prisma.siteAudit.create({
      data: { domain: 'orphan-test-empty.example', status: 'error', wcagLevel: 'wcag21aa' },
    })
    await expect(failOrphanAdaAudits(parent.id)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run, verify it fails because the helper does not exist**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/queue-manager.test.ts
```

Expected: FAIL — `failOrphanAdaAudits is not exported`.

---

### Task 4: Implement `failOrphanAdaAudits`

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts`

- [ ] **Step 1: Add the helper**

Open `lib/ada-audit/queue-manager.ts`. Insert this new exported function near the other recovery helpers (immediately above `resetStaleAudits`):

```typescript
/**
 * When a parent SiteAudit is forced into a terminal `error` state by recovery,
 * any of its AdaAudit children still in `pending` or `running` are orphans —
 * the runner that owned them is gone and they can never progress. Mark them
 * as `error` with a clear message so any open per-page poller stops spinning.
 */
export async function failOrphanAdaAudits(siteAuditId: string): Promise<void> {
  await prisma.adaAudit.updateMany({
    where: {
      siteAuditId,
      status: { in: ['pending', 'running'] },
    },
    data: {
      status: 'error',
      error: 'Audit interrupted because the site audit was stopped or restarted',
    },
  })
}
```

- [ ] **Step 2: Run tests, verify they pass**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/queue-manager.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/ada-audit/queue-manager.ts lib/ada-audit/queue-manager.test.ts
git commit -m "feat(ada-audit): failOrphanAdaAudits helper for orphan child cleanup"
```

---

### Task 5: Add failing test for `failOrphanPdfAudits` helper

**Files:**
- Modify: `lib/ada-audit/queue-manager.test.ts`

- [ ] **Step 1: Append the test block**

Append to `lib/ada-audit/queue-manager.test.ts`:

```typescript
const { failOrphanPdfAudits } = await import('./queue-manager')

describe('failOrphanPdfAudits', () => {
  beforeEach(clearOrphanTestState)

  it('marks pending and scanning PDFs as error; leaves complete/error PDFs alone', async () => {
    const parent = await prisma.siteAudit.create({
      data: { domain: 'orphan-test-pdf.example', status: 'error', wcagLevel: 'wcag21aa' },
    })
    await prisma.pdfAudit.create({
      data: { url: 'https://orphan-test-pdf.example/a.pdf', status: 'scanning', siteAuditId: parent.id },
    })
    await prisma.pdfAudit.create({
      data: { url: 'https://orphan-test-pdf.example/b.pdf', status: 'pending', siteAuditId: parent.id },
    })
    await prisma.pdfAudit.create({
      data: { url: 'https://orphan-test-pdf.example/c.pdf', status: 'complete', siteAuditId: parent.id, issues: '[]' },
    })
    await prisma.pdfAudit.create({
      data: { url: 'https://orphan-test-pdf.example/d.pdf', status: 'error', siteAuditId: parent.id, scanError: 'pre-existing' },
    })

    await failOrphanPdfAudits(parent.id)

    const after = await prisma.pdfAudit.findMany({ where: { siteAuditId: parent.id }, orderBy: { url: 'asc' } })
    const byUrl = Object.fromEntries(after.map((c) => [c.url, c]))

    expect(byUrl['https://orphan-test-pdf.example/a.pdf'].status).toBe('error')
    expect(byUrl['https://orphan-test-pdf.example/a.pdf'].scanError).toMatch(/site audit/i)
    expect(byUrl['https://orphan-test-pdf.example/b.pdf'].status).toBe('error')
    expect(byUrl['https://orphan-test-pdf.example/b.pdf'].scanError).toMatch(/site audit/i)
    expect(byUrl['https://orphan-test-pdf.example/c.pdf'].status).toBe('complete')      // untouched
    expect(byUrl['https://orphan-test-pdf.example/d.pdf'].scanError).toBe('pre-existing')  // untouched
  })

  it('is a no-op when there are no orphan PDFs', async () => {
    const parent = await prisma.siteAudit.create({
      data: { domain: 'orphan-test-pdf-empty.example', status: 'error', wcagLevel: 'wcag21aa' },
    })
    await expect(failOrphanPdfAudits(parent.id)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/queue-manager.test.ts
```

Expected: FAIL — `failOrphanPdfAudits is not exported`.

If the PdfAudit `status` field names differ from `scanning` / `pending` / `complete` / `error`, or `scanError` is named differently, fix the test to match `prisma/schema.prisma` before continuing.

---

### Task 6: Implement `failOrphanPdfAudits`

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts`

- [ ] **Step 1: Add the helper**

Open `lib/ada-audit/queue-manager.ts`. Insert immediately below `failOrphanAdaAudits`:

```typescript
/**
 * Same idea as failOrphanAdaAudits, but for the PdfAudit table. When a parent
 * SiteAudit is interrupted during the `pdfs-running` phase, any PdfAudit rows
 * still in `pending` or `scanning` are orphans and would otherwise sit
 * forever. PdfAudit uses `scanError` for its failure message column.
 */
export async function failOrphanPdfAudits(siteAuditId: string): Promise<void> {
  await prisma.pdfAudit.updateMany({
    where: {
      siteAuditId,
      status: { in: ['pending', 'scanning'] },
    },
    data: {
      status: 'error',
      scanError: 'Audit interrupted because the site audit was stopped or restarted',
    },
  })
}
```

- [ ] **Step 2: Run tests, verify they pass**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/queue-manager.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/ada-audit/queue-manager.ts lib/ada-audit/queue-manager.test.ts
git commit -m "feat(ada-audit): failOrphanPdfAudits helper for orphan PDF cleanup"
```

---

### Task 7: Wire both helpers into `resetStaleAudits`

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts`
- Test: `lib/ada-audit/queue-manager.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `lib/ada-audit/queue-manager.test.ts`:

```typescript
const { resetStaleAudits } = await import('./queue-manager')

describe('resetStaleAudits — orphan child cleanup', () => {
  beforeEach(clearOrphanTestState)

  it('cascade-fails AdaAudit and PdfAudit orphans when it errors a stale parent', async () => {
    const sixMinAgo = new Date(Date.now() - 6 * 60 * 1000)
    const parent = await prisma.siteAudit.create({
      data: { domain: 'orphan-test-stale.example', status: 'pdfs-running', wcagLevel: 'wcag21aa' },
    })
    // Backdate updatedAt past the 5-minute threshold
    await prisma.$executeRaw`UPDATE "SiteAudit" SET "updatedAt" = ${sixMinAgo} WHERE "id" = ${parent.id}`

    await prisma.adaAudit.create({
      data: { url: 'https://orphan-test-stale.example/in-flight', status: 'running', wcagLevel: 'wcag21aa', siteAuditId: parent.id },
    })
    await prisma.pdfAudit.create({
      data: { url: 'https://orphan-test-stale.example/doc.pdf', status: 'scanning', siteAuditId: parent.id },
    })

    await resetStaleAudits()

    const refreshedParent = await prisma.siteAudit.findUnique({ where: { id: parent.id } })
    expect(refreshedParent?.status).toBe('error')

    const ada = await prisma.adaAudit.findFirst({ where: { siteAuditId: parent.id } })
    expect(ada?.status).toBe('error')
    expect(ada?.error).toMatch(/site audit/i)

    const pdf = await prisma.pdfAudit.findFirst({ where: { siteAuditId: parent.id } })
    expect(pdf?.status).toBe('error')
    expect(pdf?.scanError).toMatch(/site audit/i)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/queue-manager.test.ts
```

Expected: FAIL — orphan rows still `running` / `scanning`.

- [ ] **Step 3: Wire both helpers into `resetStaleAudits`**

Locate the `for (const s of stale)` loop inside `resetStaleAudits`. Add both cascade calls after the parent update:

```typescript
for (const s of stale) {
    console.warn(`[queue] Resetting stale audit ${s.id}`)
    await prisma.siteAudit.update({
      where: { id: s.id },
      data: { status: 'error', error: 'Audit timed out (server may have restarted)' },
    }).catch(() => {})
    await failOrphanAdaAudits(s.id).catch(() => {})
    await failOrphanPdfAudits(s.id).catch(() => {})
    if (s.batchId) {
      await closeBatchIfDrained(s.batchId).catch(() => {})
    }
  }
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/queue-manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/queue-manager.ts lib/ada-audit/queue-manager.test.ts
git commit -m "fix(ada-audit): cascade-fail orphan AdaAudit + PdfAudit rows on stale-audit recovery"
```

---

### Task 8: Rewrite `recoverQueue` to be immediate + cascade

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts`
- Test: `lib/ada-audit/queue-manager.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `lib/ada-audit/queue-manager.test.ts`:

```typescript
const { recoverQueue } = await import('./queue-manager')

describe('recoverQueue — immediate interrupt on startup', () => {
  beforeEach(clearOrphanTestState)

  it('marks running/pdfs-running parents as interrupted immediately (no 5-min threshold), with full cascade', async () => {
    // A row whose updatedAt is RECENT — under the old 5-min threshold this would survive recovery
    const parent = await prisma.siteAudit.create({
      data: { domain: 'orphan-test-fresh.example', status: 'pdfs-running', wcagLevel: 'wcag21aa' },
    })
    await prisma.adaAudit.create({
      data: { url: 'https://orphan-test-fresh.example/in-flight', status: 'running', wcagLevel: 'wcag21aa', siteAuditId: parent.id },
    })
    await prisma.pdfAudit.create({
      data: { url: 'https://orphan-test-fresh.example/doc.pdf', status: 'scanning', siteAuditId: parent.id },
    })

    await recoverQueue()

    const refreshedParent = await prisma.siteAudit.findUnique({ where: { id: parent.id } })
    expect(refreshedParent?.status).toBe('error')
    expect(refreshedParent?.error).toMatch(/interrupted/i)

    const ada = await prisma.adaAudit.findFirst({ where: { siteAuditId: parent.id } })
    expect(ada?.status).toBe('error')

    const pdf = await prisma.pdfAudit.findFirst({ where: { siteAuditId: parent.id } })
    expect(pdf?.status).toBe('error')
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/queue-manager.test.ts
```

Expected: FAIL — parent still `pdfs-running` because the current `recoverQueue` only acts on rows older than 5 min.

- [ ] **Step 3: Rewrite `recoverQueue`**

Replace the entire `recoverQueue` function body in `lib/ada-audit/queue-manager.ts`:

```typescript
/**
 * Called on server startup to recover from crashes/restarts.
 *
 * Unlike resetStaleAudits (which runs during normal operation and uses a
 * 5-minute staleness threshold), startup recovery makes the strong assumption
 * that ANY SiteAudit in `running` or `pdfs-running` is orphaned — the previous
 * Node process is gone and its in-memory page-work state with it. So every
 * such row is flipped to `error` immediately, no threshold. Both AdaAudit and
 * PdfAudit child rows are cascade-failed alongside.
 *
 * Old-status `pending` SiteAudits get re-queued in case any predate the
 * queue-batches feature.
 */
export async function recoverQueue() {
  const orphans = await prisma.siteAudit.findMany({
    where: {
      status: { in: ['running', 'pdfs-running'] },
    },
    select: { id: true, batchId: true },
  })
  for (const o of orphans) {
    console.warn(`[queue] Startup recovery: resetting orphan audit ${o.id}`)
    await prisma.siteAudit.update({
      where: { id: o.id },
      data: { status: 'error', error: 'Audit interrupted (server restarted)' },
    }).catch(() => {})
    await failOrphanAdaAudits(o.id).catch(() => {})
    await failOrphanPdfAudits(o.id).catch(() => {})
    if (o.batchId) {
      await closeBatchIfDrained(o.batchId).catch(() => {})
    }
  }

  // Also reset any 'pending' audits (legacy status, shouldn't exist with the new queue)
  await prisma.siteAudit.updateMany({
    where: { status: 'pending' },
    data: { status: 'queued' },
  })

  void processNext()
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/queue-manager.test.ts
```

Expected: PASS — new test + all existing.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/queue-manager.ts lib/ada-audit/queue-manager.test.ts
git commit -m "fix(ada-audit): recoverQueue immediately fails orphan running audits + cascades to PDFs"
```

---

### Task 9: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Locate references**

```bash
grep -nE 'max_memory_restart|RECYCLE|recover|Stale audit' CLAUDE.md
```

- [ ] **Step 2: Update the recycle / recovery bullets**

- Any "every 25 pages" mention → change to "every 15 pages"
- The stale-recovery bullet — clarify that on startup recovery is immediate, not staleness-based, and cascades through both child tables:

```markdown
- **Stale audit recovery:** `updatedAt` field auto-updates on every Prisma write (heartbeat). `resetStaleAudits()` runs every 10 min during runtime — audits stuck in `running` / `pdfs-running` for 5+ min get errored. `recoverQueue()` runs once at startup and immediately fails any `running` / `pdfs-running` parent (a fresh Node process cannot resume in-memory page work). Both paths cascade-fail orphan `AdaAudit` rows (via `failOrphanAdaAudits`) and `PdfAudit` rows (via `failOrphanPdfAudits`) so per-page pollers and PDF scanners stop spinning.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE): document the new stale-recovery semantics and recycle-15 default"
```

---

### Task 10: Update `docs/SERVER_SETUP.md`

**Files:**
- Modify: `docs/SERVER_SETUP.md`

- [ ] **Step 1: Update the `max_memory_restart` callout**

Find:
```
> **Why 1200M max_memory_restart:** The app itself uses ~200-300 MB. Each Chrome page uses ~150 MB (pool size 2 = ~300 MB). Setting 1200M provides headroom while still catching genuine memory leaks before they cause OOM.
```

Replace with:
```
> **Why 2400M max_memory_restart:** Node typically uses ~1.0-1.5 GB during Lighthouse trace processing; Chrome resident ~300-600 MB at pool size 2. The 2026-05-14 fei.edu incident proved that 1200M tripped legitimate per-page peaks at concurrency=1 and caused mid-audit SIGKILLs. 2400M leaves headroom for the trace-time spike while still catching genuine leaks. The 2 GB swap below this is the kernel-level safety net.
```

- [ ] **Step 2: Update the env-variable table**

Find the row for `SITE_AUDIT_BROWSER_RECYCLE_PAGES`. Update the example value:

```markdown
| `SITE_AUDIT_BROWSER_RECYCLE_PAGES` | `15` | Restart Chrome after this many site-audit pages to reclaim browser memory |
```

`BROWSER_POOL_SIZE` and `SITE_AUDIT_CONCURRENCY` rows are unchanged in this PR.

- [ ] **Step 3: Commit**

```bash
git add docs/SERVER_SETUP.md
git commit -m "docs(server-setup): document the stability tuning rationale"
```

---

### Task 11: Verify lint + full test suite + build

**Files:** none

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 2: Full test suite**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run
```

Expected: PASS. New tests in queue-manager.test.ts: 2 for `failOrphanAdaAudits`, 2 for `failOrphanPdfAudits`, 1 for the `resetStaleAudits` cascade, 1 for the `recoverQueue` immediate-interrupt → **+6 new tests**.

- [ ] **Step 3: Production build**

```bash
rm -rf .next && npm run build
```

Expected: clean build.

---

### Task 12: Open the PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin fix/audit-stability
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "fix(ada-audit): stability fixes — memory ceiling + stale-recovery semantics" --body "$(cat <<'EOF'
## Summary
Stops site audits from dying at single-page peaks under the current concurrency=1 settings, and stops process restarts from leaving the queue (and per-page pollers / PDF scanners) wedged for 5+ minutes. Three fixes:

1. **PM2/Node memory ceiling raised** so legitimate Lighthouse peaks don't trigger SIGKILLs mid-audit.
2. **Stale-recovery semantics fixed** so a process restart doesn't leave audits wedged for 10 minutes.
3. **Orphan child cleanup** for both `AdaAudit` and `PdfAudit` rows when a parent is forced to `error`.

**This is a stability PR, not a throughput PR.** Concurrency stays at 1, browser pool stays at 2. Throughput tuning is deferred to a separate PR with measured data from this baseline.

## Smoking gun
2026-05-14 fei.edu audit died at page 8/34 with `Audit timed out (server may have restarted)`. `pm2 describe` showed the Node process restarted at exactly the same instant Chrome went to zero. dmesg showed no kernel OOM kill — confirms PM2's `max_memory_restart: 1200M` SIGKILL'd Node during a Lighthouse trace peak.

## Config changes (`ecosystem.config.js`)

| Knob | Was | Now |
|---|---|---|
| `max_memory_restart` | `1200M` | `2400M` |
| `NODE_OPTIONS --max-old-space-size` | `1536` | `2048` |
| `SITE_AUDIT_BROWSER_RECYCLE_PAGES` | `25` | `15` |
| `BROWSER_POOL_SIZE` | `2` | **unchanged** |
| `SITE_AUDIT_CONCURRENCY` | `1` | **unchanged** |

## Code changes (`lib/ada-audit/queue-manager.ts`)

- **New `failOrphanAdaAudits(siteAuditId)` helper.** Flips `pending` / `running` child AdaAudit rows to `error` with a clear message. Without it, the per-page `AuditPoller` polls a stale row forever.
- **New `failOrphanPdfAudits(siteAuditId)` helper.** Same idea for `PdfAudit` rows in `pending` / `scanning`. Important for parents interrupted during the `pdfs-running` phase.
- **`resetStaleAudits` now cascades through both helpers** for every parent it errors.
- **`recoverQueue` rewritten:** drops the 5-minute staleness threshold (a fresh Node process can't resume in-memory work, so every `running` / `pdfs-running` row is by definition orphaned at startup) and cascades through both helpers.

## Test plan
- [x] 6 new tests in `lib/ada-audit/queue-manager.test.ts`:
  - `failOrphanAdaAudits` marks pending+running, leaves complete/error alone
  - `failOrphanAdaAudits` no-op when no orphans
  - `failOrphanPdfAudits` marks pending+scanning, leaves complete/error alone
  - `failOrphanPdfAudits` no-op when no orphans
  - `resetStaleAudits` cascades to both AdaAudit and PdfAudit orphans
  - `recoverQueue` immediately interrupts running rows + cascades to both child tables
- [x] Existing tests pass
- [x] Lint, build clean
- [ ] Post-deploy: queue the same fei.edu audit that failed at page 8; verify it completes the full 34-page run without a PM2 restart
- [ ] Post-deploy: trigger a forced restart (`pm2 restart seo-tools`) during an audit; verify the parent and ALL child rows (AdaAudit + PdfAudit) flip to `error` immediately, no wedged queue

## Deploy mechanics
The deploy must use `pm2 delete seo-tools && pm2 start ecosystem.config.js` — a plain `pm2 restart` will not re-read the new `max_memory_restart` from the config file. Same gotcha as PR #12.

## Out of scope (deferred)
- Bumping `BROWSER_POOL_SIZE` to 4 and `SITE_AUDIT_CONCURRENCY` to 2. Throughput, not stability. Separate PR after we have stable-baseline metrics. See `docs/superpowers/plans/2026-05-14-audit-throughput-tuning.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return PR URL**

---

## Self-review checklist

- [x] **Spec coverage**: rationale inline (three-bug section + "Why these specific values" table). No separate spec.
- [x] **No placeholders**: every config value is concrete; every code block is the actual code to paste.
- [x] **Type consistency**: both helpers have the same signature shape `(siteAuditId: string) => Promise<void>`. Used identically in tests and call sites.
- [x] **Test ordering**: each test is written *before* its corresponding implementation; RED verified before each GREEN.
- [x] **Deploy reminder**: the `pm2 delete + start` requirement is called out explicitly in the PR body.
- [x] **PDF orphan cleanup covered**: explicitly addressed via `failOrphanPdfAudits` and wired into both recovery paths. No deferral.
