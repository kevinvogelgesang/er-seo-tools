import type { PublicSection } from './public-types'
import type { ViewbookStage } from './stages'

export type SectionDisplayMode = 'always-open' | 'done' | 'ack-collapsed' | 'normal'

const ALWAYS_OPEN_KEYS = new Set(['pc-intro'])

export function sectionDisplayMode(section: PublicSection, stage: ViewbookStage): SectionDisplayMode {
  if (ALWAYS_OPEN_KEYS.has(section.sectionKey)) return 'always-open'
  if (section.state === 'done') return 'done'
  if (stage === 'post-contract' && section.acknowledgedAt != null) return 'ack-collapsed'
  return 'normal'
}

export function sectionStartsCollapsed(m: SectionDisplayMode): boolean {
  return m === 'done' || m === 'ack-collapsed'
}

export function sectionLocksAutoReveal(m: SectionDisplayMode): boolean {
  return m !== 'normal'
}

const BUILDING_OPEN = new Set<string>(['milestones', 'materials'])

export function sectionInitiallyOpen(section: PublicSection, stage: ViewbookStage): boolean {
  const mode = sectionDisplayMode(section, stage)
  if (mode === 'always-open') return true
  if (mode === 'done' || mode === 'ack-collapsed') return false
  if (stage === 'building') return BUILDING_OPEN.has(section.sectionKey)
  return true
}
