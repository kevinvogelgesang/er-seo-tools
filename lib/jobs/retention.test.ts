// lib/jobs/retention.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { cleanOldTerminalJobs } from './retention'

const TYPE = 'test-retention'
const DAY = 24 * 60 * 60 * 1000

async function clearTestState() {
  await prisma.job.deleteMany({ where: { type: { startsWith: 'test-' } } })
  await prisma.schedule.deleteMany({ where: { jobType: { startsWith: 'test-' } } })
}

async function makeJob(
  status: string,
  ageDays: number,
  extra: Partial<Prisma.JobUncheckedCreateInput> = {},
): Promise<string> {
  const job = await prisma.job.create({ data: { type: TYPE, status, ...extra } })
  await prisma.$executeRaw`UPDATE "Job" SET "updatedAt" = ${Date.now() - ageDays * DAY} WHERE "id" = ${job.id}`
  return job.id
}

async function survives(id: string): Promise<boolean> {
  return (await prisma.job.findUnique({ where: { id } })) !== null
}

describe('cleanOldTerminalJobs', () => {
  beforeEach(clearTestState)

  it('deletes old complete/cancelled, keeps young ones', async () => {
    const oldComplete = await makeJob('complete', 8)
    const oldCancelled = await makeJob('cancelled', 8)
    const youngComplete = await makeJob('complete', 6)
    await cleanOldTerminalJobs()
    expect(await survives(oldComplete)).toBe(false)
    expect(await survives(oldCancelled)).toBe(false)
    expect(await survives(youngComplete)).toBe(true)
  })

  it('keeps errors under 30 days, deletes older', async () => {
    const youngError = await makeJob('error', 8)
    const oldError = await makeJob('error', 31)
    await cleanOldTerminalJobs()
    expect(await survives(youngError)).toBe(true)
    expect(await survives(oldError)).toBe(false)
  })

  it('never touches queued or running rows', async () => {
    const queued = await makeJob('queued', 60)
    const running = await makeJob('running', 60)
    await cleanOldTerminalJobs()
    expect(await survives(queued)).toBe(true)
    expect(await survives(running)).toBe(true)
  })

  it('keeps a job referenced by Schedule.lastJobId', async () => {
    const id = await makeJob('complete', 60)
    await prisma.schedule.create({
      data: { jobType: TYPE, cadence: 'every:10m', nextRunAt: new Date(), lastJobId: id },
    })
    await cleanOldTerminalJobs()
    expect(await survives(id)).toBe(true)
  })

  it("keeps a job holding its schedule's current nextRunAt slot, deletes other slots", async () => {
    const slot = new Date('2026-06-01T00:00:00Z')
    const sched = await prisma.schedule.create({
      data: { jobType: TYPE, cadence: 'every:10m', nextRunAt: slot },
    })
    const slotJob = await makeJob('complete', 60, { scheduleId: sched.id, scheduledFor: slot })
    const otherSlotJob = await makeJob('complete', 60, {
      scheduleId: sched.id,
      scheduledFor: new Date('2026-05-01T00:00:00Z'),
    })
    await cleanOldTerminalJobs()
    expect(await survives(slotJob)).toBe(true)
    expect(await survives(otherSlotJob)).toBe(false)
  })
})
