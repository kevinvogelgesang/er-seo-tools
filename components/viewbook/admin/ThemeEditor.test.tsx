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
  vi.unstubAllGlobals()
  vi.mocked(useEditorActivity).mockClear()
  __resetSyncRegistry()
})

function lastCallFor(id: string): boolean | undefined {
  const calls = vi.mocked(useEditorActivity).mock.calls
  return [...calls].reverse().find(([callId]) => callId === id)?.[1]
}

describe('ThemeEditor', () => {
  it('groups controls into cards beside a sticky bounded preview and replaces native details', () => {
    const { container } = render(<ThemeEditor viewbookId={1} theme={DEFAULT_THEME} onSaved={vi.fn()} />)

    const layout = screen.getByTestId('theme-editor-layout')
    expect(layout.className).toContain('lg:grid-cols-')
    expect(screen.getByRole('heading', { name: 'Colors' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Typography' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Logo' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Heading typography' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Body typography' })).toBeTruthy()

    const primaryControl = screen.getByLabelText('primary color').closest('[data-color-control]') as HTMLElement
    expect(within(primaryControl).getByText('#122033')).toBeTruthy()
    expect((screen.getByLabelText('primary color') as HTMLInputElement).className).toContain('h-12')

    const previewColumn = screen.getByTestId('theme-editor-preview-column')
    expect(previewColumn.className).toContain('lg:sticky')
    const heroTrigger = screen.getByRole('button', { name: /Hero assets/ })
    expect(heroTrigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByLabelText('Hero image for Brand Guidelines')).toBeTruthy()
    expect(container.querySelector('details')).toBeNull()
  })

  it('offers searchable manifest-backed font choices in the admin editor', () => {
    render(<ThemeEditor viewbookId={1} theme={DEFAULT_THEME} onSaved={vi.fn()} />)
    const bodySelect = screen.getByLabelText('Body font') as HTMLSelectElement
    expect(bodySelect.querySelector('option[value="roboto"]')).not.toBeNull()

    fireEvent.change(screen.getByLabelText('Search body fonts'), { target: { value: 'garamond' } })

    expect(bodySelect.querySelector('option[value="eb-garamond"]')?.textContent).toBe('EB Garamond')
    expect(bodySelect.querySelector('option[value="roboto"]')).toBeNull()
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

  it('reflects unsaved color and font drafts in the live preview', () => {
    render(<ThemeEditor viewbookId={1} theme={DEFAULT_THEME} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('primary color'), { target: { value: '#123456' } })
    fireEvent.change(screen.getByLabelText('Heading font'), { target: { value: 'playfair-display' } })

    const canvas = screen.getByTestId('theme-preview-canvas')
    expect(canvas.style.getPropertyValue('--vb-primary')).toBe('#123456')
    expect(canvas.style.getPropertyValue('--vb-heading-font')).toContain('Playfair Display')
  })
})
