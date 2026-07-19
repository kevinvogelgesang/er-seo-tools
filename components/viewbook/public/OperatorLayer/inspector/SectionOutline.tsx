'use client'
import type { OperatorViewbookData } from '@/lib/viewbook/operator-data'
import type { ViewbookStage } from '@/lib/viewbook/stages'
import type { SectionKey } from '@/lib/viewbook/theme'

export type OutlineGroup = 'primary' | 'carried' | 'future'
export interface OutlineRow {
  sectionKey: SectionKey
  title: string
  state: 'active' | 'hidden' | 'done'
  acknowledged: boolean
  group: OutlineGroup
}
export interface SectionOutlineProps {
  operatorData: OperatorViewbookData
  stage: ViewbookStage
  pcCompletedAt: string | null
  viewbookId: number
}

// PR2 fills this from public-data lineups (primary+carried, hidden reinserted
// in lineup order, pc-thanks gated by pcCompletedAt, future-stage → 'future').
export function buildOutlineRows(_operatorData: OperatorViewbookData, _stage: ViewbookStage, _pcCompletedAt: string | null): OutlineRow[] {
  return []
}

export function SectionOutline(_props: SectionOutlineProps) {
  return <nav aria-label="Section outline" data-vb-section-outline /> // PR2 renders rows from buildOutlineRows
}
