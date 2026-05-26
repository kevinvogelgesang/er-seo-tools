import { describe, it, expect } from 'vitest'
import { formatInBrowserTZ } from './format-date'

describe('formatInBrowserTZ', () => {
  it('returns em dash for null/undefined/invalid', () => {
    expect(formatInBrowserTZ(null)).toBe('—')
    expect(formatInBrowserTZ(undefined)).toBe('—')
    expect(formatInBrowserTZ('not-a-date')).toBe('—')
  })
  it('formats a valid ISO string (contains a year)', () => {
    expect(formatInBrowserTZ('2026-05-13T19:15:00.000Z', 'date')).toMatch(/\d{4}/)
  })
})
