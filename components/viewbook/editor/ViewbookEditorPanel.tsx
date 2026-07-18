'use client'

import { useId, useState, type ReactNode } from 'react'

export interface ViewbookEditorPanelProps {
  title: string
  description?: ReactNode
  status?: ReactNode
  defaultOpen?: boolean
  id?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}

export function ViewbookEditorPanel({
  title,
  description,
  status,
  defaultOpen = false,
  id,
  open,
  onOpenChange,
  children,
}: ViewbookEditorPanelProps) {
  const generatedId = useId()
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const controlled = open !== undefined
  const expanded = controlled ? open : internalOpen
  const panelId = id ?? `viewbook-editor-panel-${generatedId}`
  const triggerId = `${panelId}-trigger`
  const bodyId = `${panelId}-body`

  function toggle() {
    const next = !expanded
    if (!controlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  return (
    <div
      id={id}
      data-viewbook-editor-panel
      className="rounded-xl border border-gray-200 bg-white font-body shadow-sm transition-[border-color,box-shadow] focus-within:border-teal-500/60 focus-within:ring-2 focus-within:ring-teal-500/15 dark:border-navy-border dark:bg-navy-card"
    >
      <button
        id={triggerId}
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={toggle}
        className="group flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-navy transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500/40 dark:text-white dark:hover:bg-navy-light"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-display text-sm font-semibold">{title}</span>
          {description && (
            <span className="mt-0.5 block text-xs font-normal text-gray-500 dark:text-white/55">
              {description}
            </span>
          )}
        </span>
        {status && <span className="shrink-0">{status}</span>}
        <svg
          data-viewbook-editor-panel-chevron
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 motion-reduce:transition-none dark:text-white/45 ${expanded ? 'rotate-180' : ''}`}
        >
          <path d="m5 7.5 5 5 5-5" />
        </svg>
      </button>
      <div
        id={bodyId}
        role="region"
        aria-labelledby={triggerId}
        hidden={!expanded}
        className="border-t border-gray-200 bg-gray-50/70 dark:border-navy-border dark:bg-navy-deep/40"
      >
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
