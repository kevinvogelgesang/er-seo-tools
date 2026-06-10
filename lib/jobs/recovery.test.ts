// lib/jobs/recovery.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { registerJobHandler, clearJobRegistryForTests } from './registry'
import { recoverJobsOnStartup, sweepStaleJobs } from './recovery'

async function clearTestJobs() {
  await prisma.job.deleteMany({ where: { type: { startsWith: 'test-' } } })
}

describe('jobs/recovery', () => {
  beforeEach(async () => {
    clearJobRegistryForTests()
    await clearTestJobs()
  })

  it('startup re-queues running jobs with attempts left', async () => {
    const job = await prisma.job.create({
      data: { type: 'test-rec', status: 'running', attempts: 1, maxAttempts: 3, heartbeatAt: new Date() },
    })
    await recoverJobsOnStartup()
    const row = await prisma.job.findUnique({ where: { id: job.id } })
    expect(row?.status).toBe('queued')
    expect(row?.attempts).toBe(1) // next claim increments
    expect(row?.lastError).toContain('restart')
    expect(row?.heartbeatAt).toBeNull()
  })

  it('startup fails exhausted running jobs and fires onExhausted', async () => {
    const onExhausted = vi.fn(async () => {})
    registerJobHandler({ type: 'test-rec', concurrency: 1, handler: async () => {}, onExhausted })
    const job = await prisma.job.create({
      data: { type: 'test-rec', payload: '{"k":1}', status: 'running', attempts: 3, maxAttempts: 3 },
    })
    await recoverJobsOnStartup()
    expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe('error')
    expect(onExhausted).toHaveBeenCalledWith({ k: 1 }, expect.objectContaining({ jobId: job.id, attempts: 3 }))
  })

  it('startup leaves queued/terminal jobs alone', async () => {
    const q = await prisma.job.create({ data: { type: 'test-rec', status: 'queued' } })
    const c = await prisma.job.create({ data: { type: 'test-rec', status: 'complete' } })
    await recoverJobsOnStartup()
    expect((await prisma.job.findUnique({ where: { id: q.id } }))?.status).toBe('queued')
    expect((await prisma.job.findUnique({ where: { id: c.id } }))?.status).toBe('complete')
  })

  it('stale sweep recovers only stale-heartbeat running jobs', async () => {
    const stale = await prisma.job.create({
      data: { type: 'test-rec', status: 'running', attempts: 1, maxAttempts: 3, heartbeatAt: new Date(Date.now() - 3 * 60_000) },
    })
    const fresh = await prisma.job.create({
      data: { type: 'test-rec', status: 'running', attempts: 1, maxAttempts: 3, heartbeatAt: new Date() },
    })
    await sweepStaleJobs()
    expect((await prisma.job.findUnique({ where: { id: stale.id } }))?.status).toBe('queued')
    expect((await prisma.job.findUnique({ where: { id: fresh.id } }))?.status).toBe('running')
  })

  it('stale sweep fails exhausted jobs with onExhausted', async () => {
    const onExhausted = vi.fn(async () => {})
    registerJobHandler({ type: 'test-rec', concurrency: 1, handler: async () => {}, onExhausted })
    const stale = await prisma.job.create({
      data: { type: 'test-rec', status: 'running', attempts: 3, maxAttempts: 3, heartbeatAt: new Date(Date.now() - 3 * 60_000) },
    })
    await sweepStaleJobs()
    expect((await prisma.job.findUnique({ where: { id: stale.id } }))?.status).toBe('error')
    expect(onExhausted).toHaveBeenCalled()
  })
})
