// lib/jobs/queue.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { enqueueJob, cancelJobsByGroup, countActiveJobsByGroup } from './queue'

async function clearTestJobs() {
  await prisma.job.deleteMany({ where: { type: { startsWith: 'test-' } } })
}

describe('jobs/queue', () => {
  beforeEach(clearTestJobs)

  it('enqueues a job with payload, group, priority, runAfter', async () => {
    const runAfter = new Date(Date.now() + 60_000)
    const res = await enqueueJob({
      type: 'test-q', payload: { a: 1 }, groupKey: 'g1', priority: 5, runAfter, maxAttempts: 7,
    })
    expect(res.deduped).toBe(false)
    const row = await prisma.job.findUnique({ where: { id: res.id } })
    expect(row?.status).toBe('queued')
    expect(JSON.parse(row!.payload)).toEqual({ a: 1 })
    expect(row?.groupKey).toBe('g1')
    expect(row?.priority).toBe(5)
    expect(row?.maxAttempts).toBe(7)
    expect(row?.runAfter.getTime()).toBe(runAfter.getTime())
  })

  it('dedups an active job by (type, dedupKey)', async () => {
    const first = await enqueueJob({ type: 'test-q', dedupKey: 'k1' })
    const second = await enqueueJob({ type: 'test-q', dedupKey: 'k1' })
    expect(second).toEqual({ id: first.id, deduped: true })
    expect(await prisma.job.count({ where: { type: 'test-q' } })).toBe(1)
  })

  it('dedup window reopens after terminal status', async () => {
    const first = await enqueueJob({ type: 'test-q', dedupKey: 'k1' })
    await prisma.job.update({ where: { id: first.id }, data: { status: 'complete' } })
    const second = await enqueueJob({ type: 'test-q', dedupKey: 'k1' })
    expect(second.deduped).toBe(false)
    expect(second.id).not.toBe(first.id)
  })

  it('running jobs still dedup (active window covers queued + running)', async () => {
    const first = await enqueueJob({ type: 'test-q', dedupKey: 'k1' })
    await prisma.job.update({ where: { id: first.id }, data: { status: 'running' } })
    const second = await enqueueJob({ type: 'test-q', dedupKey: 'k1' })
    expect(second).toEqual({ id: first.id, deduped: true })
  })

  it('scheduled slot uniqueness survives terminal status', async () => {
    const slot = new Date('2026-06-10T03:00:00Z')
    const first = await enqueueJob({ type: 'test-q', scheduleId: 'sch1', scheduledFor: slot })
    await prisma.job.update({ where: { id: first.id }, data: { status: 'complete' } })
    const replay = await enqueueJob({ type: 'test-q', scheduleId: 'sch1', scheduledFor: slot })
    expect(replay).toEqual({ id: first.id, deduped: true })
    expect(await prisma.job.count({ where: { scheduleId: 'sch1' } })).toBe(1)
  })

  it('cancelJobsByGroup cancels queued rows only', async () => {
    const q = await enqueueJob({ type: 'test-q', groupKey: 'g2' })
    const r = await enqueueJob({ type: 'test-q', groupKey: 'g2', dedupKey: 'distinct' })
    await prisma.job.update({ where: { id: r.id }, data: { status: 'running' } })
    const count = await cancelJobsByGroup('g2')
    expect(count).toBe(1)
    expect((await prisma.job.findUnique({ where: { id: q.id } }))?.status).toBe('cancelled')
    expect((await prisma.job.findUnique({ where: { id: r.id } }))?.status).toBe('running')
  })

  it('countActiveJobsByGroup counts queued+running incl. backoff-delayed, excludes terminal', async () => {
    await enqueueJob({ type: 'test-q', groupKey: 'g3', runAfter: new Date(Date.now() + 3_600_000) })
    const r = await enqueueJob({ type: 'test-q', groupKey: 'g3', dedupKey: 'r' })
    await prisma.job.update({ where: { id: r.id }, data: { status: 'running' } })
    const done = await enqueueJob({ type: 'test-q', groupKey: 'g3', dedupKey: 'done' })
    await prisma.job.update({ where: { id: done.id }, data: { status: 'error' } })
    expect(await countActiveJobsByGroup('g3')).toBe(2)
  })
})
