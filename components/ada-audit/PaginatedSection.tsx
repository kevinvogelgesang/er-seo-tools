'use client'

import { ReactNode, useEffect } from 'react'

interface Props {
  title: string
  icon?: ReactNode
  trailing?: ReactNode                 // optional element rendered next to the title (e.g., search input)
  rowCount: number                     // total rows after filtering (for "Page X of N" math)
  pageSize?: number                    // if undefined, no pagination footer (scroll-only mode)
  page?: number                        // current page, 1-indexed. Required when pageSize is set.
  onPageChange?: (next: number) => void
  loading?: boolean                    // user-initiated load — dims content. Polling should NOT pass true.
  error?: string | null                // when no data and fetch failed
  onRetry?: () => void                 // shown alongside error
  empty?: ReactNode                    // shown when rowCount === 0 and no error and not loading
  children: ReactNode                  // the table rows
}

const ROW_PX = 56                       // approximate row height; container fits ~10
const CONTAINER_MAX = ROW_PX * 10

export default function PaginatedSection({
  title, icon, trailing,
  rowCount, pageSize, page, onPageChange,
  loading, error, onRetry, empty, children,
}: Props) {
  const totalPages = pageSize && rowCount > 0 ? Math.max(1, Math.ceil(rowCount / pageSize)) : 1
  const currentPage = page ?? 1

  // Auto-fallback if currentPage exceeds totalPages (e.g. deletion shrank the
  // data). Parent owns page state; we only fire onPageChange so it can
  // correct. Side effects must run in useEffect, not during render — under
  // React 19 Strict Mode, render-time queueMicrotask would fire twice, and
  // router.replace from a child during the parent's render is a warning.
  useEffect(() => {
    if (pageSize && currentPage > totalPages && onPageChange) {
      onPageChange(totalPages)
    }
  }, [pageSize, currentPage, totalPages, onPageChange])

  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
        {icon && <div className="w-8 h-8 rounded-lg bg-orange/15 flex items-center justify-center flex-shrink-0">{icon}</div>}
        <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">{title}</h2>
        {trailing && <div className="ml-auto">{trailing}</div>}
      </div>

      <div
        className={`relative overflow-y-auto transition-opacity duration-150 ${loading ? 'opacity-50' : ''}`}
        style={{ maxHeight: CONTAINER_MAX }}
      >
        {error && rowCount === 0 ? (
          <div className="p-6 text-center">
            <p className="text-[13px] font-body text-red-700 dark:text-red-400 mb-3">Failed to load {title.toLowerCase()}. {error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="text-[12px] font-body font-semibold text-orange hover:underline"
              >
                Retry
              </button>
            )}
          </div>
        ) : rowCount === 0 && empty ? (
          <div className="p-6 text-center text-[13px] font-body text-navy/50 dark:text-white/50">{empty}</div>
        ) : (
          children
        )}
      </div>

      {pageSize && rowCount > pageSize && onPageChange && (
        <div className="flex items-center justify-center gap-4 px-6 py-3 border-t border-gray-100 dark:border-navy-border bg-gray-50/50 dark:bg-navy-deep/50">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
            className="text-[12px] font-body font-semibold text-navy/70 dark:text-white/70 disabled:opacity-30 disabled:cursor-not-allowed hover:text-orange"
          >
            ← Prev
          </button>
          <span className="text-[12px] font-body text-navy/60 dark:text-white/60">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            className="text-[12px] font-body font-semibold text-navy/70 dark:text-white/70 disabled:opacity-30 disabled:cursor-not-allowed hover:text-orange"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
