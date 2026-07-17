'use client'

import type { ReactNode } from 'react'
import type { OperatorSectionData, OperatorViewbookData } from '@/lib/viewbook/operator-data'
import type { SectionKey } from '@/lib/viewbook/theme'
import { usePresentationMode } from '../PresentationToggle'
import { InlineSectionEditors } from './InlineEditors'
import { SectionQuickControls } from './SectionQuickControls'

export function OperatorSectionWrapper({
  sectionKey,
  viewbookId,
  section,
  operatorData,
  pcCompletedAt,
  isOperator = true,
  children,
}: {
  sectionKey: SectionKey
  viewbookId: number
  section: OperatorSectionData
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

  return (
    <div data-operator-section-wrapper={sectionKey}>
      <SectionQuickControls viewbookId={viewbookId} section={section} pcCompletedAt={pcCompletedAt} />
      {children}
      <InlineSectionEditors viewbookId={viewbookId} section={section} operatorData={operatorData} />
    </div>
  )
}
