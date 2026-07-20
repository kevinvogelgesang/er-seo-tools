// The collapsed-row expand affordance — 2026-07-19 revision. The 'bar'
// variant is dropped (chevron + pill only, see lib/viewbook/presentation-
// config.ts). Both are now PURELY DECORATIVE (aria-hidden, no button, no
// onClick): the enclosing <button> in CollapsibleSection owns the click
// handler, keyboard activation, and aria-expanded/aria-controls/aria-label —
// nesting a second real interactive control inside it would be an invalid
// (and redundant) interactive-in-interactive pattern. This is a plain,
// isomorphic component (no hooks/handlers) — SectionShell (server) renders it
// directly, inline next to the title, no RSC boundary needed.
import type { CollapseAffordanceKind } from '@/lib/viewbook/presentation-config'

function ChevronIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export function CollapseAffordance({ kind }: { kind: CollapseAffordanceKind }) {
  if (kind === 'pill') {
    return (
      <span
        aria-hidden
        className="inline-flex flex-none items-center gap-1.5 rounded-full border border-white/50 bg-white/90 px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-colors group-hover:bg-white"
        style={{ color: 'var(--vb-primary)' }}
      >
        Expand
        <ChevronIcon className="h-3.5 w-3.5" />
      </span>
    )
  }

  // chevron (default): a soft rounded tap target with a crisp SVG chevron —
  // icon-only, no visible label.
  return (
    <span
      aria-hidden
      className="inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg bg-white/10 text-white transition-colors group-hover:bg-white/20"
    >
      <ChevronIcon className="h-3.5 w-3.5" />
    </span>
  )
}
