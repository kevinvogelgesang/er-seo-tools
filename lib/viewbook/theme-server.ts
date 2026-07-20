import 'server-only'

import { isCatalogFont, resolveCatalogFont } from './font-catalog'
import type { ResolvedThemeFont, ResolvedThemeFonts } from './resolved-theme-fonts'
import {
  DEFAULT_THEME,
  parseStoredTheme,
  registerCatalogFontValidator,
  validateViewbookTheme,
  type ViewbookTheme,
} from './theme'

// Permanent process initialization. There is deliberately no unregister:
// toggling a shared validator per request would race concurrent requests.
export function enableCatalogThemeValidation(): void {
  registerCatalogFontValidator(isCatalogFont)
}

enableCatalogThemeValidation()

export function validateViewbookThemeWide(raw: unknown): ViewbookTheme | null {
  return validateViewbookTheme(raw, isCatalogFont)
}

export function parseStoredThemeWide(json: string): ViewbookTheme {
  return parseStoredTheme(json, isCatalogFont)
}

function resolvedFont(key: string): ResolvedThemeFont {
  const fallback = resolveCatalogFont(DEFAULT_THEME.headingFont)
  const font = resolveCatalogFont(key) ?? fallback
  if (!font) throw new Error('default_font_missing_from_catalog')
  return { key: resolveCatalogFont(key) ? key : DEFAULT_THEME.headingFont, family: font.family, gfQuery: font.gfQuery }
}

export function resolveThemeFonts(theme: ViewbookTheme): ResolvedThemeFonts {
  const heading = resolvedFont(theme.headingFont)
  const body = resolvedFont(theme.bodyFont)
  const queries = [...new Set([heading.gfQuery, body.gfQuery])]
  return {
    href: `https://fonts.googleapis.com/css2?${queries.join('&')}&display=swap`,
    heading,
    body,
  }
}
