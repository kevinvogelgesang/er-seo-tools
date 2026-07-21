// lib/viewbook/section-origin.test.ts
import { describe, it, expect } from 'vitest'
import { originStageOf, groupCarriedByOrigin } from './section-origin'

describe('section-origin', () => {
  it('resolves the earliest primary stage for a key', () => {
    expect(originStageOf('pc-setup')).toBe('post-contract')
    expect(originStageOf('welcome')).toBe('kickoff')
    expect(originStageOf('brand')).toBe('website-specifics')
  })
  it('groups carried sections by origin stage in stage order', () => {
    const secs = [
      { sectionKey: 'welcome', state: 'done' },
      { sectionKey: 'pc-setup', state: 'done' },
    ] as any
    const groups = groupCarriedByOrigin(secs)
    expect(groups.map((g) => g.stageLabel)).toEqual(['Getting Started', 'Kickoff'])
    expect(groups[0].sections[0].sectionKey).toBe('pc-setup')
  })
})
