// Pure stage-stepper derivation for ProgressNav v2 (spec §8 matured header).
// Client-safe — no server imports.
import { STAGE_LABELS, VIEWBOOK_STAGES, type ViewbookStage } from './stages'

export interface StageStep {
  key: ViewbookStage
  label: string
  state: 'done' | 'current' | 'upcoming'
}

export function stageSteps(current: ViewbookStage): StageStep[] {
  const currentIndex = VIEWBOOK_STAGES.indexOf(current)
  return VIEWBOOK_STAGES.map((key, i) => ({
    key,
    label: STAGE_LABELS[key],
    state: i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming',
  }))
}
