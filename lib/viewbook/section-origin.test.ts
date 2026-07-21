import { describe, it, expect } from 'vitest'
import { originStageOf, groupCarriedByOrigin } from './section-origin'
import type { PublicSection } from './public-types'

const sec = (sectionKey: string, state: 'active' | 'done' = 'done') =>
  ({ sectionKey, state, doneAt: null, acknowledgedAt: null, introNote: null, narrative: null }) as PublicSection

describe('originStageOf', () => {
  it('maps a key to the first stage whose primary lineup contains it', () => {
    expect(originStageOf('pc-setup')).toBe('post-contract')
    expect(originStageOf('welcome')).toBe('kickoff')
    expect(originStageOf('brand')).toBe('website-specifics')
  })
})

describe('groupCarriedByOrigin', () => {
  it('buckets sections by origin stage in canonical order', () => {
    const groups = groupCarriedByOrigin([sec('welcome'), sec('pc-setup')])
    expect(groups.map((g) => g.stageLabel)).toEqual(['Getting Started', 'Kickoff'])
    expect(groups[0].sections[0].sectionKey).toBe('pc-setup')
  })
  it('returns [] for no carried sections', () => {
    expect(groupCarriedByOrigin([])).toEqual([])
  })
})
