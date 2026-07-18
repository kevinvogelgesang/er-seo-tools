'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { editorSecondaryBtnClass } from '@/components/viewbook/editor'

const STORAGE_KEY = 'vb-presentation-mode'

export interface PresentationModeValue {
  initialized: boolean
  presenting: boolean
  toggle: () => void
}

const PresentationModeContext = createContext<PresentationModeValue | null>(null)

// Safe default for consumers rendered OUTSIDE a PresentationModeProvider — the
// anonymous public tree renders KickoffNextSection (and, via it, presentation-
// aware children) with no operator layer / provider. There is no presentation
// concept there, so behave as fully-initialized + not-presenting with a no-op
// toggle. usePresentationMode NEVER throws, so a bare render can't crash.
const PRESENTATION_MODE_DEFAULT: PresentationModeValue = {
  initialized: true,
  presenting: false,
  toggle: () => {},
}

export function PresentationModeProvider({ children }: { children: ReactNode }) {
  // Treat the pre-hydration state as presenting. Consumers can safely render
  // public content, but must wait for `initialized` before showing ER chrome.
  const [initialized, setInitialized] = useState(false)
  const [presenting, setPresenting] = useState(true)

  useEffect(() => {
    try {
      setPresenting(localStorage.getItem(STORAGE_KEY) === 'true')
    } catch {
      setPresenting(false)
    }
    setInitialized(true)
  }, [])

  const value = useMemo<PresentationModeValue>(() => ({
    initialized,
    presenting,
    toggle: () => {
      setPresenting((current) => {
        const next = !current
        try {
          localStorage.setItem(STORAGE_KEY, String(next))
        } catch {
          // Storage can be unavailable in privacy modes; the in-memory toggle
          // still works for this pageview.
        }
        return next
      })
    },
  }), [initialized, presenting])

  return <PresentationModeContext.Provider value={value}>{children}</PresentationModeContext.Provider>
}

export function usePresentationMode(): PresentationModeValue {
  return useContext(PresentationModeContext) ?? PRESENTATION_MODE_DEFAULT
}

export function PresentationToggle() {
  const { initialized, presenting, toggle } = usePresentationMode()
  if (!initialized) return null

  if (presenting) {
    return (
      <button
        type="button"
        aria-label="Return to editing"
        aria-pressed="true"
        onClick={toggle}
        style={{
          bottom: 'max(1rem, env(safe-area-inset-bottom))',
          left: 'max(1rem, env(safe-area-inset-left))',
        }}
        className="fixed bottom-4 left-4 z-50 rounded-full border border-gray-200 bg-white/95 px-4 py-2.5 font-body text-sm font-semibold text-navy shadow-xl backdrop-blur-md transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:ring-offset-2 dark:border-navy-border dark:bg-navy-card/95 dark:text-white dark:hover:bg-navy-light dark:focus-visible:ring-offset-navy-deep"
      >
        Return to editing
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-label="Preview as client"
      aria-pressed="false"
      onClick={toggle}
      className={`${editorSecondaryBtnClass} shrink-0 whitespace-nowrap`}
    >
      Preview as client
    </button>
  )
}
