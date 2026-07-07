// lib/widgets/registry.test.tsx
import { describe, it, expect } from 'vitest'
import { WIDGETS, DEFAULT_LAYOUT } from './registry'

describe('widget registry', () => {
  it('every widget has a valid shape and defaultSize ∈ sizes', () => {
    for (const w of WIDGETS) {
      expect(typeof w.id).toBe('string')
      expect(typeof w.title).toBe('string')
      expect(w.sizes.length).toBeGreaterThan(0)
      expect(w.sizes).toContain(w.defaultSize)
      expect(typeof w.Component).toBe('function')
    }
  })
  it('widget ids are unique', () => {
    const ids = WIDGETS.map((w) => w.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('every DEFAULT_LAYOUT item references a registered widget and a supported size', () => {
    for (const item of DEFAULT_LAYOUT) {
      const w = WIDGETS.find((x) => x.id === item.id)
      expect(w, `layout id ${item.id} must be registered`).toBeTruthy()
      expect(w!.sizes).toContain(item.size)
    }
  })
  it('does NOT register deferred aggregate widgets (PR 3.5)', () => {
    const ids = WIDGETS.map((w) => w.id)
    expect(ids).not.toContain('kpi-strip')
    expect(ids).not.toContain('needs-attention')
  })
})
