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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
})
