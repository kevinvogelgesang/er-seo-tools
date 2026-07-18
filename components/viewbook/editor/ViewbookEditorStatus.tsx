'use client'

import type { ReactNode } from 'react'

export type ViewbookEditorStatusState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error'

export interface ViewbookEditorStatusProps {
  state: ViewbookEditorStatusState
  message?: ReactNode
}

export function ViewbookEditorStatus({ state, message }: ViewbookEditorStatusProps) {
  if (state === 'idle') return null

  if (state === 'dirty') {
    return (
      <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
        Unsaved
      </span>
    )
  }

  if (state === 'saving') {
    return (
      <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 dark:text-teal-300">
        <span
          aria-hidden="true"
          className="h-3 w-3 animate-spin rounded-full border-2 border-teal-200 border-t-teal-600 motion-reduce:animate-none dark:border-teal-500/30 dark:border-t-teal-300"
        />
        Saving…
      </span>
    )
  }

  if (state === 'saved') {
    return (
      <span role="status" aria-live="polite" className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-300">
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 10 3.25 3.25L15.5 5.5" />
        </svg>
        Saved
      </span>
    )
  }

  if (state === 'conflict') {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
      >
        {message ?? 'Conflict'}
      </span>
    )
  }

  return (
    <span
      role="alert"
      className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-500/15 dark:text-red-300"
    >
      {message ?? 'Error'}
    </span>
  )
}
