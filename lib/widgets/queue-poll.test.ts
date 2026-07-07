// @vitest-environment jsdom
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { useQueueStatus } from './queue-poll'

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
})
