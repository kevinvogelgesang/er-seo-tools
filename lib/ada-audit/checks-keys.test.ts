import { describe, expect, it } from 'vitest'
import { keyForNode, keyForPage, keyForPageViolation, canonicalJson } from './checks-keys'

describe('canonicalJson', () => {
  it('sorts object keys alphabetically', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('handles nested objects', () => {
    expect(canonicalJson({ outer: { b: 1, a: 2 }, first: 'x' })).toBe('{"first":"x","outer":{"a":2,"b":1}}')
  })

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
  })
})

describe('keyForNode', () => {
  it('is deterministic for the same inputs', () => {
    const a = keyForNode({ ruleId: 'color-contrast', target: ['nav', 'a.link'] })
    const b = keyForNode({ ruleId: 'color-contrast', target: ['nav', 'a.link'] })
    expect(a).toBe(b)
  })

  it('differs when ruleId differs', () => {
    const a = keyForNode({ ruleId: 'color-contrast', target: ['nav'] })
    const b = keyForNode({ ruleId: 'image-alt', target: ['nav'] })
    expect(a).not.toBe(b)
  })

  it('differs when target differs', () => {
    const a = keyForNode({ ruleId: 'color-contrast', target: ['nav'] })
    const b = keyForNode({ ruleId: 'color-contrast', target: ['footer'] })
    expect(a).not.toBe(b)
  })

  it('outputs 64-char hex', () => {
    const k = keyForNode({ ruleId: 'r', target: ['t'] })
    expect(k).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('keyForPage', () => {
  it('is deterministic', () => {
    expect(keyForPage({ pageUrl: 'https://x.com/a' })).toBe(keyForPage({ pageUrl: 'https://x.com/a' }))
  })
})

describe('keyForPageViolation', () => {
  it('is deterministic', () => {
    const a = keyForPageViolation({ pageUrl: 'https://x.com/a', ruleId: 'color-contrast' })
    const b = keyForPageViolation({ pageUrl: 'https://x.com/a', ruleId: 'color-contrast' })
    expect(a).toBe(b)
  })

  it('is delimiter-safe (contains pipe in URL)', () => {
    const a = keyForPageViolation({ pageUrl: 'https://x.com/a|b', ruleId: 'color-contrast' })
    const b = keyForPageViolation({ pageUrl: 'https://x.com/a', ruleId: 'b|color-contrast' })
    expect(a).not.toBe(b)
  })
})
