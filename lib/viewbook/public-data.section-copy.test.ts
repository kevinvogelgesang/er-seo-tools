import { describe, it, expect } from 'vitest'
import { buildSectionCopyMap } from './public-data'
import { SECTION_COPY } from './section-copy'

describe('buildSectionCopyMap', () => {
  it('resolves every catalog key with override ← company-wide ← code default', () => {
    const global = { brand: { purpose: 'CW', whatThis: 'CWt', whatWeNeed: null } }
    const overrides = { brand: { purpose: 'OV', whatThis: 'OVt', whatWeNeed: 'need' } }
    const map = buildSectionCopyMap(global as any, overrides as any)
    expect(map.brand).toEqual({ purpose: 'OV', whatThis: 'OVt', whatWeNeed: 'need' })
    // a key with neither layer = code default
    expect(map.welcome.whatThis).toBe(SECTION_COPY.welcome.whatThis)
  })
})
