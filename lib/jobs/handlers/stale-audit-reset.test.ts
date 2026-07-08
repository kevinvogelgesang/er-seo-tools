// lib/jobs/handlers/stale-audit-reset.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const reset = vi.fn()
vi.mock('@/lib/ada-audit/queue-manager', () => ({
  resetStaleAudits: (...a: unknown[]) => reset(...a),
}))

const { registerStaleAuditResetHandler, STALE_AUDIT_RESET_JOB_TYPE } = await import('./stale-audit-reset')
const { getJobHandler, clearJobRegistryForTests } = await import('../registry')

const ctx = { jobId: 'j1', attempt: 1, signal: new AbortController().signal, reportProgress: () => {} }

describe('jobs/handlers/stale-audit-reset', () => {
  beforeEach(() => {
    clearJobRegistryForTests()
    reset.mockReset()
  })

  it('registers with the right config', () => {
    registerStaleAuditResetHandler()
    const cfg = getJobHandler(STALE_AUDIT_RESET_JOB_TYPE)
    expect(cfg).toBeDefined()
    expect(cfg!.concurrency).toBe(1)
    expect(cfg!.maxAttempts).toBe(1)
    expect(cfg!.timeoutMs).toBe(5 * 60 * 1000) // registry default
  })

  it('delegates to resetStaleAudits', async () => {
    reset.mockResolvedValue(undefined)
    registerStaleAuditResetHandler()
    await getJobHandler(STALE_AUDIT_RESET_JOB_TYPE)!.handler({}, ctx)
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('propagates a throw', async () => {
    reset.mockRejectedValue(new Error('busy'))
    registerStaleAuditResetHandler()
    await expect(getJobHandler(STALE_AUDIT_RESET_JOB_TYPE)!.handler({}, ctx)).rejects.toThrow('busy')
  })
})
