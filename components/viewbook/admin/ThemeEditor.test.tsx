// @vitest-environment jsdom
//
// Final-review fix (P1): `draft` used to be seeded ONCE from the `theme`
// prop, so dirty was computed as `draft !== theme` directly. Once a
// background `load()` advanced `theme` (another admin session's edit, or
// THIS editor's own save landing), the stale draft differed from the NEW
// prop and `dirty` read true forever — permanently suppressing the shared
// refresher (registered under id 'admin-theme'). Covers the reconciliation
// (useBaselineSync) and the commit-on-save-success fix together.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DEFAULT_THEME, type ViewbookTheme } from '@/lib/viewbook/theme'
import { ThemeEditor } from './ThemeEditor'
import { __resetSyncRegistry, useEditorActivity } from '@/components/viewbook/public/useViewbookSync'

vi.mock('@/components/viewbook/public/useViewbookSync', async () => {
  const actual = await vi.importActual<typeof import('@/components/viewbook/public/useViewbookSync')>(
    '@/components/viewbook/public/useViewbookSync',
  )
  return { ...actual, useEditorActivity: vi.fn(actual.useEditorActivity) }
})

afterEach(() => {
  cleanup()
  document.head.querySelectorAll('[data-vb-admin-font-key]').forEach((node) => node.remove())
  vi.unstubAllGlobals()
  vi.mocked(useEditorActivity).mockClear()
  __resetSyncRegistry()
})

function lastCallFor(id: string): boolean | undefined {
  const calls = vi.mocked(useEditorActivity).mock.calls
  return [...calls].reverse().find(([callId]) => callId === id)?.[1]
}

