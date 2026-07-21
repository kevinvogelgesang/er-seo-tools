'use client'
import type { SectionKey } from '@/lib/viewbook/theme'
import type { SectionStatus } from '@/lib/viewbook/section-status'

export function StageOverview({ items }: { items: { sectionKey: SectionKey; label: string; status: SectionStatus; anchor: string }[] }) {
  return (
    <nav aria-label="In this stage">
      {items.map((item) => (
        <button key={`${item.sectionKey}-${item.anchor}`} type="button">
          {item.label}
        </button>
      ))}
    </nav>
  )
}
