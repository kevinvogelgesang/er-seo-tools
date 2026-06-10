// lib/jobs/scheduler.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { parseCadence, nextRun, tickSchedules } from './scheduler'

async function clearTestState() {
  await prisma.job.deleteMany({ where: { type: { startsWith: 'test-' } } })
  await prisma.schedule.deleteMany({ where: { jobType: { startsWith: 'test-' } } })
}

describe('jobs/scheduler', () => {
  beforeEach(clearTestState)

  describe('parseCadence', () => {
    it('accepts the grammar', () => {
      expect(parseCadence('every:30m')).toEqual({ kind: 'every', ms: 30 * 60_000 })
      expect(parseCadence('every:6h')).toEqual({ kind: 'every', ms: 6 * 3_600_000 })
      expect(parseCadence('every:1d')).toEqual({ kind: 'every', ms: 86_400_000 })
      expect(parseCadence('daily@03:30')).toEqual({ kind: 'daily', hour: 3, minute: 30 })
      expect(parseCadence('weekly:1@09:00')).toEqual({ kind: 'weekly', dow: 1, hour: 9, minute: 0 })
    })

    it('throws on garbage', () => {
      for (const bad of ['hourly', 'every:0m', 'every:5s', 'daily@25:00', 'daily@10:75', 'weekly:7@09:00', '']) {
        expect(() => parseCadence(bad), bad).toThrow()
      }
    })
  })

  describe('nextRun', () => {
    it('every: is pure ms arithmetic from `from`', () => {
      const from = new Date('2026-06-10T10:00:00')
      expect(nextRun('every:30m', from).getTime()).toBe(from.getTime() + 30 * 60_000)
    })

    it('daily: next occurrence strictly after `from`', () => {
      const before = new Date('2026-06-10T02:00:00')
      expect(nextRun('daily@03:30', before).toISOString()).toBe(new Date('2026-06-10T03:30:00').toISOString())
      const after = new Date('2026-06-10T04:00:00')
      expect(nextRun('daily@03:30', after).toISOString()).toBe(new Date('2026-06-11T03:30:00').toISOString())
    })

    it('weekly: next matching day-of-week strictly after `from`', () => {
      // 2026-06-10 is a Wednesday (dow 3)
      const wed = new Date('2026-06-10T10:00:00')
      const nextMon = nextRun('weekly:1@09:00', wed)
      expect(nextMon.getDay()).toBe(1)
      expect(nextMon.getTime()).toBeGreaterThan(wed.getTime())
      const sameDayLater = nextRun('weekly:3@23:00', wed)
      expect(sameDayLater.toISOString()).toBe(new Date('2026-06-10T23:00:00').toISOString())
    })
  })

  describe('tickSchedules', () => {
    it('enqueues due schedules with slot keys and advances nextRunAt', async () => {
      const due = new Date(Date.now() - 60_000)
      const sched = await prisma.schedule.create({
        data: { jobType: 'test-sched', payload: '{"d":1}', cadence: 'every:30m', nextRunAt: due },
      })
      await tickSchedules()
      const jobs = await prisma.job.findMany({ where: { scheduleId: sched.id } })
      expect(jobs).toHaveLength(1)
      expect(jobs[0].type).toBe('test-sched')
      expect(JSON.parse(jobs[0].payload)).toEqual({ d: 1 })
      expect(jobs[0].scheduledFor!.getTime()).toBe(due.getTime())
      expect(jobs[0].groupKey).toBe(`schedule:${sched.id}`)
      const fresh = await prisma.schedule.findUnique({ where: { id: sched.id } })
      expect(fresh!.nextRunAt.getTime()).toBeGreaterThan(Date.now())
      expect(fresh!.lastJobId).toBe(jobs[0].id)
      expect(fresh!.lastRunAt).not.toBeNull()
    })

    it('skips disabled and not-yet-due schedules', async () => {
      await prisma.schedule.create({
        data: { jobType: 'test-sched', cadence: 'every:30m', nextRunAt: new Date(Date.now() - 60_000), enabled: false },
      })
      await prisma.schedule.create({
        data: { jobType: 'test-sched', cadence: 'every:30m', nextRunAt: new Date(Date.now() + 3_600_000) },
      })
      await tickSchedules()
      expect(await prisma.job.count({ where: { type: 'test-sched' } })).toBe(0)
    })

    it('crash-replay of a slot is exactly-once even when the first job completed', async () => {
      const slot = new Date(Date.now() - 60_000)
      const sched = await prisma.schedule.create({
        data: { jobType: 'test-sched', cadence: 'every:30m', nextRunAt: slot },
      })
      // Simulate: previous tick enqueued the slot, job completed, then the
      // process died BEFORE nextRunAt was advanced.
      const orphan = await prisma.job.create({
        data: { type: 'test-sched', status: 'complete', scheduleId: sched.id, scheduledFor: slot },
      })
      await tickSchedules()
      expect(await prisma.job.count({ where: { scheduleId: sched.id } })).toBe(1) // no duplicate
      const fresh = await prisma.schedule.findUnique({ where: { id: sched.id } })
      expect(fresh!.nextRunAt.getTime()).toBeGreaterThan(slot.getTime()) // still advanced
      expect(fresh!.lastJobId).toBe(orphan.id)
    })

    it('missed slots collapse to a single future run (advance from now, not the slot)', async () => {
      const longAgo = new Date(Date.now() - 7 * 86_400_000)
      const sched = await prisma.schedule.create({
        data: { jobType: 'test-sched', cadence: 'every:1d', nextRunAt: longAgo },
      })
      await tickSchedules()
      expect(await prisma.job.count({ where: { scheduleId: sched.id } })).toBe(1)
      const fresh = await prisma.schedule.findUnique({ where: { id: sched.id } })
      expect(fresh!.nextRunAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('concurrent ticks produce one job and one advance', async () => {
      const sched = await prisma.schedule.create({
        data: { jobType: 'test-sched', cadence: 'every:30m', nextRunAt: new Date(Date.now() - 60_000) },
      })
      await Promise.all([tickSchedules(), tickSchedules()])
      expect(await prisma.job.count({ where: { scheduleId: sched.id } })).toBe(1)
    })
  })
})
