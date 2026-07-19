'use client'

// PR3 Task 2: the three operator-selected expand affordances rendered over a
// collapsed hero. All three are ONE semantic control — a labeled, accessible
// <button> wired to `aria-controls`/`aria-expanded` — only the visual
// presentation differs. `accessibleName` is actor-specific text supplied by
// the caller (CollapsibleSection) — "Expand (just for you)" for a client
// viewer vs "Expand (visible to everyone)" for an operator (FIX-ACTOR-AFFORDANCE).
import type { CollapseAffordanceKind } from '@/lib/viewbook/presentation-config'

export function CollapseAffordance({
  kind,
  regionId,
  accessibleName,
  onExpand,
  disabled,
}: {
  kind: CollapseAffordanceKind
  regionId: string
  accessibleName: string
  onExpand(): void
  disabled: boolean
}) {
  const common = {
    'aria-expanded': false as const,
    'aria-controls': regionId,
    'aria-label': accessibleName,
    disabled,
    onClick: onExpand,
    type: 'button' as const,
  }

  if (kind === 'bar') {
    return (
      <button
        {...common}
        className="relative z-[3] flex w-full items-center justify-center gap-2 border-t border-white/25 bg-white/15 py-3 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/25 disabled:opacity-50"
      >
        <span aria-hidden>⌄</span>
        <span>{accessibleName}</span>
      </button>
    )
  }

  if (kind === 'pill') {
    return (
      <button
        {...common}
        className="absolute left-4 top-4 z-[3] inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3.5 py-1.5 text-xs font-semibold text-[color:var(--vb-primary)] shadow-md transition hover:bg-white disabled:opacity-50"
      >
        <span>{accessibleName}</span>
        <span aria-hidden>⌄</span>
      </button>
    )
  }

  // chevron: icon-only, no visible label text — the accessible name lives
  // entirely in aria-label.
  return (
    <button
      {...common}
      className="absolute bottom-4 right-4 z-[3] flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-white/20 text-2xl leading-none text-white transition hover:bg-white/30 disabled:opacity-50"
    >
      <span aria-hidden>⌄</span>
    </button>
  )
}
