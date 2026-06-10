// lib/jobs/introspection.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { getJobQueueState } from './introspection'

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
