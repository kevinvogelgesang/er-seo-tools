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
  hasActiveEditorActivity,
  registerEditorActivity,
  requestRefresh,
  useAutosave,
  useBaselineSync,
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

  // Final-review CRITICAL fix — latch deadlock via a stale pendingObservedRef.
  // Trace: tick observes vA -> onChange fires, latch armed at vA. While
  // still latched, a LATER tick observes vB > vA -> pendingObservedRef holds
  // vB. The refresh for vA then lands ALREADY at vB (the server moved on
  // before the RSC refresh resolved) — the latch correctly clears (vB >=
  // vA), but the leftover pendingObservedRef=vB used to survive untouched.
  // The NEXT tick (server still at vB) would re-observe that same
  // already-satisfied value, tryFlush would misread it as fresh, arm a new
  // latch on it, and that latch could never clear again (initialVersion
  // can't "catch up" to a value it's already caught up to) — live sync dead
  // until reload. Both the tryFlush() discard AND the initialVersion effect
  // discard are required to close this; this test exercises the full trace.
  it('CRITICAL: a refresh landing past a stale pendingObserved value does not deadlock the latch — a later genuine bump still fires onChange', async () => {
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
    expect(onChange).toHaveBeenCalledTimes(1) // latch armed at v=2

    // Server advances AGAIN to v=3 while still latched on v=2 (refresh for
    // v=2 hasn't landed yet) — pendingObservedRef now holds the newer v=3.
    remoteV = 3
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onChange).toHaveBeenCalledTimes(1) // still latched — held, not fired

    // The refresh lands, but ALREADY at v=3 (the server moved on before this
    // RSC refresh resolved) — initialVersion jumps straight past both v=2
    // and the pendingObserved v=3.
    rerender({ url: '/sync', initialVersion: 3, onChange, intervalMs: 1000 })
    await act(async () => {
      await flushAsync()
    })

    // Nothing new from the server yet (still v=3) — must NOT fire a spare
    // onChange from the leftover pendingObservedRef=3 the props already
    // reflect. This is the assertion that fails without the fix.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onChange).toHaveBeenCalledTimes(1)

    // A genuinely NEW bump afterward must still fire — this is exactly what
    // deadlocked permanently before the fix.
    remoteV = 4
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

  // Final-review P2 fix — a bare pendingRefresh (no observed version yet)
  // queued while a sync fetch is already in flight must stay queued rather
  // than firing a blind refresh the moment an editor releases mid-fetch —
  // the in-flight tick's OWN post-resolve flush must be the ONLY one that
  // fires, coalescing into a single onChange instead of two.
  it('P2: a bare pendingRefresh queued during an in-flight poll does not double-fire once the editor releases and the fetch resolves', async () => {
    const onChange = vi.fn()
    let resolveFetch: ((value: unknown) => void) | null = null
    const fetchMock = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    registerEditorActivity('editor-1', true) // busy editor — suppresses onChange
    renderHook(() => useViewbookSync({ url: '/sync', initialVersion: 1, onChange, intervalMs: 1000 }))
    expect(fetchMock).toHaveBeenCalledTimes(1) // mount tick's fetch is now in flight

    // requestRefresh() arrives while the editor is still busy AND the mount
    // tick's fetch is still outstanding — triggerTick() is a no-op (a tick is
    // already inFlight), so this only sets the bare pendingRefresh flag.
    requestRefresh()

    // The editor releases WHILE the fetch is still outstanding.
    await act(async () => {
      registerEditorActivity('editor-1', false)
      await flushAsync()
    })
    expect(onChange).not.toHaveBeenCalled() // deferred — fetch still in flight

    // The in-flight fetch resolves with a genuinely newer version.
    await act(async () => {
      resolveFetch!(jsonResponse(2))
      await flushAsync()
    })
    expect(onChange).toHaveBeenCalledTimes(1) // exactly one refresh, not two
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

// Task 5 — SectionReveal (components/viewbook/public/SectionReveal.tsx) uses
// this read-only query to suppress scroll-collapse while ANY editor island is
// active, including the operator inline editors that render OUTSIDE a given
// SectionShell's DOM (a local focus/`contains` check can't see those; this
// module-level registry can). This is a pure reflection of the same registry
// `registerEditorActivity` writes to — no separate state to drift.
describe('hasActiveEditorActivity', () => {
  it('reflects the registry: false when idle, true while any id is active, false again once released', () => {
    __resetSyncRegistry()
    expect(hasActiveEditorActivity()).toBe(false)
    registerEditorActivity('field-1', true)
    expect(hasActiveEditorActivity()).toBe(true)
    registerEditorActivity('field-1', false)
    expect(hasActiveEditorActivity()).toBe(false)
  })

  it('stays true while at least one of several registered ids remains active', () => {
    __resetSyncRegistry()
    registerEditorActivity('field-1', true)
    registerEditorActivity('field-2', true)
    registerEditorActivity('field-1', false)
    expect(hasActiveEditorActivity()).toBe(true) // field-2 still active
    registerEditorActivity('field-2', false)
    expect(hasActiveEditorActivity()).toBe(false)
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

describe('useAutosave', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('saves once after a 600ms trailing debounce and requests refresh only after commit', async () => {
    const save = vi.fn(async (draft: string) => draft)
    const onQueueDrained = vi.fn()
    const hook = renderHook(() => {
      const baseline = useBaselineSync('old', false)
      const autosave = useAutosave({
        editorId: 'autosave-debounce',
        draft: baseline.draft,
        dirty: baseline.dirty,
        save,
        commit: baseline.commit,
        onQueueDrained,
      })
      return { ...baseline, ...autosave }
    })

    act(() => hook.result.current.setDraft('new'))
    expect(hasActiveEditorActivity()).toBe(true)
    await act(async () => vi.advanceTimersByTimeAsync(599))
    expect(save).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
      await flushAsync()
    })

    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith('new')
    expect(onQueueDrained).toHaveBeenCalledOnce()
    expect(hook.result.current.dirty).toBe(false)
    expect(hasActiveEditorActivity()).toBe(false)
  })

  it('flushes the queued draft immediately when blur asks it to flush', async () => {
    const save = vi.fn(async (draft: string) => draft)
    const hook = renderHook(() => {
      const baseline = useBaselineSync('old', false)
      const autosave = useAutosave({
        editorId: 'autosave-blur',
        draft: baseline.draft,
        dirty: baseline.dirty,
        save,
        commit: baseline.commit,
        onQueueDrained: vi.fn(),
      })
      return { ...baseline, ...autosave }
    })

    act(() => hook.result.current.setDraft('blurred'))
    await act(async () => {
      hook.result.current.flush()
      await flushAsync()
    })
    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith('blurred')
  })

  it('serializes requests, coalesces to the latest queued draft, and ignores the stale first response', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const onQueueDrained = vi.fn()
    const committed: string[] = []
    const hook = renderHook(() => {
      const baseline = useBaselineSync('old', false)
      const autosave = useAutosave({
        editorId: 'autosave-queue',
        draft: baseline.draft,
        dirty: baseline.dirty,
        save,
        commit: (value) => {
          committed.push(value)
          baseline.commit(value)
        },
        onQueueDrained,
      })
      return { ...baseline, ...autosave }
    })

    act(() => hook.result.current.setDraft('first'))
    await act(async () => vi.advanceTimersByTimeAsync(600))
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenLastCalledWith('first')

    act(() => hook.result.current.setDraft('second'))
    act(() => hook.result.current.setDraft('latest'))
    await act(async () => vi.advanceTimersByTimeAsync(600))
    expect(save).toHaveBeenCalledTimes(1)
    expect(hasActiveEditorActivity()).toBe(true)

    await act(async () => {
      first.resolve('stale-server-response')
      await flushAsync()
    })
    expect(committed).toEqual([])
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith('latest')
    expect(onQueueDrained).not.toHaveBeenCalled()
    expect(hasActiveEditorActivity()).toBe(true)

    await act(async () => {
      second.resolve('latest')
      await flushAsync()
    })
    expect(committed).toEqual(['latest'])
    expect(onQueueDrained).toHaveBeenCalledOnce()
    expect(hasActiveEditorActivity()).toBe(false)
  })

  it('pauses on a classified conflict and retries only after the explicit resume action', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('stale_version'))
      .mockResolvedValueOnce('mine')
    const hook = renderHook(() => {
      const baseline = useBaselineSync('server', false)
      const autosave = useAutosave({
        editorId: 'autosave-conflict',
        draft: baseline.draft,
        dirty: baseline.dirty,
        save,
        commit: baseline.commit,
        onError: () => 'pause',
        onQueueDrained: vi.fn(),
      })
      return { ...baseline, ...autosave }
    })

    act(() => hook.result.current.setDraft('mine'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
      await flushAsync()
    })
    expect(hook.result.current.paused).toBe(true)
    expect(hook.result.current.draft).toBe('mine')

    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(save).toHaveBeenCalledTimes(1)
    await act(async () => {
      hook.result.current.resume()
      await flushAsync()
    })
    expect(save).toHaveBeenCalledTimes(2)
    expect(hook.result.current.paused).toBe(false)
  })
})
