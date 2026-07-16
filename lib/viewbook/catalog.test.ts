import { describe, it, expect } from 'vitest'
import { CATALOG, CATALOG_CATEGORIES } from './catalog'
import { DEFAULT_MILESTONES } from './milestones'

describe('viewbook catalog', () => {
  it('has unique defKeys and valid categories/types', () => {
    const keys = CATALOG.map((e) => e.defKey)
    expect(new Set(keys).size).toBe(keys.length)
    for (const e of CATALOG) {
      expect(CATALOG_CATEGORIES).toContain(e.category)
      expect(['text', 'textarea', 'list']).toContain(e.fieldType)
      expect(e.defKey).toMatch(/^[a-z0-9-]+$/)
      expect(e.label.length).toBeGreaterThan(0)
    }
  })

  it('covers every category and orders uniquely within category', () => {
    for (const cat of CATALOG_CATEGORIES) {
      const entries = CATALOG.filter((e) => e.category === cat)
      expect(entries.length).toBeGreaterThan(0)
      const orders = entries.map((e) => e.sortOrder)
      expect(new Set(orders).size).toBe(orders.length)
    }
  })

  it('seeds 7 default milestones in order', () => {
    expect(DEFAULT_MILESTONES).toHaveLength(7)
    expect(DEFAULT_MILESTONES.map((m) => m.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(DEFAULT_MILESTONES[0].title).toBe('Kickoff')
  })
})
