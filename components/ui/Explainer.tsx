'use client'

// components/ui/Explainer.tsx — reusable inline explanation disclosure (2026-07-14 spec).
//
// One consistent home for "what does this measure / how is this computed" prose:
// a button trigger (label + rotating chevron) that expands an inline panel.
// Structured subcomponents mirror the "Social Style" mock's visual language
// (summary paragraph, tag chips, two-column do/don't lists, flagged footer note)
// WITHOUT its popover behavior — expansion is inline, below the trigger.
//
// Accessibility contract (Codex fixes 1):
//  - `aria-expanded` on the trigger, `aria-controls` wired via useId()
//    (unique + hydration-safe).
//  - Collapsed panel is `aria-hidden` AND `inert` (React 19 boolean prop) so
//    links/buttons inside the zero-height grid can never receive keyboard
//    focus. The panel stays mounted (the grid-rows animation needs real
//    content height), but it is removed from both the a11y tree and the tab
//    order.
//  - Safari 14 fallback: native `inert` is not reliable there and aria-hidden
//    alone does NOT block keyboard focus, so the collapsed panel ALSO gets
//    Tailwind's `invisible` (visibility:hidden) — visibility removes the
//    subtree from the tab order everywhere. visibility transitions
//    discretely, so content text disappears at the start of the collapse
//    while the 200ms grid clip still animates; accepted tradeoff.
//  - Animation: grid-template-rows 0fr→1fr wrapped in motion-safe: variants —
//    prefers-reduced-motion users get an instant toggle.
//
// House rule (Codex fix 2, spec §"methodology-vs-operational-truth"): only
// STATIC explanatory prose belongs inside an Explainer. Status lines, errors,
// freshness lines, coverage/truncation warnings, and honesty qualifiers must
// stay visible in the adopting surface at all times.
//
// No state beyond useState(open), no fetches, no context — safe on public
// token-gated pages and inside server-component trees (RSC children pattern).

import { useId, useState } from 'react'

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function FlagIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 21V4" />
      <path d="M4 4h12l-2 4 2 4H4" />
    </svg>
  )
}

export function Explainer({
  label,
  children,
  defaultOpen = false,
  variant = 'plain',
  className = '',
}: {
  label: string
  children: React.ReactNode
  defaultOpen?: boolean
  /** 'card' = bordered rounded panel for standalone placement; 'plain' = borderless for embedding inside an existing card. */
  variant?: 'card' | 'plain'
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  const chrome =
    variant === 'card'
      ? 'bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-xl px-4 py-3'
      : ''
  return (
    <div className={`${chrome} ${className}`.trim()}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-[12px] font-body font-semibold text-navy/60 dark:text-white/60 hover:text-navy dark:hover:text-white transition-colors"
      >
        {label}
        <ChevronIcon
          className={`w-3.5 h-3.5 motion-safe:transition-transform motion-safe:duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        className={`grid motion-safe:transition-[grid-template-rows] motion-safe:duration-200 motion-safe:ease-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div
          id={panelId}
          aria-hidden={open ? undefined : true}
          inert={!open}
          className={`min-h-0 overflow-hidden ${open ? '' : 'invisible'}`.trim()}
        >
          <div className="pt-2 pb-1 space-y-3">{children}</div>
        </div>
      </div>
    </div>
  )
}

export function ExplainerSummary({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] font-body text-navy/70 dark:text-white/70 leading-relaxed">
      {children}
    </p>
  )
}

export function ExplainerTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <li
          key={t}
          className="rounded-full bg-gray-100 dark:bg-white/10 px-2 py-0.5 text-[11px] font-body font-semibold text-gray-600 dark:text-white/60"
        >
          {t}
        </li>
      ))}
    </ul>
  )
}

interface ExplainerColumn {
  label: string
  items: string[]
}

export function ExplainerColumns({ good, bad }: { good: ExplainerColumn; bad: ExplainerColumn }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <p className="text-[11px] font-body font-semibold uppercase tracking-wider text-green-700 dark:text-green-400 mb-1">
          {good.label}
        </p>
        <ul className="space-y-1">
          {good.items.map((item) => (
            <li
              key={item}
              className="flex items-start gap-1.5 text-[12px] font-body text-navy/70 dark:text-white/70"
            >
              <span aria-hidden className="text-green-600 dark:text-green-400 font-semibold">
                ✓
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-[11px] font-body font-semibold uppercase tracking-wider text-red-700 dark:text-red-400 mb-1">
          {bad.label}
        </p>
        <ul className="space-y-1">
          {bad.items.map((item) => (
            <li
              key={item}
              className="flex items-start gap-1.5 text-[12px] font-body text-navy/70 dark:text-white/70"
            >
              <span aria-hidden className="text-red-600 dark:text-red-400 font-semibold">
                ✗
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function ExplainerNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2">
      <FlagIcon className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5" />
      <p className="text-[12px] font-body text-amber-800 dark:text-amber-400 leading-relaxed">
        {children}
      </p>
    </div>
  )
}
