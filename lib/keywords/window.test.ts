import { describe, it, expect } from 'vitest'
import { computeSnapshotWindow } from './window'
import { formatYmd, dayCount } from '@/lib/analytics/dates'

describe('computeSnapshotWindow', () => {
  it('computes end = now-3d and start = end-90d for a mid-day now', () => {
    const now = new Date('2026-07-10T15:23:45.000Z')
    const w = computeSnapshotWindow(now)

    expect(formatYmd(w.end)).toBe('2026-07-07')
    expect(formatYmd(w.start)).toBe('2026-04-08')
    expect(dayCount(w)).toBe(91)
  })

  it('is UTC-only: a now at exact UTC midnight yields the same window', () => {
    const now = new Date('2026-07-10T00:00:00.000Z')
    const w = computeSnapshotWindow(now)

    expect(formatYmd(w.end)).toBe('2026-07-07')
    expect(formatYmd(w.start)).toBe('2026-04-08')
    expect(dayCount(w)).toBe(91)
  })

  it('result dates are whole UTC days (zero time-of-day component)', () => {
    const now = new Date('2026-07-10T23:59:59.999Z')
    const w = computeSnapshotWindow(now)

    expect(w.start.getUTCHours()).toBe(0)
    expect(w.start.getUTCMinutes()).toBe(0)
    expect(w.start.getUTCSeconds()).toBe(0)
    expect(w.start.getUTCMilliseconds()).toBe(0)
    expect(w.end.getUTCHours()).toBe(0)
    expect(w.end.getUTCMinutes()).toBe(0)
    expect(w.end.getUTCSeconds()).toBe(0)
    expect(w.end.getUTCMilliseconds()).toBe(0)
  })

  it('crosses a year boundary correctly', () => {
    const now = new Date('2027-01-01T12:00:00.000Z')
    const w = computeSnapshotWindow(now)

    expect(formatYmd(w.end)).toBe('2026-12-29')
    expect(dayCount(w)).toBe(91)
  })
})
