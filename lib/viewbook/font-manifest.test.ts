import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FONT_MANIFEST, isAllowedFont } from './font-manifest'

const LEGACY_KEYS = [
  'inter',
  'lora',
  'playfair-display',
  'montserrat',
  'oswald',
  'merriweather',
  'source-sans-3',
  'work-sans',
  'libre-baskerville',
  'poppins',
  'archivo',
  'dm-serif-display',
] as const

describe('FONT_MANIFEST', () => {
  it('preserves every legacy stored key exactly and adds searchable choices', () => {
    for (const key of LEGACY_KEYS) expect(FONT_MANIFEST[key]).toBeDefined()
    expect(Object.keys(FONT_MANIFEST).length).toBeGreaterThan(LEGACY_KEYS.length)
  })

  it('contains valid code-owned metadata for every entry', () => {
    for (const [key, font] of Object.entries(FONT_MANIFEST)) {
      expect(key).toMatch(/^[a-z0-9-]+$/)
      expect(font.family.trim().length).toBeGreaterThan(0)
      expect(font.supportedWeights.length).toBeGreaterThan(0)
      expect(font.supportedWeights.every((weight) => /^\d{3}$/.test(weight))).toBe(true)
      expect(font.gfQuery).toMatch(/^family=[A-Za-z0-9+]+:wght@\d{3}(;\d{3})*$/)
    }
  })

  it('accepts manifest keys and rejects unlisted/injection strings', () => {
    expect(isAllowedFont('inter')).toBe(true)
    expect(isAllowedFont('roboto')).toBe(true)
    expect(isAllowedFont('family=Roboto&display=swap')).toBe(false)
    expect(isAllowedFont('Inter:wght@400;900')).toBe(false)
    expect(isAllowedFont('toString')).toBe(false)
  })

  it('stays below the public-bundle manifest budget', () => {
    const source = fs.readFileSync(path.join(__dirname, 'font-manifest.ts'))
    expect(source.byteLength).toBeLessThan(32 * 1024)
  })
})
