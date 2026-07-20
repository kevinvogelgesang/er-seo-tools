// PR7 Task 6 (restyled 2026-07-19): the shared "summary face" — a compact
// status/metric line rendered in the section's sub-hero bar (SectionShell's
// `summary` prop → SectionReveal's sticky header, right-aligned beside the
// title). Server component, `--vb-*` tokens only, light-only (public
// viewbook is light-only per the design pass).
//
// 2026-07-19 de-dup: the `eyebrow` line is GONE. It repeated the section
// title (every call site passed the title or a shorthand of it) directly
// under the sticky-bar's own title — the welcome section literally read
// "Welcome / Welcome / In progress". The bar now reads title-left,
// summary-right, one line: "Welcome ······ In progress".
import type { ReactNode } from 'react'
import type { PublicSection } from '@/lib/viewbook/public-types'

export function SummaryStat({
  headline,
  chip,
}: {
  headline: string
  chip?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
      <p className="min-w-0 truncate text-sm font-semibold text-black/55">{headline}</p>
      {chip != null && (
        <span
          className="shrink-0 rounded-full px-3 py-1 text-sm font-semibold"
          style={{ background: 'var(--vb-tertiary)', color: 'var(--vb-on-tertiary)' }}
        >
          {chip}
        </span>
      )}
    </div>
  )
}

// Generic one-line status for sections with no rich metric of their own.
// Deliberately coarse (state + ack only) — every PublicSection carries these
// two fields regardless of section kind, so this never needs section-specific
// data. The celebratory "Completed {date}" badge (SectionShell) already
// covers the doneAt detail; this is just the at-a-glance word.
export function sectionStatusLabel(section: PublicSection): string {
  if (section.state === 'done') return 'Marked complete'
  if (section.acknowledgedAt) return 'Acknowledged'
  return 'In progress'
}
