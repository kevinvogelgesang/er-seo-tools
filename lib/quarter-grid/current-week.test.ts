import { describe, it, expect } from 'vitest'
import { resolveCurrentWeek } from './current-week'

describe('resolveCurrentWeek', () => {
  it('returns null for an empty start date', () => {
    expect(resolveCurrentWeek('', new Date('2026-07-07T12:00:00'))).toBeNull()
  })
  it('returns week 1 for a date inside the first week', () => {
    // startDate is a Monday; +2 days is still week 1.
    expect(resolveCurrentWeek('2026-07-06', new Date('2026-07-08T12:00:00'))).toBe(1)
  })
  it('returns week 2 for a date seven days after start', () => {
    expect(resolveCurrentWeek('2026-07-06', new Date('2026-07-14T12:00:00'))).toBe(2)
  })
  it('returns null when today is past the 13-week window', () => {
    expect(resolveCurrentWeek('2026-07-06', new Date('2026-11-01T12:00:00'))).toBeNull()
  })
  it('returns null when today is before the start date', () => {
    expect(resolveCurrentWeek('2026-07-06', new Date('2026-07-01T12:00:00'))).toBeNull()
  })
})
