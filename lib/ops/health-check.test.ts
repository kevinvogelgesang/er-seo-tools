// lib/ops/health-check.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateHealth, type HealthSignals } from './health-check'
import type { AlertState } from './alert-state'

const now = new Date('2026-07-02T12:00:00Z')
const OPTS = { lookbackMs: 15 * 60_000, cooldownMs: 360 * 60_000, backupStaleHours: 26 }
const clean: HealthSignals = {
  newErroredSiteAudits: 0, newErroredAdaAudits: 0, newExhaustedJobs: 0,
  stalledAudit: null, newestBackupAgeHours: 1,
}
const st: AlertState = { lastCheckAt: now.getTime() - OPTS.lookbackMs, cooldowns: {} }

describe('evaluateHealth', () => {
  it('all clean → no alerts, advances lastCheckAt', () => {
    const r = evaluateHealth(clean, st, now, OPTS)
    expect(r.alerts).toEqual([])
    expect(r.nextState.lastCheckAt).toBe(now.getTime())
  })
  it('errored audits + exhausted jobs each produce a line', () => {
    const r = evaluateHealth({ ...clean, newErroredSiteAudits: 2, newExhaustedJobs: 1 }, st, now, OPTS)
    expect(r.alerts.length).toBe(2)
    expect(r.alerts.join('\n')).toMatch(/audit/i)
    expect(r.alerts.join('\n')).toMatch(/job/i)
  })
  it('queue-stalled fires once then is suppressed by cooldown', () => {
    const sig = { ...clean, stalledAudit: { id: 'a1', minutesStuck: 74 } }
    const r1 = evaluateHealth(sig, st, now, OPTS)
    expect(r1.alerts.some((a) => /stall/i.test(a))).toBe(true)
    // Second run within cooldown, using r1's committed cooldowns.
    const r2 = evaluateHealth(sig, r1.nextState, new Date(now.getTime() + 60_000), OPTS)
    expect(r2.alerts.some((a) => /stall/i.test(a))).toBe(false)
  })
  it('backup-stale fires when age exceeds threshold or no backup exists', () => {
    expect(evaluateHealth({ ...clean, newestBackupAgeHours: 31 }, st, now, OPTS).alerts.some((a) => /backup/i.test(a))).toBe(true)
    expect(evaluateHealth({ ...clean, newestBackupAgeHours: null }, st, now, OPTS).alerts.some((a) => /backup/i.test(a))).toBe(true)
  })
})
