# Audit Queue Batches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class auto-grouped batches to the site-audit queue, give the Clients section a one-click queue button + bulk action, and add a dedicated `/ada-audit/queue` page with Active and History tabs.

**Architecture:** New `AuditBatch` Prisma model with a SQLite partial unique index that enforces at-most-one-open-batch at the DB level. `enqueueAudit` attaches to the open batch (creating one on P2002 race-retry). A new `closeBatchIfDrained` helper is invoked from every place a SiteAudit transitions to a terminal state (success path via `site-audit-finalizer`, error path in `runAudit`, stale-recovery paths). A new `queueSiteAuditRequest` helper extracts the in-flight duplicate guard so both the single POST and a new bulk POST share it. The Clients section gains queue buttons + active chips; a new `/ada-audit/queue` page renders Active (5 s poll) + History (paginated) tabs.

**Tech Stack:** Next.js 15 App Router · TypeScript · Prisma + SQLite (WAL) · React 19 · Tailwind · existing `PaginatedSection` from the UI overhaul PR.

**Reference spec:** `docs/superpowers/specs/2026-05-13-audit-queue-batches-design.md`

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `lib/ada-audit/audit-batch-helpers.ts` | `closeBatchIfDrained(batchId)`, `resolveBatchLabel(batch)`, query helpers |
| `lib/ada-audit/audit-batch-helpers.test.ts` | Unit tests for the helpers |
| `lib/ada-audit/queue-request.ts` | `queueSiteAuditRequest(input)` shared helper (normalize + dup guard + enqueue) |
| `lib/ada-audit/queue-request.test.ts` | Unit tests for the helper |
| `app/api/audit-batches/route.ts` | Paginated GET (closed batches) |
| `app/api/audit-batches/route.test.ts` | Pagination, ordering, count derivation |
| `app/api/audit-batches/[id]/route.ts` | GET (one batch + members) + PATCH (label) |
| `app/api/audit-batches/[id]/route.test.ts` | Shape, label validation, 404 |
| `app/api/site-audit/bulk-queue/route.ts` | POST (queue all eligible clients) |
| `app/api/site-audit/bulk-queue/route.test.ts` | Fail-loud, partial success, all-success |
| `app/ada-audit/queue/page.tsx` | Route shell |
| `components/ada-audit/QueuePageTabs.tsx` | Tab container with URL state |
| `components/ada-audit/QueueActiveView.tsx` | Active tab + 5s polling + close-edge toast |
| `components/ada-audit/QueueHistoryView.tsx` | History tab (paginated) |
| `components/ada-audit/QueueBatchRow.tsx` | One collapsible batch row (inline label edit) |
| `components/ada-audit/QueueMemberRow.tsx` | One site-audit member row |
| `components/ada-audit/BulkQueueModal.tsx` | Confirmation + missing-domains state + result panel |

### Modified files
| Path | Change |
|---|---|
| `prisma/schema.prisma` | Add `AuditBatch` model + `SiteAudit.batchId` column + indexes |
| `lib/ada-audit/types.ts` | Add `AuditBatchSummary`, `AuditBatchDetail`, `QueueStatusWithBatch` types |
| `lib/ada-audit/queue-manager.ts` | Extend `enqueueAudit` to attach to open batch; wire `closeBatchIfDrained` into `runAudit` error path and `resetStaleAudits` / `recoverQueue` |
| `lib/ada-audit/site-audit-finalizer.ts` | Call `closeBatchIfDrained` after the complete-flip |
| `app/api/site-audit/route.ts` | Switch POST to call `queueSiteAuditRequest`; GET unchanged |
| `app/api/site-audit/queue/route.ts` | Response gains `clientId` per row + `batch` field |
| `components/ada-audit/ClientsAuditSummary.tsx` | Per-row Queue audit button, header bulk + View queue links, in-flight chip |
| `components/ada-audit/SiteAuditForm.tsx` | Fix `selectClient` to always update domain; add no-domain hint |

---

## Phase 1: Foundation

### Task 1: Cut branch off latest main

- [ ] **Step 1: Verify main is current and clean**

```bash
git checkout main
git pull --ff-only
git status
git log --oneline -3
```

