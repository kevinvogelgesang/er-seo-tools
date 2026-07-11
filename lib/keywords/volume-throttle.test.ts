// lib/keywords/volume-throttle.test.ts
//
// Pure unit tests for the KS-2 process-wide rolling throttle (spec §5.3,
// Codex #2 / plan #5). Controllable fake clock (`let t = 0`) injected as
// `now`/`sleep` — NO vi.useFakeTimers, matching the plan's brief.
import { describe, it, expect, vi } from 'vitest'
import { createThrottle, volumeThrottle } from './volume-throttle'

/** Builds a fresh controllable clock: `now()` reads `t`, `sleep(ms)` advances
 * `t` by `ms` (default) unless the test overrides the mock implementation. */
function makeClock() {
  let t = 0
  const now = () => t
  const sleep = vi.fn(async (ms: number) => {
    t += ms
  })
  return {
    now,
    sleep,
    get t() {
      return t
    },
    set t(v: number) {
      t = v
    },
  }
}

describe('createThrottle', () => {
  it('grants the first maxRequests acquires with zero sleeps', async () => {
    const clock = makeClock()
    const throttle = createThrottle({ maxRequests: 12, windowMs: 60_000, now: clock.now, sleep: clock.sleep })

    for (let i = 0; i < 12; i++) {
      await throttle.acquire()
    }

    expect(clock.sleep).not.toHaveBeenCalled()
  })

  it('the 13th acquire sleeps until the oldest grant falls out of the window, then grants', async () => {
    const clock = makeClock()
    const throttle = createThrottle({ maxRequests: 12, windowMs: 60_000, now: clock.now, sleep: clock.sleep })

    for (let i = 0; i < 12; i++) {
      await throttle.acquire()
    }
    expect(clock.t).toBe(0) // all 12 granted at t=0, no sleeping yet

    await throttle.acquire()

    expect(clock.sleep).toHaveBeenCalledTimes(1)
    expect(clock.sleep).toHaveBeenCalledWith(60_000) // oldest grant (t=0) + windowMs - now(0)
    expect(clock.t).toBe(60_000) // grant happens AFTER the clock advance
  })

  it('rolling window: a new acquire only needs the OLDEST grant to expire, not a full window reset', async () => {
    const clock = makeClock()
    const throttle = createThrottle({ maxRequests: 12, windowMs: 60_000, now: clock.now, sleep: clock.sleep })

    // Spread the 12 grants across 11 seconds instead of issuing them all at t=0.
    for (let i = 0; i < 12; i++) {
      clock.t = i * 1000 // t = 0, 1000, ..., 11000
      await throttle.acquire()
    }

    // Move to t=12000 (short past the last grant) and request a 13th permit.
    // A fixed-window design would sleep until 11000 + 60000 = 71000 (59000ms).
    // The rolling design only needs the OLDEST grant (t=0) to fall out of the
    // window: wait until t=60000, i.e. sleep(60000 - 12000) = 48000.
    clock.t = 12_000
    await throttle.acquire()

    expect(clock.sleep).toHaveBeenCalledTimes(1)
    expect(clock.sleep).toHaveBeenCalledWith(48_000)
    expect(clock.t).toBe(60_000)
  })

  it('re-checks the clock after waking: an under-delivering sleep triggers a second sleep, never an early grant', async () => {
    const clock = makeClock()
    let sleepCalls = 0
    const sleep = vi.fn(async (ms: number) => {
      sleepCalls++
      // First sleep under-delivers (advances the clock by only half the
      // requested duration) — the throttle must re-check and sleep again
      // rather than granting early.
      clock.t += sleepCalls === 1 ? ms / 2 : ms
    })
    const throttle = createThrottle({ maxRequests: 12, windowMs: 60_000, now: clock.now, sleep })

    for (let i = 0; i < 12; i++) {
      await throttle.acquire()
    }
    await throttle.acquire()

    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep.mock.calls[0][0]).toBe(60_000) // first attempt: wait the full remaining window
    expect(sleep.mock.calls[1][0]).toBe(30_000) // second attempt: only the remaining 30_000ms was still short
    expect(clock.t).toBe(60_000) // grant only happens once the window is truly clear
  })

  it('two concurrent acquire bursts (6 + 7 = 13) share ONE window: exactly one sleep total, grants serialized', async () => {
    const clock = makeClock()
    const throttle = createThrottle({ maxRequests: 12, windowMs: 60_000, now: clock.now, sleep: clock.sleep })

    const burstA = Array.from({ length: 6 }, () => throttle.acquire())
    const burstB = Array.from({ length: 7 }, () => throttle.acquire())

    await Promise.all([...burstA, ...burstB])

    expect(clock.sleep).toHaveBeenCalledTimes(1)
    expect(clock.sleep).toHaveBeenCalledWith(60_000)
    expect(clock.t).toBe(60_000)
  })

  it('multi-waiter FIFO: staggered priming frees slots one at a time; 3 concurrent acquires grant in call order with sequenced sleeps', async () => {
    const clock = makeClock()
    const throttle = createThrottle({ maxRequests: 12, windowMs: 60_000, now: clock.now, sleep: clock.sleep })

    // Prime 12 grants at t = 0, 5_000, ..., 55_000 — the window slots free
    // one at a time (t=60_000, 65_000, 70_000), NOT all at once. This is
    // what makes the probe discriminating: with the promise chain stripped
    // (acquire = () => acquireOnce()), waiter 0's synchronous fake sleep
    // advances the clock past the oldest grant's expiry BEFORE waiter 1
    // even checks it, so waiter 1 steals the freed slot and grants FIRST —
    // breaking the FIFO order asserted below.
    for (let i = 0; i < 12; i++) {
      clock.t = i * 5_000
      await throttle.acquire()
    }
    expect(clock.sleep).not.toHaveBeenCalled()
    expect(clock.t).toBe(55_000)

    const order: number[] = []
    const grantTimes: number[] = []
    const waiters = [0, 1, 2].map((i) =>
      throttle.acquire().then(() => {
        order.push(i)
        grantTimes.push(clock.now())
      }),
    )
    await Promise.all(waiters)

    // FIFO grant order — the unchained mutant resolves waiter 1 first.
    expect(order).toEqual([0, 1, 2])
    // Each waiter grants exactly when "its" slot frees: one per 5s step.
    expect(grantTimes).toEqual([60_000, 65_000, 70_000])
    // Per-waiter sleep sequencing: each waiter waits only for the oldest
    // grant AT ITS TURN (5_000ms each), never a full-window reset.
    expect(clock.sleep.mock.calls.map((c) => c[0])).toEqual([5_000, 5_000, 5_000])
    expect(clock.t).toBe(70_000)
  })

  it('tail recovery: a rejected sleep fails only ITS acquire; the next acquire resolves fine with no unhandledRejection', async () => {
    const clock = makeClock()
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)

    try {
      const sleep = vi
        .fn<(ms: number) => Promise<void>>()
        .mockRejectedValueOnce(new Error('sleep boom'))
        .mockImplementation(async (ms: number) => {
          clock.t += ms
        })
      const throttle = createThrottle({ maxRequests: 12, windowMs: 60_000, now: clock.now, sleep })

      for (let i = 0; i < 12; i++) {
        await throttle.acquire()
      }

      // 13th acquire needs to sleep; the injected sleep rejects once.
      await expect(throttle.acquire()).rejects.toThrow('sleep boom')

      // Give any stray unhandled rejection a chance to surface.
      await new Promise((r) => setTimeout(r, 20))
      expect(unhandled).toEqual([])

      // The NEXT acquire must proceed normally (chain recovered), using the
      // now-default sleep behavior (full advance).
      await throttle.acquire()
      expect(clock.t).toBe(60_000)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('exports a module singleton volumeThrottle with an acquire method', () => {
    expect(volumeThrottle).toBeDefined()
    expect(typeof volumeThrottle.acquire).toBe('function')
  })
})
