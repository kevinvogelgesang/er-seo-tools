// lib/ada-audit/axe-trim.test.ts
//
// C13: trimAxeResultsForStorage is .toString()-injected into the audited page
// (same contract as parse-seo-dom) — behavior tests plus the SWC-helper guard.
import { describe, it, expect } from 'vitest'
import { trimAxeResultsForStorage } from './axe-trim'

describe('trimAxeResultsForStorage', () => {
  it('replaces the passes array with a passCount scalar and drops inapplicable', () => {
    const r = trimAxeResultsForStorage({
      violations: [{ id: 'color-contrast' }],
      passes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      incomplete: [{ id: 'd', nodes: [] }],
      inapplicable: [{ id: 'e' }],
    })
    expect(r.passCount).toBe(3)
    expect(r).not.toHaveProperty('passes')
    expect(r).not.toHaveProperty('inapplicable')
    // incomplete is KEPT — it feeds the needs-review UI and the v2 penalty.
    expect(Array.isArray(r.incomplete)).toBe(true)
    expect((r.incomplete as unknown[]).length).toBe(1)
    expect(Array.isArray(r.violations)).toBe(true)
  })

  it('missing passes array yields passCount 0', () => {
    const r = trimAxeResultsForStorage({ violations: [] })
    expect(r.passCount).toBe(0)
    expect(r).not.toHaveProperty('passes')
  })

  it('injected source stays SWC-helper-free (no typeof / module refs)', () => {
    const src = trimAxeResultsForStorage.toString()
    // typeof compiles to a module-scope _type_of helper at es2017 — banned in
    // injected code (see parse-seo-dom.ts header + commit cc8d1c1).
    expect(src).not.toMatch(/\btypeof\b/)
    expect(src).not.toMatch(/_type_of|_object_spread|_define_property|_instanceof/)
  })
})