Expected: working tree clean apart from session-local junk (`.claude/`, `prisma/local-dev.db*`, `local-uploads/`). Latest commit on main mentions the PDF resilience hotfix (PR #10).

- [ ] **Step 2: Create branch**

```bash
git checkout -b feat/audit-queue-batches
```

Expected: `Switched to a new branch 'feat/audit-queue-batches'`.

---

### Task 2: Prisma schema migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_audit_batches/migration.sql` (auto-generated, then hand-edited)

- [ ] **Step 1: Add `AuditBatch` model and `SiteAudit.batchId` field to `prisma/schema.prisma`**

Append after the last existing model (`PdfAudit`):

```prisma
model AuditBatch {
  id         String      @id @default(cuid())
  startedAt  DateTime    @default(now())
  closedAt   DateTime?
  label      String?
  siteAudits SiteAudit[]

  @@index([closedAt])
  @@index([startedAt])
}
```

In the `SiteAudit` model, after the `pdfAudits` relation, insert:

```prisma
  batchId    String?
  batch      AuditBatch? @relation(fields: [batchId], references: [id], onDelete: SetNull)
```

And add a new index inside the `SiteAudit` `@@index` block:

```prisma
  @@index([batchId])
```

- [ ] **Step 2: Generate the migration**

```bash
DATABASE_URL='file:./prisma/local-dev.db' npx prisma migrate dev --name add_audit_batches --create-only
```

`--create-only` writes the SQL but doesn't apply it yet — we need to hand-edit before running.

Expected: a new file under `prisma/migrations/<timestamp>_add_audit_batches/migration.sql`.

- [ ] **Step 3: Append the partial unique index to the migration SQL**

Open the generated `migration.sql`. At the bottom, append:

```sql
-- Enforces "at most one open batch" at the DB level. Prisma's schema DSL can't
-- model a partial unique constraint, so it lives in raw SQL. Enqueue catches
-- the Prisma P2002 error and retries by re-reading the open batch.
CREATE UNIQUE INDEX "audit_batches_one_open"
  ON "AuditBatch" ((1))
  WHERE "closedAt" IS NULL;
```

- [ ] **Step 4: Apply the migration**

```bash
DATABASE_URL='file:./prisma/local-dev.db' npx prisma migrate deploy
```

Expected: `1 migration applied`, no errors.

- [ ] **Step 5: Verify the schema applied**

```bash
DATABASE_URL='file:./prisma/local-dev.db' npx tsx -e "
import { prisma } from './lib/db'
;(async () => {
  console.log(prisma.auditBatch ? 'AuditBatch OK' : 'missing')
  const indexes: { name: string }[] = await prisma.\$queryRawUnsafe(\"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='AuditBatch'\")
  console.log('indexes:', indexes.map(i => i.name).join(', '))
})()
"
```

Expected:
```
AuditBatch OK
indexes: ..., audit_batches_one_open, AuditBatch_closedAt_idx, AuditBatch_startedAt_idx
```

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(ada-audit): schema for audit-batches + partial unique open-batch index"
```

---

### Task 3: `audit-batch-helpers.ts` with TDD

**Files:**
- Create: `lib/ada-audit/audit-batch-helpers.ts`
- Create: `lib/ada-audit/audit-batch-helpers.test.ts`

The helpers own two things: closing a drained batch, and resolving a label (DB value or auto-generated from startedAt).

- [ ] **Step 1: Write the failing test `audit-batch-helpers.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { closeBatchIfDrained, resolveBatchLabel } from './audit-batch-helpers'

describe('resolveBatchLabel', () => {
  it('returns the stored label when set', () => {
    const out = resolveBatchLabel({
      id: 'b1',
      startedAt: new Date('2026-05-13T19:15:00Z'),
      closedAt: null,
      label: 'Q2 audits',
    })
    expect(out).toBe('Q2 audits')
  })

  it('returns an auto-label derived from startedAt when label is null', () => {
    const out = resolveBatchLabel({
      id: 'b1',
      startedAt: new Date('2026-05-13T19:15:00Z'),
      closedAt: null,
      label: null,
    })
    // Locale-dependent — assert structure not exact text
    expect(out).toMatch(/^Batch — /)
    expect(out.length).toBeLessThan(80)
  })
})

describe('closeBatchIfDrained', () => {
  beforeEach(async () => {
    // Clean test data
    await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://test-batch.example/' } } })
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'test-batch-' } } })
    await prisma.auditBatch.deleteMany({ where: { label: { startsWith: '__test__' } } })
  })

  it('closes the batch when no members are in flight', async () => {
    const batch = await prisma.auditBatch.create({ data: { label: '__test__drained' } })
    await prisma.siteAudit.create({
      data: { domain: 'test-batch-1.example', status: 'complete', wcagLevel: 'wcag21aa', batchId: batch.id },
    })

    await closeBatchIfDrained(batch.id)

    const after = await prisma.auditBatch.findUnique({ where: { id: batch.id } })
    expect(after?.closedAt).toBeTruthy()
  })

  it('does NOT close the batch when at least one member is queued/running/pdfs-running', async () => {
    const batch = await prisma.auditBatch.create({ data: { label: '__test__active' } })
    await prisma.siteAudit.create({
      data: { domain: 'test-batch-2.example', status: 'complete', wcagLevel: 'wcag21aa', batchId: batch.id },
    })
    await prisma.siteAudit.create({
      data: { domain: 'test-batch-3.example', status: 'pdfs-running', wcagLevel: 'wcag21aa', batchId: batch.id },
    })

    await closeBatchIfDrained(batch.id)

    const after = await prisma.auditBatch.findUnique({ where: { id: batch.id } })
    expect(after?.closedAt).toBeNull()
  })

  it('is idempotent — calling on an already-closed batch is a no-op', async () => {
    const closedAt = new Date('2026-05-12T00:00:00Z')
    const batch = await prisma.auditBatch.create({ data: { label: '__test__already_closed', closedAt } })

    await closeBatchIfDrained(batch.id)

    const after = await prisma.auditBatch.findUnique({ where: { id: batch.id } })
    expect(after?.closedAt?.toISOString()).toBe(closedAt.toISOString())
  })

  it('does nothing when batchId is null', async () => {
    await expect(closeBatchIfDrained(null)).resolves.toBeUndefined()
  })

  it('does nothing when the batch row no longer exists', async () => {
    await expect(closeBatchIfDrained('nonexistent-id')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
npm test -- audit-batch-helpers
```

Expected: FAIL with "Cannot find module './audit-batch-helpers'".

- [ ] **Step 3: Implement `lib/ada-audit/audit-batch-helpers.ts`**

```ts
// lib/ada-audit/audit-batch-helpers.ts
//
// Helpers for the AuditBatch lifecycle. The key invariant — "at most one open
// batch" — is enforced by a SQLite partial unique index on
// AuditBatch(closedAt IS NULL). This module is the single place that flips a
// batch from open to closed: callers (queue-manager error path, site-audit-
// finalizer success path, stale-recovery paths) just hand us the batchId.

import { prisma } from '@/lib/db'

/** Statuses that count as "in flight" — a batch with any such member stays open. */
const IN_FLIGHT_STATUSES = ['queued', 'pending', 'running', 'pdfs-running']

interface BatchForLabel {
  id: string
  startedAt: Date
  closedAt: Date | null
  label: string | null
}

/**
 * If the batch has no in-flight members and is currently open, mark it closed.
 * No-op when batchId is null, the batch doesn't exist, the batch is already
 * closed, or at least one member is still in flight.
 */
export async function closeBatchIfDrained(batchId: string | null | undefined): Promise<void> {
  if (!batchId) return

  const batch = await prisma.auditBatch.findUnique({
    where: { id: batchId },
    select: { id: true, closedAt: true },
  })
  if (!batch) return
  if (batch.closedAt) return  // already closed — idempotent

  const inFlightCount = await prisma.siteAudit.count({
    where: { batchId, status: { in: IN_FLIGHT_STATUSES } },
  })
  if (inFlightCount > 0) return

  await prisma.auditBatch.update({
    where: { id: batchId },
    data: { closedAt: new Date() },
  })
}

/**
 * Resolve a batch's display label. Returns the stored label if set, otherwise
 * an auto-generated string of the form "Batch — May 13, 2026 7:15 PM".
 */
export function resolveBatchLabel(batch: BatchForLabel): string {
  if (batch.label && batch.label.trim()) return batch.label.trim()
  const formatted = batch.startedAt.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
  return `Batch — ${formatted}`
}
```

- [ ] **Step 4: Run the tests, verify pass**

```bash
npm test -- audit-batch-helpers
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/audit-batch-helpers.ts lib/ada-audit/audit-batch-helpers.test.ts
git commit -m "feat(ada-audit): closeBatchIfDrained + resolveBatchLabel helpers with tests"
```

---

## Phase 2: Backend — enqueue + close hooks

### Task 4: `queueSiteAuditRequest` shared helper

**Files:**
- Create: `lib/ada-audit/queue-request.ts`
- Create: `lib/ada-audit/queue-request.test.ts`

The existing `POST /api/site-audit` route has domain normalization + the in-flight dup guard inline. The new bulk endpoint needs the same logic. Extract it into a helper that returns a discriminated-union result both routes can translate to their respective response shapes.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { queueSiteAuditRequest } from './queue-request'

describe('queueSiteAuditRequest', () => {
  beforeEach(async () => {
    await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://qr-test.example' } } })
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'qr-test' } } })
  })

  it('returns invalid for empty domain', async () => {
    const r = await queueSiteAuditRequest({ domain: '', clientId: null, wcagLevel: 'wcag21aa' })
    expect(r).toEqual({ kind: 'invalid', reason: expect.stringContaining('domain') })
  })

  it('returns invalid for malformed domain', async () => {
    const r = await queueSiteAuditRequest({ domain: 'not a domain!', clientId: null, wcagLevel: 'wcag21aa' })
    expect(r.kind).toBe('invalid')
  })

  it('returns queued with an id on success', async () => {
    const r = await queueSiteAuditRequest({ domain: 'qr-test-fresh.example', clientId: null, wcagLevel: 'wcag21aa' })
    expect(r.kind).toBe('queued')
    if (r.kind === 'queued') expect(typeof r.id).toBe('string')
  })

  it('returns duplicate when a site audit for the domain is already queued', async () => {
    const seeded = await prisma.siteAudit.create({
      data: { domain: 'qr-test-dup.example', status: 'queued', wcagLevel: 'wcag21aa' },
    })
    const r = await queueSiteAuditRequest({ domain: 'qr-test-dup.example', clientId: null, wcagLevel: 'wcag21aa' })
    expect(r).toEqual({ kind: 'duplicate', existingId: seeded.id })
  })

  it('treats pdfs-running as in-flight for the duplicate guard', async () => {
    const seeded = await prisma.siteAudit.create({
      data: { domain: 'qr-test-pdfs.example', status: 'pdfs-running', wcagLevel: 'wcag21aa' },
    })
    const r = await queueSiteAuditRequest({ domain: 'qr-test-pdfs.example', clientId: null, wcagLevel: 'wcag21aa' })
    expect(r).toEqual({ kind: 'duplicate', existingId: seeded.id })
  })

  it('normalizes domain (strips scheme/path, lowercases)', async () => {
    const r = await queueSiteAuditRequest({ domain: 'HTTPS://QR-Test-Norm.Example/some/path', clientId: null, wcagLevel: 'wcag21aa' })
    expect(r.kind).toBe('queued')
    const created = await prisma.siteAudit.findFirst({ where: { domain: 'qr-test-norm.example' } })
    expect(created).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
npm test -- queue-request
```

Expected: FAIL.

- [ ] **Step 3: Implement `lib/ada-audit/queue-request.ts`**

```ts
// lib/ada-audit/queue-request.ts
//
// Shared "validate + dedup + enqueue" helper. Owned by:
//   - POST /api/site-audit (single audit request)
//   - POST /api/site-audit/bulk-queue (per-client iteration)
//
// The in-flight duplicate guard lives here (not in enqueueAudit) because the
// queue-manager itself shouldn't reject — it's a producer interface used by
// recovery paths too. Keeping the guard at the request layer means both
// route handlers see the same dedup behavior.

import { prisma } from '@/lib/db'
import { enqueueAudit } from './queue-manager'
import { normaliseSiteAuditDomain, normaliseDiscoveredSiteAuditUrls } from './site-audit-helpers'

const IN_FLIGHT_STATUSES = ['queued', 'pending', 'running', 'pdfs-running']

export type QueueRequestResult =
  | { kind: 'queued'; id: string }
  | { kind: 'duplicate'; existingId: string }
  | { kind: 'invalid'; reason: string }

export interface QueueRequestInput {
  domain: string
  clientId: number | null
  wcagLevel: string
  preDiscoveredUrls?: string[]
}

export async function queueSiteAuditRequest(input: QueueRequestInput): Promise<QueueRequestResult> {
  const rawDomain = typeof input.domain === 'string' ? input.domain.trim() : ''
  if (!rawDomain) return { kind: 'invalid', reason: 'domain is required' }

  const domain = normaliseSiteAuditDomain(rawDomain)
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return { kind: 'invalid', reason: 'Invalid domain (e.g. example.edu)' }
  }

  const existing = await prisma.siteAudit.findFirst({
    where: { domain, status: { in: IN_FLIGHT_STATUSES } },
    select: { id: true },
  })
  if (existing) return { kind: 'duplicate', existingId: existing.id }

  const normalisedUrls = input.preDiscoveredUrls
    ? normaliseDiscoveredSiteAuditUrls(input.preDiscoveredUrls, domain)
    : undefined

  if (input.preDiscoveredUrls && (!normalisedUrls || normalisedUrls.length === 0)) {
    return { kind: 'invalid', reason: `No submitted URLs belong to ${domain}` }
  }

  const wcagLevel = input.wcagLevel === 'wcag22aa' ? 'wcag22aa' : 'wcag21aa'
  const { id } = await enqueueAudit(domain, input.clientId, wcagLevel, normalisedUrls)
  return { kind: 'queued', id }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- queue-request
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/queue-request.ts lib/ada-audit/queue-request.test.ts
git commit -m "feat(ada-audit): queueSiteAuditRequest shared helper with tests"
```

---

### Task 5: Extend `enqueueAudit` to attach to open batch (with P2002 retry)

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts`

- [ ] **Step 1: Read the current `enqueueAudit` function**

It's around line 142 of `lib/ada-audit/queue-manager.ts` and looks like:

```ts
export async function enqueueAudit(
  domain: string,
  clientId: number | null,
  wcagLevel: string,
  preDiscoveredUrls?: string[],
): Promise<{ id: string; status: string }> {
  const audit = await prisma.siteAudit.create({
    data: {
      domain,
      status: 'queued',
      clientId,
      wcagLevel,
      discoveredUrls: preDiscoveredUrls ? JSON.stringify(preDiscoveredUrls) : null,
    },
  })
  void processNext()
  setTimeout(() => void processNext(), 2000)
  return { id: audit.id, status: 'queued' }
}
```

- [ ] **Step 2: Replace it with the batch-aware version**

```ts
export async function enqueueAudit(
  domain: string,
  clientId: number | null,
  wcagLevel: string,
  preDiscoveredUrls?: string[],
): Promise<{ id: string; status: string }> {
  // Attach to the open batch (or create one). The partial unique index
  // `audit_batches_one_open` enforces "at most one open batch" at the DB
  // level — if two enqueue requests race and both observe "no open batch",
  // exactly one create() will succeed; the other catches P2002 and re-reads.
  const batchId = await ensureOpenBatch()

  const audit = await prisma.siteAudit.create({
    data: {
      domain,
      status: 'queued',
      clientId,
      wcagLevel,
      discoveredUrls: preDiscoveredUrls ? JSON.stringify(preDiscoveredUrls) : null,
      batchId,
    },
  })

  void processNext()
  setTimeout(() => void processNext(), 2000)
  return { id: audit.id, status: 'queued' }
}

async function ensureOpenBatch(): Promise<string> {
  // Fast path — open batch already exists.
  const existing = await prisma.auditBatch.findFirst({
    where: { closedAt: null },
    select: { id: true },
  })
  if (existing) return existing.id

  // Try to create. P2002 means another request beat us; re-read.
  try {
    const created = await prisma.auditBatch.create({ data: {} })
    return created.id
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code !== 'P2002') throw err
    const after = await prisma.auditBatch.findFirst({
      where: { closedAt: null },
      select: { id: true },
    })
    if (!after) {
      // Pathological: P2002 but no open batch visible. Re-throw to surface
      // the underlying problem rather than spin.
      throw err
    }
    return after.id
  }
}
```

- [ ] **Step 3: Run existing tests to verify nothing else broke**

```bash
npm test -- queue-manager
```

Expected: existing site-audit-helpers + queue-related tests still pass.

- [ ] **Step 4: Smoke test enqueue → batch attachment**

```bash
DATABASE_URL='file:./prisma/local-dev.db' npx tsx -e "
import { prisma } from './lib/db'
import { enqueueAudit } from './lib/ada-audit/queue-manager'
;(async () => {
  // Clean up any leftover open batches and stale audits from prior runs
  await prisma.siteAudit.deleteMany({ where: { domain: 'enqueue-smoke.example' } })
  await prisma.auditBatch.deleteMany({ where: { closedAt: null } })

  const { id: a1 } = await enqueueAudit('enqueue-smoke.example', null, 'wcag21aa')
  const audit1 = await prisma.siteAudit.findUnique({ where: { id: a1 } })
  console.log('audit1.batchId:', audit1?.batchId)

  // Second enqueue should attach to the SAME open batch
  await prisma.siteAudit.deleteMany({ where: { domain: 'enqueue-smoke.example' } })
  const { id: a2 } = await enqueueAudit('enqueue-smoke.example', null, 'wcag21aa')
  const audit2 = await prisma.siteAudit.findUnique({ where: { id: a2 } })
  console.log('audit2.batchId:', audit2?.batchId, '— matches a1?:', audit1?.batchId === audit2?.batchId)

  // Clean up
  await prisma.siteAudit.deleteMany({ where: { domain: 'enqueue-smoke.example' } })
  await prisma.auditBatch.deleteMany({ where: { closedAt: null } })
})()
"
```

Expected: both `batchId` values are the same non-null string. The "matches a1" check prints `true`.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/queue-manager.ts
git commit -m "feat(ada-audit): enqueueAudit attaches to open batch (P2002 race-safe)"
```

---

### Task 6: Wire `closeBatchIfDrained` into `site-audit-finalizer`

**Files:**
- Modify: `lib/ada-audit/site-audit-finalizer.ts`

- [ ] **Step 1: Edit `lib/ada-audit/site-audit-finalizer.ts`**

Find the existing `finalizeSiteAudit` function. Add the import at the top and the close-call after the `prisma.siteAudit.update` that flips status to `complete`. The new function body:

```ts
import { prisma } from '@/lib/db'
import { buildSiteAuditSummary } from './site-audit-helpers'
import { closeBatchIfDrained } from './audit-batch-helpers'

export async function finalizeSiteAudit(id: string): Promise<void> {
  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    include: { pageAudits: { include: { pdfAudits: true } } },
  })
  if (!audit) return
  if (audit.status === 'complete') return

  const summary = buildSiteAuditSummary(audit.pageAudits)
  await prisma.siteAudit.update({
    where: { id },
    data: {
      status: 'complete',
      summary: JSON.stringify(summary),
    },
  })

  // Close the batch if this audit was the last in-flight member.
  // Idempotent — closeBatchIfDrained is a no-op when others are still in flight.
  await closeBatchIfDrained(audit.batchId).catch((e) => {
    console.warn('[site-audit-finalizer] closeBatchIfDrained failed for batch', audit.batchId, ':', (e as Error).message)
  })
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/ada-audit/site-audit-finalizer.ts
git commit -m "feat(ada-audit): finalizeSiteAudit closes batch when drained"
```

---

### Task 7: Wire `closeBatchIfDrained` into `runAudit` error path + stale recovery

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts`

`runAudit` has a top-level `catch` that sets `status: 'error'`. That terminal transition needs to fire `closeBatchIfDrained` too. Same for `resetStaleAudits` and `recoverQueue` which directly update rows to error.

- [ ] **Step 1: Add the import to `lib/ada-audit/queue-manager.ts`**

At the top of the file, after the existing imports:

```ts
import { closeBatchIfDrained } from './audit-batch-helpers'
```

- [ ] **Step 2: Wire into the `runAudit` top-level `catch`**

Find the catch block at the end of `runAudit`:

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : 'Site audit failed'
  console.error(`[site-audit] id=${id} error:`, message)
  await prisma.siteAudit.update({
    where: { id },
    data: { status: 'error', error: message },
  }).catch(() => {})
  await closeBrowser().catch(() => {})
}
```

Change to (insert `closeBatchIfDrained` after the update):

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : 'Site audit failed'
  console.error(`[site-audit] id=${id} error:`, message)
  await prisma.siteAudit.update({
    where: { id },
    data: { status: 'error', error: message },
  }).catch(() => {})
  // Read back the batchId — we may not have it in scope if the audit errored
  // before any local variable captured it.
  const errored = await prisma.siteAudit.findUnique({
    where: { id },
    select: { batchId: true },
  }).catch(() => null)
  if (errored?.batchId) {
    await closeBatchIfDrained(errored.batchId).catch(() => {})
  }
  await closeBrowser().catch(() => {})
}
```

- [ ] **Step 3: Wire into `resetStaleAudits`**

Find the `resetStaleAudits` function. Currently:

```ts
export async function resetStaleAudits() {
  const STALE_MS = 5 * 60 * 1000
  const staleThreshold = new Date(Date.now() - STALE_MS)
  const stale = await prisma.siteAudit.findMany({
    where: {
      status: { in: ['running', 'pdfs-running'] },
      updatedAt: { lt: staleThreshold },
    },
    select: { id: true },
  })
  for (const s of stale) {
    console.warn(`[queue] Resetting stale audit ${s.id}`)
    await prisma.siteAudit.update({
      where: { id: s.id },
      data: { status: 'error', error: 'Audit timed out (server may have restarted)' },
    }).catch(() => {})
  }
  if (stale.length > 0) void processNext()
}
```

Change to:

```ts
export async function resetStaleAudits() {
  const STALE_MS = 5 * 60 * 1000
  const staleThreshold = new Date(Date.now() - STALE_MS)
  const stale = await prisma.siteAudit.findMany({
    where: {
      status: { in: ['running', 'pdfs-running'] },
      updatedAt: { lt: staleThreshold },
    },
    select: { id: true, batchId: true },
  })
  for (const s of stale) {
    console.warn(`[queue] Resetting stale audit ${s.id}`)
    await prisma.siteAudit.update({
      where: { id: s.id },
      data: { status: 'error', error: 'Audit timed out (server may have restarted)' },
    }).catch(() => {})
    if (s.batchId) {
      await closeBatchIfDrained(s.batchId).catch(() => {})
    }
  }
  if (stale.length > 0) void processNext()
}
```

- [ ] **Step 4: Wire into `recoverQueue`**

Same treatment for `recoverQueue`. Change the `findMany` select to include `batchId`, and call `closeBatchIfDrained` after each update:

```ts
export async function recoverQueue() {
  const STALE_MS = 5 * 60 * 1000
  const staleThreshold = new Date(Date.now() - STALE_MS)

  const stale = await prisma.siteAudit.findMany({
    where: {
      status: { in: ['running', 'pdfs-running'] },
      updatedAt: { lt: staleThreshold },
    },
    select: { id: true, batchId: true },
  })
  for (const s of stale) {
    console.warn(`[queue] Startup recovery: resetting stale audit ${s.id}`)
    await prisma.siteAudit.update({
      where: { id: s.id },
      data: { status: 'error', error: 'Audit interrupted (server restarted)' },
    }).catch(() => {})
    if (s.batchId) {
      await closeBatchIfDrained(s.batchId).catch(() => {})
    }
  }

  await prisma.siteAudit.updateMany({
    where: { status: 'pending' },
    data: { status: 'queued' },
  })

  void processNext()
}
```

- [ ] **Step 5: Type-check + tests**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -5
```

Expected: tsc clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/queue-manager.ts
git commit -m "feat(ada-audit): close drained batch on runAudit error + stale recovery"
```

---

### Task 8: queue-manager.ts test — enqueue attaches to existing/new batch

**Files:**
- Create: `lib/ada-audit/queue-manager.test.ts` (or extend if it exists)

- [ ] **Step 1: Check if the test file exists**

```bash
ls lib/ada-audit/queue-manager.test.ts 2>&1
```

If it exists, append the new `describe('enqueueAudit batch attachment', …)` block. If it doesn't, create with the boilerplate below.

- [ ] **Step 2: Write the test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { enqueueAudit } from './queue-manager'

describe('enqueueAudit batch attachment', () => {
  beforeEach(async () => {
    // Clean prior test rows
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'enqtest-' } } })
    // Clean any orphan open batches from prior runs
    await prisma.auditBatch.deleteMany({ where: { closedAt: null } })
  })

  it('creates a new batch when no open batch exists', async () => {
    const { id } = await enqueueAudit('enqtest-fresh.example', null, 'wcag21aa')
    const audit = await prisma.siteAudit.findUniqueOrThrow({ where: { id } })
    expect(audit.batchId).not.toBeNull()
    const batch = await prisma.auditBatch.findUniqueOrThrow({ where: { id: audit.batchId! } })
    expect(batch.closedAt).toBeNull()
  })

  it('attaches a second enqueue to the same open batch', async () => {
    const a = await enqueueAudit('enqtest-a.example', null, 'wcag21aa')
    const b = await enqueueAudit('enqtest-b.example', null, 'wcag21aa')
    const aRow = await prisma.siteAudit.findUniqueOrThrow({ where: { id: a.id } })
    const bRow = await prisma.siteAudit.findUniqueOrThrow({ where: { id: b.id } })
    expect(aRow.batchId).toBe(bRow.batchId)
    expect(aRow.batchId).not.toBeNull()
  })

  it('opens a new batch after the previous one closes', async () => {
    const a = await enqueueAudit('enqtest-c.example', null, 'wcag21aa')
    const aRow = await prisma.siteAudit.findUniqueOrThrow({ where: { id: a.id } })
    // Simulate batch closing
    await prisma.auditBatch.update({
      where: { id: aRow.batchId! },
      data: { closedAt: new Date() },
    })
    const b = await enqueueAudit('enqtest-d.example', null, 'wcag21aa')
    const bRow = await prisma.siteAudit.findUniqueOrThrow({ where: { id: b.id } })
    expect(bRow.batchId).not.toBe(aRow.batchId)
    const bBatch = await prisma.auditBatch.findUniqueOrThrow({ where: { id: bRow.batchId! } })
    expect(bBatch.closedAt).toBeNull()
  })
})
```

- [ ] **Step 3: Run, verify pass**

```bash
npm test -- queue-manager
```

Expected: PASS, 3 new tests (plus any existing).

- [ ] **Step 4: Commit**

```bash
git add lib/ada-audit/queue-manager.test.ts
git commit -m "test(ada-audit): enqueue attaches to or creates open batch"
```

---

## Phase 3: Backend — endpoints

### Task 9: Add types to `lib/ada-audit/types.ts`

**Files:**
- Modify: `lib/ada-audit/types.ts`

- [ ] **Step 1: Append to `lib/ada-audit/types.ts`**

At the bottom of the file:

```ts
// ── Audit batches ──────────────────────────────────────────────────────────

export interface AuditBatchSummary {
  id: string
  startedAt: string          // ISO
  closedAt: string           // ISO (always non-null in list responses)
  label: string              // resolved auto-label if DB column is null
  auditCount: number
  completeCount: number
  errorCount: number
}

export interface AuditBatchMember {
  id: string
  domain: string
  clientId: number | null
  clientName: string | null
  status: string             // queued | running | pdfs-running | complete | error
  pagesTotal: number
  pagesComplete: number
  pagesError: number
  score: number | null
  createdAt: string          // ISO
}

export interface AuditBatchDetail {
  id: string
  startedAt: string          // ISO
  closedAt: string | null    // null when this is the open batch
  label: string
  members: AuditBatchMember[]
}

// Shape returned by GET /api/site-audit/queue.
// `batch` describes the currently open batch (null when queue is drained).
// `clientId` on each active/queued row lets the Clients section drive
// in-flight chips by client id rather than fragile domain string compare.
export interface QueueStatusWithBatch {
  active: {
    id: string
    domain: string
    pagesTotal: number
    pagesComplete: number
    pagesError: number
    clientId: number | null
  } | null
  queued: {
    id: string
    domain: string
    position: number
    clientId: number | null
  }[]
  batch: {
    id: string
    startedAt: string
    label: string
  } | null
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/ada-audit/types.ts
git commit -m "feat(ada-audit): AuditBatch types"
```

---

### Task 10: Extend `GET /api/site-audit/queue` response

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts` (extend `getQueueStatus`)
- Modify: `app/api/site-audit/queue/route.ts` (response shape)

The existing endpoint just calls `getQueueStatus()` from queue-manager. The helper needs to return `clientId` per row and the open `batch`.

- [ ] **Step 1: Edit `getQueueStatus` in `lib/ada-audit/queue-manager.ts`**

Find the existing `getQueueStatus` function. Replace its body:

```ts
export async function getQueueStatus(): Promise<QueueStatusWithBatch> {
  const { resolveBatchLabel } = await import('./audit-batch-helpers')

  const active = await prisma.siteAudit.findFirst({
    where: { status: { in: ['running', 'pending', 'pdfs-running'] } },
    select: {
      id: true, domain: true, pagesTotal: true, pagesComplete: true, pagesError: true,
      clientId: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  const queuedRows = await prisma.siteAudit.findMany({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, domain: true, clientId: true },
  })

  const openBatch = await prisma.auditBatch.findFirst({
    where: { closedAt: null },
    select: { id: true, startedAt: true, label: true, closedAt: true },
  })

  return {
    active: active ? { ...active, clientId: active.clientId ?? null } : null,
    queued: queuedRows.map((q, i) => ({
      id: q.id,
      domain: q.domain,
      position: i + 1,
      clientId: q.clientId ?? null,
    })),
    batch: openBatch
      ? {
          id: openBatch.id,
          startedAt: openBatch.startedAt.toISOString(),
          label: resolveBatchLabel(openBatch),
        }
      : null,
  }
}
```

Also update the existing import at the top of `queue-manager.ts` to import the new type:

```ts
import type { QueueStatusWithBatch } from './types'
```

(Remove the older `QueueStatus` interface definition inside `queue-manager.ts` if present — the type now lives in `lib/ada-audit/types.ts`.)

- [ ] **Step 2: Verify the route still compiles**

`app/api/site-audit/queue/route.ts` calls `getQueueStatus()` and returns the JSON. No change needed there — return type just got richer.

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke test the endpoint shape**

```bash
DATABASE_URL='file:./prisma/local-dev.db' npx tsx -e "
import { getQueueStatus } from './lib/ada-audit/queue-manager'
;(async () => {
  const s = await getQueueStatus()
  console.log(JSON.stringify(s, null, 2))
})()
"
```

Expected: JSON with `active`, `queued`, AND a `batch` field (null or an object with `id`/`startedAt`/`label`).

- [ ] **Step 4: Commit**

```bash
git add lib/ada-audit/queue-manager.ts
git commit -m "feat(ada-audit): /api/site-audit/queue returns clientId + open batch"
```

---

### Task 11: `GET /api/audit-batches` (paginated list of closed batches)

**Files:**
- Create: `app/api/audit-batches/route.ts`
- Create: `app/api/audit-batches/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { GET } from './route'
import { NextRequest } from 'next/server'

function req(url: string): NextRequest {
  return new NextRequest(url)
}

describe('GET /api/audit-batches', () => {
  beforeEach(async () => {
    await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://abtest-' } } })
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'abtest-' } } })
    await prisma.auditBatch.deleteMany({ where: { label: { startsWith: '__abtest__' } } })
  })

  it('excludes open batches', async () => {
    await prisma.auditBatch.create({ data: { label: '__abtest__open' } })
    await prisma.auditBatch.create({ data: { label: '__abtest__closed', closedAt: new Date() } })

    const res = await GET(req('http://localhost/api/audit-batches'))
    const json = await res.json() as { items: { label: string }[] }
    const ours = json.items.filter((i) => i.label.startsWith('__abtest__'))
    expect(ours.map((i) => i.label)).toEqual(['__abtest__closed'])
  })

  it('orders closed batches newest first by closedAt', async () => {
    const older = new Date('2026-05-12T00:00:00Z')
    const newer = new Date('2026-05-13T00:00:00Z')
    await prisma.auditBatch.create({ data: { label: '__abtest__older', closedAt: older, startedAt: older } })
    await prisma.auditBatch.create({ data: { label: '__abtest__newer', closedAt: newer, startedAt: newer } })

    const res = await GET(req('http://localhost/api/audit-batches'))
    const json = await res.json() as { items: { label: string }[] }
    const ours = json.items.filter((i) => i.label.startsWith('__abtest__'))
    expect(ours.map((i) => i.label)).toEqual(['__abtest__newer', '__abtest__older'])
  })

  it('derives counts from member SiteAudits', async () => {
    const b = await prisma.auditBatch.create({ data: { label: '__abtest__counts', closedAt: new Date() } })
    await prisma.siteAudit.create({ data: { domain: 'abtest-1.example', status: 'complete', wcagLevel: 'wcag21aa', batchId: b.id } })
    await prisma.siteAudit.create({ data: { domain: 'abtest-2.example', status: 'complete', wcagLevel: 'wcag21aa', batchId: b.id } })
    await prisma.siteAudit.create({ data: { domain: 'abtest-3.example', status: 'error', wcagLevel: 'wcag21aa', batchId: b.id } })

    const res = await GET(req('http://localhost/api/audit-batches'))
    const json = await res.json() as { items: { label: string; auditCount: number; completeCount: number; errorCount: number }[] }
    const ours = json.items.find((i) => i.label === '__abtest__counts')!
    expect(ours).toMatchObject({ auditCount: 3, completeCount: 2, errorCount: 1 })
  })

  it('paginates with page + pageSize and returns totalCount', async () => {
    for (let i = 0; i < 5; i++) {
      await prisma.auditBatch.create({
        data: {
          label: `__abtest__page-${i}`,
          closedAt: new Date(Date.now() - i * 1000),
        },
      })
    }
    const res = await GET(req('http://localhost/api/audit-batches?page=2&pageSize=2'))
    const json = await res.json() as { items: { label: string }[]; totalCount: number; page: number; pageSize: number }
    expect(json.page).toBe(2)
    expect(json.pageSize).toBe(2)
    expect(json.totalCount).toBeGreaterThanOrEqual(5)
    expect(json.items.length).toBeLessThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
npm test -- 'app/api/audit-batches/route.test'
```

Expected: FAIL ("Cannot find module './route'").

- [ ] **Step 3: Implement `app/api/audit-batches/route.ts`**

```ts
// app/api/audit-batches/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveBatchLabel } from '@/lib/ada-audit/audit-batch-helpers'
import type { AuditBatchSummary } from '@/lib/ada-audit/types'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const pageSizeRaw = parseInt(url.searchParams.get('pageSize') ?? '25', 10) || 25
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw))

  const where = { closedAt: { not: null } }

  const [batches, totalCount] = await Promise.all([
    prisma.auditBatch.findMany({
      where,
      orderBy: { closedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        siteAudits: { select: { status: true } },
      },
    }),
    prisma.auditBatch.count({ where }),
  ])

  const items: AuditBatchSummary[] = batches.map((b) => {
    const auditCount = b.siteAudits.length
    let completeCount = 0
    let errorCount = 0
    for (const m of b.siteAudits) {
      if (m.status === 'complete') completeCount++
      else if (m.status === 'error') errorCount++
    }
    return {
      id: b.id,
      startedAt: b.startedAt.toISOString(),
      closedAt: b.closedAt!.toISOString(),
      label: resolveBatchLabel(b),
      auditCount,
      completeCount,
      errorCount,
    }
  })

  return NextResponse.json({ items, totalCount, page, pageSize })
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- 'app/api/audit-batches/route.test'
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/audit-batches/route.ts app/api/audit-batches/route.test.ts
git commit -m "feat(ada-audit): GET /api/audit-batches paginated closed-batches list"
```

---

### Task 12: `GET /api/audit-batches/[id]` (one batch + members)

**Files:**
- Create: `app/api/audit-batches/[id]/route.ts`
- Create: `app/api/audit-batches/[id]/route.test.ts`

- [ ] **Step 1: Write the failing test (GET portion)**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { GET, PATCH } from './route'
import { NextRequest } from 'next/server'

function req(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, init)
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/audit-batches/[id]', () => {
  beforeEach(async () => {
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'abd-' } } })
    await prisma.auditBatch.deleteMany({ where: { label: { startsWith: '__abd__' } } })
  })

  it('returns 404 when not found', async () => {
    const res = await GET(req('http://localhost/api/audit-batches/nonexistent'), params('nonexistent'))
    expect(res.status).toBe(404)
  })

  it('returns the batch with its members ordered by createdAt ascending', async () => {
    const b = await prisma.auditBatch.create({ data: { label: '__abd__detail', closedAt: new Date() } })
    const first = await prisma.siteAudit.create({
      data: {
        domain: 'abd-first.example', status: 'complete', wcagLevel: 'wcag21aa',
        batchId: b.id, createdAt: new Date('2026-05-13T19:00:00Z'),
      },
    })
    const second = await prisma.siteAudit.create({
      data: {
        domain: 'abd-second.example', status: 'error', wcagLevel: 'wcag21aa',
        batchId: b.id, createdAt: new Date('2026-05-13T19:01:00Z'),
      },
    })

    const res = await GET(req(`http://localhost/api/audit-batches/${b.id}`), params(b.id))
    expect(res.status).toBe(200)
    const json = await res.json() as { id: string; members: { id: string; status: string }[] }
    expect(json.id).toBe(b.id)
    expect(json.members.map((m) => m.id)).toEqual([first.id, second.id])
    expect(json.members.map((m) => m.status)).toEqual(['complete', 'error'])
  })

  it('returns closedAt as null when the batch is open', async () => {
    const b = await prisma.auditBatch.create({ data: { label: '__abd__open' } })
    const res = await GET(req(`http://localhost/api/audit-batches/${b.id}`), params(b.id))
    const json = await res.json() as { closedAt: string | null }
    expect(json.closedAt).toBeNull()
  })
})

