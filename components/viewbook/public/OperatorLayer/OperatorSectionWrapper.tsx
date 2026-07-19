'use client'

import type { ReactNode } from 'react'
import type { OperatorSectionData, OperatorViewbookData } from '@/lib/viewbook/operator-data'
import type { SectionKey } from '@/lib/viewbook/theme'
import { usePresentationMode } from '../PresentationToggle'
import { SectionQuickControls } from './SectionQuickControls'

export function OperatorSectionWrapper({
  sectionKey,
  viewbookId,
  section,
  pcCompletedAt,
  isOperator = true,
  children,
}: {
  sectionKey: SectionKey
  viewbookId: number
  section: OperatorSectionData
  // `operatorData` is still passed by page.tsx (PR4 removes it from the type);
  // PR3 no longer reads it here — the editors moved to InspectorPanes.
  operatorData: OperatorViewbookData
  pcCompletedAt: string | null
  isOperator?: boolean
  children: ReactNode
}) {
  // This island is composed server-side around EVERY section (P1 fix), so it
  // owns the per-section presentation gate: before localStorage is read, or in
  // presentation mode, render the bare public section — no controls, no editor
  // chrome. Outside a provider, usePresentationMode returns the safe default
  // (initialized + not-presenting) so standalone/anonymous renders show nothing
  // unexpected and never throw.
  const { initialized, presenting } = usePresentationMode()
  if (!isOperator || !initialized || presenting) return <>{children}</>

  // `data-operator-section` is the scroll-spy target boundary (useSectionSelection
  // reads it + `dataset.operatorSection`). The inline editors moved to
  // InspectorPanes — the canvas section now only carries quick controls + the
  // real public section, no below-section editor sandwich.
  return (
    <div data-operator-section-wrapper={sectionKey} data-operator-section={sectionKey}>
      <SectionQuickControls viewbookId={viewbookId} section={section} pcCompletedAt={pcCompletedAt} />
      {children}
    </div>
  )
}
