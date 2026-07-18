'use client'

import type { OperatorViewbookData } from '@/lib/viewbook/operator-data'
import { StatusPill } from '@/components/ui/StatusPill'
import { SectionQuickControls } from './SectionQuickControls'

export function HiddenSectionsList({
  viewbookId,
  operatorData,
  pcCompletedAt,
}: {
  viewbookId: number
  operatorData: OperatorViewbookData
  pcCompletedAt: string | null
}) {
  const hidden = operatorData.sections.filter((section) =>
    section.state === 'hidden' && (section.sectionKey !== 'pc-thanks' || pcCompletedAt !== null),
  )
  if (hidden.length === 0) return null

  return (
    <aside data-operator-hidden-sections className="border-b border-amber-200 bg-amber-50 py-3 font-body text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-sm font-bold">Hidden sections</h2>
          <StatusPill label={String(hidden.length)} tone="warning" />
        </div>
        <p className="mt-0.5 text-xs text-amber-800/75 dark:text-amber-200/70">Hidden from the client view.</p>
        <div className="mt-3 space-y-2">
          {hidden.map((section) => (
            <div key={section.sectionKey} className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-navy-border dark:bg-navy-card">
              <SectionQuickControls
                viewbookId={viewbookId}
                section={section}
                pcCompletedAt={pcCompletedAt}
                variant="embedded"
              />
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