describe('PATCH /api/audit-batches/[id]', () => {
  beforeEach(async () => {
    await prisma.auditBatch.deleteMany({ where: { label: { startsWith: '__abp__' } } })
  })

  it('sets a label', async () => {
    const b = await prisma.auditBatch.create({ data: { label: '__abp__initial', closedAt: new Date() } })
    const res = await PATCH(
      req(`http://localhost/api/audit-batches/${b.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: '__abp__renamed' }),
      }),
      params(b.id),
    )
    expect(res.status).toBe(200)
    const after = await prisma.auditBatch.findUniqueOrThrow({ where: { id: b.id } })
    expect(after.label).toBe('__abp__renamed')
  })

  it('clears a label when given null', async () => {
    const b = await prisma.auditBatch.create({ data: { label: '__abp__clearme', closedAt: new Date() } })
    const res = await PATCH(
      req(`http://localhost/api/audit-batches/${b.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: null }),
      }),
      params(b.id),
    )
    expect(res.status).toBe(200)
    const after = await prisma.auditBatch.findUniqueOrThrow({ where: { id: b.id } })
    expect(after.label).toBeNull()
  })

  it('rejects labels longer than 200 chars with 400', async () => {
    const b = await prisma.auditBatch.create({ data: { label: '__abp__lengthcheck', closedAt: new Date() } })
    const res = await PATCH(
      req(`http://localhost/api/audit-batches/${b.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'x'.repeat(201) }),
      }),
      params(b.id),
    )
    expect(res.status).toBe(400)
  })

  it('rejects non-string non-null label with 400', async () => {
    const b = await prisma.auditBatch.create({ data: { label: '__abp__typecheck', closedAt: new Date() } })
    const res = await PATCH(
      req(`http://localhost/api/audit-batches/${b.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 42 }),
      }),
      params(b.id),
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 for missing batch', async () => {
    const res = await PATCH(
      req('http://localhost/api/audit-batches/nope', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'x' }),
      }),
      params('nope'),
    )
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
npm test -- 'app/api/audit-batches/\[id\]/route.test'
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `app/api/audit-batches/[id]/route.ts`**

