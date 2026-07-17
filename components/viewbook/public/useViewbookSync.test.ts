// @vitest-environment jsdom
//
// PR2 Task 6 — contract tests for the useViewbookSync hook and its
// module-level editor registry. This hook is the SINGLE refresher: it polls
// a cheap {v} endpoint and only ever calls onChange when the registry
// (registerEditorActivity) is idle, coalescing poll-detected changes with
// explicit requestRefresh() calls. Mirrors the fake-timer + mocked-fetch
// harness conventions used by components/handoff/useMemoPoller.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import {
  __resetSyncRegistry,
  registerEditorActivity,
  requestRefresh,
  useEditorActivity,
  useViewbookSync,
  type UseViewbookSyncOpts,
} from './useViewbookSync'

async function flushAsync(times = 10) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

function jsonResponse(v: number) {
  return { status: 200, ok: true, json: async () => ({ v }) }
}

function notFoundResponse() {
  return { status: 404, ok: false, json: async () => ({}) }
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  __resetSyncRegistry()
  setVisibility('visible')
})

afterEach(() => {
  cleanup()
  __resetSyncRegistry()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useViewbookSync', () => {
  it('fires onChange once when the polled version changes', async () => {
    const onChange = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(2)))
    renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange, intervalMs: 1000 }))
    await act(async () => {
      await flushAsync()
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does not call onChange when the polled version is unchanged', async () => {
    const onChange = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(1)))
    renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange, intervalMs: 1000 }))
    await act(async () => {
      await flushAsync()
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('latches after a detected change (no repeat onChange until initialVersion catches up), then re-arms', async () => {
    const onChange = vi.fn()
    let remoteV = 2
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(remoteV)))
    const { rerender } = renderHook(
      (props: UseViewbookSyncOpts) => useViewbookSync(props),
      { initialProps: { url: '/sync', initialVersion: 1, onChange, intervalMs: 1000 } },
    )
    await act(async () => {
      await flushAsync()
    })
    expect(onChange).toHaveBeenCalledTimes(1)

    // Server still reports v=2 (nothing new happened), and the RSC refresh
    // hasn't landed yet (initialVersion prop still 1) — must NOT fire again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onChange).toHaveBeenCalledTimes(1)

    // The refresh lands: initialVersion prop advances to 2. This re-arms the
    // latch for a genuinely NEW future change.
    rerender({ url: '/sync', initialVersion: 2, onChange, intervalMs: 1000 })
    await act(async () => {
      await flushAsync()
    })

    remoteV = 3
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('coalesces a poll-detected change with a requestRefresh() call into ONE onChange', async () => {
    const onChange = vi.fn()
    let remoteV = 1
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(remoteV)))
    renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange, intervalMs: 1000 }))
    await act(async () => {
      await flushAsync()
    })
    expect(onChange).not.toHaveBeenCalled() // no change yet — nothing to coalesce

    remoteV = 2
    requestRefresh()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('suppresses onChange while an editor is registered active, and flushes exactly one refresh on release', async () => {
    const onChange = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(2)))
    registerEditorActivity('editor-1', true)
    renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange, intervalMs: 1000 }))
    await act(async () => {
      await flushAsync()
    })
    expect(onChange).not.toHaveBeenCalled()

    await act(async () => {
      registerEditorActivity('editor-1', false)
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  // PR2 Task 6 fix wave — per-keystroke idle-window flush. Every editor
  // island's registration effect used to inline
  // `useEffect(() => { registerEditorActivity(id, active); return () =>
  // registerEditorActivity(id, false) }, [...draft state])` — the cleanup
  // ran on EVERY dependency change, so a keystroke (draft string changes,
  // deps re-evaluate) unregistered then immediately re-registered the SAME
  // id synchronously, with nothing awaited in between. If that transient
  // unregister happened to be the only active editor, the OLD synchronous
  // idle-transition flush would fire a held refresh mid-keystroke, clobbering
  // the operator's draft. The fix defers the idle notification to a
  // microtask and re-checks idleness before running it.
  it('a synchronous unregister→re-register (simulated keystroke) with a held refresh does not fire onChange', async () => {
    const onChange = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(2)))
    registerEditorActivity('editor-1', true)
    renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange, intervalMs: 1000 }))
    await act(async () => {
      await flushAsync()
    })
    expect(onChange).not.toHaveBeenCalled() // detected but held — registry still active

    // Simulate one keystroke's effect cleanup+re-run: unregister then
    // immediately re-register the SAME id synchronously, no await between —
    // exactly what the pre-`useEditorActivity` inline pattern did on every
    // dependency change.
    registerEditorActivity('editor-1', false)
    registerEditorActivity('editor-1', true)
    await act(async () => {
      await flushAsync()
    })
    expect(onChange).not.toHaveBeenCalled() // transient idle window — still active, must not flush

    // A genuine release afterward still works normally.
    await act(async () => {
      registerEditorActivity('editor-1', false)
      await flushAsync()
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('a real release (stays idle across the microtask) flushes exactly once', async () => {
    const onChange = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(2)))
    registerEditorActivity('editor-1', true)
    renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange, intervalMs: 1000 }))
    await act(async () => {
      await flushAsync()
    })
    expect(onChange).not.toHaveBeenCalled()

    registerEditorActivity('editor-1', false) // a genuine release — no re-register follows
    expect(onChange).not.toHaveBeenCalled() // flush is deferred to a microtask, not synchronous

    await act(async () => {
      await flushAsync()
    })
    expect(onChange).toHaveBeenCalledTimes(1)

    // Nothing further fires on subsequent flushes.
    await act(async () => {
      await flushAsync()
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  // PR2 Task 6 fix wave — MINOR: the latched early-return must consume
  // pendingRefresh (and the stale-observed value) rather than leaving them
  // to fire a spare onChange once the latch clears.
  it('a requestRefresh() arriving while latched is consumed — no extra onChange once the latch clears', async () => {
    const onChange = vi.fn()
    const remoteV = 2
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(remoteV)))
    const { rerender } = renderHook(
      (props: UseViewbookSyncOpts) => useViewbookSync(props),
      { initialProps: { url: '/sync', initialVersion: 1, onChange, intervalMs: 1000 } },
    )
    await act(async () => {
      await flushAsync()
    })
    expect(onChange).toHaveBeenCalledTimes(1) // armed the latch at v=2

    // A requestRefresh() arrives while still latched (initialVersion prop
    // hasn't caught up yet, and the server still reports the SAME v=2 the
    // latch is already waiting to confirm) — its intent is already covered
    // by the pending latch, so it must not survive to fire a spare onChange
    // once that latch clears.
    requestRefresh()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
      await flushAsync()
    })
    expect(onChange).toHaveBeenCalledTimes(1)

    // The refresh lands: initialVersion catches up, clearing the latch. The
    // server still reports the SAME v=2 — nothing genuinely new.
    rerender({ url: '/sync', initialVersion: 2, onChange, intervalMs: 1000 })
    await act(async () => {
      await flushAsync()
      await vi.advanceTimersByTimeAsync(1000) // next natural tick, still v=2
    })
    expect(onChange).toHaveBeenCalledTimes(1) // no spare fire
  })

  it('a terminal 404 calls the provided onGone exactly once and stops polling permanently', async () => {
    const onChange = vi.fn()
    const onGone = vi.fn()
    const fetchMock = vi.fn(async () => notFoundResponse())
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange, onGone, intervalMs: 1000 }))
    await act(async () => {
      await flushAsync()
    })
    expect(onGone).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()

    const callsBefore = fetchMock.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(fetchMock.mock.calls.length).toBe(callsBefore) // never polls again
  })

  it('a terminal 404 falls back to onChange when onGone is not provided', async () => {
    const onChange = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => notFoundResponse()))
    renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange, intervalMs: 1000 }))
    await act(async () => {
      await flushAsync()
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('doubles the backoff on repeated fetch errors, capped at 30s, and resets to the base cadence on recovery', async () => {
    let fail = true
    const fetchMock = vi.fn(async () => {
      if (fail) throw new Error('network down')
      return jsonResponse(1) // unchanged — isolates cadence from change-detection
    })
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange: vi.fn() })) // default intervalMs 3500
    await act(async () => {
      await flushAsync()
    })
    let calls = fetchMock.mock.calls.length
    expect(calls).toBe(1)

    // 3500 -> 7000 -> 14000 -> 28000 -> 30000 (capped) -> 30000 (capped)
    for (const delay of [7000, 14000, 28000, 30000, 30000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay - 1)
      })
      expect(fetchMock.mock.calls.length).toBe(calls) // not yet
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
        await flushAsync()
      })
      expect(fetchMock.mock.calls.length).toBe(calls + 1)
      calls += 1
    }

    // Recover: the next tick succeeds, resetting backoff to the base 3500ms.
    fail = false
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
      await flushAsync()
    })
    calls = fetchMock.mock.calls.length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3499)
    })
    expect(fetchMock.mock.calls.length).toBe(calls)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(fetchMock.mock.calls.length).toBe(calls + 1)
  })

  it('does nothing while document.visibilityState is hidden, and checks immediately when it becomes visible', async () => {
    setVisibility('hidden')
    const fetchMock = vi.fn(async () => jsonResponse(1))
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange: vi.fn(), intervalMs: 1000 }))
    await act(async () => {
      await flushAsync()
    })
    expect(fetchMock).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchMock).not.toHaveBeenCalled()

    await act(async () => {
      setVisibility('visible')
      await flushAsync()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ignores a fetch that resolves after unmount (no onChange, no crash)', async () => {
    const onChange = vi.fn()
    let resolveFetch: ((value: unknown) => void) | null = null
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveFetch = resolve })))
    const { unmount } = renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange, intervalMs: 1000 }))
    await act(async () => {
      await flushAsync()
    })
    unmount()
    await act(async () => {
      resolveFetch!(jsonResponse(2))
      await flushAsync()
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('never overlaps polls — the next tick is scheduled only after the previous one settles (recursive timeout, not setInterval)', async () => {
    let resolveFetch: ((value: unknown) => void) | null = null
    const fetchMock = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange: vi.fn(), intervalMs: 1000 }))
    await act(async () => {
      await flushAsync()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Well past several intervals while the first fetch is still pending —
    // a setInterval-based implementation would have fired again by now.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFetch!(jsonResponse(1))
      await flushAsync()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('__resetSyncRegistry clears leftover active editors and pendingRefresh between tests', async () => {
    registerEditorActivity('leftover-editor', true) // nothing else ever unregisters this id
    requestRefresh()
    __resetSyncRegistry()

    const onChange = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(2)))
    renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange, intervalMs: 1000 }))
    await act(async () => {
      await flushAsync()
    })
    // If the leftover active editor had survived the reset, this would stay
    // suppressed forever.
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('tolerates a synchronous Strict-Mode-style mount/unmount/mount without warning, but warns when two instances genuinely coexist', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(1)))

    const first = renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange: vi.fn() }))
    first.unmount()
    const survivor = renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange: vi.fn() }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(warnSpy).not.toHaveBeenCalled()
    survivor.unmount()

    warnSpy.mockClear()
    const a = renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange: vi.fn() }))
    const b = renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange: vi.fn() }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    a.unmount()
    b.unmount()
    warnSpy.mockRestore()
  })

  // PR2 Task 6 fix wave — NIT: the admin editor used to pass a placeholder
  // `initialVersion` (`vb?.syncVersion ?? 0`) before its mount-time load()
  // resolved, so the poll started immediately and could observe the REAL
  // version as a "change" from the placeholder — a redundant second load.
  // `enabled` gates the hook off until the real version is available.
  it('enabled:false does not poll; flipping it true starts polling using the current initialVersion', async () => {
    const onChange = vi.fn()
    const fetchMock = vi.fn(async () => jsonResponse(5))
    vi.stubGlobal('fetch', fetchMock)
    const { rerender } = renderHook(
      (props: UseViewbookSyncOpts) => useViewbookSync(props),
      { initialProps: { url: '/sync', initialVersion: 0, onChange, intervalMs: 1000, enabled: false } },
    )
    await act(async () => {
      await flushAsync()
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()

    // The "load" resolves: the real version (5, matching what the server
    // will report) is now known, and the hook is enabled.
    rerender({ url: '/sync', initialVersion: 5, onChange, intervalMs: 1000, enabled: true })
    await act(async () => {
      await flushAsync()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // The real version already matches what was passed — no bogus "change"
    // detected against a stale placeholder, so no redundant onChange.
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('useEditorActivity', () => {
  it('registers the initial active level on mount and unregisters on unmount', async () => {
    const onChange = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(2)))
    const { unmount } = renderHook(() => useEditorActivity('hook-editor', true))
    renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange, intervalMs: 1000 }))
    await act(async () => {
      await flushAsync()
    })
    expect(onChange).not.toHaveBeenCalled() // registered active — suppresses the refresher

    unmount()
    await act(async () => {
      await flushAsync()
    })
    expect(onChange).toHaveBeenCalledTimes(1) // unmount unregistered it — flush released
  })

  it('updates the active level on a dependency change WITHOUT unregistering — no per-keystroke idle window', async () => {
    const onChange = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(2)))
    const { rerender } = renderHook(({ active }: { active: boolean }) => useEditorActivity('hook-editor-2', active), {
      initialProps: { active: true },
    })
    renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange, intervalMs: 1000 }))
    await act(async () => {
      await flushAsync()
    })
    expect(onChange).not.toHaveBeenCalled()

    // Simulate a keystroke: `active` stays true across the re-render (the
    // draft is still non-empty), which is the common case this hook must
    // handle WITHOUT ever unregistering mid-edit.
    await act(async () => {
      rerender({ active: true })
      await flushAsync()
    })
    expect(onChange).not.toHaveBeenCalled() // never unregistered — still suppressed

    // A real transition to inactive DOES unregister (via the level effect,
    // not the unmount effect) and releases the refresher.
    await act(async () => {
      rerender({ active: false })
      await flushAsync()
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
