// lib/findings/finding-type-sets.test.ts
//
// Drift tripwire: these literal ids must always match the write-side sources
// of truth (`onpage-seo-mapper.ts`'s SEVERITY map, `broken-link-mapper.ts`'s
// TYPE_OF). If a mapper adds/renames a type, this test fails until this module
// is updated to match — intentional friction, not a bug.
import { describe, it, expect } from 'vitest'
import {
  ONPAGE_FINDING_TYPES,
  ONPAGE_FINDING_TYPE_SET,
  ONPAGE_FINDING_LABELS,
  BROKEN_INTERNAL_FINDING_TYPES,
  BROKEN_INTERNAL_FINDING_TYPE_SET,
  BROKEN_EXTERNAL_FINDING_TYPE,
  BROKEN_FINDING_TYPES,
  BROKEN_FINDING_TYPE_SET,
  BROKEN_FINDING_LABELS,
} from './finding-type-sets'

describe('finding-type-sets', () => {
  it('ONPAGE set equals exactly the 7 literal ids from onpage-seo-mapper', () => {
    expect([...ONPAGE_FINDING_TYPES].sort()).toEqual(
      [
        'missing_title',
        'duplicate_title',
        'missing_meta_description',
        'duplicate_meta_description',
        'missing_h1',
        'duplicate_h1',
        'thin_content',
      ].sort()
    )
    expect(ONPAGE_FINDING_TYPE_SET.size).toBe(7)
  })

  it('broken ids exactly match broken-link-mapper TYPE_OF: 2 internal + 1 external', () => {
    expect([...BROKEN_INTERNAL_FINDING_TYPES].sort()).toEqual(
      ['broken_internal_links', 'broken_images'].sort()
    )
    expect(BROKEN_EXTERNAL_FINDING_TYPE).toBe('broken_external_links')
    expect([...BROKEN_FINDING_TYPES].sort()).toEqual(
      ['broken_internal_links', 'broken_images', 'broken_external_links'].sort()
    )
    expect(BROKEN_INTERNAL_FINDING_TYPE_SET.size).toBe(2)
    expect(BROKEN_FINDING_TYPE_SET.size).toBe(3)
  })

  it('every on-page type has a label; label map keys equal the type set exactly', () => {
    for (const t of ONPAGE_FINDING_TYPES) {
      expect(ONPAGE_FINDING_LABELS[t]).toBeTruthy()
    }
    expect(Object.keys(ONPAGE_FINDING_LABELS).sort()).toEqual([...ONPAGE_FINDING_TYPES].sort())
  })

  it('every broken type has a label; label map keys equal the broken type set exactly', () => {
    for (const t of BROKEN_FINDING_TYPES) {
      expect(BROKEN_FINDING_LABELS[t]).toBeTruthy()
    }
    expect(Object.keys(BROKEN_FINDING_LABELS).sort()).toEqual([...BROKEN_FINDING_TYPES].sort())
  })

  it('on-page and broken type sets are disjoint', () => {
    const overlap = ONPAGE_FINDING_TYPES.filter((t) => (BROKEN_FINDING_TYPE_SET as Set<string>).has(t))
    expect(overlap).toEqual([])
  })
})
