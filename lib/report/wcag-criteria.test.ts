// lib/report/wcag-criteria.test.ts
import { describe, it, expect } from 'vitest'
import { WCAG_CRITERIA, criterionFromTag, criterionById, criteriaForLevel } from './wcag-criteria'

describe('criterionFromTag', () => {
  it('maps 3-digit tags', () => {
    expect(criterionFromTag('wcag111')).toBe('1.1.1')
  })

  it('maps 4-digit tags (double-digit criterion)', () => {
    expect(criterionFromTag('wcag1412')).toBe('1.4.12')
    expect(criterionFromTag('wcag2410')).toBe('2.4.10')
  })

  it('returns null for level/meta/category tags', () => {
    expect(criterionFromTag('wcag2a')).toBeNull()
    expect(criterionFromTag('wcag21aa')).toBeNull()
    expect(criterionFromTag('wcag22aa')).toBeNull()
    expect(criterionFromTag('best-practice')).toBeNull()
    expect(criterionFromTag('cat.color')).toBeNull()
  })

  it('maps AAA tags to a criterion id that is absent from the table', () => {
    expect(criterionFromTag('wcag146')).toBe('1.4.6') // 1.4.6 is AAA
    expect(criterionById('1.4.6')).toBeUndefined()
  })
})

describe('WCAG_CRITERIA table', () => {
  it('contains expected A/AA entries with versions', () => {
    expect(criterionById('1.1.1')).toEqual({ id: '1.1.1', name: 'Non-text Content', level: 'A', version: '2.0' })
    expect(criterionById('1.4.12')).toEqual({ id: '1.4.12', name: 'Text Spacing', level: 'AA', version: '2.1' })
    expect(criterionById('2.5.8')).toEqual({ id: '2.5.8', name: 'Target Size (Minimum)', level: 'AA', version: '2.2' })
  })

  it('contains only A and AA levels', () => {
    expect(WCAG_CRITERIA.every((c) => c.level === 'A' || c.level === 'AA')).toBe(true)
  })
})

describe('criteriaForLevel', () => {
  it('excludes 2.2 entries for wcag21aa', () => {
    const ids = criteriaForLevel('wcag21aa').map((c) => c.id)
    expect(ids).not.toContain('2.5.8')
    expect(ids).not.toContain('2.4.11')
    expect(ids).toContain('1.4.12')
    expect(criteriaForLevel('wcag21aa').every((c) => c.version !== '2.2')).toBe(true)
  })

  it('includes 2.2 entries for wcag22aa', () => {
    const ids = criteriaForLevel('wcag22aa').map((c) => c.id)
    expect(ids).toContain('2.5.8')
    expect(ids).toContain('2.4.11')
    expect(criteriaForLevel('wcag22aa')).toHaveLength(WCAG_CRITERIA.length)
  })
})
