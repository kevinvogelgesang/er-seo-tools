'use client'

// PR2 Task 6: the SINGLE refresher. Every mutation bumps Viewbook.syncVersion
// (Tasks 1-5); this hook polls the cheap version endpoint and is the ONLY
// thing that calls a page-level refresh (router.refresh() on the public
// page, load() on the admin editor) — the v1 per-mutation router.refresh()
// calls are removed in favor of requestRefresh() (see the island migrations).
//
// Module-level editor registry: every editing island (FieldEditor,
// AmendmentForm, MaterialLinkForm, FeedbackThread registration-only, and the
// admin Theme/Content/DataSource/Milestones/Settings islands) registers its
// dirty/focused/saving state here via registerEditorActivity(). The hook
// only ever calls onChange while the registry is idle — an in-flight
// refresh must never clobber an in-progress edit.
import { useEffect, useRef, useState, type FocusEvent } from 'react'

// ---------------------------------------------------------------------------
// Module-level registry
// ---------------------------------------------------------------------------

const activeEditors = new Map<string, boolean>()
const idleListeners = new Set<() => void>()
const pendingRefreshListeners = new Set<() => void>()
let pendingRefresh = false
let liveInstances = 0
let hasWarnedOverlap = false

function isRegistryIdle(): boolean {
  for (const active of activeEditors.values()) {
    if (active) return false
  }
  return true
}

/**
 * Islands call this on focus/dirty/save-in-flight transitions. Call with
 * `active: false` (or rely on the unmount cleanup calling it) to dispose.
 */
export function registerEditorActivity(id: string, active: boolean): void {
  const wasIdle = isRegistryIdle()
  if (active) {
    activeEditors.set(id, true)
  } else {
    activeEditors.delete(id)
  }
  if (!wasIdle && isRegistryIdle()) {
    for (const listener of Array.from(idleListeners)) listener()
  }
}

/** Marks a pending refresh; the polling hook flushes it once the registry is idle. */
export function requestRefresh(): void {
  pendingRefresh = true
  for (const listener of Array.from(pendingRefreshListeners)) listener()
}

function subscribeIdle(listener: () => void): () => void {
  idleListeners.add(listener)
  return () => idleListeners.delete(listener)
}

function subscribePendingRefresh(listener: () => void): () => void {
  pendingRefreshListeners.add(listener)
  return () => pendingRefreshListeners.delete(listener)
}

/** Test-only seam: resets ALL module state. Call in beforeEach/afterEach. */
export function __resetSyncRegistry(): void {
  activeEditors.clear()
  idleListeners.clear()
  pendingRefreshListeners.clear()
  pendingRefresh = false
  liveInstances = 0
  hasWarnedOverlap = false
}

// ---------------------------------------------------------------------------
// useFocusWithin — shared "does focus remain inside this container" tracker
// for the editor islands' dirty-detection (a container with several inputs
// must not flicker idle while tabbing between its own fields).
// ---------------------------------------------------------------------------

