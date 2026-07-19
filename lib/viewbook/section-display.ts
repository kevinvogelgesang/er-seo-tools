import type { PublicSection } from './public-types'
import type { ViewbookStage } from './stages'

export type SectionDisplayMode = 'always-open' | 'done' | 'ack-collapsed' | 'normal' | 'hero-collapsed'

const ALWAYS_OPEN_KEYS = new Set(['pc-intro'])

export function sectionDisplayMode(section: PublicSection, stage: ViewbookStage): SectionDisplayMode {
  // Operator "collapse to hero" wins over everything — the client sees only the
  // brand hero band; the section body (intro + content) is not rendered at all.
  if (section.state === 'collapsed') return 'hero-collapsed'
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
