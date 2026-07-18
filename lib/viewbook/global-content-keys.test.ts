// Task 2: `process-milestones` is a new global-content key (global default +
// per-viewbook override, reusing the existing heading/body block system).
// This test pins the enumeration contract so a future edit can't silently
// drop the key from either list.
import { describe, expect, it } from 'vitest'
import { GLOBAL_CONTENT_KEYS, OVERRIDE_ELIGIBLE_KEYS } from './global-content-keys'

describe('GLOBAL_CONTENT_KEYS', () => {
  it('includes process-milestones', () => {
    expect(GLOBAL_CONTENT_KEYS).toContain('process-milestones')
  })
})

describe('OVERRIDE_ELIGIBLE_KEYS', () => {
  it('includes process-milestones (a plain heading/body block key, not team/pc-intro)', () => {
    expect(OVERRIDE_ELIGIBLE_KEYS).toContain('process-milestones')
  })

  it('still excludes team and pc-intro', () => {
    expect(OVERRIDE_ELIGIBLE_KEYS).not.toContain('team')
    expect(OVERRIDE_ELIGIBLE_KEYS).not.toContain('pc-intro')
  })

  it('is exactly GLOBAL_CONTENT_KEYS minus team and pc-intro', () => {
    const expected = GLOBAL_CONTENT_KEYS.filter((key) => key !== 'team' && key !== 'pc-intro')
    expect([...OVERRIDE_ELIGIBLE_KEYS].sort()).toEqual([...expected].sort())
  })
})
