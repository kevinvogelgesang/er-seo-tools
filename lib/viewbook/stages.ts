// Client-safe code-owned stage catalog (v2 spec §4). Lineups decide what the
// public page renders per stage; a key absent from both lists does not render
// even when its DB row exists. New section keys enter lineups ONLY in the PR
// that ships their component (spec Codex fix 2 — producers before consumers).

import type { SectionKey } from './theme'

export const VIEWBOOK_STAGES = ['post-contract', 'kickoff', 'website-specifics', 'building'] as const
export type ViewbookStage = (typeof VIEWBOOK_STAGES)[number]

export function isViewbookStage(s: string): s is ViewbookStage {
  return (VIEWBOOK_STAGES as readonly string[]).includes(s)
}

export function nextStage(s: ViewbookStage): ViewbookStage | null {
  const i = VIEWBOOK_STAGES.indexOf(s)
  return VIEWBOOK_STAGES[i + 1] ?? null
}

export function prevStage(s: ViewbookStage): ViewbookStage | null {
  const i = VIEWBOOK_STAGES.indexOf(s)
  return i > 0 ? VIEWBOOK_STAGES[i - 1] : null
}

export const STAGE_LABELS: Record<ViewbookStage, string> = {
  'post-contract': 'Getting Started',
  kickoff: 'Kickoff',
  'website-specifics': 'Website Specifics',
  building: 'Now Building',
}

export interface StageLineup {
  primary: SectionKey[]
  carried: SectionKey[]
}

export const STAGE_LINEUPS: Record<ViewbookStage, StageLineup> = {
  'post-contract': { primary: ['data-source'], carried: [] },
  kickoff: { primary: ['welcome', 'milestones', 'strategy'], carried: ['data-source'] },
  'website-specifics': {
    primary: ['brand', 'assessment'],
    carried: ['welcome', 'milestones', 'strategy', 'data-source'],
  },
  building: {
    primary: ['welcome', 'milestones', 'data-source', 'brand', 'assessment', 'strategy', 'materials'],
    carried: [],
  },
}