export function useFocusWithin(): {
  focused: boolean
  onFocus: () => void
  onBlur: (event: FocusEvent<HTMLElement>) => void
} {
  const [focused, setFocused] = useState(false)
  return {
    focused,
    onFocus: () => setFocused(true),
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setFocused(false)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// useViewbookSync
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 3500
const MAX_BACKOFF_MS = 30_000

export interface UseViewbookSyncOpts {
  /** Version endpoint returning `{ v: number }`. */
  url: string
  /** The syncVersion the CURRENT server-rendered props reflect. */
  initialVersion: number
  /** Poll cadence while visible and healthy. Defaults to 3.5s. */
  intervalMs?: number
  /** Called exactly once per coalesced refresh, when the registry is idle. */
  onChange: () => void
  /** Called (instead of onChange) on a terminal 404 — defaults to onChange. */
  onGone?: () => void
}

export function useViewbookSync(opts: UseViewbookSyncOpts): void {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS

  // Freshness refs: read the LATEST option every tick without tearing down
  // the single polling effect (components/handoff/useMemoPoller.ts precedent).
  const onChangeRef = useRef(opts.onChange)
  useEffect(() => {
    onChangeRef.current = opts.onChange
  })
  const onGoneRef = useRef(opts.onGone)
  useEffect(() => {
    onGoneRef.current = opts.onGone
  })
  const urlRef = useRef(opts.url)
  useEffect(() => {
    urlRef.current = opts.url
  })

  // lastKnown: the syncVersion the current props already reflect.
  const lastKnownRef = useRef(opts.initialVersion)
  // awaitingConfirm: the remote v observed right before calling onChange for
  // a detected version change; cleared once initialVersion catches up to (or
  // past) it — the refresh latch (Codex wave-2 fix 5). null while no
  // version-change-triggered refresh is in flight.
  const awaitingConfirmRef = useRef<number | null>(null)
  // A version change observed while the registry was busy — held until an
  // idle transition lets it flush ("flushes ONE refresh on release").
  const pendingObservedRef = useRef<number | null>(null)
  const stoppedRef = useRef(false) // terminal 404
  const backoffRef = useRef(intervalMs)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Re-sync from the initialVersion prop: once it catches up to (or passes)
  // the recorded awaitingConfirm value, the latch clears — a genuinely NEW
  // change can fire onChange again. (This effect intentionally runs on every
  // opts.initialVersion change, including the very first render.)
  useEffect(() => {
    lastKnownRef.current = opts.initialVersion
    if (awaitingConfirmRef.current !== null && opts.initialVersion >= awaitingConfirmRef.current) {
      awaitingConfirmRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.initialVersion])

  useEffect(() => {
    let disposed = false
    let inFlight = false

    function clearTimer() {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    function scheduleNext(delay: number) {
      if (disposed || stoppedRef.current) return
      clearTimer()
      timerRef.current = setTimeout(() => {
        void tick()
      }, delay)
    }

    // Attempts to deliver a coalesced refresh. Consumes pendingRefresh
    // unconditionally; consumes pendingObservedRef (and arms the latch)
    // only when there IS an observed version to wait for confirmation of —
    // a bare requestRefresh() (no observed remote v) must never leave the
    // latch stuck on a value initialVersion already satisfies.
    function tryFlush() {
      if (disposed || stoppedRef.current) return
      if (!isRegistryIdle()) return
      const hadPendingRefresh = pendingRefresh
      const observed = pendingObservedRef.current
      if (observed === null && !hadPendingRefresh) return
      if (observed !== null && awaitingConfirmRef.current !== null) return // already latched, waiting for confirmation
      pendingRefresh = false
      if (observed !== null) {
        awaitingConfirmRef.current = observed
        pendingObservedRef.current = null
      }
      onChangeRef.current()
    }

    async function tick() {
      if (disposed || inFlight) return
      inFlight = true
      clearTimer() // a manually-triggered tick preempts any still-pending schedule
      try {
        const res = await fetch(urlRef.current, { cache: 'no-store' })
        if (disposed) return
        if (res.status === 404) {
          stoppedRef.current = true
          const onGone = onGoneRef.current ?? onChangeRef.current
          onGone()
          return // terminal — never reschedule
        }
        if (!res.ok) throw new Error(`viewbook_sync_failed_${res.status}`)
        const body = (await res.json()) as { v: number }
        if (disposed) return
        backoffRef.current = intervalMs // reset backoff on success
        if (body.v !== lastKnownRef.current) {
          pendingObservedRef.current = body.v
        }
        tryFlush()
      } catch {
        if (disposed) return
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS)
      } finally {
        inFlight = false
        if (!disposed && document.visibilityState === 'visible') {
          scheduleNext(backoffRef.current)
        }
      }
    }

    // Triggers an out-of-cadence tick right now (visibility resume, or a
    // requestRefresh() arriving while idle) — a no-op if a tick is already
    // in flight, since that tick's own tryFlush() will pick up whatever
    // pendingRefresh/pendingObservedRef state exists once it resolves
    // (this is what keeps a poll-detected change and a requestRefresh()
    // arriving around the same moment coalesced into ONE onChange).
    function triggerTick() {
      if (!inFlight) void tick()
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        triggerTick()
      } else {
        clearTimer()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    const unsubIdle = subscribeIdle(tryFlush)
    const unsubPendingRefresh = subscribePendingRefresh(triggerTick)

    if (document.visibilityState === 'visible') void tick()

    return () => {
      disposed = true
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibility)
      unsubIdle()
      unsubPendingRefresh()
    }
    // Mounted once — freshness is handled entirely via refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Single-mount guard (Codex wave-2 fix 7): React Strict Mode's dev
  // double-mount runs mount→cleanup→mount synchronously within one tick, so
  // by the time a macrotask runs the count has settled back to 1 — only warn
  // when TWO LIVE instances genuinely coexist after that settling.
  useEffect(() => {
    liveInstances += 1
    const timer = setTimeout(() => {
      if (liveInstances > 1 && !hasWarnedOverlap) {
        hasWarnedOverlap = true
        console.warn(
          '[useViewbookSync] multiple live instances detected on one page — only one refresher should be mounted.',
        )
      }
    }, 0)
    return () => {
      liveInstances -= 1
      if (liveInstances <= 1) hasWarnedOverlap = false
      clearTimeout(timer)
    }
  }, [])
}
