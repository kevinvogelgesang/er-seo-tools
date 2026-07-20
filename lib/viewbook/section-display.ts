import type { PublicSection } from './public-types'
import type { ViewbookStage } from './stages'

export type SectionDisplayMode = 'always-open' | 'done' | 'ack-collapsed' | 'normal'

// 2026-07-19 welcome-auto-reveal: pc-intro no longer wins over done/ack — it
// now follows the same display-mode rules as every other section (collapse
// eligibility lives in theme.ts's COLLAPSE_EXCLUDED_SECTION_KEYS, now empty).
// Retained (now empty) as the seam for any future permanently-open section.
const ALWAYS_OPEN_KEYS = new Set<string>()

export function sectionDisplayMode(section: PublicSection, stage: ViewbookStage): SectionDisplayMode {
  if (ALWAYS_OPEN_KEYS.has(section.sectionKey)) return 'always-open'
  if (section.state === 'done') return 'done'
  if (stage === 'post-contract' && section.acknowledgedAt != null) return 'ack-collapsed'
  return 'normal'
}

const BUILDING_OPEN = new Set<string>(['milestones', 'materials'])

export function sectionInitiallyOpen(section: PublicSection, stage: ViewbookStage): boolean {
  const mode = sectionDisplayMode(section, stage)
  if (mode === 'always-open') return true
  if (mode === 'done' || mode === 'ack-collapsed') return false
  if (stage === 'building') return BUILDING_OPEN.has(section.sectionKey)
  return true
}
