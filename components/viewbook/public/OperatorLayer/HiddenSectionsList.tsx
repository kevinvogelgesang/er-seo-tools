'use client'

import type { OperatorViewbookData } from '@/lib/viewbook/operator-data'
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
    <aside data-operator-hidden-sections className="border-b border-amber-900/15 bg-amber-50 px-4 py-3 text-black">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-900">Hidden sections</h2>
        <div className="mt-2 space-y-2">
          {hidden.map((section) => (
            <div key={section.sectionKey} className="rounded border border-amber-900/15 bg-white">
              <span className="block px-4 pt-2 text-xs font-semibold text-black/65">{section.sectionKey}</span>
              <SectionQuickControls viewbookId={viewbookId} section={section} pcCompletedAt={pcCompletedAt} />
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
