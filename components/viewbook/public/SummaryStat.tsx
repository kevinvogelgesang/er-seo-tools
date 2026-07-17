// PR7 Task 6: the shared "summary face" presentational tile — an index-card
// glance rendered in a section's brand-header summary row (SectionShell's
// `summary` prop). Server component, `--vb-*` tokens only, light-only (public
// viewbook is light-only per the design pass). Two call shapes:
//   - rich: a section-specific eyebrow ("MILESTONES") + a metric headline
//     ("2 of 5 complete") + an optional status/number chip.
//   - generic default: eyebrow = the section's own title, headline = a
//     one-line status derived from section state (sectionStatusLabel below) —
//     used by every section that has no bespoke rich summary, so no section
//     ever lacks a summary face.
import type { ReactNode } from 'react'
import type { PublicSection } from '@/lib/viewbook/public-types'

export function SummaryStat({
  eyebrow,
  headline,
  chip,
}: {
  eyebrow: string
  headline: string
  chip?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0">
        <p
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: 'var(--vb-secondary)' }}
        >
          {eyebrow}
        </p>
        <p className="truncate text-lg font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
          {headline}
        </p>
      </div>
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
