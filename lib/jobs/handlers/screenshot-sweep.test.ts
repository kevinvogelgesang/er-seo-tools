// lib/jobs/handlers/screenshot-sweep.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sweep = vi.fn()
vi.mock('@/lib/ada-audit/screenshot-sweeper', () => ({
  sweepExpiredScreenshots: (...a: unknown[]) => sweep(...a),
}))

const { registerScreenshotSweepHandler, SCREENSHOT_SWEEP_JOB_TYPE } = await import('./screenshot-sweep')
const { getJobHandler, clearJobRegistryForTests } = await import('../registry')

const ctx = { jobId: 'j1', attempt: 1, signal: new AbortController().signal }

describe('jobs/handlers/screenshot-sweep', () => {
  beforeEach(() => {
    clearJobRegistryForTests()
    sweep.mockReset()
  })

  it('registers with the right config', () => {
    registerScreenshotSweepHandler()
    const cfg = getJobHandler(SCREENSHOT_SWEEP_JOB_TYPE)
    expect(cfg).toBeDefined()
    expect(cfg!.concurrency).toBe(1)
    expect(cfg!.maxAttempts).toBe(1)
    expect(cfg!.timeoutMs).toBe(10 * 60 * 1000)
  })

  it('delegates to sweepExpiredScreenshots', async () => {
    sweep.mockResolvedValue({ checked: 0, deleted: 0 })
    registerScreenshotSweepHandler()
    await getJobHandler(SCREENSHOT_SWEEP_JOB_TYPE)!.handler({}, ctx)
    expect(sweep).toHaveBeenCalledTimes(1)
  })

  it('propagates a throw', async () => {
    sweep.mockRejectedValue(new Error('fs error'))
    registerScreenshotSweepHandler()
    await expect(getJobHandler(SCREENSHOT_SWEEP_JOB_TYPE)!.handler({}, ctx)).rejects.toThrow('fs error')
  })
})
