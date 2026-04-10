'use client'

import { useState } from 'react'

interface Props {
  previousScore: number | null
  currentScore: number | null
}

export default function RescanBanner({ previousScore, currentScore }: Props) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  const scoreText = (() => {
    if (previousScore === null || currentScore === null) return null
    if (previousScore === currentScore) return `Score unchanged at ${currentScore}`
    const direction = currentScore > previousScore ? 'improved' : 'decreased'
    return `Score ${direction}: ${previousScore} → ${currentScore}`
  })()

  return (
    <div className="flex items-start gap-3 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-xl px-4 py-3">
      <svg
        className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      <div className="flex-1">
        <p className="text-[13px] font-body font-semibold text-green-800 dark:text-green-400">
          Re-scan complete
        </p>
        {scoreText && (
          <p className="text-[12px] font-body text-green-700 dark:text-green-400/80 mt-0.5">
            {scoreText}
          </p>
        )}
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="flex-shrink-0 text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
