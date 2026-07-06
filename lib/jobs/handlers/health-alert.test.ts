// lib/jobs/handlers/health-alert.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  readAlertState: vi.fn(),
  writeAlertState: vi.fn(),
  collectHealthSignals: vi.fn(),
  sendAlert: vi.fn(),
}))
vi.mock('@/lib/ops/alert-state', () => ({
  readAlertState: mocks.readAlertState,
  writeAlertState: mocks.writeAlertState,
}))
vi.mock('@/lib/ops/alert-webhook', () => ({ sendAlert: mocks.sendAlert }))
vi.mock('@/lib/ops/health-check', async (orig) => ({
  ...(await orig<typeof import('@/lib/ops/health-check')>()),
  collectHealthSignals: mocks.collectHealthSignals,
}))

const { runHealthAlert } = await import('./health-alert')

const CLEAN = {
  newErroredSiteAudits: 0, newErroredAdaAudits: 0, newExhaustedJobs: 0,
  erroredSiteAuditDetails: [], erroredAdaAuditDetails: [], exhaustedJobDetails: [],
  stalledAudit: null, newestBackupAgeHours: 1,
}
beforeEach(() => {
  mocks.readAlertState.mockReset(); mocks.writeAlertState.mockReset()
  mocks.collectHealthSignals.mockReset(); mocks.sendAlert.mockReset()
  mocks.readAlertState.mockResolvedValue({ lastCheckAt: 0, cooldowns: {} })
})

describe('runHealthAlert', () => {
  it('no alerts → advances state, no send', async () => {
    mocks.collectHealthSignals.mockResolvedValue(CLEAN)
    await runHealthAlert(new Date())
    expect(mocks.sendAlert).not.toHaveBeenCalled()
    expect(mocks.writeAlertState).toHaveBeenCalledOnce()
  })
  it('alerts + delivery failure → state NOT advanced', async () => {
    mocks.collectHealthSignals.mockResolvedValue({ ...CLEAN, newExhaustedJobs: 1 })
    mocks.sendAlert.mockResolvedValue({ sent: false, skipped: false })
    await runHealthAlert(new Date())
    expect(mocks.sendAlert).toHaveBeenCalledOnce()
    expect(mocks.writeAlertState).not.toHaveBeenCalled()
  })
  it('alerts + delivered → state advanced', async () => {
    mocks.collectHealthSignals.mockResolvedValue({ ...CLEAN, newExhaustedJobs: 1 })
    mocks.sendAlert.mockResolvedValue({ sent: true, skipped: false })
    await runHealthAlert(new Date())
    expect(mocks.writeAlertState).toHaveBeenCalledOnce()
  })
  it('alerts + dark (skipped) → state advanced', async () => {
    mocks.collectHealthSignals.mockResolvedValue({ ...CLEAN, newExhaustedJobs: 1 })
    mocks.sendAlert.mockResolvedValue({ sent: false, skipped: true })
    await runHealthAlert(new Date())
    expect(mocks.writeAlertState).toHaveBeenCalledOnce()
  })
})
