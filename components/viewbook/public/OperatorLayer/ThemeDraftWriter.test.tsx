// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import { ThemeDraftWriter } from './ThemeDraftWriter'
import {
  __resetThemeDraftStore,
  commitThemeDraft,
  setThemeDraft,
} from './theme-store'

afterEach(() => {
  cleanup()
  __resetThemeDraftStore()
  document.body.innerHTML = ''
  document.head.querySelectorAll('[data-vb-theme-font]').forEach((node) => node.remove())
})

function fixture() {
  const root = document.createElement('div')
  root.setAttribute('data-vb-theme-root', '')
  document.body.append(root)
  const link = document.createElement('link')
  link.setAttribute('data-vb-theme-font', '')
  document.head.append(link)
  return { root, link }
}

describe('ThemeDraftWriter', () => {
  it('writes live canonical variables and the manifest-backed font href onto fixture markers', () => {
    const { root, link } = fixture()
    render(<ThemeDraftWriter viewbookId={12} theme={DEFAULT_THEME} />)

    act(() => {
      setThemeDraft(12, {
        primary: '#ffffff',
        headingFont: 'roboto',
        bodyFont: 'dm-serif-display',
      })
    })

    expect(root.style.getPropertyValue('--vb-primary')).toBe('#ffffff')
    expect(root.style.getPropertyValue('--vb-on-primary')).toBe('#111111')
    expect(root.style.getPropertyValue('--vb-heading-font')).toContain('Roboto')
    expect(link.getAttribute('href')).toContain('family=Roboto:wght@100;300;400;500;700;900')
  })

  it('restores the last committed theme on unmount, not the initial theme', () => {
    const { root } = fixture()
    const view = render(<ThemeDraftWriter viewbookId={12} theme={DEFAULT_THEME} />)
    const committed = { ...DEFAULT_THEME, primary: '#123456' }
    act(() => {
      commitThemeDraft(12, committed)
      setThemeDraft(12, { primary: '#ffffff' })
    })
    expect(root.style.getPropertyValue('--vb-primary')).toBe('#ffffff')

    view.unmount()
    expect(root.style.getPropertyValue('--vb-primary')).toBe('#123456')
  })
})
