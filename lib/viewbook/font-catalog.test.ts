import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FONT_MANIFEST } from './font-manifest'
import { isCatalogFont, resolveCatalogFont, searchCatalogFonts } from './font-catalog'

describe('full Google Fonts catalog', () => {
  it('is a key-compatible superset of the curated manifest', () => {
    for (const [key, manifestFont] of Object.entries(FONT_MANIFEST)) {
      const catalogFont = resolveCatalogFont(key)
      expect(catalogFont, key).not.toBeNull()
      expect(catalogFont?.family).toBe(manifestFont.family)
      expect(catalogFont?.supportedWeights).toEqual(expect.arrayContaining(manifestFont.supportedWeights))
    }
  })

  it('caps CSS2 queries at 400 plus three preferred supported weights', () => {
    expect(resolveCatalogFont('roboto')).toEqual({
      family: 'Roboto',
      supportedWeights: ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
      gfQuery: 'family=Roboto:wght@400;600;700;800',
    })
    expect(resolveCatalogFont('abril-fatface')?.gfQuery).toBe('family=Abril+Fatface:wght@400')
  })

  it('searches family names and slugs with a rendered-result limit', () => {
    const exact = searchCatalogFonts('abril fatface', 50)
    expect(exact.total).toBeGreaterThan(0)
    expect(exact.results[0]).toMatchObject({ key: 'abril-fatface', family: 'Abril Fatface' })

    const broad = searchCatalogFonts('sans', 5)
    expect(broad.results).toHaveLength(5)
    expect(broad.total).toBeGreaterThan(5)
  })

  it('uses exact own-key membership and stays below the snapshot budget', () => {
    expect(isCatalogFont('abril-fatface')).toBe(true)
    expect(isCatalogFont('toString')).toBe(false)
    expect(isCatalogFont('family=Roboto&display=swap')).toBe(false)
    expect(fs.statSync(path.join(__dirname, 'font-catalog.json')).size).toBeLessThan(200 * 1024)
  })
})
