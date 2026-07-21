import { describe, it, expect } from 'vitest'
import { SECTION_COPY, INPUT_EXPECTING_KEYS } from './section-copy'
import { SECTION_KEYS } from './theme'

describe('section-copy', () => {
  it('has copy for every section key', () => {
    for (const k of SECTION_KEYS) {
      expect(SECTION_COPY[k], `missing copy for ${k}`).toBeDefined()
      expect(SECTION_COPY[k].purpose.length).toBeGreaterThan(0)
      expect(SECTION_COPY[k].whatThis.length).toBeGreaterThan(0)
    }
  })
  it('input-expecting keys are a subset of the catalog and each has whatWeNeed text', () => {
    for (const k of INPUT_EXPECTING_KEYS) {
      expect((SECTION_KEYS as readonly string[]).includes(k)).toBe(true)
      expect(SECTION_COPY[k].whatWeNeed, `${k} expects input but has no whatWeNeed`).toBeTruthy()
    }
  })
})
