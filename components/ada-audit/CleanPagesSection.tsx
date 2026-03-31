'use client'

import { useState } from 'react'
import type { SitePageResult } from '@/lib/ada-audit/types'

interface Props {
  pages: SitePageResult[]
}

export default function CleanPagesSection({ pages }: Props) {
  const [expanded, setExpanded] = useState(false)

  if (pages.length === 0) return null

  return (
    <div className="bg-green-50 dark:bg-green-500/5 border border-green-200 dark:border-green-500/20 rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-green-100/50 dark:hover:bg-green-500/10 transition-colors"
      >
        <div className="w-8 h-8 rounded-lg bg-green-500/15 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <span className="font-display font-bold text-[15px] text-green-800 dark:text-green-300">
          {pages.length} Clean Page{pages.length !== 1 ? 's' : ''}
        </span>
        <span className="text-[12px] font-body text-green-600/60 dark:text-green-400/60">
          0 violations
        </span>
        <svg
          className={`w-4 h-4 ml-auto flex-shrink-0 text-green-600/40 dark:text-green-400/40 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-green-200 dark:border-green-500/20 px-6 py-3 space-y-1">
          {pages.map((page) => {
            const urlDisplay = page.url.replace(/^https?:\/\//, '')
            return (
              <div key={page.adaAuditId} className="flex items-center gap-2 py-1">
                <svg className="w-3 h-3 flex-shrink-0 text-green-500/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <a
                  href={`/ada-audit/${page.adaAuditId}`}
                  className="text-[12px] font-body text-green-800/70 dark:text-green-300/70 hover:text-green-800 dark:hover:text-green-300 truncate transition-colors"
                  title={page.url}
                >
                  {urlDisplay}
                </a>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
