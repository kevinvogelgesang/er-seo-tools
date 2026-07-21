// lib/viewbook/section-origin.ts
// Pure, client-safe: which stage a carried section "belongs" to (spec §5 item 7).
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
    if (!buckets.has(origin)) buckets.set(origin, [])
    buckets.get(origin)!.push(s)
  }
  // Emit in canonical stage order.
  return VIEWBOOK_STAGES.filter((st) => buckets.has(st)).map((st) => ({
    stageLabel: STAGE_LABELS[st],
    sections: buckets.get(st)!,
  }))
}
