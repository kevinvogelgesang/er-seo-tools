import { describe, it, expect } from 'vitest'
import { createFixedWindowLimiter } from './rate-limit'

function fakeClock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('createFixedWindowLimiter', () => {
  it('allows up to max hits then blocks', () => {
    const c = fakeClock()
    const l = createFixedWindowLimiter({ max: 3, windowMs: 1000, now: c.now })
    expect(l.hit('k').allowed).toBe(true)
    expect(l.hit('k').allowed).toBe(true)
    expect(l.hit('k').allowed).toBe(true)
    const blocked = l.hit('k')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBe(1)
    expect(blocked.remaining).toBe(0)
  })

  it('rolls the window at exactly windowMs (>= boundary, no Retry-After:0-while-blocked)', () => {
    const c = fakeClock()
    const l = createFixedWindowLimiter({ max: 1, windowMs: 1000, now: c.now })
    expect(l.hit('k').allowed).toBe(true)
    expect(l.hit('k').allowed).toBe(false)
    c.advance(1000)
    expect(l.hit('k').allowed).toBe(true)
  })

  it('reset clears a key', () => {
    const c = fakeClock()
    const l = createFixedWindowLimiter({ max: 1, windowMs: 1000, now: c.now })
    expect(l.hit('k').allowed).toBe(true)
    expect(l.hit('k').allowed).toBe(false)
    l.reset('k')
    expect(l.hit('k').allowed).toBe(true)
  })

  it('keys are independent', () => {
    const c = fakeClock()
    const l = createFixedWindowLimiter({ max: 1, windowMs: 1000, now: c.now })
    expect(l.hit('a').allowed).toBe(true)
    expect(l.hit('b').allowed).toBe(true)
  })

  it('prunes at maxKeys but never evicts the key being evaluated', () => {
    const c = fakeClock()
    const l = createFixedWindowLimiter({ max: 5, windowMs: 100000, now: c.now, maxKeys: 2 })
    l.hit('old1'); c.advance(1); l.hit('old2'); c.advance(1)
    const r = l.hit('fresh')
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(4)
  })

  it('coerces invalid config to safe defaults', () => {
    const c = fakeClock()
    const l = createFixedWindowLimiter({ max: 0, windowMs: -5, now: c.now })
    expect(() => l.hit('k')).not.toThrow()
    expect(l.hit('k').allowed).toBe(true)
  })
})
