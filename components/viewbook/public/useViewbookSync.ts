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
import { useEffect, useRef, useState, type Dispatch, type FocusEvent, type SetStateAction } from 'react'

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
 *
 * The idle-transition flush is deferred to a microtask and RE-CHECKS
 * idleness before running listeners. This matters because a per-keystroke
 * effect-deps change (the pre-`useEditorActivity` inline pattern, and any
 * future caller shaped like it) unregisters and immediately re-registers
 * the SAME id synchronously within one render/effect pass — a transient
 * idle window with no real release. Without the defer+recheck, that
 * transient window would flush a held refresh mid-keystroke. Queuing the
 * notification lets the synchronous re-register (if any) land first; only a
 * genuine release is still idle by the time the microtask runs.
 */
export function registerEditorActivity(id: string, active: boolean): void {
  const wasIdle = isRegistryIdle()
  if (active) {
    activeEditors.set(id, true)
  } else {
    activeEditors.delete(id)
  }
  if (!wasIdle && isRegistryIdle()) {
    queueMicrotask(() => {
      if (!isRegistryIdle()) return // re-registered before this microtask ran — not a real release
      for (const listener of Array.from(idleListeners)) listener()
    })
  }
}

/**
 * Owns an editor's registration for its entire mount lifetime: registers the
 * current `active` level via an effect (no cleanup — nothing to unregister
 * on a mere level change), and unregisters ONLY on unmount via a SEPARATE
 * empty-deps effect. This is the shape every island/admin tab should use
 * instead of inlining `useEffect(() => { registerEditorActivity(id, active);
 * return () => registerEditorActivity(id, false) }, [...])` — that inline
 * pattern's cleanup fires on every dependency change (e.g. a draft string
 * changing per keystroke), which is exactly the per-keystroke idle-window
 * bug the module-level defer above also guards against. Two independent
 * layers, same failure class.
 *
 * `id` MUST be mount-stable (a literal or a value fixed for the component's
 * whole lifetime — e.g. `field-${field.id}` where `field.id` never changes
 * post-mount). The unmount-cleanup effect below reads `id` via `idRef`,
 * which always holds the LATEST value, so if a caller passes a CHANGING id
 * across renders (e.g. derived from an array index that can shift), the
 * unmount cleanup unregisters only the last id seen — every EARLIER id this
 * component was registered under (from before the id changed) is never
 * unregistered and leaks as a permanently-active registration, deadlocking
 * the shared refresher exactly like a stuck latch.
 */