describe('ThemeEditor', () => {
  it('stacks controls above a full-width bounded preview and replaces native details', () => {
    const { container } = render(<ThemeEditor viewbookId={1} theme={DEFAULT_THEME} onSaved={vi.fn()} />)

    const layout = screen.getByTestId('theme-editor-layout')
    expect(layout.className).toContain('space-y-')
    expect(layout.className).not.toContain('grid-cols-')
    expect(screen.getByRole('heading', { name: 'Colors' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Typography' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Logo' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Heading typography' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Body typography' })).toBeTruthy()

    // 2026-07-19 hex-first color entry: the hex echo is an EDITABLE text
    // field (HexColorInput) — type/paste an exact brand code; the native
    // swatch stays for visual picking.
    const primaryControl = screen.getByLabelText('primary color').closest('[data-color-control]') as HTMLElement
    expect((within(primaryControl).getByLabelText('primary hex code') as HTMLInputElement).value).toBe('#122033')
    expect((screen.getByLabelText('primary color') as HTMLInputElement).className).toContain('h-10')

    const previewBlock = screen.getByTestId('theme-editor-preview-block')
    expect(previewBlock.className).not.toContain('sticky')
    expect(layout.lastElementChild).toBe(previewBlock)
    const heroTrigger = screen.getByRole('button', { name: /Hero assets/ })
    expect(heroTrigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByLabelText('Hero image for Brand Guidelines')).toBeTruthy()
    expect(container.querySelector('details')).toBeNull()
  })

  it('loads the full catalog lazily and keyboard-selects a visible combobox result', async () => {
    render(<ThemeEditor viewbookId={1} theme={DEFAULT_THEME} onSaved={vi.fn()} />)
    const input = screen.getByRole('combobox', { name: 'Search heading fonts' })
    expect(input.getAttribute('aria-expanded')).toBe('false')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'abril fatface' } })
    const option = await screen.findByRole('option', { name: 'Abril Fatface' })
    expect(input.getAttribute('aria-controls')).toBeTruthy()
    expect(input.getAttribute('aria-autocomplete')).toBe('list')
    expect(option.getAttribute('aria-selected')).toBe('false')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBe(option.id)
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByText('Selected: Abril Fatface')).toBeTruthy()
    expect(screen.getByText('A confident viewbook heading').getAttribute('style')).toContain('Abril Fatface')
  })

  it('labels a catalog-only initial value, caps broad results, and dedupes its stylesheet', async () => {
    render(
      <ThemeEditor
        viewbookId={1}
        theme={{ ...DEFAULT_THEME, headingFont: 'abril-fatface' }}
        onSaved={vi.fn()}
      />,
    )
    expect(screen.getByText('Selected: Abril Fatface')).toBeTruthy()
    expect(screen.getByText('A confident viewbook heading').getAttribute('style')).toContain('Abril Fatface')

    const input = screen.getByRole('combobox', { name: 'Search heading fonts' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'sans' } })
    expect(await screen.findByText(/Showing 50 of \d+ fonts/)).toBeTruthy()
    fireEvent.change(input, { target: { value: 'abril fatface' } })
    const option = await screen.findByRole('option', { name: 'Abril Fatface' })
    fireEvent.mouseEnter(option)
    fireEvent.mouseEnter(option)
    expect(document.head.querySelectorAll('link[data-vb-admin-font-key="abril-fatface"]')).toHaveLength(1)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })

  it('adopts a newer theme prop from a background reload while idle (does not stay dirty forever)', () => {
    const { rerender } = render(<ThemeEditor viewbookId={1} theme={DEFAULT_THEME} onSaved={vi.fn()} />)
    expect(lastCallFor('admin-theme')).toBe(false) // idle at mount

    const advanced: ViewbookTheme = { ...DEFAULT_THEME, primary: '#ff0000' }
    rerender(<ThemeEditor viewbookId={1} theme={advanced} onSaved={vi.fn()} />)

    // Reconciled: the draft adopted the new prop, so dirty reads false again
    // instead of getting stuck true.
    expect(lastCallFor('admin-theme')).toBe(false)
    expect((screen.getByLabelText('primary color') as HTMLInputElement).value).toBe('#ff0000')
  })

  it('does not go stale-dirty after this editor SAVES its own change (commit-on-success)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ theme: { ...DEFAULT_THEME, primary: '#00ff00' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn()
    render(<ThemeEditor viewbookId={1} theme={DEFAULT_THEME} onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText('primary color'), { target: { value: '#00ff00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save theme' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())

    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: { ...DEFAULT_THEME, primary: '#00ff00' } }),
    })

    // Immediately after the save resolves — BEFORE any parent reload changes
    // the `theme` prop — the registry must already read idle.
    expect(lastCallFor('admin-theme')).toBe(false)
  })

  it('does not clobber a focused/dirty draft with a background reload', () => {
    const { rerender } = render(<ThemeEditor viewbookId={1} theme={DEFAULT_THEME} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('primary color'), { target: { value: '#123456' } })

    const advanced: ViewbookTheme = { ...DEFAULT_THEME, secondary: '#abcdef' }
    rerender(<ThemeEditor viewbookId={1} theme={advanced} onSaved={vi.fn()} />)

    expect((screen.getByLabelText('primary color') as HTMLInputElement).value).toBe('#123456') // undiverged edit survives
  })

  it('uploads logo and hero assets with the unchanged multipart fields', async () => {
    const logoTheme: ViewbookTheme = { ...DEFAULT_THEME, logo: 'logo.webp' }
    const heroTheme: ViewbookTheme = {
      ...logoTheme,
      sectionHeroes: { brand: 'brand.webp' },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ theme: logoTheme }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ theme: heroTheme }) })
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn()
    render(<ThemeEditor viewbookId={7} theme={DEFAULT_THEME} onSaved={onSaved} />)

    const logoFile = new File(['logo'], 'logo.webp', { type: 'image/webp' })
    fireEvent.change(screen.getByLabelText('Viewbook logo'), { target: { files: [logoFile] } })
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(logoTheme))
    const logoBody = fetchMock.mock.calls[0][1]?.body as FormData
    expect(fetchMock.mock.calls[0][0]).toBe('/api/viewbooks/7/assets')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
    expect(logoBody.get('kind')).toBe('logo')
    expect(logoBody.get('sectionKey')).toBeNull()
    expect(logoBody.get('file')).toBe(logoFile)

    const heroFile = new File(['hero'], 'brand.webp', { type: 'image/webp' })
    fireEvent.change(screen.getByLabelText('Hero image for Brand Guidelines'), { target: { files: [heroFile] } })
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(heroTheme))
    const heroBody = fetchMock.mock.calls[1][1]?.body as FormData
    expect(fetchMock.mock.calls[1][0]).toBe('/api/viewbooks/7/assets')
    expect(fetchMock.mock.calls[1][1]?.method).toBe('POST')
    expect(heroBody.get('kind')).toBe('hero')
    expect(heroBody.get('sectionKey')).toBe('brand')
    expect(heroBody.get('file')).toBe(heroFile)
  })

  it('reflects unsaved color and font drafts in the live preview', async () => {
    render(<ThemeEditor viewbookId={1} theme={DEFAULT_THEME} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('primary color'), { target: { value: '#123456' } })
    const headingSearch = screen.getByRole('combobox', { name: 'Search heading fonts' })
    fireEvent.focus(headingSearch)
    fireEvent.change(headingSearch, { target: { value: 'playfair display' } })
    fireEvent.click(await screen.findByRole('option', { name: 'Playfair Display' }))

    const canvas = screen.getByTestId('theme-preview-canvas')
    expect(canvas.style.getPropertyValue('--vb-primary')).toBe('#123456')
    expect(canvas.style.getPropertyValue('--vb-heading-font')).toContain('Playfair Display')
  })
})
