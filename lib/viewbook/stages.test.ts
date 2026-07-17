import { describe, expect, it } from 'vitest'
import { SECTION_KEYS } from './theme'
import {
  VIEWBOOK_STAGES, isViewbookStage, nextStage, prevStage, STAGE_LINEUPS,
} from './stages'

describe('stage catalog', () => {
  it('orders the four stages', () => {
    expect(VIEWBOOK_STAGES).toEqual(['post-contract', 'kickoff', 'website-specifics', 'building'])
  })
  it('validates stage strings', () => {
    expect(isViewbookStage('kickoff')).toBe(true)
    expect(isViewbookStage('nope')).toBe(false)
  })
  it('steps forward and back with null at the ends', () => {
    expect(nextStage('post-contract')).toBe('kickoff')
    expect(nextStage('building')).toBeNull()
    expect(prevStage('post-contract')).toBeNull()
    expect(prevStage('building')).toBe('website-specifics')
  })
  it('every lineup key is a registered SectionKey and lists are disjoint', () => {
    for (const stage of VIEWBOOK_STAGES) {
      const { primary, carried } = STAGE_LINEUPS[stage]
      for (const k of [...primary, ...carried]) {
        expect(SECTION_KEYS).toContain(k)
      }
      expect(primary.filter((k) => carried.includes(k))).toEqual([])
    }
  })
  it('lineups contain only keys with shipped renderers (PR4 deliberately unpins kickoff-next; PR6 adds ws-intro)', () => {
    const shipped = [
      'welcome', 'milestones', 'data-source', 'brand', 'assessment', 'strategy', 'materials',
      'kickoff-next', 'ws-intro',
    ]
    for (const stage of VIEWBOOK_STAGES) {
      const { primary, carried } = STAGE_LINEUPS[stage]
      for (const k of [...primary, ...carried]) expect(shipped).toContain(k)
    }
  })
  it('kickoff renders kickoff-next last in the primary lineup', () => {
    expect(STAGE_LINEUPS.kickoff.primary).toEqual(['welcome', 'milestones', 'strategy', 'kickoff-next'])
  })
  it('website-specifics renders ws-intro first in the primary lineup (PR6)', () => {
    expect(STAGE_LINEUPS['website-specifics'].primary).toEqual(['ws-intro', 'brand', 'assessment'])
  })
  it('building primary preserves the v1 order', () => {
    expect(STAGE_LINEUPS.building.primary).toEqual([
      'welcome', 'milestones', 'data-source', 'brand', 'assessment', 'strategy', 'materials',
    ])
  })
})
