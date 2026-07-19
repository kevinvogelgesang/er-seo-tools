'use client'
import type { OperatorViewbookData } from '@/lib/viewbook/operator-data'

export interface InspectorPanesProps { viewbookId: number; operatorData: OperatorViewbookData }

export function InspectorPanes(_props: InspectorPanesProps) {
  return <div role="region" aria-label="Section editors" data-vb-inspector-panes /> // PR3 mounts all section panes
}
