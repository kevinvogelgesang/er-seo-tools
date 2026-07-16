// Client-safe theming primitives for the public viewbook. The Google Fonts
// href is built ONLY from FONT_CATALOG values (themes store catalog KEYS —
// client input never reaches the URL, spec §6). Colors were regex-validated
// by parseStoredTheme; they are applied as React inline-style CSS custom
// properties on the shell wrapper (no <style> injection surface at all).
import type { CSSProperties } from 'react'
import { DEFAULT_THEME, FONT_CATALOG, onThemeColorText, type ViewbookTheme } from '@/lib/viewbook/theme'

const FALLBACK = FONT_CATALOG[DEFAULT_THEME.headingFont]

export function fontsHref(theme: ViewbookTheme): string {
  const queries = [
    ...new Set(
      [theme.headingFont, theme.bodyFont].map((k) => (FONT_CATALOG[k] ?? FALLBACK).gfQuery),
    ),
  ]
  return `https://fonts.googleapis.com/css2?${queries.join('&')}&display=swap`
}

export function fontFamily(key: string): string {
  return `'${(FONT_CATALOG[key] ?? FALLBACK).family}', sans-serif`
}

// `--vb-*` is the CANONICAL variable namespace (Codex plan-fix 4): PR4's
// integration phase renames its leaves' `--viewbook-primary` references to
// `--vb-primary`; PR3/PR5 components use these names as-is.
export function themeCssVars(theme: ViewbookTheme): CSSProperties {
  return {
    '--vb-primary': theme.primary,
    '--vb-secondary': theme.secondary,
    '--vb-tertiary': theme.tertiary,
    '--vb-on-primary': onThemeColorText(theme.primary),
    '--vb-on-secondary': onThemeColorText(theme.secondary),
    '--vb-on-tertiary': onThemeColorText(theme.tertiary),
    '--vb-heading-font': fontFamily(theme.headingFont),
    '--vb-body-font': fontFamily(theme.bodyFont),
  } as CSSProperties
}

export function publicAssetUrl(token: string, filename: string): string {
  return `/api/viewbook/${encodeURIComponent(token)}/assets/${encodeURIComponent(filename)}`
}

export function ThemeStyle({ theme }: { theme: ViewbookTheme }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={fontsHref(theme)} />
    </>
  )
}
