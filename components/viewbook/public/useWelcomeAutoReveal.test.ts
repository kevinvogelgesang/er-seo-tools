// @vitest-environment jsdom
// Task 12 (docs/superpowers/sdd/task-12-brief.md — Codex fixes 5-6): the hook
// is a one-shot "auto-reveal the welcome section after N ms" timer with a
// SYNCHRONOUS consume() the button/navigation can call to cancel it before it
// fires — no async React-state round trip. Coverage here targets every
// hardening detail called out in the brief: write-flag-before-expand(),
// re-reading the flag inside fire() (another tab/instance can win the race),
// the timer!==null/raf!==null ref guards (a rAF id of 0 is a valid id, NOT a
// falsy "unset" sentinel), the storage-event cross-tab cancel, and the
// module-level `memoryFlags` Set fallback when localStorage throws.
//
// Isolation note: the hook keeps a MODULE-level `memoryFlags` Set (the
// localStorage-unavailable fallback), which persists across every test in
// this file since the module import is cached. Rather than `vi.resetModules()`
// + a dynamic re-import per test (risky here — it would load a second copy of
// `react`, alongside the one `@testing-library/react` already holds, and
// break hook dispatch), every test gets a fresh, never-reused `viewbookId`
// via `nextId()`, so no test's key can ever collide with another's leftover
// Set entry or stored flag. The one test that deliberately exercises the
// Set's cross-mount persistence (localStorage-throws) does so within a
// single test, reusing its own id on purpose.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useWelcomeAutoReveal, welcomeRevealedKey } from './useWelcomeAutoReveal'

let stored = new Map<string, string>()
let idCounter = 0
function nextId(): number {
  idCounter += 1
  return idCounter
}

function stubWorkingLocalStorage() {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value)
    },
    removeItem: (key: string) => {
      stored.delete(key)
    },
    clear: () => stored.clear(),
  })
}

function fireStorage(key: string, newValue: string | null) {
  const evt = new Event('storage')
  Object.defineProperty(evt, 'key', { value: key })
  Object.defineProperty(evt, 'newValue', { value: newValue })
  window.dispatchEvent(evt)
}

beforeEach(() => {
  stored = new Map()
  stubWorkingLocalStorage()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('welcomeRevealedKey', () => {
  it('builds the documented localStorage key shape', () => {
    expect(welcomeRevealedKey(42)).toBe('vb:welcome-revealed:42')
  })
})

describe('useWelcomeAutoReveal — arming and firing', () => {
  it('fires once after delayMs when enabled/ready/collapsed/flag-unset: expand() called exactly once and the flag is written to "1"', async () => {
    vi.useFakeTimers()
    const id = nextId()
    const expand = vi.fn()
    renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: true, expand, delayMs: 5000 }),
    )
    expect(expand).not.toHaveBeenCalled()
    expect(stored.has(welcomeRevealedKey(id))).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(expand).toHaveBeenCalledTimes(1)
    expect(stored.get(welcomeRevealedKey(id))).toBe('1')
  })

  it('write-flag-before-expand(): the flag is persisted BEFORE expand() runs, not after', async () => {
    vi.useFakeTimers()
    const id = nextId()
    const key = welcomeRevealedKey(id)
    const order: string[] = []
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => {
        order.push('write')
        stored.set(k, v)
      },
      removeItem: (k: string) => stored.delete(k),
      clear: () => stored.clear(),
    })
    const expand = vi.fn(() => order.push('expand'))
    renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: true, expand, delayMs: 1000 }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(order).toEqual(['write', 'expand'])
    expect(stored.get(key)).toBe('1')
  })

  it('re-reads the flag inside fire(): if another tab/instance wrote the flag before the timer elapsed, expand() is NOT called (last mover loses)', async () => {
    vi.useFakeTimers()
    const id = nextId()
    const key = welcomeRevealedKey(id)
    const expand = vi.fn()
    renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: true, expand, delayMs: 5000 }),
    )

    // Simulate another tab/session claiming the flag directly (NOT via a
    // 'storage' event — same-document writes never dispatch 'storage' to
    // themselves, so this exercises the fire()-time re-read, not the
    // storage-event cancel path tested separately below).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999)
      stored.set(key, '1')
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(expand).not.toHaveBeenCalled()
  })

  it('no-op when the flag is already set to "1": expand() is never called', async () => {
    vi.useFakeTimers()
    const id = nextId()
    stored.set(welcomeRevealedKey(id), '1')
    const expand = vi.fn()
    renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: true, expand, delayMs: 1000 }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(expand).not.toHaveBeenCalled()
  })

  it('no-op when !ready: no timer is armed and the flag is never written', async () => {
    vi.useFakeTimers()
    const id = nextId()
    const expand = vi.fn()
    renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: false, collapsed: true, expand, delayMs: 1000 }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(expand).not.toHaveBeenCalled()
    expect(stored.has(welcomeRevealedKey(id))).toBe(false)
  })

  it('no-op when !enabled: no timer is armed and the flag is never written', async () => {
    vi.useFakeTimers()
    const id = nextId()
    const expand = vi.fn()
    renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: false, ready: true, collapsed: true, expand, delayMs: 1000 }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(expand).not.toHaveBeenCalled()
    expect(stored.has(welcomeRevealedKey(id))).toBe(false)
  })

  it('no-op when previewMode: no timer is armed and the flag is never written', async () => {
    vi.useFakeTimers()
    const id = nextId()
    const expand = vi.fn()
    renderHook(() =>
      useWelcomeAutoReveal({
        viewbookId: id, enabled: true, ready: true, collapsed: true, expand, delayMs: 1000, previewMode: true,
      }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(expand).not.toHaveBeenCalled()
    expect(stored.has(welcomeRevealedKey(id))).toBe(false)
  })

  it('already-expanded (collapsed=false) at arm time: the flag is written but expand() is never called', () => {
    const id = nextId()
    const expand = vi.fn()
    renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: false, expand, delayMs: 1000 }),
    )

    expect(stored.get(welcomeRevealedKey(id))).toBe('1')
    expect(expand).not.toHaveBeenCalled()
  })

  it('a stable re-render with unchanged props does not re-fire after the flag has already been consumed', async () => {
    vi.useFakeTimers()
    const id = nextId()
    const expand = vi.fn()
    const opts = { viewbookId: id, enabled: true, ready: true, collapsed: true, expand, delayMs: 1000 }
    const { rerender } = renderHook(() => useWelcomeAutoReveal(opts))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(expand).toHaveBeenCalledTimes(1)

    rerender()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(expand).toHaveBeenCalledTimes(1)
  })
})

