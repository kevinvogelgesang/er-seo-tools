import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { registerJobHandler, clearJobRegistryForTests } from './registry'
import { enqueueJob } from './queue'
import { runWorkerTickOnce, resetWorkerForTests } from './worker'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => { resolve = res })
  return { promise, resolve }
}
async function waitFor(pred: () => Promise<boolean>, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) { if (await pred()) return; await new Promise((r) => setTimeout(r, 25)) }
  throw new Error('waitFor timed out')
}

describe('worker progress', () => {
  beforeEach(async () => {
    clearJobRegistryForTests()
    resetWorkerForTests()
    await prisma.job.deleteMany({ where: { type: { startsWith: 'test-prog' } } })
  })
  afterEach(() => { vi.useRealTimers() })

  it('sets progress:100 and clears message on successful settle', async () => {
    registerJobHandler({ type: 'test-prog-ok', concurrency: 1, handler: async (_p, ctx) => { ctx.reportProgress(42, 'Checked 42/100 links') } })
    const { id } = await enqueueJob({ type: 'test-prog-ok', payload: {} })
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.status === 'complete')
    const row = await prisma.job.findUnique({ where: { id } })
    expect(row?.progress).toBe(100)
    expect(row?.progressMessage).toBeNull()
  })

  // NOTE (deviation from plan Step 1): the plan's version of this test drives
  // the HEARTBEAT_MS=15_000 interval with `vi.useFakeTimers()` +
  // `advanceTimersByTimeAsync`. In practice that combination never observes
  // the flush here — the heartbeat's `prisma.job.updateMany(...)` resolves via
  // real SQLite I/O (libuv), which fake timers do not drive, so
  // `advanceTimersByTimeAsync` returns before the write lands (reproduced
  // consistently across repeated runs, not a one-off flake). Per the plan's
  // own fallback note, HEARTBEAT_MS is NOT changed; instead this test uses
  // real timers and polls for the real ~15s heartbeat tick to land, with an
  // extended per-test timeout. The success-settle test above (progress:100)
  // remains the required, deterministic contract test.
  it('flushes reported progress to the row on the fenced heartbeat', async () => {
    const gate = deferred()
    registerJobHandler({
      type: 'test-prog-hb', concurrency: 1,
      handler: async (_p, ctx) => { ctx.reportProgress(42, 'Checked 42/100 links'); await gate.promise },
    })
    const { id } = await enqueueJob({ type: 'test-prog-hb', payload: {} })
    await runWorkerTickOnce()
    await waitFor(async () => (await prisma.job.findUnique({ where: { id } }))?.progress === 42, 700)
    const mid = await prisma.job.findUnique({ where: { id } })
    expect(mid?.progress).toBe(42)
    expect(mid?.progressMessage).toBe('Checked 42/100 links')
    gate.resolve()
  }, 20_000)
})
