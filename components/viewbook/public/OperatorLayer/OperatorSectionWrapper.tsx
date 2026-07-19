'use client'

import type { ReactNode } from 'react'
import type { SectionKey } from '@/lib/viewbook/theme'
import { usePresentationMode } from '../PresentationToggle'

export function OperatorSectionWrapper({
  sectionKey,
  isOperator = true,
  children,
}: {
  sectionKey: SectionKey
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

  // PR4: boundary-only. `data-operator-section` is the scroll-spy target
  // boundary (useSectionSelection reads it + `dataset.operatorSection`). The
  // status controls moved into the inspector pane's Status group (the single
  // mutation owner); the inline editors already moved to InspectorPanes. The
  // canvas section now carries ONLY the boundary + the real public section.
  return (
    <div data-operator-section-wrapper={sectionKey} data-operator-section={sectionKey}>
      {children}
    </div>
  )
}
