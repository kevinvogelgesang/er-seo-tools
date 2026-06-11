// components/quarter-grid/usePoolKeyboard.ts
'use client'

// Pool-chip keyboard shortcuts (moved from page.tsx in B4):
//   1–5    → set priority (chip stays in pool)
//   Space  → assign to the next open frontier slot, pre-select the next chip
// Deps are [hoveredPoolChipId] ONLY, verbatim — setPriority and
// assignHoveredToFrontier MUST be stable useCallbacks (they are, in
// useQuarterPlan) or this effect captures stale closures.

import { useEffect } from 'react'

export function usePoolKeyboard(opts: {
  hoveredPoolChipId: number | null
  setHoveredPoolChipId: (id: number | null) => void
  setPriority: (id: number, p: number) => void
  assignHoveredToFrontier: (id: number) => number | null
  onToast: (msg: string) => void
}) {
  const { hoveredPoolChipId, setHoveredPoolChipId, setPriority, assignHoveredToFrontier, onToast } = opts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!hoveredPoolChipId) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return

      // 1–5: set priority
      if (/^[1-5]$/.test(e.key)) {
        e.preventDefault()
        const priority = parseInt(e.key, 10)
        setPriority(hoveredPoolChipId, priority)
        onToast(`P${priority}`)
        return
      }

      // Space: assign to frontier; pre-select next chip so the user can keep
      // going without moving the mouse
      if (e.key === ' ') {
        e.preventDefault()
        const next = assignHoveredToFrontier(hoveredPoolChipId)
        setHoveredPoolChipId(next)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [hoveredPoolChipId]) // eslint-disable-line react-hooks/exhaustive-deps
}
