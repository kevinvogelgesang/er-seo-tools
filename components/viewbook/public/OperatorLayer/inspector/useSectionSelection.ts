'use client'

import { useEffect } from 'react'
import type { SectionKey } from '@/lib/viewbook/theme'
import { useSelectionContext } from './SelectionContext'

const HYSTERESIS_PX = 24

// Passive scroll-spy. Scores VISIBLE PIXELS per section, breaks ties in lineup
// order, and applies a hysteresis margin before replacing the current
// selection. Calls observe() — SelectionContext is the authoritative pin guard,
// so this never overrides a section the operator is editing. Reads geometry
// only; never mutates height/collapse/<details> state.
export function useSectionSelection(orderedKeys: readonly SectionKey[]): void {
  const { observe, selectedKey, pinnedKey, pinnedKind, release } = useSelectionContext()
  const sig = orderedKeys.join('|') // stable effect dep — avoids disconnect/reconnect churn (fix #5)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const keys = sig.split('|') as SectionKey[]
    const visible = new Map<SectionKey, number>()

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const key = (e.target as HTMLElement).dataset.operatorSection as SectionKey | undefined
        if (!key) continue
        visible.set(key, e.isIntersecting ? (e.intersectionRect?.height ?? 0) : 0)
      }
      let best: SectionKey | null = null
      let bestPx = 0
      for (const key of keys) { // iteration order = lineup order → deterministic ties
        const px = visible.get(key) ?? 0
        if (px > bestPx) { bestPx = px; best = key }
      }
      if (!best) return
      // manual-nav pin releases once its target is dominant
      if (pinnedKind === 'manual-nav' && best === pinnedKey) release(pinnedKey, 'manual-nav')
      // hysteresis: keep current selection unless the challenger clears the margin
      const currentPx = selectedKey ? (visible.get(selectedKey) ?? 0) : 0
      if (best !== selectedKey && bestPx < currentPx + HYSTERESIS_PX) return
      observe(best)
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] })

    document.querySelectorAll<HTMLElement>('[data-operator-section]').forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [sig, observe, selectedKey, pinnedKey, pinnedKind, release])
}
