// lib/services/seo-reports.test.ts
//
// DB-backed tests for the seo-reports service.
// Run with: DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/seo-reports.test.ts

import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { isClientEligible, createBatchWithReports } from './seo-reports'
import type { DateWindow } from '@/lib/analytics/dates'

const PREFIX = 't14-seo-rep-'

// IDs accumulated per test — cleaned up in afterEach
const createdClientIds: number[] = []
const createdBatchIds: string[] = []
const createdScheduleIds: string[] = []

afterEach(async () => {
  // Clean reports + batches first (FK order)
  if (createdBatchIds.length > 0) {
    await prisma.seoReport.deleteMany({ where: { batchId: { in: createdBatchIds } } })
    await prisma.seoReportBatch.deleteMany({ where: { id: { in: createdBatchIds } } })
    createdBatchIds.length = 0
  }
  if (createdScheduleIds.length > 0) {
    await prisma.schedule.deleteMany({ where: { id: { in: createdScheduleIds } } })
    createdScheduleIds.length = 0
  }
  if (createdClientIds.length > 0) {
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } })
    createdClientIds.length = 0
  }
})

// ── helpers ──────────────────────────────────────────────────────────────────

async function makeClient(suffix: string, overrides: { archivedAt?: Date | null; ga4PropertyId?: string | null; gscSiteUrl?: string | null } = {}) {
  const client = await prisma.client.create({
    data: {
      name: `${PREFIX}${suffix}`,
      ...overrides,
    },
  })
  createdClientIds.push(client.id)
  return client
}

const PERIOD: DateWindow = {
  start: new Date('2026-05-01T00:00:00Z'),
  end: new Date('2026-05-31T00:00:00Z'),
}

// ── isClientEligible ─────────────────────────────────────────────────────────

describe('isClientEligible', () => {
  it('returns true when not archived and has ga4PropertyId', () => {
    expect(isClientEligible({ archivedAt: null, ga4PropertyId: 'properties/123', gscSiteUrl: null })).toBe(true)
  })

  it('returns true when not archived and has gscSiteUrl', () => {
    expect(isClientEligible({ archivedAt: null, ga4PropertyId: null, gscSiteUrl: 'sc-domain:example.com' })).toBe(true)
  })

  it('returns true when not archived and has both ga4 and gsc', () => {
    expect(isClientEligible({ archivedAt: null, ga4PropertyId: 'properties/456', gscSiteUrl: 'https://example.com/' })).toBe(true)
  })

  it('returns false when archived (even with analytics mapped)', () => {
    expect(isClientEligible({ archivedAt: new Date(), ga4PropertyId: 'properties/123', gscSiteUrl: 'sc-domain:example.com' })).toBe(false)
  })

  it('returns false when neither ga4 nor gsc is mapped', () => {
    expect(isClientEligible({ archivedAt: null, ga4PropertyId: null, gscSiteUrl: null })).toBe(false)
  })
})

// ── createBatchWithReports ───────────────────────────────────────────────────

describe('createBatchWithReports — manual trigger', () => {
  it('creates one batch + one report per clientId and returns all ids', async () => {
    const c1 = await makeClient('c1')
    const c2 = await makeClient('c2')

    const result = await createBatchWithReports({
      trigger: 'manual',
      clientIds: [c1.id, c2.id],
      period: PERIOD,
      comparisonMode: 'prev_period',
      createdBy: 'test-user',
    })

    createdBatchIds.push(result.batchId)

    expect(result.batchId).toBeTruthy()
    expect(result.reportIds).toHaveLength(2)

    // Verify DB state
    const batch = await prisma.seoReportBatch.findUnique({ where: { id: result.batchId } })
    expect(batch).not.toBeNull()
    expect(batch!.trigger).toBe('manual')
    expect(batch!.totalReports).toBe(2)
    expect(batch!.comparisonMode).toBe('prev_period')
    // prev_period of May 2026 (31 days) → Apr 1–30 2026
    expect(batch!.comparisonStart.toISOString()).toBe('2026-03-31T00:00:00.000Z')
    expect(batch!.comparisonEnd.toISOString()).toBe('2026-04-30T00:00:00.000Z')

    const reports = await prisma.seoReport.findMany({ where: { batchId: result.batchId } })
    expect(reports).toHaveLength(2)
    expect(reports.map((r) => r.id).sort()).toEqual([...result.reportIds].sort())
    expect(reports.every((r) => r.status === 'queued')).toBe(true)
  })

  it('returns correct comparison dates for prev_year mode', async () => {
    const c = await makeClient('c3')

    const result = await createBatchWithReports({
      trigger: 'manual',
      clientIds: [c.id],
      period: PERIOD,
      comparisonMode: 'prev_year',
    })

    createdBatchIds.push(result.batchId)

    const batch = await prisma.seoReportBatch.findUnique({ where: { id: result.batchId } })
    // prev_year of May 2026 → May 2025
    expect(batch!.comparisonStart.toISOString()).toBe('2025-05-01T00:00:00.000Z')
    expect(batch!.comparisonEnd.toISOString()).toBe('2025-05-31T00:00:00.000Z')
  })
})

// ── idempotency: scheduled trigger ──────────────────────────────────────────

describe('createBatchWithReports — scheduled idempotency', () => {
  it('second call with same (scheduleId, scheduledFor) returns existing batch + report ids, no duplicates', async () => {
    const c1 = await makeClient('idem-c1')
    const c2 = await makeClient('idem-c2')

    // Create a Schedule row so the FK is valid
    const schedule = await prisma.schedule.create({
      data: {
        jobType: 'seo-report',
        cadence: 'monthly:1@06:00',
        payload: '{}',
        nextRunAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    createdScheduleIds.push(schedule.id)

    const scheduledFor = new Date('2026-06-01T06:00:00Z')

    const input = {
      trigger: 'scheduled' as const,
      scheduleId: schedule.id,
      scheduledFor,
      clientIds: [c1.id, c2.id],
      period: PERIOD,
      comparisonMode: 'prev_period' as const,
    }

    // First call
    const first = await createBatchWithReports(input)
    createdBatchIds.push(first.batchId)

    // Second call — same slot
    const second = await createBatchWithReports(input)

    // Must return the same batchId
    expect(second.batchId).toBe(first.batchId)

    // Report ids must match (same set, possibly different order)
    expect([...second.reportIds].sort()).toEqual([...first.reportIds].sort())

    // DB: only one batch, only two reports
    const batchCount = await prisma.seoReportBatch.count({ where: { id: first.batchId } })
    expect(batchCount).toBe(1)

    const reportCount = await prisma.seoReport.count({ where: { batchId: first.batchId } })
    expect(reportCount).toBe(2)
  })
})
