import type { ReactNode } from 'react'
import type { PublicSection } from '@/lib/viewbook/public-types'
import type { SectionRenderMeta } from '@/lib/viewbook/section-status'

export function PreviousStages({
  groups,
  renderSection,
}: {
  groups: { stageLabel: string; sections: PublicSection[] }[]
  renderSection: (s: PublicSection, meta: SectionRenderMeta) => ReactNode
}) {
  if (groups.length === 0) {
    return null
  }

  return (
    <>
      {groups.map((group) => (
        <div key={group.stageLabel}>
          <h2>{group.stageLabel}</h2>
          {group.sections.map((section) =>
            renderSection(section, {
              heroSize: 'none',
              chapterNumber: null,
              status: 'complete',
              isLead: false,
            })
          )}
        </div>
      ))}
    </>
  )
}
