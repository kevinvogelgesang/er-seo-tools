'use client'

// PR3 Task 1: the personal-override + reconciliation reducer backing
// CollapsibleSection. Effective collapse = (override === 'expanded') ? false
// : collapsedShared — a personal expand always wins over the shared default,
// and the personal override is one-valued (localStorage holds 'expanded' or
// the key is absent — never 'collapsed').
//
// `pending` is STATE (not just a ref): the reconcile effect depends on
// [collapsedShared, pending] so a `collapsedShared` prop that arrives WHILE a
// write is in flight is not dropped — it applies the instant `endPending()`
// clears pending and the effect reruns (Codex FIX-5). `beginPending` uses a
// separate ref for a SYNCHRONOUS double-fire guard (two pre-commit click
// events can land before React re-renders `disabled`).
//
// `forceExpandedLocal` (vb:navigate) sets the in-memory override WITHOUT
// touching localStorage (Codex FIX-6) — a forced-open section must not
// silently become "expanded forever" after a random anchor/hash visit.
import { useCallback, useEffect, useRef, useState } from 'react'

export function collapseKey(viewbookId: number, sectionKey: string): string {
  return `vb:collapse:${viewbookId}:${sectionKey}`
}

function readOverride(key: string): 'expanded' | null {
  try {
    return localStorage.getItem(key) === 'expanded' ? 'expanded' : null
  } catch {
    return null
  }
}

export function useCollapseState({
  viewbookId,
  sectionKey,
  collapsedShared,
}: {
  viewbookId: number
  sectionKey: string
  collapsedShared: boolean
}) {
  const key = collapseKey(viewbookId, sectionKey)
  // SSR-safe seed: no window/localStorage read during the initial render, so
  // server and first client paint agree (matches SectionReveal's convention).
  const [collapsed, setCollapsed] = useState(collapsedShared)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false) // synchronous double-fire guard
  const overrideRef = useRef<'expanded' | null>(null) // in-memory truth (persisted OR nav-forced)

  useEffect(() => {
    // Mount: read the persisted override; a personal expand wins immediately.
    overrideRef.current = readOverride(key)
    setCollapsed(overrideRef.current === 'expanded' ? false : collapsedShared)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    // Reconcile whenever the shared prop changes OR pending clears —
    // suppressed while pending so an optimistic view isn't clobbered by a
    // stale prop mid-flight; depending on `pending` is what applies a prop
    // that arrived WHILE pending once endPending() clears it (FIX-5).
    if (pending) return
    setCollapsed(overrideRef.current === 'expanded' ? false : collapsedShared)
  }, [collapsedShared, pending])

  const beginPending = useCallback((): boolean => {
    if (pendingRef.current) return false
    pendingRef.current = true
    setPending(true)
    return true
  }, [])

  const endPending = useCallback(() => {
    pendingRef.current = false
    setPending(false)
  }, [])

  const setPersonalExpanded = useCallback(() => {
    try {
      localStorage.setItem(key, 'expanded')
    } catch {
      // localStorage unavailable (private mode etc) — in-memory override still applies.
    }
    overrideRef.current = 'expanded'
    setCollapsed(false)
  }, [key])

  const forceExpandedLocal = useCallback(() => {
    // vb:navigate — expand in-memory only, NEVER persisted.
    overrideRef.current = 'expanded'
    setCollapsed(false)
  }, [])

  const clearPersonalOverride = useCallback((): 'expanded' | null => {
    const prev = overrideRef.current
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
    overrideRef.current = null
    return prev
  }, [key])

  const restorePersonalOverride = useCallback(
    (prev: 'expanded' | null) => {
      overrideRef.current = prev
      try {
        if (prev) localStorage.setItem(key, prev)
        else localStorage.removeItem(key)
      } catch {
        // ignore
      }
    },
    [key],
  )

  const setCollapsedOptimistic = useCallback((next: boolean) => setCollapsed(next), [])

  return {
    collapsed,
    pending,
    beginPending,
    endPending,
    setPersonalExpanded,
    forceExpandedLocal,
    clearPersonalOverride,
    restorePersonalOverride,
    setCollapsedOptimistic,
  }
}