describe('useWelcomeAutoReveal — delayMs=0 fires via requestAnimationFrame', () => {
  it('schedules a requestAnimationFrame (not a timer) when delayMs is 0, and firing it calls expand() once', () => {
    const id = nextId()
    let rafCallback: FrameRequestCallback | null = null
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallback = cb
      return 7
    })
    const expand = vi.fn()

    renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: true, expand, delayMs: 0 }),
    )

    expect(rafSpy).toHaveBeenCalledTimes(1)
    expect(expand).not.toHaveBeenCalled()

    act(() => {
      rafCallback?.(0)
    })

    expect(expand).toHaveBeenCalledTimes(1)
    expect(stored.get(welcomeRevealedKey(id))).toBe('1')
  })

  it('a negative delayMs also fires via requestAnimationFrame (delayMs <= 0)', () => {
    const id = nextId()
    let rafCallback: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallback = cb
      return 1
    })
    const expand = vi.fn()

    renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: true, expand, delayMs: -1 }),
    )

    act(() => {
      rafCallback?.(0)
    })

    expect(expand).toHaveBeenCalledTimes(1)
  })

  it('a rAF id of 0 is a valid scheduled id — unmounting before it fires still cancels it (the ref guard is `!== null`, not truthiness)', () => {
    const id = nextId()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
    const expand = vi.fn()

    const { unmount } = renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: true, expand, delayMs: 0 }),
    )

    unmount()

    expect(cancelSpy).toHaveBeenCalledWith(0)
    expect(expand).not.toHaveBeenCalled()
  })
})

describe('useWelcomeAutoReveal — consume()', () => {
  it('consume() called before the timer fires cancels it, writes the flag, and expand() is never called afterward', async () => {
    vi.useFakeTimers()
    const id = nextId()
    const expand = vi.fn()
    const { result } = renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: true, expand, delayMs: 5000 }),
    )

    act(() => {
      result.current.consume()
    })

    expect(stored.get(welcomeRevealedKey(id))).toBe('1')
    expect(expand).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(expand).not.toHaveBeenCalled()
  })

  it('consume() before a delayMs=0 rAF fires cancels the frame via cancelAnimationFrame and expand() is never called', () => {
    const id = nextId()
    let rafCallback: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallback = cb
      return 3
    })
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
    const expand = vi.fn()
    const { result } = renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: true, expand, delayMs: 0 }),
    )

    act(() => {
      result.current.consume()
    })

    expect(cancelSpy).toHaveBeenCalledWith(3)
    expect(stored.get(welcomeRevealedKey(id))).toBe('1')

    // Manually invoking the raw stored callback proves nothing about the real
    // browser (a truly cancelled rAF never invokes its callback) — it only
    // confirms the hook's OWN re-entrancy guard: fire() re-reads the flag and
    // bails, so even a "leaked" invocation is inert.
    act(() => {
      rafCallback?.(0)
    })
    expect(expand).not.toHaveBeenCalled()
  })

  it('consume() is a no-op-safe call when nothing was ever armed (flag already set at mount)', () => {
    const id = nextId()
    stored.set(welcomeRevealedKey(id), '1')
    const expand = vi.fn()
    const { result } = renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: true, expand, delayMs: 1000 }),
    )

    expect(() => {
      act(() => {
        result.current.consume()
      })
    }).not.toThrow()
    expect(expand).not.toHaveBeenCalled()
  })
})

