// @vitest-environment jsdom
//
// Final-review fix (P1): `welcome`/section intro-narrative/override drafts
// used to be seeded ONCE from their props with dirty computed directly
// against the raw prop — a background `load()` advancing those props (e.g.
// this SAME tab's own save landing) left `dirty` stuck true forever,
// permanently suppressing the shared refresher. Covers reconciliation
// (useBaselineSync) and commit-on-save-success for the welcome note and one
// representative override row.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ContentTab } from './ContentTab'
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

// The "Welcome note" <label> isn't programmatically associated to its
// <textarea> (no htmlFor/id, no nesting), so getByLabelText can't resolve
// it — locate the textarea via the label's sibling instead, scoped to the
// label's own wrapper div (every SectionTextRow/OverrideRowEditor row also
// renders a plain textarea+"Save" button with overlapping text/roles).
function welcomeControls(): { textarea: HTMLTextAreaElement; save: HTMLElement } {
  const label = screen.getByText('Welcome note')
  const row = within(label.parentElement as HTMLElement)
  return { textarea: row.getByRole('textbox') as HTMLTextAreaElement, save: row.getByRole('button', { name: 'Save' }) }
}

describe('ContentTab welcome note', () => {
  it('adopts a newer welcomeNote prop from a background reload while idle', () => {
    const { rerender } = render(
      <ContentTab viewbookId={1} welcomeNote="Original note" sections={[]} overrides={[]} onChanged={vi.fn()} />,
    )
    expect(lastCallFor('admin-content-welcome')).toBe(false)

    rerender(<ContentTab viewbookId={1} welcomeNote="Updated elsewhere" sections={[]} overrides={[]} onChanged={vi.fn()} />)

    expect(lastCallFor('admin-content-welcome')).toBe(false) // reconciled, not stuck dirty
    expect(welcomeControls().textarea.value).toBe('Updated elsewhere')
  })

  it('does not go stale-dirty after this tab saves its own welcome-note change', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ContentTab viewbookId={1} welcomeNote="" sections={[]} overrides={[]} onChanged={vi.fn()} />)

    const { textarea, save } = welcomeControls()
    fireEvent.change(textarea, { target: { value: 'New note' } })
    fireEvent.click(save)
    // StrategyDocsCard (mounted alongside the welcome-note editor) also
    // calls the shared fetch mock on mount for its own doc list — scope
    // this wait to the welcome-note PATCH specifically rather than
    // asserting a single total call.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/1', expect.objectContaining({ method: 'PATCH' })),
    )

    expect(lastCallFor('admin-content-welcome')).toBe(false)
  })

  it('does not clobber a locally-diverged welcome-note draft with a background reload', () => {
    const { rerender } = render(
      <ContentTab viewbookId={1} welcomeNote="Original note" sections={[]} overrides={[]} onChanged={vi.fn()} />,
    )
    fireEvent.change(welcomeControls().textarea, { target: { value: 'My in-progress edit' } })

    rerender(<ContentTab viewbookId={1} welcomeNote="Updated elsewhere" sections={[]} overrides={[]} onChanged={vi.fn()} />)

    expect(welcomeControls().textarea.value).toBe('My in-progress edit')
  })
})

describe('ContentTab client-specific override row', () => {
  // Must be one of GLOBAL_CONTENT_KEYS (excluding 'team') — ContentTab renders
  // one row per catalog key regardless of what's in `overrides`.
  const overrideKey = 'process'

  it('does not go stale-dirty after saving an override (commit-on-success)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ContentTab viewbookId={1} welcomeNote="" sections={[]} overrides={[{ contentKey: overrideKey, body: '' }]} onChanged={vi.fn()} />)

    // Open this row's <details> directly (not exercising the click-to-open
    // UX — that's not what this test is about). All six override rows
    // share identical placeholder/button text, so every subsequent query is
    // scoped to THIS row via `within`.
    const details = screen.getByText(overrideKey).closest('details') as HTMLDetailsElement
    details.open = true
    const row = within(details)

    const textarea = row.getByPlaceholderText('Client-specific adjustments to the base plan (plain text)')
    fireEvent.change(textarea, { target: { value: 'Adjusted plan text' } })
    fireEvent.click(row.getByRole('button', { name: 'Save' }))
    // StrategyDocsCard (mounted alongside the override editor) also calls
    // the shared fetch mock on mount — scope this wait to the override PUT
    // specifically rather than asserting a single total call.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/viewbooks/1/overrides/${overrideKey}`,
        expect.objectContaining({ method: 'PUT' }),
      ),
    )

    expect(lastCallFor(`admin-content-override-${overrideKey}`)).toBe(false)
  })

  // Codex PR5 fix-wave finding 5: 'pc-intro' is BOTH a SECTION_KEYS member
  // (its own "Section intros & narratives" row, unconditionally rendered
  // above) AND a GLOBAL_CONTENT_KEYS member (its own GlobalContentEditor
  // field) — but PcIntroSection reads only `data.global.pcIntro`, so a
  // per-viewbook override row for it would be a dead control (saves
  // succeed, nothing renders differently). It must render exactly ONCE
  // (the section-intro row), never a second time as an override row.
  it('does not render pc-intro a second time as a per-viewbook override row', () => {
    render(<ContentTab viewbookId={1} welcomeNote="" sections={[]} overrides={[]} onChanged={vi.fn()} />)
    expect(screen.getAllByText('pc-intro')).toHaveLength(1)
  })
})
