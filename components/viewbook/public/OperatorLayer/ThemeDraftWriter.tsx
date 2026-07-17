'use client'

import { useEffect } from 'react'
import type { ViewbookTheme } from '@/lib/viewbook/theme'
import { fontsHref, themeCssVars } from '../ThemeStyle'
import {
  getCommittedTheme,
  initializeThemeDraft,
  restoreCommittedTheme,
  useThemeDraft,
} from './theme-store'

function writeTheme(theme: ViewbookTheme): void {
  const root = document.querySelector<HTMLElement>('[data-vb-theme-root]')
  if (root) {
    for (const [name, value] of Object.entries(themeCssVars(theme))) {
      root.style.setProperty(name, String(value))
    }
  }
  document.querySelector<HTMLLinkElement>('link[data-vb-theme-font]')?.setAttribute('href', fontsHref(theme))
}

export function ThemeDraftWriter({ viewbookId, theme }: { viewbookId: number; theme: ViewbookTheme }) {
  const draft = useThemeDraft(viewbookId, theme)

  useEffect(() => initializeThemeDraft(viewbookId, theme), [theme, viewbookId])
  useEffect(() => writeTheme(draft), [draft])
  useEffect(() => {
    return () => {
      restoreCommittedTheme(viewbookId)
      writeTheme(getCommittedTheme(viewbookId) ?? theme)
    }
    // Cleanup belongs to this viewbook mount; ordinary theme prop changes
    // must not restore the preview mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewbookId])

  return null
}
