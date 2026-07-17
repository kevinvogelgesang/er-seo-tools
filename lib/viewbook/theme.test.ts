import { describe, it, expect } from 'vitest'
import {
  validateViewbookTheme,
  parseStoredTheme,
  onThemeColorText,
  themeByteLength,
  DEFAULT_THEME,
  FONT_CATALOG,
} from './theme'
import { relativeLuminance } from './contrast'

const good = {
  primary: '#122033',
  secondary: '#1D7F7F',
  tertiary: '#C99334',
  headingFont: 'inter',
  bodyFont: 'inter',
  logo: null,
  sectionHeroes: {},
}

describe('validateViewbookTheme', () => {
  it('accepts a complete valid theme', () => {
    expect(validateViewbookTheme(good)).toEqual(good)
  })

  it('rejects unknown keys, missing keys, bad hex, unknown fonts, bad hero keys/filenames', () => {
    expect(validateViewbookTheme({ ...good, extra: 1 })).toBeNull()
    const { logo: _logo, ...missing } = good
    expect(validateViewbookTheme(missing)).toBeNull()
    expect(validateViewbookTheme({ ...good, primary: 'red' })).toBeNull()
    expect(validateViewbookTheme({ ...good, primary: '#12203' })).toBeNull()
    expect(validateViewbookTheme({ ...good, headingFont: 'comic-sans' })).toBeNull()
    expect(validateViewbookTheme({ ...good, sectionHeroes: { nope: 'a.png' } })).toBeNull()
    expect(validateViewbookTheme({ ...good, sectionHeroes: { brand: '../x.png' } })).toBeNull()
    expect(validateViewbookTheme({ ...good, logo: 'x.svg' })).toBeNull()
    expect(validateViewbookTheme(null)).toBeNull()
  })

  it('rejects arrays, prototype font keys, and over-cap themes', () => {
    expect(validateViewbookTheme([])).toBeNull()
    expect(validateViewbookTheme({ ...good, sectionHeroes: [] })).toBeNull()
    expect(validateViewbookTheme({ ...good, headingFont: 'toString' })).toBeNull()
    // regex-legal (the filename regex has no length bound) but > 8192 bytes serialized:
    expect(validateViewbookTheme({ ...good, logo: 'a'.repeat(8300) + '.png' })).toBeNull()
  })

  it('measures the cap in UTF-8 bytes via TextEncoder', () => {
    expect(themeByteLength(good)).toBe(new TextEncoder().encode(JSON.stringify(good)).length)
  })

  it('parseStoredTheme degrades to DEFAULT_THEME, never throws', () => {
    expect(parseStoredTheme('not json')).toEqual(DEFAULT_THEME)
    expect(parseStoredTheme('{}')).toEqual(DEFAULT_THEME)
    expect(parseStoredTheme(JSON.stringify(good))).toEqual(good)
  })

  it('every catalog font has family + gfQuery', () => {
    expect(Object.keys(FONT_CATALOG).length).toBeGreaterThanOrEqual(12)
    for (const f of Object.values(FONT_CATALOG)) {
      expect(f.family.length).toBeGreaterThan(0)
      expect(f.gfQuery).toMatch(/^family=/)
    }
  })

  it('picks text color at the 0.179 luminance crossover', () => {
    expect(onThemeColorText('#808080')).toBe('#111111')
    expect(onThemeColorText('#5a5a5a')).toBe('#ffffff')
    expect(onThemeColorText('#122033')).toBe('#ffffff')
    expect(onThemeColorText('#f5f0e6')).toBe('#111111')
  })
})

describe('onThemeColorText (post-contrast.ts refactor)', () => {
  it('picks dark text on light bg, white text on dark bg', () => {
    expect(onThemeColorText('#ffffff')).toBe('#111111')
    expect(onThemeColorText('#000000')).toBe('#ffffff')
    expect(onThemeColorText('#122033')).toBe('#ffffff') // DEFAULT_THEME.primary
    expect(onThemeColorText('#c99334')).toBe('#111111') // DEFAULT_THEME.tertiary
  })
  it('crossover is at luminance 0.179 using the shared luminance fn', () => {
    // Deterministic boundary (Codex fix): #757575 ≈ 0.178 luminance → white text
    // (below crossover); #767676 ≈ 0.181 → dark text (above). These are exact
    // 8-bit greys straddling 0.179; no "adjust if flaky" — they are the gate.
    expect(onThemeColorText('#757575')).toBe('#ffffff')
    expect(onThemeColorText('#767676')).toBe('#111111')
    expect(relativeLuminance('#757575')).toBeLessThan(0.179)
    expect(relativeLuminance('#767676')).toBeGreaterThan(0.179)
  })
})
