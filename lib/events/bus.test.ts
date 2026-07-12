// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { subscribeBus, publishInvalidation, getBusStats, __resetBusForTest, BusFullError } from './bus'

const mkSub = () => { const frames: string[] = []; return { frames, sub: { write: (f: string) => frames.push(f), close: () => {} } } }

describe('bus', () => {
  beforeEach(() => { __resetBusForTest(); vi.useFakeTimers() })

  it('broadcasts a coalesced invalidate frame to all subscribers', async () => {
    const a = mkSub(); const b = mkSub()
    subscribeBus(a.sub); subscribeBus(b.sub)
    publishInvalidation('queue'); publishInvalidation('queue') // coalesced
    await vi.advanceTimersByTimeAsync(200)
    expect(a.frames.join('')).toContain('event: invalidate')
    expect(a.frames.join('')).toContain('data: {"topic":"queue"}')
    expect(a.frames.filter(f => f.includes('"topic":"queue"')).length).toBe(1)
    expect(b.frames.length).toBe(a.frames.length)
  })

  it('publishInvalidation never throws even if a subscriber write throws', () => {
    subscribeBus({ write: () => { throw new Error('boom') }, close: () => {} })
    expect(() => { publishInvalidation('queue'); vi.advanceTimersByTime(200) }).not.toThrow()
  })

  it('enforces MAX_CONNECTIONS', () => {
    for (let i = 0; i < 100; i++) subscribeBus(mkSub().sub)
    expect(() => subscribeBus(mkSub().sub)).toThrow(BusFullError)
  })

  it('disposer is idempotent and returns subscriber count to zero', () => {
    const d = subscribeBus(mkSub().sub)
    expect(getBusStats().subscribers).toBe(1)
    d(); d()
    expect(getBusStats().subscribers).toBe(0)
  })

  it('drops frames under backpressure and evicts a persistently slow subscriber', async () => {
    __resetBusForTest(); vi.useFakeTimers()
    const frames: string[] = []
    let slow = true
    const closed = { v: false }
    subscribeBus({ write: (f) => frames.push(f), close: () => { closed.v = true }, desiredSize: () => (slow ? 0 : 10) })
    for (let i = 0; i < 21; i++) { publishInvalidation('t' + i); await vi.advanceTimersByTimeAsync(200) }
    expect(frames.length).toBe(0)     // all dropped
    expect(closed.v).toBe(true)       // evicted after MAX_CONSECUTIVE_DROPS
    expect(getBusStats().subscribers).toBe(0)
  })
})