```ts
// app/api/audit-batches/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveBatchLabel } from '@/lib/ada-audit/audit-batch-helpers'
import { computeScoreFromCounts } from '@/lib/ada-audit/scoring'
import type { AuditBatchDetail, AuditBatchMember } from '@/lib/ada-audit/types'

export const dynamic = 'force-dynamic'

const MAX_LABEL_LENGTH = 200

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const batch = await prisma.auditBatch.findUnique({
    where: { id },
    include: {
      siteAudits: {
        orderBy: { createdAt: 'asc' },
        include: { client: { select: { name: true } } },
      },
    },
  })

  if (!batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  }

  const members: AuditBatchMember[] = batch.siteAudits.map((m) => {
    let score: number | null = null
    if (m.status === 'complete' && m.summary) {
      try {
        const summary = JSON.parse(m.summary) as { aggregate?: unknown } | null
        const agg = summary?.aggregate
        if (agg) score = computeScoreFromCounts(agg as never, m.wcagLevel).score
      } catch {
        score = null
      }
    }
    return {
      id: m.id,
      domain: m.domain,
      clientId: m.clientId ?? null,
      clientName: m.client?.name ?? null,
      status: m.status,
      pagesTotal: m.pagesTotal,
      pagesComplete: m.pagesComplete,
      pagesError: m.pagesError,
      score,
      createdAt: m.createdAt.toISOString(),
    }
  })

  const response: AuditBatchDetail = {
    id: batch.id,
    startedAt: batch.startedAt.toISOString(),
    closedAt: batch.closedAt ? batch.closedAt.toISOString() : null,
    label: resolveBatchLabel(batch),
    members,
  }

  return NextResponse.json(response)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = (body as { label?: unknown })?.label
  let nextLabel: string | null
  if (raw === null) {
    nextLabel = null
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.length > MAX_LABEL_LENGTH) {
      return NextResponse.json({ error: `label must be ${MAX_LABEL_LENGTH} chars or fewer` }, { status: 400 })
    }
    nextLabel = trimmed === '' ? null : trimmed
  } else {
    return NextResponse.json({ error: 'label must be a string or null' }, { status: 400 })
  }

  const existing = await prisma.auditBatch.findUnique({ where: { id }, select: { id: true } })
  if (!existing) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  }

  const updated = await prisma.auditBatch.update({
    where: { id },
    data: { label: nextLabel },
    select: { id: true, label: true },
  })

  return NextResponse.json({ id: updated.id, label: updated.label })
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- 'app/api/audit-batches/\[id\]/route.test'
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/audit-batches/[id]/
git commit -m "feat(ada-audit): GET + PATCH /api/audit-batches/[id]"
```

