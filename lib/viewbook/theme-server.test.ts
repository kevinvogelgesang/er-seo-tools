import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, registerCatalogFontValidator, validateViewbookTheme } from './theme'
import {
  enableCatalogThemeValidation,
  resolveThemeFonts,
  validateViewbookThemeWide,
} from './theme-server'

describe('server-side full-catalog theme support', () => {
  it('accepts catalog-only keys while rejecting junk', () => {
    const catalogTheme = { ...DEFAULT_THEME, headingFont: 'abril-fatface' }
    expect(validateViewbookThemeWide(catalogTheme)).toEqual(catalogTheme)
    expect(validateViewbookThemeWide({ ...DEFAULT_THEME, headingFont: 'definitely-not-a-google-font' })).toBeNull()
  })

  it('permanently widens the existing service-facing validator', () => {
    enableCatalogThemeValidation()
    expect(validateViewbookTheme({ ...DEFAULT_THEME, headingFont: 'abril-fatface' })?.headingFont).toBe('abril-fatface')
    expect(() => registerCatalogFontValidator(() => false)).toThrow(/already registered/)
  })

  it('resolves a bounded public href and exact family names', () => {
    const resolved = resolveThemeFonts({
      ...DEFAULT_THEME,
      headingFont: 'abril-fatface',
      bodyFont: 'roboto',
    })
    expect(resolved.heading).toMatchObject({ key: 'abril-fatface', family: 'Abril Fatface' })
    expect(resolved.body).toMatchObject({ key: 'roboto', family: 'Roboto' })
    expect(resolved.href).toContain('family=Abril+Fatface:wght@400')
    expect(resolved.href).toContain('family=Roboto:wght@400;600;700;800')
  })
})
