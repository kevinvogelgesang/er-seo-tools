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

  it('adds school-phone and school-website additively at the end of the school category (PR5)', () => {
    const school = CATALOG.filter((e) => e.category === 'school')
    expect(school.map((e) => e.defKey)).toEqual([
      'school-name',
      'school-contact-name',
      'school-contact-email',
      'school-services',
      'school-ad-name',
      'school-phone',
      'school-website',
    ])
    expect(school.find((e) => e.defKey === 'school-phone')).toMatchObject({
      category: 'school',
      label: 'Main phone number',
      fieldType: 'text',
    })
    expect(school.find((e) => e.defKey === 'school-website')).toMatchObject({
      category: 'school',
      label: 'Website URL',
      fieldType: 'text',
    })
  })

  it('byte-pins the five original school defKeys (additive-only contract)', () => {
    const original = ['school-name', 'school-contact-name', 'school-contact-email', 'school-services', 'school-ad-name']
    const pinned = CATALOG.filter((e) => original.includes(e.defKey))
    expect(pinned).toEqual([
      { defKey: 'school-name', category: 'school', label: 'School name', fieldType: 'text', sortOrder: 1 },
      { defKey: 'school-contact-name', category: 'school', label: 'Primary contact name', fieldType: 'text', sortOrder: 2 },
      { defKey: 'school-contact-email', category: 'school', label: 'Primary contact email', fieldType: 'text', sortOrder: 3 },
      { defKey: 'school-services', category: 'school', label: 'Services in your subscription', fieldType: 'list', sortOrder: 4 },
      { defKey: 'school-ad-name', category: 'school', label: 'How do you refer to your school in advertising? Any abbreviations?', fieldType: 'textarea', sortOrder: 5 },
    ])
  })

  it('seeds 7 default milestones in order', () => {
    expect(DEFAULT_MILESTONES).toHaveLength(7)
    expect(DEFAULT_MILESTONES.map((m) => m.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(DEFAULT_MILESTONES[0].title).toBe('Kickoff')
  })
})
