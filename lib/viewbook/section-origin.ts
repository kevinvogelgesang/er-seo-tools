// Pure, client-safe: which stage a carried section "belongs" to, and grouping
// carried sections by that origin for the continuous viewer's "Previous stages"
// (spec §5.2).
import type { SectionKey } from './theme'
import type { PublicSection } from './public-types'
import { STAGE_LINEUPS, STAGE_LABELS, VIEWBOOK_STAGES, type ViewbookStage } from './stages'

export function originStageOf(key: SectionKey): ViewbookStage | null {
  for (const stage of VIEWBOOK_STAGES) {
    if (STAGE_LINEUPS[stage].primary.includes(key)) return stage
  }
  return null
}

export function groupCarriedByOrigin(
  sections: PublicSection[],
): { stageLabel: string; sections: PublicSection[] }[] {
  const buckets = new Map<ViewbookStage, PublicSection[]>()
  for (const s of sections) {
    const origin = originStageOf(s.sectionKey)
    if (!origin) continue
    const arr = buckets.get(origin) ?? []
    arr.push(s)
    buckets.set(origin, arr)
  }
  const out: { stageLabel: string; sections: PublicSection[] }[] = []
  for (const stage of VIEWBOOK_STAGES) {
    const arr = buckets.get(stage)
    if (arr && arr.length) out.push({ stageLabel: STAGE_LABELS[stage], sections: arr })
  }
  return out
}
