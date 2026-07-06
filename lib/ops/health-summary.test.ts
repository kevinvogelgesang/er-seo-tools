import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as hc from './health-check'
import { getLivenessSummary, __resetHealthSummaryCache } from './health-summary'

const zeroSignals: hc.HealthSignals = {
  newErroredSiteAudits: 0, newErroredAdaAudits: 0, newExhaustedJobs: 0,
  erroredSiteAuditDetails: [], erroredAdaAuditDetails: [], exhaustedJobDetails: [],
  stalledAudit: null, newestBackupAgeHours: 1,
}

describe('getLivenessSummary', () => {
  beforeEach(() => { __resetHealthSummaryCache(); vi.restoreAllMocks() })

  it('ok when no signals trip', async () => {
    vi.spyOn(hc, 'collectHealthSignals').mockResolvedValue(zeroSignals)
    expect(await getLivenessSummary()).toEqual({ status: 'ok' })
  })

  it('degraded when a signal trips', async () => {
    vi.spyOn(hc, 'collectHealthSignals').mockResolvedValue({ ...zeroSignals, newExhaustedJobs: 3 })
    expect(await getLivenessSummary()).toEqual({ status: 'degraded' })
  })

  it('passes a lookback-window since, not 0', async () => {
    const spy = vi.spyOn(hc, 'collectHealthSignals').mockResolvedValue(zeroSignals)
    const now = new Date('2026-07-05T12:00:00Z')
    await getLivenessSummary(now)
    const sinceArg = spy.mock.calls[0][1] as number
    expect(sinceArg).toBe(now.getTime() - hc.healthEvalOpts().lookbackMs)
    expect(sinceArg).toBeGreaterThan(0)
  })

  it('fails open to ok when signal collection throws', async () => {
    vi.spyOn(hc, 'collectHealthSignals').mockRejectedValue(new Error('db slow'))
    expect(await getLivenessSummary()).toEqual({ status: 'ok' })
  })

  it('caches within the TTL (one collect call for two reads)', async () => {
    const spy = vi.spyOn(hc, 'collectHealthSignals').mockResolvedValue(zeroSignals)
    await getLivenessSummary()
    await getLivenessSummary()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
