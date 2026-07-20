// lib/sweep/origin-type.test.ts
import { describe, it, expect } from 'vitest'
import { asSweepOrigin } from './types'

describe('asSweepOrigin', () => {
  it('passes through known values', () => {
    expect(asSweepOrigin('manual')).toBe('manual')
    expect(asSweepOrigin('scheduled')).toBe('scheduled')
  })
  it('fails safe to scheduled for anything else', () => {
    expect(asSweepOrigin(null)).toBe('scheduled')
    expect(asSweepOrigin(undefined)).toBe('scheduled')
    expect(asSweepOrigin('bogus')).toBe('scheduled')
  })
})
