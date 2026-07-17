'use client'

import type { ReactNode } from 'react'
import type { OperatorViewbookData } from '@/lib/viewbook/operator-data'
import type { PublicSection } from '@/lib/viewbook/public-types'
import type { ViewbookStage } from '@/lib/viewbook/stages'
import { PresentationModeProvider, PresentationToggle, usePresentationMode } from '../PresentationToggle'
import { HiddenSectionsList } from './HiddenSectionsList'
import { OperatorBar } from './OperatorBar'
import { OperatorSectionWrapper } from './OperatorSectionWrapper'

export interface OperatorViewbookLayerProps {
  viewbookId: number
  operatorEmail: string
  stage: ViewbookStage
  pcCompletedAt: string | null
  operatorData: OperatorViewbookData
  renderSection: (section: PublicSection) => ReactNode
  renderViewbook: (renderSection: (section: PublicSection) => ReactNode) => ReactNode
}

export function OperatorViewbookLayer(props: OperatorViewbookLayerProps) {
  return (
    <PresentationModeProvider>
      <OperatorViewbookLayerContent {...props} />
    </PresentationModeProvider>
  )
}

function OperatorViewbookLayerContent({
  viewbookId,
  operatorEmail,
  stage,
  pcCompletedAt,
  operatorData,
  renderSection,
  renderViewbook,
}: OperatorViewbookLayerProps) {
  const { initialized, presenting } = usePresentationMode()

  // Before localStorage has been read, render the normal public tree only.
  // This prevents a persisted presentation-mode browser from flashing ER
  // chrome while leaving the actual viewbook visible during hydration.
  if (!initialized) return <>{renderViewbook(renderSection)}</>

  if (presenting) {
    return (
      <>
        {renderViewbook(renderSection)}
        <PresentationToggle />
      </>
    )
  }

  const wrappedRenderSection = (publicSection: PublicSection): ReactNode => {
    const section = operatorData.sections.find((item) => item.sectionKey === publicSection.sectionKey)
    const rendered = renderSection(publicSection)
    if (!section) return rendered
    return (
      <OperatorSectionWrapper
        sectionKey={section.sectionKey}
        viewbookId={viewbookId}
        section={section}
        operatorData={operatorData}
        pcCompletedAt={pcCompletedAt}
      >
        {rendered}
      </OperatorSectionWrapper>
    )
  }

  return (
    <div data-operator-viewbook-layer>
      <OperatorBar
        viewbookId={viewbookId}
        operatorEmail={operatorEmail}
        stage={stage}
        pcCompletedAt={pcCompletedAt}
      />
      <HiddenSectionsList viewbookId={viewbookId} operatorData={operatorData} pcCompletedAt={pcCompletedAt} />
      {renderViewbook(wrappedRenderSection)}
    </div>
  )
}
