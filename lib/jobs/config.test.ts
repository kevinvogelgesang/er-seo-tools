// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseNonNegativeInt } from './config'

describe('parseNonNegativeInt', () => {
  it('parses 0 as 0 (not the fallback)', () => {
    expect(parseNonNegativeInt('0', 300)).toBe(0)
  })
  it('parses a positive integer', () => {
    expect(parseNonNegativeInt('7', 300)).toBe(7)
  })
  it('falls back on negative', () => {
    expect(parseNonNegativeInt('-1', 300)).toBe(300)
  })
  it('falls back on undefined/garbage', () => {
    expect(parseNonNegativeInt(undefined, 300)).toBe(300)
    expect(parseNonNegativeInt('abc', 300)).toBe(300)
  })
})
