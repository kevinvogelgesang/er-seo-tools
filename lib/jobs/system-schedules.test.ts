// lib/jobs/system-schedules.test.ts
//
// Global-state discipline: these tests create REAL system-* Schedule rows
// and real-typed Job rows in the shared dev DB — clearTestState deletes
// both, plus the usual test-* rows, in beforeEach AND afterEach so other
// test files' tickSchedules() calls never see leftover system schedules.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { seedSystemSchedules, SYSTEM_SCHEDULES } from './system-schedules'
import { tickSchedules, nextRun } from './scheduler'

const SYSTEM_TYPES = SYSTEM_SCHEDULES.map((s) => s.jobType)

async function clearTestState() {
  await prisma.job.deleteMany({ where: { type: { in: [...SYSTEM_TYPES, 'test-sys-retired'] } } })
  await prisma.job.deleteMany({ where: { type: { startsWith: 'test-' } } })
  await prisma.schedule.deleteMany({ where: { name: { startsWith: 'system-' } } })
  await prisma.schedule.deleteMany({ where: { jobType: { startsWith: 'test-' } } })
}

describe('seedSystemSchedules', () => {
  beforeEach(clearTestState)
  afterEach(clearTestState)

  it('creates all system schedules; cleanup starts at its next slot, the rest immediately', async () => {
    const now = new Date()
    await seedSystemSchedules(now)
    const rows = await prisma.schedule.findMany({ where: { name: { startsWith: 'system-' } } })
    expect(rows).toHaveLength(SYSTEM_SCHEDULES.length)
    for (const expected of SYSTEM_SCHEDULES) {
      const row = rows.find((r) => r.name === expected.name)!
      expect(row.jobType).toBe(expected.jobType)
      expect(row.cadence).toBe(expected.cadence)
      expect(row.enabled).toBe(true)
    }
    const sweep = rows.find((r) => r.name === 'system-screenshot-sweep')!
    const staleReset = rows.find((r) => r.name === 'system-stale-audit-reset')!
    const cleanup = rows.find((r) => r.name === 'system-cleanup')!
    expect(sweep.nextRunAt.getTime()).toBeLessThanOrEqual(now.getTime())
    expect(staleReset.nextRunAt.getTime()).toBeLessThanOrEqual(now.getTime())
    expect(cleanup.nextRunAt.getTime()).toBeGreaterThan(now.getTime())
    // D0: db-backup is non-immediate (next daily slot), health-alert is immediate.
    const backup = rows.find((r) => r.name === 'system-db-backup')!
    const alert = rows.find((r) => r.name === 'system-health-alert')!
    expect(backup.nextRunAt.getTime()).toBeGreaterThan(now.getTime())
    expect(alert.nextRunAt.getTime()).toBeLessThanOrEqual(now.getTime())
  })

  it('seeds system-robots-monitor weekly, not immediate (D5)', async () => {
    const fixedNow = new Date('2026-01-13T12:00:00Z') // A Tuesday
    await seedSystemSchedules(fixedNow)
    const rows = await prisma.schedule.findMany({ where: { name: { startsWith: 'system-' } } })
    const monitor = rows.find((r) => r.name === 'system-robots-monitor')!
    expect(monitor).toBeDefined()
    expect(monitor.jobType).toBe('robots-monitor-sweep')
    expect(monitor.cadence).toBe('weekly:1@06:30')
    expect(monitor.enabled).toBe(true)
    // immediate:false -> nextRunAt is a FUTURE weekly:1@06:30 slot, never now
    const expectedNext = nextRun('weekly:1@06:30', fixedNow)
    expect(monitor.nextRunAt.getTime()).toBe(expectedNext.getTime())
    expect(monitor.nextRunAt.getTime()).toBeGreaterThan(fixedNow.getTime())
    expect(monitor.nextRunAt.getDay()).toBe(1) // Monday, server-local
  })

  it('seeds system-client-sweep weekly, not immediate (D8)', async () => {
    const fixedNow = new Date('2026-01-13T12:00:00Z') // A Tuesday
    await seedSystemSchedules(fixedNow)
    const rows = await prisma.schedule.findMany({ where: { name: { startsWith: 'system-' } } })
    const sweep = rows.find((r) => r.name === 'system-client-sweep')!
    expect(sweep).toBeDefined()
    expect(sweep.jobType).toBe('client-sweep')
    expect(sweep.cadence).toBe('weekly:1@01:00')
    expect(sweep.enabled).toBe(true)
    // immediate:false -> nextRunAt is a FUTURE weekly:1@01:00 slot, never now
    const expectedNext = nextRun('weekly:1@01:00', fixedNow)
    expect(sweep.nextRunAt.getTime()).toBe(expectedNext.getTime())
    expect(sweep.nextRunAt.getTime()).toBeGreaterThan(fixedNow.getTime())
    expect(sweep.nextRunAt.getDay()).toBe(1) // Monday, server-local
  })

  it('seeds system-sweep-digest weekly, not immediate (D8)', async () => {
    const fixedNow = new Date('2026-01-13T12:00:00Z') // A Tuesday
    await seedSystemSchedules(fixedNow)
    const rows = await prisma.schedule.findMany({ where: { name: { startsWith: 'system-' } } })
    const digest = rows.find((r) => r.name === 'system-sweep-digest')!
    expect(digest).toBeDefined()
    expect(digest.jobType).toBe('sweep-digest')
    expect(digest.cadence).toBe('weekly:1@14:00')
    expect(digest.enabled).toBe(true)
    // immediate:false -> nextRunAt is a FUTURE weekly:1@14:00 slot, never now
    const expectedNext = nextRun('weekly:1@14:00', fixedNow)
    expect(digest.nextRunAt.getTime()).toBe(expectedNext.getTime())
    expect(digest.nextRunAt.getTime()).toBeGreaterThan(fixedNow.getTime())
    expect(digest.nextRunAt.getDay()).toBe(1) // Monday, server-local
  })

  it('seeds system-viewbook-digest every 15 minutes and immediately', async () => {
    const now = new Date('2026-07-16T12:00:00Z')
    await seedSystemSchedules(now)
    const digest = await prisma.schedule.findUniqueOrThrow({ where: { name: 'system-viewbook-digest' } })
    expect(digest.jobType).toBe('viewbook-digest')
    expect(digest.cadence).toBe('every:15m')
    expect(digest.nextRunAt.getTime()).toBeLessThanOrEqual(now.getTime())
  })

  it('re-seed is idempotent: no duplicates, nextRunAt preserved when cadence unchanged', async () => {
    await seedSystemSchedules()
    const before = await prisma.schedule.findMany({ where: { name: { startsWith: 'system-' } } })
    await seedSystemSchedules()
    const after = await prisma.schedule.findMany({ where: { name: { startsWith: 'system-' } } })
    expect(after).toHaveLength(before.length)
    for (const b of before) {
      const a = after.find((r) => r.id === b.id)!
      expect(a.nextRunAt.getTime()).toBe(b.nextRunAt.getTime())
    }
  })

  it('recomputes nextRunAt when the stored cadence differs', async () => {
    await seedSystemSchedules()
    const past = new Date(Date.now() - 60 * 60 * 1000)
    await prisma.schedule.update({
      where: { name: 'system-screenshot-sweep' },
      data: { cadence: 'every:5m', nextRunAt: past },
    })
    const now = new Date()
    await seedSystemSchedules(now)
    const row = await prisma.schedule.findUnique({ where: { name: 'system-screenshot-sweep' } })
    expect(row!.cadence).toBe('every:30m')
    expect(row!.nextRunAt.getTime()).toBe(now.getTime() + 30 * 60_000)
  })

  it('refreshes payload and re-enables a manually disabled row', async () => {
    await seedSystemSchedules()
    await prisma.schedule.update({
      where: { name: 'system-cleanup' },
      data: { enabled: false, payload: '{"drifted":true}' },
    })
    await seedSystemSchedules()
    const row = await prisma.schedule.findUnique({ where: { name: 'system-cleanup' } })
    expect(row!.enabled).toBe(true)
    expect(row!.payload).toBe('{}')
  })

  it('disables retired system-* schedules and cancels their queued jobs', async () => {
    const retired = await prisma.schedule.create({
      data: {
        name: 'system-retired-thing',
        jobType: 'test-sys-retired',
        cadence: 'every:10m',
        nextRunAt: new Date(),
      },
    })
    const queued = await prisma.job.create({
      data: { type: 'test-sys-retired', status: 'queued', scheduleId: retired.id },
    })
    const running = await prisma.job.create({
      data: { type: 'test-sys-retired', status: 'running', scheduleId: retired.id },
    })
    await seedSystemSchedules()
    const schedRow = await prisma.schedule.findUnique({ where: { id: retired.id } })
    expect(schedRow!.enabled).toBe(false)
    expect((await prisma.job.findUnique({ where: { id: queued.id } }))!.status).toBe('cancelled')
    expect((await prisma.job.findUnique({ where: { id: running.id } }))!.status).toBe('running')
  })

  it('concurrent seeding still yields exactly one row per schedule', async () => {
    const now = new Date()
    await Promise.all([seedSystemSchedules(now), seedSystemSchedules(now)])
    const rows = await prisma.schedule.findMany({ where: { name: { startsWith: 'system-' } } })
    expect(rows).toHaveLength(SYSTEM_SCHEDULES.length)
  })

  it('leaves NULL-name schedules alone', async () => {
    const adHoc = await prisma.schedule.create({
      data: { jobType: 'test-adhoc', cadence: 'every:10m', nextRunAt: new Date() },
    })
    await seedSystemSchedules()
    const row = await prisma.schedule.findUnique({ where: { id: adHoc.id } })
    expect(row!.enabled).toBe(true)
  })

  it('integration: tickSchedules enqueues one job per due system schedule', async () => {
    await seedSystemSchedules()
    const past = new Date(Date.now() - 60_000)
    await prisma.schedule.updateMany({
      where: { name: { startsWith: 'system-' } },
      data: { nextRunAt: past },
    })
    await tickSchedules()
    for (const s of SYSTEM_SCHEDULES) {
      const sched = await prisma.schedule.findUnique({ where: { name: s.name } })
      const jobs = await prisma.job.findMany({ where: { scheduleId: sched!.id } })
      expect(jobs).toHaveLength(1)
      expect(jobs[0].type).toBe(s.jobType)
      expect(jobs[0].status).toBe('queued')
    }
  })
})
