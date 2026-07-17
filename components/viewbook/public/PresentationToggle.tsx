'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

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
        aria-label="Show editing controls"
        aria-pressed="true"
        onClick={toggle}
        className="fixed bottom-3 right-3 z-50 rounded-full border border-black/15 bg-white/90 px-2.5 py-1.5 text-xs font-medium text-black/60 shadow-sm backdrop-blur focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
      >
        Edit
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-label="Presentation mode"
      aria-pressed="false"
      onClick={toggle}
      className="rounded-full border border-black/15 bg-white px-3 py-1.5 text-xs font-semibold text-black/65 hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
    >
      Presentation mode
    </button>
  )
}
