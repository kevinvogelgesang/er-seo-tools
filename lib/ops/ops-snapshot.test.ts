import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/jobs/introspection', () => ({
  getJobQueueState: vi.fn(async () => ({ counts: {}, oldestRunning: null, recentFailures: [] })),
  getCleanupStats: vi.fn(async () => [{ type: 'cleanup', lastCompletedAt: null, lastStatus: null, lastError: null }]),
}))
vi.mock('@/lib/ops/health-check', () => ({
  collectHealthSignals: vi.fn(async () => { throw new Error('db down') }), // force one section to fail
  evaluateHealth: vi.fn(() => ({ alerts: [], nextState: { lastCheckAt: 0, cooldowns: {} } })),
  healthEvalOpts: () => ({ lookbackMs: 900000, cooldownMs: 1, backupStaleHours: 26 }),
}))
vi.mock('@/lib/ops/disk', () => ({ getDiskFree: vi.fn(async () => 123) }))
vi.mock('@/lib/ops/db-size', () => ({ getDbSizeBytes: vi.fn(async () => 456), resolveDbPath: () => '/x/db.sqlite' }))
vi.mock('@/lib/ada-audit/browser-pool', () => ({
  getPoolState: () => ({ poolSize: 2, inUse: 0, free: 2, waiting: 0, draining: false, browserAlive: false, pagesServed: 0 }),
}))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))

import { loadOpsSnapshot } from './ops-snapshot'
import { logError } from '@/lib/log'

describe('loadOpsSnapshot', () => {
  it('isolates a failed section without blanking the rest, and logs it', async () => {
    const snap = await loadOpsSnapshot()
    expect(snap.queue.ok).toBe(true)
    expect(snap.health.ok).toBe(false) // collectHealthSignals threw
    expect(snap.disk.ok).toBe(true)
    if (snap.disk.ok) expect(snap.disk.data).toBe(123)
    expect(snap.pool.ok).toBe(true)
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'ops-snapshot', section: 'health' }),
      expect.any(Error),
    )
  })
})
