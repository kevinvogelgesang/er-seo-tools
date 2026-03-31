'use client'

import { useState, useEffect } from 'react'

const STORAGE_KEY = 'ada_compliance_banner_dismissed'

export default function ComplianceBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setVisible(true)
      }
    } catch {
      // localStorage unavailable (e.g. private browsing restrictions) — show banner
      setVisible(true)
    }
  }, [])

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch { /* ignore */ }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
      <svg
        className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
        />
      </svg>
      <p className="flex-1 text-[13px] font-body text-amber-800 leading-snug">
        WCAG 2.1 AA compliance is required by April 24, 2026 for public universities under the ADA.
      </p>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex-shrink-0 text-amber-600 hover:text-amber-800 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
