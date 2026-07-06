// lib/jobs/introspection.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { getJobQueueState, getCleanupStats } from './introspection'

async function clearTestJobs() {
  await prisma.job.deleteMany({ where: { type: { startsWith: 'test-' } } })
}

describe('jobs/introspection', () => {
  beforeEach(clearTestJobs)

  it('reports per-type/status counts, oldest running, recent failures', async () => {
    await prisma.job.create({ data: { type: 'test-intro', status: 'queued' } })
    await prisma.job.create({
      data: { type: 'test-intro', status: 'running', startedAt: new Date('2026-01-01') },
    })
    await prisma.job.create({
      data: { type: 'test-intro', status: 'error', lastError: 'kaput', completedAt: new Date() },
    })
    const state = await getJobQueueState()
    expect(state.counts['test-intro']).toMatchObject({ queued: 1, running: 1, error: 1 })
    expect(state.oldestRunning?.type).toBe('test-intro')
    expect(state.recentFailures.some((f) => f.lastError === 'kaput')).toBe(true)
  })
})

describe('getCleanupStats', () => {
  it('maps the newest job row per maintenance type (status + error + completedAt)', async () => {
    const spy = vi.spyOn(prisma.job, 'findFirst').mockImplementation((async (args: { where: { type: string } }) => {
      if (args.where.type === 'cleanup') {
        return { completedAt: new Date('2026-07-05T09:00:00Z'), status: 'complete', lastError: null }
      }
      if (args.where.type === 'db-backup') {
        return { completedAt: new Date('2026-07-05T08:00:00Z'), status: 'error', lastError: 'disk full' }
      }
      return null // no run yet for the other types
    }) as never)

    const rows = await getCleanupStats()

    // findFirst called once per maintenance type, ordered by completedAt desc.
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { completedAt: 'desc' } }))

    const cleanup = rows.find((r) => r.type === 'cleanup')!
    expect(cleanup.lastStatus).toBe('complete')
    expect(cleanup.lastError).toBeNull()
    expect(cleanup.lastCompletedAt?.toISOString()).toBe('2026-07-05T09:00:00.000Z')

    const backup = rows.find((r) => r.type === 'db-backup')!
    expect(backup.lastStatus).toBe('error')
    expect(backup.lastError).toBe('disk full')

    const swept = rows.find((r) => r.type === 'screenshot-sweep')!
    expect(swept.lastCompletedAt).toBeNull()
    expect(swept.lastStatus).toBeNull()

    spy.mockRestore()
  })
})
