// lib/jobs/worker.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { registerJobHandler, clearJobRegistryForTests } from './registry'
import { enqueueJob } from './queue'
import { runWorkerTickOnce, getActiveJobCounts, resetWorkerForTests, backoffMs } from './worker'

async function clearTestJobs() {
  await prisma.job.deleteMany({ where: { type: { startsWith: 'test-' } } })
}

function deferred() {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function waitFor(predicate: () => Promise<boolean>, tries = 40): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await predicate()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('waitFor timed out')
}

describe('jobs/worker', () => {
  beforeEach(async () => {
    clearJobRegistryForTests()
    resetWorkerForTests()
    await clearTestJobs()
  })

  it('backoffMs doubles per attempt and caps at 15 min', () => {
    expect(backoffMs(30_000, 1)).toBe(30_000)
    expect(backoffMs(30_000, 2)).toBe(60_000)
    expect(backoffMs(30_000, 3)).toBe(120_000)
    expect(backoffMs(30_000, 20)).toBe(15 * 60 * 1000)
  })

  it('claims and completes a job; attempts increments at claim time', async () => {
    const handler = vi.fn(async () => {})
    registerJobHandler({ type: 'test-w', concurrency: 1, handler })
    const { id } = await enqueueJob({ type: 'test-w', payload: { n: 1 } })
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.status === 'complete')
    const row = await prisma.job.findUnique({ where: { id } })
    expect(row?.attempts).toBe(1)
    expect(row?.startedAt).not.toBeNull()
    expect(row?.completedAt).not.toBeNull()
    expect(handler).toHaveBeenCalledWith({ n: 1 }, expect.objectContaining({ jobId: id, attempt: 1 }))
  })

  it('respects type-keyed concurrency', async () => {
    const gates = [deferred(), deferred(), deferred()]
    let started = 0
    registerJobHandler({
      type: 'test-w', concurrency: 2,
      handler: async () => { await gates[started++].promise },
    })
    await Promise.all([1, 2, 3].map(() => enqueueJob({ type: 'test-w' })))
    await runWorkerTickOnce()
    await waitFor(async () => getActiveJobCounts()['test-w'] === 2)
    expect(started).toBe(2)
    expect(await prisma.job.count({ where: { type: 'test-w', status: 'running' } })).toBe(2)
    gates[0].resolve()
    await waitFor(async () => (await prisma.job.count({ where: { type: 'test-w', status: 'complete' } })) === 1)
    await runWorkerTickOnce() // backfill the freed slot
    await waitFor(async () => started === 3)
    gates[1].resolve(); gates[2].resolve()
    await waitFor(async () => (await prisma.job.count({ where: { type: 'test-w', status: 'complete' } })) === 3)
    expect(getActiveJobCounts()['test-w'] ?? 0).toBe(0)
  })

  it('does not claim jobs whose runAfter is in the future', async () => {
    registerJobHandler({ type: 'test-w', concurrency: 1, handler: vi.fn(async () => {}) })
    const { id } = await enqueueJob({ type: 'test-w', runAfter: new Date(Date.now() + 3_600_000) })
    await runWorkerTickOnce()
    await new Promise((r) => setTimeout(r, 50))
    expect((await prisma.job.findUnique({ where: { id } }))?.status).toBe('queued')
  })

  it('claims higher priority first', async () => {
    const order: number[] = []
    registerJobHandler({
      type: 'test-w', concurrency: 1,
      handler: async (payload) => { order.push((payload as { n: number }).n) },
    })
    await enqueueJob({ type: 'test-w', payload: { n: 1 }, priority: 0 })
    await enqueueJob({ type: 'test-w', payload: { n: 2 }, priority: 10 })
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.count({ where: { type: 'test-w', status: 'complete' } })) === 1)
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.count({ where: { type: 'test-w', status: 'complete' } })) === 2)
    expect(order).toEqual([2, 1])
  })

  it('throw → re-queued with backoff runAfter and lastError', async () => {
    registerJobHandler({
      type: 'test-w', concurrency: 1, backoffBaseMs: 30_000,
      handler: async () => { throw new Error('flaky') },
    })
    const { id } = await enqueueJob({ type: 'test-w' })
    const before = Date.now()
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.status === 'queued')
    const row = await prisma.job.findUnique({ where: { id } })
    expect(row?.attempts).toBe(1)
    expect(row?.lastError).toBe('flaky')
    expect(row!.runAfter.getTime()).toBeGreaterThanOrEqual(before + 30_000)
  })

  it('exhaustion → error + onExhausted with attempts and lastError', async () => {
    const onExhausted = vi.fn(async () => {})
    registerJobHandler({
      type: 'test-w', concurrency: 1, maxAttempts: 1,
      handler: async () => { throw new Error('fatal') },
      onExhausted,
    })
    const { id } = await enqueueJob({ type: 'test-w', payload: { x: 1 }, maxAttempts: 1 })
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.status === 'error')
    expect((await prisma.job.findUnique({ where: { id } }))?.lastError).toBe('fatal')
    expect(onExhausted).toHaveBeenCalledWith({ x: 1 }, { jobId: id, attempts: 1, lastError: 'fatal' })
  })

  it('logs a structured error when a job exhausts its retries', async () => {
    const { logger } = await import('@/lib/log')
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    try {
      registerJobHandler({
        type: 'test-w', concurrency: 1, maxAttempts: 1,
        handler: async () => { throw new Error('boom-log') },
      })
      const { id } = await enqueueJob({ type: 'test-w', payload: { y: 2 }, maxAttempts: 1 })
      await runWorkerTickOnce()
      await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.status === 'error')
      const call = spy.mock.calls.find((c) => (c[0] as { jobId?: string })?.jobId === id)
      expect(call).toBeTruthy()
      const arg = call![0] as Record<string, unknown>
      expect(arg.type).toBe('test-w')
      expect(arg.attempt).toBe(1)
      expect((arg.err as { message: string }).message).toBe('boom-log')
    } finally {
      // Restore in finally so a failed assertion cannot poison later worker tests
      // that share this module's logger singleton.
      spy.mockRestore()
    }
  })

  it('timeout settles as a throw and aborts the handler signal', async () => {
    let seenSignal: AbortSignal | null = null
    registerJobHandler({
      type: 'test-w', concurrency: 1, timeoutMs: 50,
      handler: async (_p, ctx) => {
        seenSignal = ctx.signal
        await new Promise(() => {}) // hangs forever
      },
    })
    const { id } = await enqueueJob({ type: 'test-w' })
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.status === 'queued')
    const row = await prisma.job.findUnique({ where: { id } })
    expect(row?.lastError).toContain('timed out')
    expect(seenSignal!.aborted).toBe(true)
    expect(getActiveJobCounts()['test-w'] ?? 0).toBe(0) // wrapper settled despite hung promise
  })

  it('attempt fence: a superseded attempt cannot clobber the reclaimed job', async () => {
    const gate = deferred()
    registerJobHandler({
      type: 'test-w', concurrency: 1,
      handler: async () => { await gate.promise },
    })
    const { id } = await enqueueJob({ type: 'test-w' })
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.status === 'running')

    // Simulate stale sweep re-queue + reclaim by a new attempt:
    await prisma.job.update({ where: { id }, data: { status: 'queued' } })
    await prisma.job.update({ where: { id }, data: { status: 'running', attempts: 2 } })

    gate.resolve() // zombie attempt-1 settles with fence attempts=1 → must match 0 rows
    await new Promise((r) => setTimeout(r, 100))
    const row = await prisma.job.findUnique({ where: { id } })
    expect(row?.status).toBe('running') // untouched by the zombie's 'complete' write
    expect(row?.attempts).toBe(2)
  })

  it('reconcileActiveSets retires entries whose DB lease is gone', async () => {
    const gate = deferred()
    registerJobHandler({ type: 'test-w', concurrency: 1, handler: async () => { await gate.promise } })
    const { id } = await enqueueJob({ type: 'test-w' })
    await runWorkerTickOnce()
    await waitFor(async () => getActiveJobCounts()['test-w'] === 1)
    // Simulate a sweep re-queue: the lease (status/attempts) no longer matches.
    await prisma.job.update({ where: { id }, data: { status: 'queued' } })
    const { reconcileActiveSets } = await import('./worker')
    await reconcileActiveSets()
    expect(getActiveJobCounts()['test-w'] ?? 0).toBe(0)
    gate.resolve() // let the zombie wrapper settle; fenced writes no-op
  })

  it('marks a job with unparseable payload as failed, not crashed', async () => {
    registerJobHandler({ type: 'test-w', concurrency: 1, maxAttempts: 1, handler: vi.fn(async () => {}) })
    const { id } = await enqueueJob({ type: 'test-w', maxAttempts: 1 })
    await prisma.job.update({ where: { id }, data: { payload: '{not json' } })
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.status === 'error')
    expect((await prisma.job.findUnique({ where: { id } }))?.lastError).toContain('payload')
  })
})
