// Client-safe theming primitives for the public viewbook. The Google Fonts
// href is built ONLY from FONT_CATALOG values (themes store catalog KEYS —
// client input never reaches the URL, spec §6). Colors were regex-validated
// by parseStoredTheme; they are applied as React inline-style CSS custom
// properties on the shell wrapper (no <style> injection surface at all).
import type { CSSProperties } from 'react'
import { FONT_MANIFEST } from '@/lib/viewbook/font-manifest'
import { DEFAULT_THEME, onThemeColorText, type ViewbookTheme } from '@/lib/viewbook/theme'
import type { ResolvedThemeFont, ResolvedThemeFonts } from '@/lib/viewbook/resolved-theme-fonts'

const FALLBACK = FONT_MANIFEST[DEFAULT_THEME.headingFont as keyof typeof FONT_MANIFEST]

export function fontsHref(theme: ViewbookTheme, resolvedFonts?: ResolvedThemeFonts): string {
  if (resolvedFonts) {
    const resolvedQueries = [theme.headingFont === resolvedFonts.heading.key ? resolvedFonts.heading.gfQuery : null,
      theme.bodyFont === resolvedFonts.body.key ? resolvedFonts.body.gfQuery : null]
    const unresolvedKeys = [
      theme.headingFont === resolvedFonts.heading.key ? null : theme.headingFont,
      theme.bodyFont === resolvedFonts.body.key ? null : theme.bodyFont,
    ]
    const queries = [...new Set([
      ...resolvedQueries.filter((query): query is string => query !== null),
      ...unresolvedKeys.filter((key): key is string => key !== null)
        .map((key) => (FONT_MANIFEST[key as keyof typeof FONT_MANIFEST] ?? FALLBACK).gfQuery),
    ])]
    return `https://fonts.googleapis.com/css2?${queries.join('&')}&display=swap`
  }
  const queries = [
    ...new Set(
      [theme.headingFont, theme.bodyFont].map((k) => (FONT_MANIFEST[k as keyof typeof FONT_MANIFEST] ?? FALLBACK).gfQuery),
    ),
  ]
  return `https://fonts.googleapis.com/css2?${queries.join('&')}&display=swap`
}

export function fontFamily(key: string, resolved?: ResolvedThemeFont): string {
  const family = resolved?.key === key
    ? resolved.family
    : (FONT_MANIFEST[key as keyof typeof FONT_MANIFEST] ?? FALLBACK).family
  return `'${family}', sans-serif`
}

// `--vb-*` is the CANONICAL variable namespace (Codex plan-fix 4): PR4's
// integration phase renames its leaves' `--viewbook-primary` references to
// `--vb-primary`; PR3/PR5 components use these names as-is.
export function themeCssVars(theme: ViewbookTheme, resolvedFonts?: ResolvedThemeFonts): CSSProperties {
  return {
    '--vb-primary': theme.primary,
    '--vb-secondary': theme.secondary,
    '--vb-tertiary': theme.tertiary,
    '--vb-on-primary': onThemeColorText(theme.primary),
    '--vb-on-secondary': onThemeColorText(theme.secondary),
    '--vb-on-tertiary': onThemeColorText(theme.tertiary),
    '--vb-heading-font': fontFamily(theme.headingFont, resolvedFonts?.heading),
    '--vb-body-font': fontFamily(theme.bodyFont, resolvedFonts?.body),
  } as CSSProperties
}

export function publicAssetUrl(token: string, filename: string): string {
  return `/api/viewbook/${encodeURIComponent(token)}/assets/${encodeURIComponent(filename)}`
}

export function ThemeStyle({ theme, resolvedFonts }: { theme: ViewbookTheme; resolvedFonts?: ResolvedThemeFonts }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link data-vb-theme-font rel="stylesheet" href={fontsHref(theme, resolvedFonts)} />
    </>
  )
}