---

### Task 13: Switch `POST /api/site-audit` to use `queueSiteAuditRequest`

**Files:**
- Modify: `app/api/site-audit/route.ts`

The existing POST handler has inline dup-guard logic. Replace with a call to the new shared helper.

- [ ] **Step 1: Read the current POST**

It's around lines 13-72 of `app/api/site-audit/route.ts`. Current flow: parse body → validate domain → check client → in-flight guard → enqueue.

- [ ] **Step 2: Replace the POST function**

```ts
export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = body as Record<string, unknown>
  const domain = typeof raw?.domain === 'string' ? raw.domain.trim() : ''
  const clientId = typeof raw?.clientId === 'number' ? raw.clientId : null
  const wcagLevel = typeof raw?.wcagLevel === 'string' && raw.wcagLevel === 'wcag22aa' ? 'wcag22aa' : 'wcag21aa'
  const rawPreDiscoveredUrls = Array.isArray(raw?.urls)
    ? (raw.urls as string[]).filter((u) => typeof u === 'string')
    : undefined

  if (clientId !== null) {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } })
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 400 })
    }
  }

  const result = await queueSiteAuditRequest({
    domain,
    clientId,
    wcagLevel,
    preDiscoveredUrls: rawPreDiscoveredUrls,
  })

  if (result.kind === 'invalid') {
    return NextResponse.json({ error: result.reason }, { status: 400 })
  }
  if (result.kind === 'duplicate') {
    // Read the in-flight row to surface the existing domain to clients that
    // care about backwards compatibility with the old 409 shape.
    const existing = await prisma.siteAudit.findUnique({
      where: { id: result.existingId },
      select: { domain: true },
    })
    return NextResponse.json(
      {
        error: `A site audit for ${existing?.domain ?? 'this domain'} is already queued or running`,
        id: result.existingId,
      },
      { status: 409 },
    )
  }
  return NextResponse.json({ id: result.id, status: 'queued' }, { status: 202 })
}
```

Add the new import at the top:

```ts
import { queueSiteAuditRequest } from '@/lib/ada-audit/queue-request'
```

(The existing `enqueueAudit` / `normaliseSiteAuditDomain` / `normaliseDiscoveredSiteAuditUrls` imports can be removed if the GET handler doesn't use them — verify.)

- [ ] **Step 3: Type-check + run all tests**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -5
```

Expected: tsc clean, all tests pass (including the new queue-request tests).

- [ ] **Step 4: Smoke test the POST**

```bash
DATABASE_URL='file:./prisma/local-dev.db' npx tsx -e "
import { POST } from './app/api/site-audit/route'
import { NextRequest } from 'next/server'

;(async () => {
  // Valid
  const a = await POST(new NextRequest('http://localhost/api/site-audit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'post-smoke.example' }),
  }))
  console.log('valid:', a.status, await a.json())

  // Bad domain
  const b = await POST(new NextRequest('http://localhost/api/site-audit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'not a domain' }),
  }))
  console.log('bad:  ', b.status, await b.json())
})()
"
```

Expected: first call returns 202 with `{ id, status: 'queued' }`. Second returns 400 with an error message.

- [ ] **Step 5: Commit**

```bash
git add app/api/site-audit/route.ts
git commit -m "refactor(ada-audit): POST /api/site-audit uses queueSiteAuditRequest helper"
```

---

### Task 14: `POST /api/site-audit/bulk-queue`

**Files:**
- Create: `app/api/site-audit/bulk-queue/route.ts`
- Create: `app/api/site-audit/bulk-queue/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { POST } from './route'
import { NextRequest } from 'next/server'

const req = (body: unknown = {}) =>
  new NextRequest('http://localhost/api/site-audit/bulk-queue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

async function deleteByPrefix(prefix: string) {
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: prefix } } })
  const clients = await prisma.client.findMany({ where: { name: { startsWith: prefix } }, select: { id: true } })
  if (clients.length) await prisma.client.deleteMany({ where: { id: { in: clients.map((c) => c.id) } } })
}