describe('useWelcomeAutoReveal — unmount cleanup (no leak)', () => {
  it('unmounting before a setTimeout fires clears it: expand() is never called even after the original delay elapses', async () => {
    vi.useFakeTimers()
    const id = nextId()
    const expand = vi.fn()
    const { unmount } = renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: true, expand, delayMs: 5000 }),
    )

    unmount()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(expand).not.toHaveBeenCalled()
    expect(stored.has(welcomeRevealedKey(id))).toBe(false)
  })

  it('removes the storage listener on unmount, using the SAME handler reference that was added (no leak)', () => {
    const id = nextId()
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: true, expand: vi.fn(), delayMs: 5000 }),
    )

    const addCall = addSpy.mock.calls.find(([type]) => type === 'storage')
    expect(addCall).toBeTruthy()

    unmount()

    const removeCall = removeSpy.mock.calls.find(([type]) => type === 'storage')
    expect(removeCall).toBeTruthy()
    expect(removeCall?.[1]).toBe(addCall?.[1])
  })

  it('does not attach a storage listener at all when the effect returns early (flag already set)', () => {
    const id = nextId()
    stored.set(welcomeRevealedKey(id), '1')
    const addSpy = vi.spyOn(window, 'addEventListener')
    renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: true, expand: vi.fn(), delayMs: 5000 }),
    )

    expect(addSpy.mock.calls.some(([type]) => type === 'storage')).toBe(false)
  })
})

describe('useWelcomeAutoReveal — cross-tab storage event cancels a pending timer', () => {
  it('a "storage" event setting this key to "1" cancels the pending setTimeout; expand() is never called', async () => {
    vi.useFakeTimers()
    const id = nextId()
    const key = welcomeRevealedKey(id)
    const expand = vi.fn()
    renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: true, expand, delayMs: 5000 }),
    )

    act(() => {
      fireStorage(key, '1')
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(expand).not.toHaveBeenCalled()
  })

  it('a "storage" event for a DIFFERENT key does not cancel this timer', async () => {
    vi.useFakeTimers()
    const id = nextId()
    const otherKey = welcomeRevealedKey(nextId())
    const expand = vi.fn()
    renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: true, expand, delayMs: 5000 }),
    )

    act(() => {
      fireStorage(otherKey, '1')
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(expand).toHaveBeenCalledTimes(1)
  })

  it('a "storage" event on this key with newValue !== "1" does not cancel the timer', async () => {
    vi.useFakeTimers()
    const id = nextId()
    const key = welcomeRevealedKey(id)
    const expand = vi.fn()
    renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: true, expand, delayMs: 5000 }),
    )

    act(() => {
      fireStorage(key, null) // e.g. removeItem in another tab
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(expand).toHaveBeenCalledTimes(1)
  })
})

describe('useWelcomeAutoReveal — localStorage throws: module-level Set fallback', () => {
  it('prevents a second arm within the same session when localStorage.getItem/setItem both throw', async () => {
    vi.useFakeTimers()
    const throwingStorage = {
      getItem: () => {
        throw new Error('storage blocked')
      },
      setItem: () => {
        throw new Error('storage blocked')
      },
      removeItem: () => {},
      clear: () => {},
    }
    vi.stubGlobal('localStorage', throwingStorage)
    const id = nextId()

    const expandFirst = vi.fn()
    const first = renderHook(() =>
      useWelcomeAutoReveal({
        viewbookId: id, enabled: true, ready: true, collapsed: true, expand: expandFirst, delayMs: 1000,
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(expandFirst).toHaveBeenCalledTimes(1)
    first.unmount()

    // Same session (same in-memory module, same `memoryFlags` Set) — a later
    // mount of the SAME viewbookId (e.g. remounting the welcome section after
    // navigating away and back) must not re-arm and fire again.
    const expandSecond = vi.fn()
    renderHook(() =>
      useWelcomeAutoReveal({
        viewbookId: id, enabled: true, ready: true, collapsed: true, expand: expandSecond, delayMs: 1000,
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(expandSecond).not.toHaveBeenCalled()
  })

  it('consume() also falls back to the in-memory Set when localStorage.setItem throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {},
      clear: () => {},
    })
    const id = nextId()
    const expand = vi.fn()
    const { result } = renderHook(() =>
      useWelcomeAutoReveal({ viewbookId: id, enabled: true, ready: true, collapsed: true, expand, delayMs: 5000 }),
    )

    expect(() => {
      act(() => {
        result.current.consume()
      })
    }).not.toThrow()
  })
})
