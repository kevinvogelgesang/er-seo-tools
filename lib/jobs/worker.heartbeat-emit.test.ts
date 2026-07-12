// lib/jobs/worker.heartbeat-emit.test.ts
//
// Unit test for the extracted `flushJobHeartbeat` helper — drives it DIRECTLY
// (no fake timers, no interval), so the fenced write + effect-gated emit is
// exercised deterministically. worker.progress.test.ts:36 documents why the
// real ~15s interval can't be driven by fake timers; this test sidesteps that
// by calling the helper the interval would call.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { flushJobHeartbeat } from './worker'

async function makeRunningJob(attempts: number): Promise<string> {
  const row = await prisma.job.create({
    data: { type: 'test-hbemit', status: 'running', attempts, heartbeatAt: new Date() },
  })
  return row.id
}

describe('flushJobHeartbeat', () => {
  beforeEach(async () => {
    await prisma.job.deleteMany({ where: { type: 'test-hbemit' } })
  })

  it('emits once for a committed delta, dedupes an unchanged snapshot, re-emits on change', async () => {
    const id = await makeRunningJob(1)
    const fence = { id, status: 'running', attempts: 1 }
    const lastEmitted: { current: { progress: number | null; message: string | null } | null } = { current: null }
    const emit = vi.fn()

    // First delta: fenced write lands (count===1) + change vs null → one emit.
    await flushJobHeartbeat(fence, { progress: 42, message: 'Checked 42/100' }, emit, lastEmitted)
    expect(emit).toHaveBeenCalledTimes(1)
    const afterFirst = await prisma.job.findUnique({ where: { id } })
    expect(afterFirst?.progress).toBe(42)
    expect(afterFirst?.progressMessage).toBe('Checked 42/100')

    // Same snapshot again: write still lands but no delta → NO new emit.
    await flushJobHeartbeat(fence, { progress: 42, message: 'Checked 42/100' }, emit, lastEmitted)
    expect(emit).toHaveBeenCalledTimes(1)

    // Changed snapshot: delta → second emit.
    await flushJobHeartbeat(fence, { progress: 60, message: 'Checked 60/100' }, emit, lastEmitted)
    expect(emit).toHaveBeenCalledTimes(2)
    expect(lastEmitted.current).toEqual({ progress: 60, message: 'Checked 60/100' })
  })

  it('does NOT emit and does NOT advance lastEmitted when the fence loses (count===0)', async () => {
    const id = await makeRunningJob(1)
    // Fence with the wrong attempts token → matches 0 rows.
    const staleFence = { id, status: 'running', attempts: 999 }
    const lastEmitted: { current: { progress: number | null; message: string | null } | null } = { current: null }
    const emit = vi.fn()

    await flushJobHeartbeat(staleFence, { progress: 42, message: 'stale' }, emit, lastEmitted)
    expect(emit).not.toHaveBeenCalled()
    expect(lastEmitted.current).toBeNull()

    // Row untouched by the lost-fence write.
    const row = await prisma.job.findUnique({ where: { id } })
    expect(row?.progress).toBeNull()
    expect(row?.progressMessage).toBeNull()
  })
})
