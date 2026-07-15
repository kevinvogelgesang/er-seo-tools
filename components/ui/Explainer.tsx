'use client'

// components/ui/Explainer.tsx — reusable inline-triggered FLOATING HOVER CARD
// (2026-07-15 redesign; supersedes the inline-disclosure version).
//
// A small circled-ⓘ button that, on hover / keyboard-focus / tap, opens a
// floating card of STATIC explanatory prose ("what does this measure / how is
// this computed"). Structured subcomponents mirror the "Social Style" mock's
// visual language (summary paragraph, tag chips, two-column do/don't lists,
// flagged footer note).
//
// Design contract (spec 2026-07-15, Codex-reviewed):
//  - STRICTLY NON-INTERACTIVE content. No links/buttons/inputs inside — only
//    prose, chips, ✓/✗ lists, notes, and static tables. This keeps
//    role="tooltip" semantically valid (WAI: tooltips must not contain
//    focusable content) and makes hover-dismiss safe. Interactive content
//    would need a separate non-modal-dialog popover with focus management.
//  - Positioning: @floating-ui/react with offset/flip/shift/size/arrow +
//    autoUpdate. `size` caps the card to the viewport (long tables scroll)
//    since flip/shift reposition but never shrink.
//  - Interaction: useHover(mouseOnly + safePolygon so the cursor can cross the
//    gap into the card) + useFocus(visibleOnly, the a11y path) +
//    useClick(stickIfOpen, the tap/pin path) + useDismiss (Esc/outside).
//  - Positioning transform (outer element) is kept separate from the entrance
//    animation (inner element), per Floating UI guidance.
//  - Closed = genuinely unmounted (entrance-only animation, no exit
//    transition), so there is no hidden-focus concern.
//
// House rule (spec §methodology-vs-operational-truth): ONLY invariant
// methodology prose belongs inside a card. Run-specific status, errors,
// freshness lines, coverage/truncation warnings, and honesty qualifiers must
// stay visible in the adopting surface at all times.
//
// No fetches, no context — safe on public token-gated pages and inside
// server-component trees (RSC children pattern).

import { useId, useRef, useState } from 'react'
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  size,
  arrow,
  useHover,
  useFocus,
  useClick,
  useDismiss,
  useRole,
  useInteractions,
  safePolygon,
  FloatingPortal,
  FloatingArrow,
} from '@floating-ui/react'

function InfoIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
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
  title,
  children,
  className = '',
}: {
  /** Accessible name of the ⓘ trigger (aria-label). Not rendered as text. */
  label: string
  /** Optional bold heading at the top of the floating card. */
  title?: string
  /** Non-interactive content — the subcomponents below or static prose/tables. */
  children: React.ReactNode
  /** Applied to the trigger button, e.g. for placement next to a heading. */
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const arrowRef = useRef<SVGSVGElement>(null)
  const titleId = useId()

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableWidth, availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxWidth: `${Math.min(360, availableWidth)}px`,
            maxHeight: `${Math.max(0, availableHeight)}px`,
          })
        },
      }),
      arrow({ element: arrowRef }),
    ],
  })

  const hover = useHover(context, {
    mouseOnly: true,
    move: false,
    delay: { open: 120, close: 80 },
    handleClose: safePolygon(),
  })
  const focus = useFocus(context, { visibleOnly: true })
  const click = useClick(context, { stickIfOpen: true })
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    click,
    dismiss,
    role,
  ])

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        aria-label={label}
        {...getReferenceProps()}
        className={`inline-flex items-center justify-center rounded-full p-1.5 min-h-7 min-w-7 align-middle text-navy/40 dark:text-white/40 hover:text-navy dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors ${className}`.trim()}
      >
        <InfoIcon className="w-4 h-4" />
      </button>
      {open && (
        <FloatingPortal>
          {/* Outer element carries the positioning transform. */}
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50"
          >
            {/* Inner element carries the entrance animation (kept separate). */}
            <div
              aria-labelledby={title ? titleId : undefined}
              className="motion-safe:animate-explainer-in max-w-sm overflow-y-auto rounded-xl border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card shadow-lg px-4 py-3"
            >
              <FloatingArrow
                ref={arrowRef}
                context={context}
                className="fill-white dark:fill-navy-card [&>path:first-of-type]:stroke-gray-200 dark:[&>path:first-of-type]:stroke-navy-border"
              />
              {title && (
                <p
                  id={titleId}
                  className="font-heading font-semibold text-[13px] text-navy dark:text-white mb-2"
                >
                  {title}
                </p>
              )}
              <div className="space-y-3">{children}</div>
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
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

export function ExplainerColumns({
  good,
  bad,
}: {
  good: ExplainerColumn
  bad: ExplainerColumn
}) {
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
