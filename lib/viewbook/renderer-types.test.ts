import { describe, expect, it } from 'vitest'
import { RENDERER_TYPE_IDS, RENDERER_TYPES, isRendererTypeId } from './renderer-types'

describe('RENDERER_TYPE_IDS', () => {
  it('has exactly the 14 ids', () => {
    expect(RENDERER_TYPE_IDS).toEqual([
      'welcome', 'milestones', 'data-source', 'brand', 'assessment', 'strategy',
      'materials', 'pc-intro', 'pc-setup', 'pc-invite', 'pc-thanks',
      'kickoff-next', 'ws-intro', 'generic',
    ])
  })
})

describe('RENDERER_TYPES', () => {
  it('carries the pc-setup cta verbatim', () => {
    expect(RENDERER_TYPES['pc-setup'].cta).toEqual({
      label: 'Fill in org basics',
      sectionKey: 'pc-setup',
      anchor: '#pc-setup',
    })
  })

  it('has cta: null for every other id', () => {
    for (const id of RENDERER_TYPE_IDS) {
      if (id === 'pc-setup') continue
      expect(RENDERER_TYPES[id].cta).toBeNull()
    }
  })

  it('every entry carries its own id', () => {
    for (const id of RENDERER_TYPE_IDS) {
      expect(RENDERER_TYPES[id].id).toBe(id)
    }
  })
})

describe('isRendererTypeId', () => {
  it('true for a known id', () => {
    expect(isRendererTypeId('generic')).toBe(true)
  })

  it('false for an unknown value', () => {
    expect(isRendererTypeId('bogus')).toBe(false)
  })
})