describe('POST /api/site-audit/bulk-queue', () => {
  beforeEach(async () => {
    await deleteByPrefix('bq-test-')
    // Also nuke any non-test clients we might create — but only by our prefix
  })

  it('returns 400 missing_domains when at least one client has no domain', async () => {
    await prisma.client.create({ data: { name: 'bq-test-with', domains: JSON.stringify(['bq-test-with.example']) } })
    await prisma.client.create({ data: { name: 'bq-test-without' /* domains defaults to "[]" */ } })

    const res = await POST(req())
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string; clientsWithoutDomains: { id: number; name: string }[] }
    expect(json.error).toBe('missing_domains')
    expect(json.clientsWithoutDomains.map((c) => c.name)).toContain('bq-test-without')
  })

  it('queues all clients when all have domains, returns queued list', async () => {
    await prisma.client.create({ data: { name: 'bq-test-a', domains: JSON.stringify(['bq-test-a.example']) } })
    await prisma.client.create({ data: { name: 'bq-test-b', domains: JSON.stringify(['bq-test-b.example']) } })

    const res = await POST(req())
    expect(res.status).toBe(200)
    const json = await res.json() as { queued: { clientId: number; auditId: string }[]; skipped: { clientId: number; reason: string }[] }
    expect(json.queued.length).toBe(2)
    expect(json.skipped.length).toBe(0)
  })

  it('marks duplicates as skipped without failing the whole batch', async () => {
    const c = await prisma.client.create({ data: { name: 'bq-test-dup', domains: JSON.stringify(['bq-test-dup.example']) } })
    // Pre-seed an in-flight audit for that domain
    await prisma.siteAudit.create({
      data: { domain: 'bq-test-dup.example', status: 'queued', wcagLevel: 'wcag21aa', clientId: c.id },
    })

    const res = await POST(req())
    expect(res.status).toBe(200)
    const json = await res.json() as { queued: unknown[]; skipped: { clientId: number; reason: string }[] }
    expect(json.queued.length).toBe(0)
    expect(json.skipped).toEqual([
      expect.objectContaining({ clientId: c.id, reason: expect.stringContaining('already') }),
    ])
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
npm test -- 'app/api/site-audit/bulk-queue'
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `app/api/site-audit/bulk-queue/route.ts`**

```ts
// app/api/site-audit/bulk-queue/route.ts
//
// "Queue all clients" — POSTed by the Clients section bulk button.
// Pre-flight: if ANY client has zero domains, refuse with 400 + the offending
// list so the operator can fix the data before queueing anything. Per-client
// duplicates (already in flight) are collected in the response's `skipped`
// list, not propagated as failures.

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { queueSiteAuditRequest } from '@/lib/ada-audit/queue-request'

export const dynamic = 'force-dynamic'

export async function POST() {
  const clients = await prisma.client.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, domains: true },
  })

  // Pre-check: any client without a domain triggers a hard 400 with the list.
  const clientsWithoutDomains: { id: number; name: string }[] = []
  const eligible: { id: number; name: string; firstDomain: string }[] = []
  for (const c of clients) {
    let domains: string[] = []
    try { domains = JSON.parse(c.domains) } catch { /* keep [] */ }
    const firstDomain = domains.find((d) => typeof d === 'string' && d.trim() !== '')
    if (!firstDomain) {
      clientsWithoutDomains.push({ id: c.id, name: c.name })
    } else {
      eligible.push({ id: c.id, name: c.name, firstDomain })
    }
  }

  if (clientsWithoutDomains.length > 0) {
    return NextResponse.json(
      { error: 'missing_domains', clientsWithoutDomains },
      { status: 400 },
    )
  }

  const queued: { clientId: number; auditId: string }[] = []
  const skipped: { clientId: number; reason: string }[] = []

  // Sequential rather than Promise.all so the open-batch logic and the
  // partial unique index don't see a thundering herd. ~30 clients is fast
  // enough sequentially.
  for (const c of eligible) {
    const result = await queueSiteAuditRequest({
      domain: c.firstDomain,
      clientId: c.id,
      wcagLevel: 'wcag21aa',
    })
    if (result.kind === 'queued') {
      queued.push({ clientId: c.id, auditId: result.id })
    } else if (result.kind === 'duplicate') {
      skipped.push({ clientId: c.id, reason: `already queued or running (audit ${result.existingId})` })
    } else {
      skipped.push({ clientId: c.id, reason: result.reason })
    }
  }

  return NextResponse.json({ queued, skipped })
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- 'app/api/site-audit/bulk-queue'
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/site-audit/bulk-queue/
git commit -m "feat(ada-audit): POST /api/site-audit/bulk-queue fail-loud on missing domains"
```

---

## Phase 4: Frontend — SiteAuditForm bug fix

### Task 15: Fix `selectClient` + add no-domain hint

**Files:**
- Modify: `components/ada-audit/SiteAuditForm.tsx`

- [ ] **Step 1: Replace the `selectClient` function**

Locate `selectClient` (around line 84). Replace with:

```tsx
function selectClient(client: Client | null) {
  setSelectedClient(client)
  setOpen(false)
  if (!client) {
    setQuery('')
    return
  }

  setQuery(client.name)
  if (client.domains.length > 0) {
    setDomain(client.domains[0].replace(/^https?:\/\//i, '').replace(/\/.*$/, ''))
    setDomainTouched(false)
  } else {
    // Picking a client with no domain shouldn't leave the previous client's
    // domain sitting in the input. Clear it; the no-domain hint guides the
    // user to /clients to fix it.
    setDomain('')
    setDomainTouched(false)
  }
}
```

- [ ] **Step 2: Add the no-domain hint under the domain input**

Find the domain input JSX (around line 235 — `<input ... onChange={(e) => { setDomain(e.target.value); setDomainTouched(true); resetDiscovery() }} />`). Add this block immediately after the input element (and after its closing `</div>` if the input is wrapped):

```tsx
{selectedClient && selectedClient.domains.length === 0 && (
  <p className="mt-1.5 text-[12px] font-body text-amber-700 dark:text-amber-400">
    This client has no domain configured.{' '}
    <Link href="/clients" className="text-orange hover:underline">Add one →</Link>
  </p>
)}
```

Add the import at the top of the file:

```tsx
import Link from 'next/link'
```

(If `next/link` is already imported, skip.)

- [ ] **Step 3: Type-check + smoke test**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/ada-audit/SiteAuditForm.tsx
git commit -m "fix(ada-audit): SiteAuditForm clears domain on no-domain client + hint"
```

---

## Phase 5: Frontend — Clients section

### Task 16: Per-row Queue audit button

**Files:**
- Modify: `components/ada-audit/ClientsAuditSummary.tsx`

The Clients section currently has an Action column with `View →`, `Run audit` (Link to form), or disabled tooltip. Replace `Run audit` (the Link) with an inline Queue button. For already-audited clients, **add** Queue alongside View.

- [ ] **Step 1: Add the queue-action state + handler at the top of the component**

Find the `export default function ClientsAuditSummary()` and after the existing state declarations (around `setLoading`/`setError`), add:

```tsx
const [queueingClientId, setQueueingClientId] = useState<number | null>(null)
const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

const queueClient = useCallback(async (client: ClientAuditSummary) => {
  if (!client.firstDomain) return  // disabled state covers this
  setQueueingClientId(client.clientId)
  try {
    const res = await fetch('/api/site-audit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: client.firstDomain, clientId: client.clientId }),
    })
    if (res.status === 202) {
      setToast({ kind: 'success', message: `Queued audit for ${client.clientName}` })
    } else if (res.status === 409) {
      setToast({ kind: 'error', message: `${client.clientName} already queued` })
    } else {
      const body = await res.json().catch(() => ({})) as { error?: string }
      setToast({ kind: 'error', message: body.error ?? `Couldn't queue audit (HTTP ${res.status})` })
    }
  } catch (e) {
    setToast({ kind: 'error', message: `Couldn't queue audit: ${(e as Error).message}` })
  } finally {
    setQueueingClientId(null)
    setTimeout(() => setToast(null), 4000)
  }
}, [])
```

- [ ] **Step 2: Replace the action-cell JSX**

Find the `<td className="px-6 py-3 text-right">` cell at the bottom of the row map (where `View →` / `Run audit` / disabled button currently render). Replace its contents with:

```tsx
<td className="px-6 py-3 text-right whitespace-nowrap">
  {la && (
    <Link
      href={`/ada-audit/site/${la.id}`}
      className="text-[12px] text-orange hover:underline mr-3"
    >
      View →
    </Link>
  )}
  {c.firstDomain ? (
    <button
      type="button"
      onClick={() => queueClient(c)}
      disabled={queueingClientId === c.clientId}
      className="text-[12px] text-orange hover:underline disabled:opacity-50 disabled:cursor-wait"
    >
      {queueingClientId === c.clientId ? 'Queueing…' : (la ? 'Re-queue' : 'Queue audit')}
    </button>
  ) : (
    <button
      type="button"
      disabled
      title="Add a domain on the Clients page to enable audits."
      className="text-[12px] text-navy/30 dark:text-white/30 cursor-not-allowed"
    >
      Queue audit
    </button>
  )}
</td>
```

- [ ] **Step 3: Render the toast inline (or use an existing toast pattern)**

Above the `<table>` (inside `<PaginatedSection>`), add:

```tsx
{toast && (
  <div className={`px-6 py-2 text-[12px] font-body ${
    toast.kind === 'success'
      ? 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400'
      : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
  }`}>
    {toast.message}
  </div>
)}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/ClientsAuditSummary.tsx
git commit -m "feat(ada-audit): per-row Queue audit button + toast"
```

---

### Task 17: In-flight chip on Clients rows (driven by `/api/site-audit/queue`)

**Files:**
- Modify: `components/ada-audit/ClientsAuditSummary.tsx`

- [ ] **Step 1: Add queue state + poller**

Inside `ClientsAuditSummary`, after the existing data fetch effect, add:

```tsx
import type { QueueStatusWithBatch } from '@/lib/ada-audit/types'

// …inside component:
const [queueStatus, setQueueStatus] = useState<QueueStatusWithBatch | null>(null)

useEffect(() => {
  const fetchQueue = async () => {
    try {
      const res = await fetch('/api/site-audit/queue')
      if (res.ok) setQueueStatus(await res.json() as QueueStatusWithBatch)
    } catch { /* silent — polls keep failing-tolerant */ }
  }
  void fetchQueue()
  const id = setInterval(fetchQueue, 30_000)
  return () => clearInterval(id)
}, [])

// Build a clientId -> status map for chip lookup
const inFlightByClient = useMemo(() => {
  const map = new Map<number, string>()
  if (queueStatus?.active?.clientId != null) {
    // Translate 'pdfs-running' / 'running' into a label-friendly string later
    map.set(queueStatus.active.clientId, queueStatus.active.id ? statusForActive(queueStatus.active) : 'running')
  }
  for (const q of queueStatus?.queued ?? []) {
    if (q.clientId != null) map.set(q.clientId, 'queued')
  }
  return map
}, [queueStatus])

function statusForActive(active: NonNullable<QueueStatusWithBatch['active']>): string {
  // The queue endpoint doesn't carry the literal SiteAudit.status for the
  // active row, so we can't distinguish running vs pdfs-running here.
  // Default to 'running' — the Active tab on /ada-audit/queue is where you
  // see the finer detail.
  return 'running'
}
```

- [ ] **Step 2: Add the `ChipForStatus` helper (top of file, near `ScoreBadge`)**

```tsx
function ChipForStatus({ status }: { status: string | undefined }) {
  if (!status) return null
  const label = status === 'queued' ? 'Queued' : status === 'running' ? 'Running' : status === 'pdfs-running' ? 'Scanning PDFs' : status
  const color =
    status === 'queued'
      ? 'bg-gray-100 dark:bg-gray-500/15 text-gray-700 dark:text-gray-300'
      : 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
  return (
    <span className={`text-[11px] font-body font-semibold px-2 py-0.5 rounded ml-2 ${color}`}>
      {label}
    </span>
  )
}
```

- [ ] **Step 3: Render the chip next to the score column**

Find the `<td className="px-6 py-3"><ScoreBadge ... /></td>`. Replace with:

```tsx
<td className="px-6 py-3">
  <ScoreBadge score={la?.score ?? null} />
  <ChipForStatus status={inFlightByClient.get(c.clientId)} />
</td>
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/ClientsAuditSummary.tsx
git commit -m "feat(ada-audit): in-flight chip on Clients rows driven by /queue polling"
```

---

### Task 18: `BulkQueueModal` component

**Files:**
- Create: `components/ada-audit/BulkQueueModal.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'

interface ClientWithoutDomain {
  id: number
  name: string
}

interface QueuedEntry {
  clientId: number
  auditId: string
}

interface SkippedEntry {
  clientId: number
  reason: string
}

interface Props {
  open: boolean
  eligibleCount: number
  clientsById: Map<number, string>  // clientId → name, for skip-list display
  onClose: () => void
  onConfirmed: (queued: QueuedEntry[], skipped: SkippedEntry[]) => void
}

type Phase =
  | { kind: 'confirm' }
  | { kind: 'missing'; clients: ClientWithoutDomain[] }
  | { kind: 'running' }
  | { kind: 'done'; queued: QueuedEntry[]; skipped: SkippedEntry[] }

export default function BulkQueueModal({ open, eligibleCount, clientsById, onClose, onConfirmed }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' })

  if (!open) return null

  const submit = async () => {
    setPhase({ kind: 'running' })
    try {
      const res = await fetch('/api/site-audit/bulk-queue', { method: 'POST' })
      if (res.status === 400) {
        const body = await res.json() as { clientsWithoutDomains?: ClientWithoutDomain[] }
        setPhase({ kind: 'missing', clients: body.clientsWithoutDomains ?? [] })
        return
      }
      if (res.ok) {
        const body = await res.json() as { queued: QueuedEntry[]; skipped: SkippedEntry[] }
        setPhase({ kind: 'done', queued: body.queued, skipped: body.skipped })
        onConfirmed(body.queued, body.skipped)
        return
      }
      setPhase({ kind: 'done', queued: [], skipped: [{ clientId: -1, reason: `Server error (HTTP ${res.status})` }] })
    } catch (e) {
      setPhase({ kind: 'done', queued: [], skipped: [{ clientId: -1, reason: (e as Error).message }] })
    }
  }

  const close = () => {
    setPhase({ kind: 'confirm' })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
      <div
        className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-xl max-w-lg w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 dark:border-navy-border">
          <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">
            {phase.kind === 'confirm' && 'Queue all clients'}
            {phase.kind === 'missing' && 'Missing domains'}
            {phase.kind === 'running' && 'Queueing…'}
            {phase.kind === 'done' && 'Queue results'}
          </h2>
        </div>

        <div className="p-6 space-y-3">
          {phase.kind === 'confirm' && (
            <p className="font-body text-[13px] text-navy dark:text-white">
              Queue audits for <strong>{eligibleCount}</strong> clients? Each audit runs with wcag21aa.
            </p>
          )}

          {phase.kind === 'missing' && (
            <>
              <p className="font-body text-[13px] text-navy dark:text-white">
                These clients have no domain configured. Add a domain for each, then try again.
              </p>
              <ul className="space-y-1">
                {phase.clients.map((c) => (
                  <li key={c.id} className="text-[13px] font-body text-navy dark:text-white">
                    <Link href={`/clients`} className="text-orange hover:underline">{c.name}</Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          {phase.kind === 'running' && (
            <p className="font-body text-[13px] text-navy/60 dark:text-white/60">
              Queueing audits sequentially…
            </p>
          )}

          {phase.kind === 'done' && (
            <>
              <p className="font-body text-[13px] text-navy dark:text-white">
                Queued <strong>{phase.queued.length}</strong>, skipped <strong>{phase.skipped.length}</strong>.
              </p>
              {phase.skipped.length > 0 && (
                <ul className="space-y-1 text-[12px] font-body text-navy/70 dark:text-white/70">
                  {phase.skipped.map((s, i) => (
                    <li key={i}>
                      <span className="font-semibold">{clientsById.get(s.clientId) ?? `client #${s.clientId}`}:</span> {s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-navy-border flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="text-[12px] font-body text-navy/70 dark:text-white/70 hover:text-orange"
          >
            {phase.kind === 'done' || phase.kind === 'missing' ? 'Close' : 'Cancel'}
          </button>
          {phase.kind === 'confirm' && (
            <button
              type="button"
              onClick={submit}
              className="text-[12px] font-body font-semibold text-white bg-orange hover:bg-orange/90 rounded-md px-3 py-1.5"
            >
              Queue {eligibleCount} audits
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/ada-audit/BulkQueueModal.tsx
git commit -m "feat(ada-audit): BulkQueueModal with confirm + missing + result phases"
```

---

### Task 19: Wire Queue all + View queue links into Clients section header

**Files:**
- Modify: `components/ada-audit/ClientsAuditSummary.tsx`

- [ ] **Step 1: Add modal state**

Inside `ClientsAuditSummary` (top of component, with other state):

```tsx
const [bulkModalOpen, setBulkModalOpen] = useState(false)
```

- [ ] **Step 2: Add the import**

At the top of the file:

```tsx
import BulkQueueModal from './BulkQueueModal'
```

- [ ] **Step 3: Replace the `trailing` JSX**

Find the existing `const trailing = (...)` block (the search input). Replace with:

```tsx
const clientsById = useMemo(() => {
  const m = new Map<number, string>()
  for (const c of data ?? []) m.set(c.clientId, c.clientName)
  return m
}, [data])

const eligibleCount = (data ?? []).filter((c) => c.firstDomain).length

const trailing = (
  <div className="flex items-center gap-3">
    <input
      type="text"
      value={searchInput}
      onChange={(e) => setSearchInput(e.target.value)}
      placeholder="Search clients by name"
      className="bg-white dark:bg-navy-deep border border-gray-200 dark:border-navy-border rounded-md px-3 py-1.5 text-[12px] font-body w-56"
    />
    <button
      type="button"
      onClick={() => setBulkModalOpen(true)}
      disabled={eligibleCount === 0}
      className="text-[12px] font-body font-semibold text-orange hover:underline disabled:opacity-50"
    >
      Queue all
    </button>
    <Link
      href="/ada-audit/queue"
      className="text-[12px] font-body font-semibold text-orange hover:underline"
    >
      View queue →
    </Link>
  </div>
)
```

- [ ] **Step 4: Render `BulkQueueModal` inside the component's return**

Before the closing tag of the outermost element returned from the component (or after `<PaginatedSection>`), insert:

```tsx
<BulkQueueModal
  open={bulkModalOpen}
  eligibleCount={eligibleCount}
  clientsById={clientsById}
  onClose={() => setBulkModalOpen(false)}
  onConfirmed={() => { void fetchClients(false) }}
/>
```

(`fetchClients` is the existing data fetcher in this component — confirm the name when editing.)

- [ ] **Step 5: Type-check + browser smoke**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/ada-audit/ClientsAuditSummary.tsx
git commit -m "feat(ada-audit): Queue all + View queue header controls"
```

---

## Phase 6: Frontend — Queue page

### Task 20: Route shell + tabs

**Files:**
- Create: `app/ada-audit/queue/page.tsx`
- Create: `components/ada-audit/QueuePageTabs.tsx`

- [ ] **Step 1: Write `app/ada-audit/queue/page.tsx`**

```tsx
// app/ada-audit/queue/page.tsx
import QueuePageTabs from '@/components/ada-audit/QueuePageTabs'

export const dynamic = 'force-dynamic'

export default function QueuePage() {
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="font-display font-bold text-2xl text-navy dark:text-white">Audit Queue</h1>
        <p className="text-[13px] font-body text-navy/60 dark:text-white/60 mt-1">
          Monitor the current batch and review past ones.
        </p>
      </header>
      <QueuePageTabs />
    </div>
  )
}
```

- [ ] **Step 2: Write `components/ada-audit/QueuePageTabs.tsx`**

```tsx
'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import QueueActiveView from './QueueActiveView'
import QueueHistoryView from './QueueHistoryView'

type Tab = 'active' | 'history'

function parseTab(value: string | null): Tab {
  return value === 'history' ? 'history' : 'active'
}

export default function QueuePageTabs() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const tab = parseTab(searchParams.get('tab'))

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'active') params.delete('tab')
    else params.set('tab', next)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Queue view" className="inline-flex items-center bg-gray-100 dark:bg-navy-light rounded-lg p-0.5 gap-0.5">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'active'}
          onClick={() => setTab('active')}
          className={`px-3 py-1.5 text-[12px] font-body font-semibold rounded-md transition-colors ${
            tab === 'active'
              ? 'bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm'
              : 'text-navy/50 dark:text-white/50 hover:text-navy dark:hover:text-white'
          }`}
        >
          Active
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          onClick={() => setTab('history')}
          className={`px-3 py-1.5 text-[12px] font-body font-semibold rounded-md transition-colors ${
            tab === 'history'
              ? 'bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm'
              : 'text-navy/50 dark:text-white/50 hover:text-navy dark:hover:text-white'
          }`}
        >
          History
        </button>
      </div>

      {tab === 'active' ? <QueueActiveView /> : <QueueHistoryView />}
    </div>
  )
}
```

- [ ] **Step 3: Commit (placeholder — components don't exist yet, TS will error)**

We'll commit at the end of Task 22 when both child views exist.

---

### Task 21: `QueueMemberRow` + `QueueActiveView`

**Files:**
- Create: `components/ada-audit/QueueMemberRow.tsx`
- Create: `components/ada-audit/QueueActiveView.tsx`

- [ ] **Step 1: Write `QueueMemberRow.tsx`**

```tsx
'use client'

import Link from 'next/link'
import type { AuditBatchMember } from '@/lib/ada-audit/types'

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  pending: 'Pending',
  running: 'Running',
  'pdfs-running': 'Scanning PDFs',
  complete: 'Complete',
  error: 'Error',
}

const STATUS_COLOR: Record<string, string> = {
  queued: 'bg-gray-100 dark:bg-gray-500/15 text-gray-700 dark:text-gray-300',
  pending: 'bg-gray-100 dark:bg-gray-500/15 text-gray-700 dark:text-gray-300',
  running: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400',
  'pdfs-running': 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400',
  complete: 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400',
  error: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400',
}

export default function QueueMemberRow({ member }: { member: AuditBatchMember }) {
  return (
    <tr className="border-b border-gray-50 dark:border-navy-border/50 hover:bg-gray-50/50 dark:hover:bg-navy-deep/30">
      <td className="px-6 py-3 font-body text-[13px] text-navy dark:text-white">
        <Link href={`/ada-audit/site/${member.id}`} className="hover:text-orange">
          {member.domain}
        </Link>
      </td>
      <td className="px-6 py-3 font-body text-[12px] text-navy/60 dark:text-white/60">
        {member.clientName ?? '—'}
      </td>
      <td className="px-6 py-3">
        <span className={`text-[11px] font-body font-semibold px-2 py-0.5 rounded ${STATUS_COLOR[member.status] ?? STATUS_COLOR.queued}`}>
          {STATUS_LABEL[member.status] ?? member.status}
        </span>
      </td>
      <td className="px-6 py-3 font-body text-[12px] text-navy/60 dark:text-white/60">
        {member.pagesComplete}/{member.pagesTotal}
        {member.pagesError > 0 ? ` (${member.pagesError} errored)` : ''}
      </td>
      <td className="px-6 py-3 font-body text-[12px] text-navy dark:text-white">
        {member.score ?? '—'}
      </td>
    </tr>
  )
}
```

- [ ] **Step 2: Write `QueueActiveView.tsx`**

```tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import QueueMemberRow from './QueueMemberRow'
import type { AuditBatchDetail, QueueStatusWithBatch } from '@/lib/ada-audit/types'

const POLL_MS = 5_000

const STATUS_RANK: Record<string, number> = {
  running: 0,
  'pdfs-running': 1,
  queued: 2,
  pending: 2,
  complete: 3,
  error: 4,
}

export default function QueueActiveView() {
  const [batchId, setBatchId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AuditBatchDetail | null>(null)
  const [closedToast, setClosedToast] = useState<string | null>(null)
  const lastSeenBatchId = useRef<string | null>(null)

  // Poll /api/site-audit/queue — the open batch field is the trigger.
  const tick = useCallback(async () => {
    try {
      const res = await fetch('/api/site-audit/queue')
      if (!res.ok) return
      const status = await res.json() as QueueStatusWithBatch
      const incomingId = status.batch?.id ?? null

      if (lastSeenBatchId.current && !incomingId) {
        // Edge: open → null. Batch just closed.
        setClosedToast(`Batch complete`)
        // Briefly freeze the final state so the operator can see it, then
        // transition to the empty state. Spec §Active tab.
        setTimeout(() => {
          setClosedToast(null)
          setDetail(null)
        }, 5000)
        // Fetch one last detail (now closed) so the freeze frame is accurate.
        const finalRes = await fetch(`/api/audit-batches/${lastSeenBatchId.current}`)
        if (finalRes.ok) setDetail(await finalRes.json() as AuditBatchDetail)
        setBatchId(null)
      } else if (incomingId) {
        setBatchId(incomingId)
      } else {
        setBatchId(null)
        setDetail(null)
      }
      lastSeenBatchId.current = incomingId
    } catch { /* silent — polling is best-effort */ }
  }, [])

  useEffect(() => { void tick() }, [tick])
  useEffect(() => {
    const id = setInterval(() => void tick(), POLL_MS)
    return () => clearInterval(id)
  }, [tick])

  // Fetch batch detail whenever the open batch id is set
  useEffect(() => {
    if (!batchId) return
    let cancelled = false
    const fetchDetail = async () => {
      try {
        const res = await fetch(`/api/audit-batches/${batchId}`)
        if (!res.ok) return
        const json = await res.json() as AuditBatchDetail
        if (!cancelled) setDetail(json)
      } catch { /* ignore */ }
    }
    void fetchDetail()
    const id = setInterval(fetchDetail, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [batchId])

  if (!batchId && !detail) {
    return (
      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl p-6 text-center font-body text-[13px] text-navy/60 dark:text-white/60">
        No audits in flight. Queue some from <a href="/ada-audit" className="text-orange hover:underline">/ada-audit</a>.
      </div>
    )
  }

  const sortedMembers = (detail?.members ?? []).slice().sort((a, b) => {
    const ra = STATUS_RANK[a.status] ?? 99
    const rb = STATUS_RANK[b.status] ?? 99
    if (ra !== rb) return ra - rb
    return a.createdAt.localeCompare(b.createdAt)
  })

  const counts = (detail?.members ?? []).reduce(
    (acc, m) => {
      if (m.status === 'queued' || m.status === 'pending') acc.queued++
      else if (m.status === 'running' || m.status === 'pdfs-running') acc.running++
      else if (m.status === 'complete') acc.complete++
      else if (m.status === 'error') acc.errored++
      return acc
    },
    { queued: 0, running: 0, complete: 0, errored: 0 },
  )

  return (
    <div className="space-y-3">
      {closedToast && (
        <div className="bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 text-[12px] font-body px-4 py-2 rounded-md">
          {closedToast}
        </div>
      )}
      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
          <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">
            {detail?.label ?? 'Current batch'}
          </h2>
          <p className="text-[12px] font-body text-navy/50 dark:text-white/50 mt-1">
            {counts.queued} queued · {counts.running} running · {counts.complete} complete · {counts.errored} errored
          </p>
        </div>
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-navy-deep">
            <tr className="border-b border-gray-100 dark:border-navy-border">
              <th className="text-left px-6 py-2 text-[11px] uppercase tracking-wider font-body font-semibold text-navy/50 dark:text-white/50">Domain</th>
              <th className="text-left px-6 py-2 text-[11px] uppercase tracking-wider font-body font-semibold text-navy/50 dark:text-white/50">Client</th>
              <th className="text-left px-6 py-2 text-[11px] uppercase tracking-wider font-body font-semibold text-navy/50 dark:text-white/50">Status</th>
              <th className="text-left px-6 py-2 text-[11px] uppercase tracking-wider font-body font-semibold text-navy/50 dark:text-white/50">Pages</th>
              <th className="text-left px-6 py-2 text-[11px] uppercase tracking-wider font-body font-semibold text-navy/50 dark:text-white/50">Score</th>
            </tr>
          </thead>
          <tbody>
            {sortedMembers.map((m) => <QueueMemberRow key={m.id} member={m} />)}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/ada-audit/QueueMemberRow.tsx components/ada-audit/QueueActiveView.tsx
git commit -m "feat(ada-audit): QueueActiveView with 5s poll + close-edge toast"
```

---

### Task 22: `QueueBatchRow` + `QueueHistoryView`

**Files:**
- Create: `components/ada-audit/QueueBatchRow.tsx`
- Create: `components/ada-audit/QueueHistoryView.tsx`

- [ ] **Step 1: Write `QueueBatchRow.tsx`**

```tsx
'use client'

import { useState } from 'react'
import QueueMemberRow from './QueueMemberRow'
import type { AuditBatchDetail, AuditBatchSummary } from '@/lib/ada-audit/types'

function formatDuration(startedAt: string, closedAt: string): string {
  const ms = new Date(closedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function QueueBatchRow({ batch }: { batch: AuditBatchSummary }) {
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<AuditBatchDetail | null>(null)
  const [editing, setEditing] = useState(false)
  const [labelDraft, setLabelDraft] = useState(batch.label)
  const [labelDisplay, setLabelDisplay] = useState(batch.label)
  const [saveError, setSaveError] = useState<string | null>(null)

  const expand = async () => {
    setExpanded((v) => !v)
    if (!detail) {
      try {
        const res = await fetch(`/api/audit-batches/${batch.id}`)
        if (res.ok) setDetail(await res.json() as AuditBatchDetail)
      } catch { /* leave detail null */ }
    }
  }

  const saveLabel = async () => {
    const next = labelDraft.trim()
    setSaveError(null)
    try {
      const res = await fetch(`/api/audit-batches/${batch.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: next === '' ? null : next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setSaveError(body.error ?? `HTTP ${res.status}`)
        return
      }
      setLabelDisplay(next === '' ? labelDisplay : next)
      setEditing(false)
    } catch (e) {
      setSaveError((e as Error).message)
    }
  }

  return (
    <div className="border-b border-gray-100 dark:border-navy-border">
      <div className="flex items-center gap-3 px-6 py-3">
        <button
          type="button"
          onClick={expand}
          className="text-navy/40 dark:text-white/40 hover:text-orange w-4 text-[12px]"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={saveLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveLabel()
                if (e.key === 'Escape') { setEditing(false); setLabelDraft(labelDisplay) }
              }}
              className="font-body text-[14px] bg-white dark:bg-navy-deep border border-gray-200 dark:border-navy-border rounded px-2 py-0.5 w-full max-w-sm"
            />
          ) : (
            <button
              type="button"
              onClick={() => { setEditing(true); setLabelDraft(labelDisplay) }}
              className="font-body text-[14px] text-navy dark:text-white text-left hover:text-orange truncate"
              title="Click to rename"
            >
              {labelDisplay}
            </button>
          )}
          <p className="text-[11px] font-body text-navy/40 dark:text-white/40">
            Started {formatTime(batch.startedAt)} · Closed {formatTime(batch.closedAt)} ({formatDuration(batch.startedAt, batch.closedAt)})
          </p>
          {saveError && (
            <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">{saveError}</p>
          )}
        </div>
        <div className="text-[12px] font-body text-navy/60 dark:text-white/60 whitespace-nowrap">
          {batch.auditCount} audits · {batch.completeCount} complete{batch.errorCount > 0 ? ` · ${batch.errorCount} errored` : ''}
        </div>
      </div>
      {expanded && (
        <div className="bg-gray-50/50 dark:bg-navy-deep/30">
          {detail ? (
            <table className="w-full">
              <tbody>
                {detail.members.map((m) => <QueueMemberRow key={m.id} member={m} />)}
              </tbody>
            </table>
          ) : (
            <div className="px-6 py-4 text-[12px] font-body text-navy/50 dark:text-white/50">Loading…</div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Write `QueueHistoryView.tsx`**

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import PaginatedSection from './PaginatedSection'
import QueueBatchRow from './QueueBatchRow'
import type { AuditBatchSummary, PaginatedResponse } from '@/lib/ada-audit/types'

const PAGE_SIZE = 25

export default function QueueHistoryView() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const page = Math.max(1, parseInt(searchParams.get('historyPage') ?? '1', 10) || 1)

  const [data, setData] = useState<PaginatedResponse<AuditBatchSummary> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPage = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch(`/api/audit-batches?page=${page}&pageSize=${PAGE_SIZE}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as PaginatedResponse<AuditBatchSummary>
      setData(json)
      setError(null)
    } catch (e) {
      if (data === null) setError(e instanceof Error ? e.message : 'Failed to load batches')
      else console.warn('[QueueHistoryView] reload failed:', e)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [page, data])

  useEffect(() => { void fetchPage(false) }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const setPage = useCallback((next: number) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 1) params.delete('historyPage')
    else params.set('historyPage', String(next))
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [router, searchParams])

  const items = data?.items ?? []
  const totalCount = data?.totalCount ?? 0

  return (
    <PaginatedSection
      title="Past batches"
      rowCount={totalCount}
      pageSize={PAGE_SIZE}
      page={page}
      onPageChange={setPage}
      loading={loading}
      error={error}
      onRetry={() => void fetchPage(false)}
      empty="No closed batches yet."
    >
      <div>
        {items.map((b) => <QueueBatchRow key={b.id} batch={b} />)}
      </div>
    </PaginatedSection>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/ada-audit/queue/page.tsx components/ada-audit/QueuePageTabs.tsx components/ada-audit/QueueBatchRow.tsx components/ada-audit/QueueHistoryView.tsx
git commit -m "feat(ada-audit): /ada-audit/queue page with Active + History tabs"
```

---

## Phase 7: Acceptance and ship

### Task 23: Full acceptance pass

- [ ] **Step 1: Run all tests**

```bash
npm test 2>&1 | tail -10
```

Expected: every test passes. Roughly +20 new tests (helpers + queue-request + 3 route test files + queue-manager extensions).

- [ ] **Step 2: Type-check + lint + build**

```bash
npx tsc --noEmit && npm run lint && npm run build 2>&1 | tail -15
```

Expected: all green.

- [ ] **Step 3: Local manual sweep**

```bash
npm run dev
```

Visit `http://localhost:3000/ada-audit` and verify each of:

1. Clients section header shows `Queue all` + `View queue →`.
2. Click `Queue audit` on a client with a domain → toast appears. Reload `/ada-audit/queue` → row appears in the Active tab.
3. Click `Queue all` while at least one client has no domain → modal switches to the missing-domains list, no audits queued.
4. Click `Queue all` when all clients have domains → confirmation modal; confirm; result panel shows queued + skipped (skipped only if any were already in flight).
5. Visit `/ada-audit/queue` (default `?tab=active`) → renders current batch with sorted members. Status updates every 5s.
6. When the last in-flight member completes, the Active tab surfaces a `Batch complete` toast and then transitions to the empty state.
7. `?tab=history` → list of closed batches paginates at 25. Each batch row expands to show members. Click the label → inline edit → blur saves. Reload → label persists.
8. From the Clients section, click `Queue audit` for an already-queued client → `<client> already queued` toast.
9. SiteAuditForm bug: open `/ada-audit`, switch to Full Site tab, pick a client with no domain → input clears + amber hint appears under it with a `/clients` link.

- [ ] **Step 4: Push branch**

```bash
git push -u origin feat/audit-queue-batches
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --title "feat(ada-audit): audit queue batches + Clients section quick-queue" --body "$(cat <<'EOF'
## Summary

- **`AuditBatch` model** with a SQLite partial unique index enforcing at most one open batch at the DB level. `enqueueAudit` attaches to the open batch (creating one with P2002 race retry).
- **`closeBatchIfDrained`** wired into `finalizeSiteAudit` (success path), `runAudit` error path, and the `resetStaleAudits` / `recoverQueue` paths — every place a SiteAudit transitions to a terminal state.
- **`queueSiteAuditRequest` shared helper** extracts the in-flight dup guard (now including `pdfs-running`) from the single POST handler so the new bulk-queue endpoint can reuse it.
- **New endpoints**:
  - `GET /api/audit-batches` (paginated closed batches)
  - `GET /api/audit-batches/[id]` (one batch + members)
  - `PATCH /api/audit-batches/[id]` (label edit, ≤200 chars)
  - `POST /api/site-audit/bulk-queue` (fail-loud on missing domains)
- **`GET /api/site-audit/queue`** response gains `clientId` per row + `batch` field (additive — existing callers unaffected).
- **Clients section** gains per-row `Queue audit` button + header `Queue all` + `View queue →`. In-flight chip on each row driven by the queue endpoint.
- **`/ada-audit/queue`** page with `Active` (5s polled, close-edge toast) and `History` (paginated, expandable rows, inline label edit) tabs.
- **`SiteAuditForm` bug fix**: `selectClient` now always updates the domain field (clearing if the client has none) and shows an amber `/clients` deep-link hint.

## Test plan

- [x] `npx tsc --noEmit` clean
- [x] `npm test` (~20 new tests pass)
- [x] `npm run lint` + `npm run build` clean
- [ ] Manual sweep on prod: queue a single audit, watch it appear in `/ada-audit/queue?tab=active`, watch it transition to History when complete.
- [ ] Verify the partial unique index by hammering enqueue from two parallel scripts; observe one open batch.
- [ ] Rename a past batch's label; reload; persists.

Spec: \`docs/superpowers/specs/2026-05-13-audit-queue-batches-design.md\`
Plan: \`docs/superpowers/plans/2026-05-13-audit-queue-batches.md\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: After review/merge, deploy**

```bash
ssh seo@144.126.213.242 "~/deploy.sh"
```

Verify on prod: hit `/ada-audit`, run `Queue audit` on a real client, watch the Active tab populate, watch it close into History.

---

## Reference: Environment variables introduced

None. The feature is entirely DB-backed.

## Reference: URL search params introduced

| Param | Component | Notes |
|---|---|---|
| `tab` | `QueuePageTabs` | `active \| history`. Omitted = `active`. |
| `historyPage` | `QueueHistoryView` | Omitted = 1. |
