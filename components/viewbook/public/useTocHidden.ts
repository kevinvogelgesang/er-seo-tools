'use client'

// Device-global ToC visibility (Feature B). Purely local, per-machine — one
// localStorage key for all viewbooks on this browser. Default = expanded
// (hidden=false). Mirrors useCollapseState's SSR-safe reconcile pattern: no
// window/localStorage read during render; a mount effect reconciles.
import { useCallback, useEffect, useState } from 'react'

export const TOC_HIDDEN_KEY = 'vb:toc-hidden'

function readHidden(): boolean {
  try {
    return localStorage.getItem(TOC_HIDDEN_KEY) === 'true'
  } catch {
    return false
  }
}

function writeHidden(value: boolean): void {
  try {
    localStorage.setItem(TOC_HIDDEN_KEY, value ? 'true' : 'false')
  } catch {
    // localStorage unavailable (private mode etc) — in-memory state still applies.
  }
}

export function useTocHidden() {
  // SSR-safe seed: expanded on server + first client paint (no storage read
  // during render); the mount effect reconciles immediately after.
  const [hidden, setHidden] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setHidden(readHidden())
    setReady(true)
  }, [])

  const hide = useCallback(() => { setHidden(true); writeHidden(true) }, [])
  const show = useCallback(() => { setHidden(false); writeHidden(false) }, [])
  const toggle = useCallback(() => {
    setHidden((h) => { const next = !h; writeHidden(next); return next })
  }, [])

  return { hidden, ready, show, hide, toggle }
}
