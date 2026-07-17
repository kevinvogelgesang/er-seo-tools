'use client'

import type { ReactNode } from 'react'
import type { OperatorSectionData, OperatorViewbookData } from '@/lib/viewbook/operator-data'
import type { SectionKey } from '@/lib/viewbook/theme'
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
  if (!isOperator) return <>{children}</>

  return (
    <div data-operator-section-wrapper={sectionKey}>
      <SectionQuickControls viewbookId={viewbookId} section={section} pcCompletedAt={pcCompletedAt} />
      {children}
      <InlineSectionEditors viewbookId={viewbookId} section={section} operatorData={operatorData} />
    </div>
  )
}
