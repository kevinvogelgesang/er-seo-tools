// Pure, client-safe section-status derivation for the continuous-reading viewer
// (spec §5.1). No scroll state; no server imports. Also the home of
// SectionRenderMeta (kept out of public-types.ts to stay cycle-free).
import type { SectionKey } from './theme'
import type { PublicSection } from './public-types'
import { INPUT_EXPECTING_KEYS } from './section-copy'

export type SectionStatus = 'complete' | 'current' | 'upcoming' | 'needs-input'

export interface SectionRenderMeta {
  heroSize: 'full' | 'chapter' | 'none'
  chapterNumber: number | null // 1-based position in the rendered primary lineup; null for carried
  status: SectionStatus
  isLead: boolean
}

// Derived from the RENDERED primary lineup order + each section's state. There
// is exactly ONE 'current' (the first non-terminal section); needs-input is a
// distinct call-to-action status that does NOT consume that slot. Returns a
// partial map — a key not in `sections` is absent, never defaulted.
export function computeSectionStatuses(
  renderedPrimaryOrder: SectionKey[],
  sections: Pick<PublicSection, 'sectionKey' | 'state' | 'acknowledgedAt'>[],
  ctx: { pcCompletedAt: string | null },
): Partial<Record<SectionKey, SectionStatus>> {
  const byKey = new Map(sections.map((s) => [s.sectionKey, s]))
  const out: Partial<Record<SectionKey, SectionStatus>> = {}
  let currentAssigned = false
  const progress = (key: SectionKey) => {
    if (!currentAssigned) {
      out[key] = 'current'
      currentAssigned = true
    } else {
      out[key] = 'upcoming'
    }
  }
  for (const key of renderedPrimaryOrder) {
    const s = byKey.get(key)
    if (!s) continue
    if (key === 'pc-intro') {
      if (ctx.pcCompletedAt != null) out[key] = 'complete'
      else progress(key)
      continue
    }
    if (key === 'pc-thanks') {
      progress(key)
      continue
    }
    if (s.state === 'done') {
      out[key] = 'complete'
      continue
    }
    if (s.acknowledgedAt != null) {
      out[key] = 'complete'
      continue
    }
    if (INPUT_EXPECTING_KEYS.has(key)) {
      out[key] = 'needs-input'
      continue
    }
    progress(key)
  }
  return out
}

export function carriedStatus(section: Pick<PublicSection, 'state'>): SectionStatus {
  return section.state === 'done' ? 'complete' : 'current'
}
