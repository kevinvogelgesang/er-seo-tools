// PR5 (spec §8 "tooltips — marketing-exec depth"): pure-CSS tooltip, server
// component. Reveal on hover OR keyboard focus; no JS, no client bundle.
// The trigger is ALWAYS focusable and aria-describedby-wired here so callers
// can't ship a mouse-only tooltip.
import type { ReactNode } from 'react'

export function Tooltip({ label, id, children }: { label: string; id: string; children?: ReactNode }) {
  return (
    <span className="group relative inline-flex items-center">
      <span
        tabIndex={0}
        aria-describedby={id}
        className={
          children
            ? 'cursor-help outline-offset-2'
            : 'cursor-help select-none text-sm text-black/40 outline-offset-2'
        }
      >
        {children ?? 'ⓘ'}
      </span>
      <span
        role="tooltip"
        id={id}
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-64 -translate-x-1/2 rounded-lg bg-black/85 px-3 py-2 text-xs font-normal text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  )
}
