// lib/widgets/use-home-layout.ts
// Hydration-safe client hook that owns homepage widget layout state +
// localStorage persistence (PR 3, plan Architecture §2).
//
// Hydration contract: server and first client paint both render
// DEFAULT_LAYOUT (the reducer's initial state) — localStorage is read ONLY
// inside an effect, so server markup === first client markup and there is
// no hydration warning. Persistence is armed ONLY after hydration
// completes (Codex fix 2), so the initial default can never overwrite a
// stored layout — including under React StrictMode's double-invoked
// effects (the post-hydrate persist is an idempotent rewrite of the
// just-read value).
'use client'

import { useEffect, useReducer, useState } from 'react'
import {
  LAYOUT_STORAGE_KEY,
  createLayoutReducer,
  loadLayout,
  serializeLayout,
} from './layout'
import { WIDGETS, DEFAULT_LAYOUT } from './registry'

const reducer = createLayoutReducer(WIDGETS, DEFAULT_LAYOUT)

export function useHomeLayout() {
  const [layout, dispatch] = useReducer(reducer, DEFAULT_LAYOUT)
  const [hydrated, setHydrated] = useState(false)

  // 1. Post-mount: read + reconcile from localStorage (try/catch → keep default).
  useEffect(() => {
    let raw: string | null = null
    try {
      raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY)
    } catch {
      // private mode / disabled storage — fall through with raw === null
    }
    dispatch({ type: 'hydrate', items: loadLayout(raw, WIDGETS, DEFAULT_LAYOUT) })
    setHydrated(true)
  }, [])

  // 2. Persist ONLY after hydration (Codex fix 2). try/catch → quota/security safe.
  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(layout))
    } catch {
      // quota exceeded / storage disabled — in-memory layout still updates
    }
  }, [layout, hydrated])

  return { layout, hydrated, dispatch }
}
