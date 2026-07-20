'use client'

import { useEffect } from 'react'
import type { ViewbookTheme } from '@/lib/viewbook/theme'
import type { ResolvedThemeFonts } from '@/lib/viewbook/resolved-theme-fonts'
import { fontsHref, themeCssVars } from '../ThemeStyle'
import {
  getCommittedTheme,
  initializeThemeDraft,
  restoreCommittedTheme,
  useThemeDraft,
} from './theme-store'

function writeTheme(theme: ViewbookTheme, resolvedFonts?: ResolvedThemeFonts): void {
  const root = document.querySelector<HTMLElement>('[data-vb-theme-root]')
  if (root) {
    for (const [name, value] of Object.entries(themeCssVars(theme, resolvedFonts))) {
      root.style.setProperty(name, String(value))
    }
  }
  document.querySelector<HTMLLinkElement>('link[data-vb-theme-font]')?.setAttribute('href', fontsHref(theme, resolvedFonts))
}

export function ThemeDraftWriter({
  viewbookId,
  theme,
  resolvedFonts,
}: {
  viewbookId: number
  theme: ViewbookTheme
  resolvedFonts?: ResolvedThemeFonts
}) {
  const draft = useThemeDraft(viewbookId, theme)

  useEffect(() => initializeThemeDraft(viewbookId, theme), [theme, viewbookId])
  useEffect(() => writeTheme(draft, resolvedFonts), [draft, resolvedFonts])
  useEffect(() => {
    return () => {
      restoreCommittedTheme(viewbookId)
      writeTheme(getCommittedTheme(viewbookId) ?? theme, resolvedFonts)
    }
    // Cleanup belongs to this viewbook mount; ordinary theme prop changes
    // must not restore the preview mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewbookId])

  return null
}
