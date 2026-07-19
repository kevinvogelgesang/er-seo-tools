'use client'

import type { OperatorViewbookData } from '@/lib/viewbook/operator-data'
import type { ViewbookStage } from '@/lib/viewbook/stages'
import { InspectorPanes } from './InspectorPanes'
import { SectionOutline } from './SectionOutline'

export interface OperatorInspectorProps {
  viewbookId: number
  operatorData: OperatorViewbookData
  pcCompletedAt: string | null
  stage: ViewbookStage
}

// PR5 adds the mobile bottom sheet, collapse/expand, and canvas-fit toggle.
// PR1: a desktop-only rail (hidden below lg — no inline height so there is no
// empty viewport block on mobile), docked below the published sticky offset.
export function OperatorInspector({ viewbookId, operatorData, pcCompletedAt, stage }: OperatorInspectorProps) {
  return (
    <aside
      aria-label="Viewbook editing inspector"
      data-vb-inspector
      style={{ top: 'var(--vb-sticky-offset, 0px)' }}
      className="hidden font-body lg:fixed lg:right-0 lg:bottom-0 lg:z-40 lg:block lg:w-96 lg:overflow-y-auto lg:border-l lg:border-gray-200 lg:bg-white/95 lg:backdrop-blur-md lg:dark:border-navy-border lg:dark:bg-navy-deep/95"
    >
      <SectionOutline operatorData={operatorData} stage={stage} pcCompletedAt={pcCompletedAt} viewbookId={viewbookId} />
      <InspectorPanes viewbookId={viewbookId} operatorData={operatorData} />
    </aside>
  )
}
