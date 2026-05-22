import { describe, expect, it } from 'vitest'
import { formatDuration, formatDurationHover } from './duration'

describe('formatDuration', () => {
  it('returns null when startedAt is null', () => {
    expect(formatDuration(null, new Date())).toBeNull()
  })

  it('returns null when completedAt is null', () => {
    expect(formatDuration(new Date(), null)).toBeNull()
  })

  it('formats sub-minute as Ns', () => {
    const a = new Date('2026-05-22T14:14:03Z')
    const b = new Date('2026-05-22T14:14:48Z')
    expect(formatDuration(a, b)).toBe('45s')
  })

  it('formats sub-hour as Xm Ys', () => {
    const a = new Date('2026-05-22T14:14:03Z')
    const b = new Date('2026-05-22T14:18:47Z')
    expect(formatDuration(a, b)).toBe('4m 44s')
  })

  it('formats over-hour as Hh Mm', () => {
    const a = new Date('2026-05-22T14:00:00Z')
    const b = new Date('2026-05-22T15:30:00Z')
    expect(formatDuration(a, b)).toBe('1h 30m')
  })

  it('rounds down sub-second to 0s', () => {
    const a = new Date('2026-05-22T14:14:03.000Z')
    const b = new Date('2026-05-22T14:14:03.500Z')
    expect(formatDuration(a, b)).toBe('0s')
  })
})

describe('formatDurationHover', () => {
  it('returns null when either timestamp missing', () => {
    expect(formatDurationHover(null, new Date())).toBeNull()
    expect(formatDurationHover(new Date(), null)).toBeNull()
  })

  it('shows start and end times', () => {
    const a = new Date('2026-05-22T14:14:03Z')
    const b = new Date('2026-05-22T14:18:47Z')
    const hover = formatDurationHover(a, b)!
    expect(hover).toMatch(/Started .* → Ended .*/)
  })
})
