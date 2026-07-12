// @vitest-environment jsdom
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

// queue-poll.ts imports @/lib/events/client at module scope, so it MUST be
// mocked before the store is imported (else jsdom hits a native EventSource
// that doesn't exist). The mock exposes controllable subscribeTopic/
// subscribeHealth fakes plus __fire()/__setHealth() test helpers.
vi.mock('@/lib/events/client', () => {
  let invalidate: () => void = () => {}
  let health: (h: boolean) => void = () => {}
  return {
    subscribeTopic: (_topic: string, cb: () => void) => { invalidate = cb; return () => {} },
    subscribeHealth: (cb: (h: boolean) => void) => { health = cb; cb(false); return () => {} },
    __fire: () => invalidate(),
    __setHealth: (h: boolean) => health(h),
  }
})

import { useQueueStatus } from './queue-poll'
import * as eventsClient from '@/lib/events/client'
const { __fire, __setHealth } = eventsClient as unknown as { __fire: () => void; __setHealth: (h: boolean) => void }

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
beforeEach(() => { vi.restoreAllMocks() })

const snapshot = { active: null, queued: [], batch: null }

describe('useQueueStatus', () => {
  it('fetches once and shares the result across two subscribers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot })
    vi.stubGlobal('fetch', fetchMock)

    const a = renderHook(() => useQueueStatus())
    const b = renderHook(() => useQueueStatus())

    await waitFor(() => expect(a.result.current.data).toEqual(snapshot))
    expect(b.result.current.data).toEqual(snapshot)
    // Two mounts in the same tick share ONE fetch (module-level store).
    expect(fetchMock).toHaveBeenCalledTimes(1)

    a.unmount(); b.unmount()
  })

  it('reports error=true when the fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    const { result } = renderHook(() => useQueueStatus())
    await waitFor(() => expect(result.current.error).toBe(true))
  })

  it('does not stack requests when a tick fires while a fetch is still pending', async () => {
    // A fetch that never resolves within the test: the interval must not
    // launch a second request while the first is in flight (Codex fix 1).
    vi.useFakeTimers()
    let resolveFetch: (v: unknown) => void = () => {}
    const fetchMock = vi.fn(() => new Promise((res) => { resolveFetch = res }))
    vi.stubGlobal('fetch', fetchMock)

    const { unmount } = renderHook(() => useQueueStatus())
    // Immediate fetch on first subscriber.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Advance past the 5s interval twice while the first fetch is still pending.
    await vi.advanceTimersByTimeAsync(11000)
    expect(fetchMock).toHaveBeenCalledTimes(1) // inFlight guard dropped both ticks

    resolveFetch({ ok: true, json: async () => snapshot })
    unmount()
  })

  it('refetches when the queue topic invalidate handler fires', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot })
    vi.stubGlobal('fetch', fetchMock)

    const { unmount } = renderHook(() => useQueueStatus())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    __fire()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    unmount()
  })

  it('polls at 5s while unhealthy, then demotes to a 60s safety poll once healthy', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot })
    vi.stubGlobal('fetch', fetchMock)

    const { unmount } = renderHook(() => useQueueStatus())
    // Initial fetch on mount.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Unhealthy cadence: 5s interval.
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // Health flips true: the health callback itself fires an immediate tick,
    // and the interval demotes to 60s.
    __setHealth(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    // 5s later (well under the new 60s cadence) — no new fetch.
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    // Advance to the full 60s safety interval — exactly one more fetch.
    await vi.advanceTimersByTimeAsync(55000)
    expect(fetchMock).toHaveBeenCalledTimes(4)

    unmount()
  })
})
