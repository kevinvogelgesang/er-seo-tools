import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { closeBatchIfDrained, ensureOpenBatch, resolveBatchLabel, summarizeOperators } from './audit-batch-helpers'

async function clearTestState() {
  // Test-DB isolation: close any lingering open batches so each test can
  // create one without hitting the partial unique index. Non-destructive —
  // we close, not delete.
  await prisma.auditBatch.updateMany({
    where: { closedAt: null },
    data: { closedAt: new Date() },
  })
  // Clean test-prefixed rows
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'test-batch-' } } })
  await prisma.auditBatch.deleteMany({ where: { label: { startsWith: '__test__' } } })
}

describe('summarizeOperators', () => {
  it('returns unknown for empty', () => expect(summarizeOperators([])).toBe('unknown'))
  it('returns the single operator', () =>
    expect(summarizeOperators([{ requestedBy: 'Alice' }])).toBe('Alice'))
  it('all null/blank → unknown', () =>
    expect(summarizeOperators([{ requestedBy: null }, { requestedBy: '  ' }])).toBe('unknown'))
  it('lead by count, deterministic tie-break by name asc', () =>
    expect(summarizeOperators([{ requestedBy: 'Bob' }, { requestedBy: 'Alice' }])).toBe('Alice +1'))
  it('unknown sorts last on tie', () =>
    expect(summarizeOperators([{ requestedBy: null }, { requestedBy: 'Alice' }])).toBe('Alice +1'))
})

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
  beforeEach(clearTestState)

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

describe('ensureOpenBatch', () => {
  beforeEach(clearTestState)

  it('creates a new open batch when none exists', async () => {
    const id = await ensureOpenBatch()
    expect(typeof id).toBe('string')
    const batch = await prisma.auditBatch.findUnique({ where: { id } })
    expect(batch?.closedAt).toBeNull()
  })

  it('returns the existing open batch when one exists', async () => {
    const first = await ensureOpenBatch()
    const second = await ensureOpenBatch()
    expect(second).toBe(first)
  })

  it('opens a new batch after the previous one closes', async () => {
    const first = await ensureOpenBatch()
    await prisma.auditBatch.update({ where: { id: first }, data: { closedAt: new Date() } })
    const second = await ensureOpenBatch()
    expect(second).not.toBe(first)
    const batch = await prisma.auditBatch.findUnique({ where: { id: second } })
    expect(batch?.closedAt).toBeNull()
  })
})
