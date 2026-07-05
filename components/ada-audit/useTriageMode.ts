'use client'

import { useEffect, useState } from 'react'

/**
 * Shared triage-mode toggle backed by localStorage, keyed `er-triage-mode:${id}`.
 * Read fires when `id` is truthy AND `enabled` (default true); write on toggle
 * when `id` is truthy. localStorage access is guarded so SSR / missing global
 * never throws. The hook is agnostic to shareMode/readOnly — callers pass
 * `enabled` (site view: `!shareMode`; single view: unconditional, matching
 * AuditResultsView's current behavior).
 */
export function useTriageMode(
  id: string | undefined,
  opts?: { enabled?: boolean },
): { triageMode: boolean; toggleTriage: () => void } {
  const enabled = opts?.enabled ?? true
  const [triageMode, setTriageMode] = useState(false)

  useEffect(() => {
    if (!id || !enabled) return
    try {
      if (localStorage.getItem(`er-triage-mode:${id}`) === '1') setTriageMode(true)
    } catch {
      // no localStorage (SSR / test) — leave default
    }
  }, [id, enabled])

  const toggleTriage = () => {
    setTriageMode((prev) => {
      const next = !prev
      if (id) {
        try {
          localStorage.setItem(`er-triage-mode:${id}`, next ? '1' : '0')
        } catch {
          // ignore write failure
        }
      }
      return next
    })
  }

  return { triageMode, toggleTriage }
}
