import { describe, expect, it } from 'vitest'
import { STAGE_LABELS, VIEWBOOK_STAGES } from './stages'
import { stageSteps } from './stage-progress'

describe('stageSteps', () => {
  it('marks prior stages done, the current stage current, and later stages upcoming', () => {
    expect(stageSteps('website-specifics').map((s) => s.state)).toEqual([
      'done',
      'done',
      'current',
      'upcoming',
    ])
  })

  it('returns the four stages in catalog order with catalog labels', () => {
    const steps = stageSteps('post-contract')
    expect(steps.map((s) => s.key)).toEqual(VIEWBOOK_STAGES)
    expect(steps.map((s) => s.label)).toEqual(VIEWBOOK_STAGES.map((k) => STAGE_LABELS[k]))
  })

  it('marks the first stage current and everything after upcoming', () => {
    expect(stageSteps('post-contract').map((s) => s.state)).toEqual([
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
    ])
  })

  it('marks the last stage current and everything before done', () => {
    expect(stageSteps('building').map((s) => s.state)).toEqual([
      'done',
      'done',
      'done',
      'current',
    ])
  })
})
