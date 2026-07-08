// lib/jobs/handlers/cleanup.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const runCleanup = vi.fn()
vi.mock('@/lib/cleanup', () => ({ runCleanup: (...a: unknown[]) => runCleanup(...a) }))

const { registerCleanupHandler, CLEANUP_JOB_TYPE } = await import('./cleanup')
const { getJobHandler, clearJobRegistryForTests } = await import('../registry')

const ctx = { jobId: 'j1', attempt: 1, signal: new AbortController().signal, reportProgress: () => {} }

describe('jobs/handlers/cleanup', () => {
  beforeEach(() => {
    clearJobRegistryForTests()
    runCleanup.mockReset()
  })

  it('registers with the right config', () => {
    registerCleanupHandler()
    const cfg = getJobHandler(CLEANUP_JOB_TYPE)
    expect(cfg).toBeDefined()
    expect(cfg!.concurrency).toBe(1)
    expect(cfg!.maxAttempts).toBe(1)
    expect(cfg!.timeoutMs).toBe(10 * 60 * 1000)
    expect(cfg!.onExhausted).toBeUndefined()
  })

  it('delegates to runCleanup', async () => {
    runCleanup.mockResolvedValue(undefined)
    registerCleanupHandler()
    await getJobHandler(CLEANUP_JOB_TYPE)!.handler({}, ctx)
    expect(runCleanup).toHaveBeenCalledTimes(1)
  })

  it('propagates a throw (unexpected failure fails the job)', async () => {
    runCleanup.mockRejectedValue(new Error('db down'))
    registerCleanupHandler()
    await expect(getJobHandler(CLEANUP_JOB_TYPE)!.handler({}, ctx)).rejects.toThrow('db down')
  })
})