export function useEditorActivity(id: string, active: boolean): void {
  const idRef = useRef(id)
  idRef.current = id

  useEffect(() => {
    registerEditorActivity(id, active)
  }, [id, active])

  useEffect(() => {
    return () => registerEditorActivity(idRef.current, false)
    // Unmount-only by design — see the doc comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
// useBaselineSync — shared "adopt-when-idle" draft reconciliation for admin
// editor tabs (ThemeEditor, ContentTab, …) whose local draft state used to
// be seeded ONCE from a prop (`useState(prop)`) and never resynced. Because
// the shared refresher only ever calls the page-level reload while this
// editor's own dirty flag is false (registerEditorActivity gates it), the
// prop CAN change while idle — but a bare `useState(prop)` ignores prop
// changes after mount, so the stale draft then reads as "differs from the
// NEW prop" and `dirty` gets stuck true forever, permanently suppressing the
// refresher for the whole page (Codex wave-2 fix 5).
// ---------------------------------------------------------------------------

/**
 * `serverValue` is the authoritative prop from the parent. `guard` must be
 * true whenever this specific editor must not be clobbered (typically
 * `focused || busy` — NOT the editor's own `dirty`, to avoid a
 * self-referential guard). The draft adopts a new `serverValue` only when:
 * not guarded, the server value actually changed since the last adopted
 * baseline, AND the draft hasn't locally diverged from that baseline (an
 * untouched or already-saved draft) — a diverged draft is left alone, and
 * reconciliation retries on the next `serverValue` or `guard` change.
 *
 * Call `commit(value)` immediately after a successful save to move BOTH the
 * baseline and the draft to the just-saved value right away. Without this,
 * the eventual background reload's `serverValue` (now equal to what this
 * editor itself just saved) would look like a genuine external change, but
 * the draft (already at that value, saved moments ago) would read as
 * "diverged from the still-stale baseline" — the effect would decline to
 * advance the baseline, and `dirty` would stay stuck true exactly like the
 * bug this hook exists to fix.
 */
export function useBaselineSync<T>(
  serverValue: T,
  guard: boolean,
  isEqual: (a: T, b: T) => boolean = (a, b) => a === b,
): { draft: T; setDraft: Dispatch<SetStateAction<T>>; dirty: boolean; commit: (value: T) => void; baseline: T } {
  const [baseline, setBaseline] = useState(serverValue)
  const [draft, setDraft] = useState(serverValue)

  useEffect(() => {
    if (guard) return
    if (isEqual(serverValue, baseline)) return
    if (!isEqual(draft, baseline)) return // diverged locally — never clobber
    setBaseline(serverValue)
    setDraft(serverValue)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverValue, guard])

  function commit(value: T): void {
    setBaseline(value)
    setDraft(value)
  }

  return { draft, setDraft, dirty: !isEqual(draft, baseline), commit, baseline }
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
  /**
   * Defaults to `true`. Pass `false` while `initialVersion` is still a
   * placeholder (e.g. the admin editor's initial `vb?.syncVersion ?? 0`
   * before its first load resolves) — polling with a placeholder version
   * races the mount-time load: the poll's first tick would observe the REAL
   * remote version, treat it as a "change" from the placeholder, and fire a
   * redundant second load. No fetch happens while disabled; polling starts
   * (or resumes) the moment this flips true, using whatever `initialVersion`
   * is current at that point.
   */
  enabled?: boolean
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
  const enabled = opts.enabled ?? true
  const enabledRef = useRef(enabled)
  useEffect(() => {
    enabledRef.current = enabled
  })
  // Exposes the mount effect's triggerTick to the enabled-transition effect
  // below (declared before that effect runs, in source order) so flipping
  // `enabled` from false to true kicks off the first real tick immediately
  // instead of waiting out a full interval.
  const triggerTickRef = useRef<() => void>(() => {})

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
    // CRITICAL fix (latch deadlock): a pendingObservedRef value the props
    // ALREADY reflect (this refresh landed at or past it — the common case
    // when a later tick observed a newer version while still latched on an
    // earlier one, and the refresh that eventually lands jumps straight to
    // that newer version) is stale — discard it here too, not just in
    // tryFlush. Left in place, the NEXT tick would re-observe the same
    // already-satisfied value, tryFlush would find lastKnownRef now equal to
    // it (nothing new to report) yet still arm the latch on it, and that
    // latch would never clear again (initialVersion can't "catch up" to a
    // value it already caught up to) — live sync dead until reload.
    if (pendingObservedRef.current !== null && opts.initialVersion >= pendingObservedRef.current) {
      pendingObservedRef.current = null
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
      let observed = pendingObservedRef.current
      // CRITICAL fix (latch deadlock): a leftover observed value the props
      // already reflect (<= lastKnownRef) is stale information — nothing to
      // wait for. See the matching discard in the initialVersion effect
      // above for the full trace this closes.
      if (observed !== null && observed <= lastKnownRef.current) {
        pendingObservedRef.current = null
        observed = null
      }
      if (observed === null && !hadPendingRefresh) return
      // P2 fix: a BARE pendingRefresh (no observed version) arriving while a
      // sync fetch is already in flight (e.g. requestRefresh()'s own
      // triggerTick() kicked that fetch off) must stay queued rather than
      // firing a blind refresh now — the in-flight tick's OWN post-resolve
      // tryFlush() call (see tick()'s finally block, which runs it only
      // AFTER inFlight is reset to false) will flush it exactly once. Without
      // this, an idle transition landing mid-fetch (e.g. an editor releasing
      // while its own save's requestRefresh() fetch is still outstanding)
      // fires ONE onChange here for the bare request, then the resolving
      // fetch's own tryFlush() fires a SECOND with the newly observed
      // version — two refreshes coalesced into what should be one.
      if (observed === null && hadPendingRefresh && inFlight) return
      if (observed !== null && awaitingConfirmRef.current !== null) {
        // Already latched, waiting for confirmation of an earlier detected
        // change. A requestRefresh() arriving during that wait is
        // redundant — the latch's eventual clear already implies a refresh
        // happened — so consume it now rather than leaving it to fire a
        // spare onChange once the latch clears.
        pendingRefresh = false
        if (observed === awaitingConfirmRef.current) {
          // Repeated ticks while latched keep re-observing the SAME
          // already-armed value (server hasn't moved further yet) — that's
          // not new information beyond the pending latch, so clear it. Left
          // stale, the tick right after the latch clears would see this
          // same old value, find lastKnownRef now equal to it (no reason to
          // reassign), and tryFlush would misread the leftover as a fresh
          // change — an extra onChange for nothing. A genuinely NEWER
          // observed value (real change while still waiting) is left
          // in place so it flushes once the latch clears.
          pendingObservedRef.current = null
        }
        return
      }
      pendingRefresh = false
      if (observed !== null) {
        awaitingConfirmRef.current = observed
        pendingObservedRef.current = null
      }
      onChangeRef.current()
    }

    async function tick() {
      if (disposed || inFlight || !enabledRef.current) return
      inFlight = true
      clearTimer() // a manually-triggered tick preempts any still-pending schedule
      let shouldFlush = false
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
        shouldFlush = true
      } catch {
        if (disposed) return
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS)
      } finally {
        // inFlight is cleared BEFORE this tick's own tryFlush() call (P2
        // fix) so that call is never mistaken, by tryFlush's own inFlight
        // check, for "a fetch is still outstanding" — it IS this tick
        // completing, not a concurrent one.
        inFlight = false
        if (shouldFlush) tryFlush()
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
    triggerTickRef.current = triggerTick

    if (document.visibilityState === 'visible') void tick() // no-op while disabled — see enabledRef check in tick()

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

  // Kicks off the first real tick the moment `enabled` flips true (e.g. the
  // admin editor's initial load resolving), using whatever initialVersion is
  // current by then. A no-op while still disabled, while hidden (mirrors the
  // mount effect's own visibility check — onVisibility resumes it later),
  // or while already enabled at mount (the mount effect's own tick() call
  // already ran; triggerTick's inFlight guard de-dupes the redundant call).
  useEffect(() => {
    if (enabled && document.visibilityState === 'visible') triggerTickRef.current()
  }, [enabled])

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
