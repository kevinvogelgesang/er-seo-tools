// Generic progressive-disclosure card: grade chip + headline counts collapsed;
// <details> reveals the children (evidence). C14 redesign: urgency sections
// render open by default (leave-behind) via `defaultOpen`.
import type { ReactNode } from 'react'

export type Grade = 'good' | 'warn' | 'bad' | 'none'

const GRADE_CLASSES: Record<Grade, string> = {
  good: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  bad: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  none: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60',
}

// Urgency bands (Kevin, C14 pass 2): ≥95 green, 80–94 amber, <80 red — applied
// throughout the sales report (scores AND coverage percentages) so the whole
// report reads consistently and leans toward urgency.
export function gradeForScore(score: number | null): Grade {
  if (score === null) return 'none'
  if (score >= 95) return 'good'
  if (score >= 80) return 'warn'
  return 'bad'
}

export function SectionCard(props: {
  title: string
  grade: Grade
  gradeLabel: string
  headline: string
  /** C14 redesign: urgency sections render open by default (leave-behind). */
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm">
      <details open={props.defaultOpen}>
        <summary className="cursor-pointer list-none p-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white mb-1">{props.title}</h2>
            <p className="text-[13px] font-body text-navy/50 dark:text-white/50">{props.headline}</p>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-heading font-semibold ${GRADE_CLASSES[props.grade]}`}>
            {props.gradeLabel}
          </span>
        </summary>
        <div className="px-6 pb-6 space-y-4">{props.children}</div>
      </details>
    </section>
  )
}
