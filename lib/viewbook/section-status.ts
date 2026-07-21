// Pure, client-safe status derivation (spec §4.3). No scroll state.
// SectionRenderMeta lives here (Codex fix #2) so public-types stays cycle-free.
import type { SectionKey } from './theme'
import type { PublicSection } from './public-types'
import { INPUT_EXPECTING_KEYS } from './section-copy'

export type SectionStatus = 'complete' | 'current' | 'upcoming' | 'needs-input'

export interface SectionRenderMeta {
  heroSize: 'full' | 'chapter' | 'none'
  chapterNumber: number | null
  status: SectionStatus
  isLead: boolean
}

type StatusInput = Pick<PublicSection, 'sectionKey' | 'state' | 'acknowledgedAt'>

export function computeSectionStatuses(
  renderedPrimaryOrder: SectionKey[],
  sections: StatusInput[],
  ctx: { pcCompletedAt: string | null },
): Partial<Record<SectionKey, SectionStatus>> {
  const byKey = new Map(sections.map((s) => [s.sectionKey, s]))
  const out: Partial<Record<SectionKey, SectionStatus>> = {}
  let currentAssigned = false
  // Helper: place a non-terminal (not complete, not needs-input) section in the
  // single-current progression — first gets 'current', the rest 'upcoming'.
  const progress = (key: SectionKey) => {
    out[key] = currentAssigned ? 'upcoming' : 'current'
    currentAssigned = true
  }
  for (const key of renderedPrimaryOrder) {
    const s = byKey.get(key)
    if (!s) continue
    // Bookends resolve off pcCompletedAt. pc-intro, when not complete, consumes
    // the single 'current' slot via the SAME progression (Codex fix #8).
    if (key === 'pc-intro') {
      if (ctx.pcCompletedAt != null) out[key] = 'complete'
      else progress(key)
      continue
    }
    if (key === 'pc-thanks') { progress(key); continue } // only rendered when pcCompletedAt != null
    if (s.state === 'done') { out[key] = 'complete'; continue }
    if (s.state === 'active' && s.acknowledgedAt != null) { out[key] = 'complete'; continue }
    if (s.state === 'active' && INPUT_EXPECTING_KEYS.has(key)) { out[key] = 'needs-input'; continue }
    // Every remaining non-terminal section (active OR collapsed informational)
    // runs through the ONE progression — never a second stray 'current'.
    progress(key)
  }
  return out
}

export function carriedStatus(section: Pick<PublicSection, 'state'>): SectionStatus {
  return section.state === 'done' ? 'complete' : 'current'
}
