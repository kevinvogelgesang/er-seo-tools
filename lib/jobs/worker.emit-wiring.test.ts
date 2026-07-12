// lib/jobs/worker.emit-wiring.test.ts
//
// Real-timer test of the emit wiring through `executeJob` (no fake timers).
// The 15s heartbeat-delta emit itself is proven by worker.heartbeat-emit.test.ts
// (flushJobHeartbeat unit test) + worker.progress.test.ts (real interval write);
// this test proves executeJob actually invokes the emitProgress closure on the
// claim + terminal writes, gated on the group→topic mapping.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { registerJobHandler, clearJobRegistryForTests } from './registry'
import { enqueueJob } from './queue'
import { runWorkerTickOnce, resetWorkerForTests } from './worker'
import { publishInvalidation } from '@/lib/events/bus'

vi.mock('@/lib/events/bus', () => ({ publishInvalidation: vi.fn() }))

async function waitFor(pred: () => Promise<boolean>, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) { if (await pred()) return; await new Promise((r) => setTimeout(r, 25)) }
  throw new Error('waitFor timed out')
}

describe('worker emit wiring', () => {
  beforeEach(async () => {
    clearJobRegistryForTests()
    resetWorkerForTests()
    vi.mocked(publishInvalidation).mockClear()
    await prisma.job.deleteMany({ where: { type: { startsWith: 'test-emit' } } })
  })
  afterEach(() => { vi.useRealTimers() })

  it('emits the group topic + recents through executeJob when the job maps to a topic', async () => {
    registerJobHandler({ type: 'test-emit-mapped', concurrency: 1, handler: async () => {} })
    const { id } = await enqueueJob({ type: 'test-emit-mapped', payload: {}, groupKey: 'site-audit:emit1' })
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.status === 'complete')

    const topics = vi.mocked(publishInvalidation).mock.calls.map((c) => c[0])
    // Fired on both the claim flip and the terminal complete write.
    expect(topics).toContain('site-audit:emit1')
    expect(topics).toContain('recents')
  })

  it('emits nothing when the job has no group→topic mapping', async () => {
    registerJobHandler({ type: 'test-emit-unmapped', concurrency: 1, handler: async () => {} })
    const { id } = await enqueueJob({ type: 'test-emit-unmapped', payload: {} })
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.status === 'complete')

    expect(publishInvalidation).not.toHaveBeenCalled()
  })
})
