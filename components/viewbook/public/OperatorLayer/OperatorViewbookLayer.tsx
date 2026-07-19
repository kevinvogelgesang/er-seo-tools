'use client'

import type { ReactNode } from 'react'
import type { OperatorViewbookData } from '@/lib/viewbook/operator-data'
import type { ViewbookStage } from '@/lib/viewbook/stages'
import { PresentationModeProvider, PresentationToggle, usePresentationMode } from '../PresentationToggle'
import { OperatorBar } from './OperatorBar'
import { OperatorInspector, SectionActivityProvider, SelectionProvider } from './inspector'

// Server→Client boundary contract (Codex PR8 review, P1): every prop here is
// SERIALIZABLE. The section tree is composed SERVER-SIDE in page.tsx (the
// ViewbookShell wrapped with per-section OperatorSectionWrapper islands) and
// handed down as `children` — a ReactNode. NO function props: Next.js cannot
// serialize closures across the RSC boundary, and passing `renderSection` /
// `renderViewbook` here crashed the operator route at runtime.
export interface OperatorViewbookLayerProps {
  viewbookId: number
  operatorEmail: string
  stage: ViewbookStage
  pcCompletedAt: string | null
  operatorData: OperatorViewbookData
  children: ReactNode
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
  children,
}: OperatorViewbookLayerProps) {
  const { initialized, presenting } = usePresentationMode()

  // Context Lens providers (SelectionProvider/SectionActivityProvider) are
  // mounted OUTSIDE the visual presentation gate below: they must wrap BOTH
  // branches so hooks are called unconditionally and children can consume the
  // contexts even while presenting (spec C1/C3, Codex fix #11). Only the
  // operator chrome branch renders anything that reads/writes them right now.
  return (
    <SelectionProvider>
      <SectionActivityProvider>
        {!initialized || presenting ? (
          // Before localStorage has been read, OR in presentation mode, render
          // the pre-composed public tree only. Every OperatorSectionWrapper
          // INSIDE `children` reads the same presentation flag and self-hides
          // its controls, so the tree looks anonymous; the toggle stays
          // available to return to editing (it renders null until
          // `initialized`, matching the old flow).
          <>
            {children}
            <PresentationToggle />
          </>
        ) : (
          <div data-operator-viewbook-layer>
            <OperatorBar
              viewbookId={viewbookId}
              operatorEmail={operatorEmail}
              stage={stage}
              pcCompletedAt={pcCompletedAt}
            />
            {/* PR4: HiddenSectionsList retired — hidden-section recovery now
                lives in the outline (select) → pane Status group (the ONE
                Show controller). Codex fix #8: inspector AFTER the bar but
                BEFORE children — keyboard/DOM order. */}
            <OperatorInspector
              viewbookId={viewbookId}
              operatorData={operatorData}
              pcCompletedAt={pcCompletedAt}
              stage={stage}
            />
            {children}
          </div>
        )}
      </SectionActivityProvider>
    </SelectionProvider>
  )
}
