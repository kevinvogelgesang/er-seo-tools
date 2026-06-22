import { describe, it, expect } from 'vitest'
import { formatYmd, lastFullMonth, comparisonWindow, dayCount } from './dates'

const utc = (s: string) => new Date(s + 'T00:00:00.000Z')

describe('dates', () => {
  it('formats UTC ymd regardless of local tz', () => {
    expect(formatYmd(new Date('2026-05-31T23:30:00.000Z'))).toBe('2026-05-31')
  })
  it('lastFullMonth returns the prior calendar month inclusive', () => {
    const w = lastFullMonth(new Date('2026-06-22T10:00:00.000Z'))
    expect(formatYmd(w.start)).toBe('2026-05-01')
    expect(formatYmd(w.end)).toBe('2026-05-31')
  })
  it('prev_period mirrors length immediately before', () => {
    const period = { start: utc('2026-05-01'), end: utc('2026-05-31') } // 31 days
    const c = comparisonWindow(period, 'prev_period')
    expect(formatYmd(c.start)).toBe('2026-03-31')
    expect(formatYmd(c.end)).toBe('2026-04-30')
    expect(dayCount(c)).toBe(31)
  })
  it('prev_year shifts back one year', () => {
    const period = { start: utc('2026-05-01'), end: utc('2026-05-31') }
    const c = comparisonWindow(period, 'prev_year')
    expect(formatYmd(c.start)).toBe('2025-05-01')
    expect(formatYmd(c.end)).toBe('2025-05-31')
  })
})
