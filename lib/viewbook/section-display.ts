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
