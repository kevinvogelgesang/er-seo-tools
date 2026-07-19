// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type {
  OperatorFieldData,
  OperatorMilestoneData,
  OperatorSectionData,
} from '@/lib/viewbook/operator-data'
import type { ReactNode } from 'react'
import type { SectionKey } from '@/lib/viewbook/theme'
import { hasActiveEditorActivity, requestRefresh, useEditorActivity } from '../useViewbookSync'
import { __resetThemeDraftStore } from './theme-store'
import { SelectionProvider } from './inspector/SelectionContext'
import { SectionActivityProvider, useSectionActivityContext } from './inspector/useSectionActivity'
import {
  DataSourceInlineEditor,
  DocsInlineEditor,
  MilestoneQuickEditor,
  SectionTextInlineEditor,
  ThemeInlineEditor,
  WelcomeNoteInlineEditor,
} from './InlineEditors'

vi.mock('../useViewbookSync', async () => {
  const actual = await vi.importActual<typeof import('../useViewbookSync')>('../useViewbookSync')
  return {
    ...actual,
    requestRefresh: vi.fn(),
    useEditorActivity: vi.fn(actual.useEditorActivity),
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.mocked(requestRefresh).mockClear()
  vi.mocked(useEditorActivity).mockClear()
  __resetThemeDraftStore()
  document.querySelectorAll('[data-vb-theme-root], [data-vb-theme-font]').forEach((node) => node.remove())
  vi.useRealTimers()
})

async function advanceAutosave(ms = 600) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

function ok(body: unknown = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function expectActive(prefix: string) {
  expect(vi.mocked(useEditorActivity).mock.calls.some(([id, active]) => id.startsWith(prefix) && active)).toBe(true)
}

function expectDarkModeTokens(container: HTMLElement) {
  expect(container.innerHTML.includes('dark' + ':')).toBe(true)
}

function openPanel(name: string | RegExp) {
  const matcher = typeof name === 'string'
    ? new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    : name
  const trigger = screen.getByRole('button', { name: matcher })
  if (trigger.getAttribute('aria-expanded') === 'false') fireEvent.click(trigger)
  return trigger
}

const section: OperatorSectionData = {
  sectionKey: 'brand',
  state: 'active',
  collapsedShared: false,
  doneAt: null,
  acknowledgedAt: null,
  introNote: 'Old intro',
  narrative: 'Old narrative',
}

const milestone: OperatorMilestoneData = {
  id: 4,
  title: 'Old milestone',
  blurb: null,
  description: null,
  sortOrder: 1,
  status: 'upcoming',
  targetDate: null,
  doneAt: null,
}

const field: OperatorFieldData = {
  id: 7,
  defKey: null,
  category: 'school',
  label: 'School motto',
  fieldType: 'text',
  sortOrder: 1,
  value: 'Old answer',
  version: 2,
  valueUpdatedBy: null,
  valueUpdatedAt: null,
  archivedAt: null,
  createdAt: '2026-07-16T00:00:00.000Z',
  amendments: [],
}

describe('operator inline editors', () => {
  it('autosaves the welcome note after the trailing debounce with no save button', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<WelcomeNoteInlineEditor viewbookId={12} welcomeNote="Old note" />)
    fireEvent.change(screen.getByLabelText('Welcome note'), { target: { value: 'New note' } })
    expect(hasActiveEditorActivity()).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save welcome note' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    await advanceAutosave()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/viewbooks/12')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ welcomeNote: 'New note' })
    expectDarkModeTokens(container)
  })

  it('autosaves section intro/narrative together with no save button', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<SectionTextInlineEditor viewbookId={12} section={section} />)
    fireEvent.change(screen.getByLabelText('Intro for brand'), { target: { value: 'New intro' } })
    fireEvent.change(screen.getByLabelText('Narrative for brand'), { target: { value: 'New narrative' } })
    expect(hasActiveEditorActivity()).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save brand copy' })).toBeNull()
    await advanceAutosave()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/viewbooks/12/sections/brand')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      introNote: 'New intro',
      narrative: 'New narrative',
    })
    expectDarkModeTokens(container)
  })

  it('autosaves milestone values through one PATCH with no save button', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(ok({ milestone }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<MilestoneQuickEditor viewbookId={12} milestones={[milestone]} />)
    fireEvent.change(screen.getByLabelText('Milestone title'), { target: { value: 'Launch' } })
    fireEvent.change(screen.getByLabelText('Milestone status'), { target: { value: 'current' } })
    fireEvent.change(screen.getByLabelText('Milestone target date'), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText('Milestone description'), { target: { value: 'New description' } })
    expect(hasActiveEditorActivity()).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save milestone' })).toBeNull()
    await advanceAutosave()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/viewbooks/12/milestones/4')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      title: 'Launch', status: 'current', targetDate: '2026-08-01', description: 'New description',
    })
    expectDarkModeTokens(container)
  })

  it('autosaves the theme through the existing PATCH with no save button', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(ok({ theme: { ...DEFAULT_THEME, primary: '#abcdef' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<ThemeInlineEditor viewbookId={12} theme={DEFAULT_THEME} />)
    fireEvent.change(screen.getByLabelText('primary color'), { target: { value: '#abcdef' } })
    expect(hasActiveEditorActivity()).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save theme' })).toBeNull()
    await advanceAutosave()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/viewbooks/12')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).theme.primary).toBe('#abcdef')
    expectDarkModeTokens(container)
  })

  it('searches the manifest-backed font choices while preserving key values', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<ThemeInlineEditor viewbookId={12} theme={DEFAULT_THEME} />)

    const headingSelect = screen.getByLabelText('Heading font') as HTMLSelectElement
    expect(headingSelect.querySelector('option[value="roboto"]')).not.toBeNull()
    fireEvent.change(screen.getByLabelText('Search heading fonts'), { target: { value: 'serif display' } })

    expect(headingSelect.querySelector('option[value="dm-serif-display"]')?.textContent).toBe('DM Serif Display')
    expect(headingSelect.querySelector('option[value="roboto"]')).toBeNull()
  })

  it('groups theme controls and uses a mounted disclosure for section hero assets', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<ThemeInlineEditor viewbookId={12} theme={DEFAULT_THEME} />)

    openPanel('Viewbook theme')
    expect(screen.getByRole('heading', { name: 'Colors' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Typography' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Assets' })).toBeTruthy()
    const heroTrigger = screen.getByRole('button', { name: /Section hero images/ })
    expect(heroTrigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByLabelText('Hero image for Brand Guidelines')).toBeTruthy()
    expect(document.querySelector('details')).toBeNull()
  })

  it('mounts the live writer and previews theme changes on the agreed fixture markers', () => {
    vi.stubGlobal('fetch', vi.fn())
    const root = document.createElement('div')
    root.setAttribute('data-vb-theme-root', '')
    document.body.append(root)
    const link = document.createElement('link')
    link.setAttribute('data-vb-theme-font', '')
    document.head.append(link)

    render(<ThemeInlineEditor viewbookId={12} theme={DEFAULT_THEME} />)
    fireEvent.change(screen.getByLabelText('primary color'), { target: { value: '#ffffff' } })
    fireEvent.change(screen.getByLabelText('Heading font'), { target: { value: 'roboto' } })

    expect(root.style.getPropertyValue('--vb-primary')).toBe('#ffffff')
    expect(root.style.getPropertyValue('--vb-on-primary')).toBe('#111111')
    expect(link.getAttribute('href')).toContain('family=Roboto:wght@100;300;400;500;700;900')
  })

  it('keeps the last committed theme when the editor remounts with a stale server prop', async () => {
    vi.useFakeTimers()
    const committed = { ...DEFAULT_THEME, primary: '#123456' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ theme: committed })))
    const root = document.createElement('div')
    root.setAttribute('data-vb-theme-root', '')
    document.body.append(root)

    const firstMount = render(<ThemeInlineEditor viewbookId={12} theme={DEFAULT_THEME} />)
    fireEvent.change(screen.getByLabelText('primary color'), { target: { value: committed.primary } })
    await advanceAutosave()
    firstMount.unmount()

    render(<ThemeInlineEditor viewbookId={12} theme={DEFAULT_THEME} />)

    expect((screen.getByLabelText('primary color') as HTMLInputElement).value).toBe(committed.primary)
    expect(root.style.getPropertyValue('--vb-primary')).toBe(committed.primary)
  })

  it('adapts strategy-doc management and uploads through the existing docs route', async () => {
    const doc = { id: 3, title: 'New guide', blurb: null, filename: 'guide.pdf', sortOrder: 1 }
    const fetchMock = vi.fn().mockResolvedValue(ok({ doc }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<DocsInlineEditor viewbookId={12} docs={{ global: [], own: [] }} />)
    openPanel('Strategy PDFs')
    fireEvent.change(screen.getByLabelText('PDF title'), { target: { value: 'New guide' } })
    fireEvent.change(screen.getByLabelText('PDF file'), {
      target: { files: [new File(['%PDF-test'], 'guide.pdf', { type: 'application/pdf' })] },
    })
    expectActive('operator-docs')
    fireEvent.click(screen.getByRole('button', { name: 'Upload PDF' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/viewbooks/12/docs')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(FormData)
    expectDarkModeTokens(container)
  })

  it('separates global playbooks from viewbook-specific strategy PDFs', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<DocsInlineEditor
      viewbookId={12}
      docs={{
        global: [{ id: 1, title: 'Global guide', blurb: 'Shared reference', filename: 'global.pdf', sortOrder: 1 }],
        own: [{ id: 2, title: 'Client guide', blurb: 'Client reference', filename: 'client.pdf', sortOrder: 1 }],
      }}
    />)

    openPanel('Strategy PDFs')
    expect(screen.getByRole('heading', { name: 'Global playbooks' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'This viewbook' })).toBeTruthy()
    expect(screen.getByText('Managed globally')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete Client guide' })).toBeTruthy()
  })

  it('keeps add-field explicit but autosaves an unlocked answer', async () => {
    const created = { ...field, id: 8, label: 'New question', value: null, version: 0 }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ field: created }, 201))
      .mockResolvedValueOnce(ok({ field: { ...field, value: 'New answer', version: 3 } }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(
      <DataSourceInlineEditor viewbookId={12} fields={[field]} dataLockedAt={null} />,
    )
    openPanel('Data Source')
    openPanel('Add custom field')
    fireEvent.change(screen.getByLabelText('Custom field label'), { target: { value: 'New question' } })
    expectActive('operator-new-field')
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/viewbooks/12/fields')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ label: 'New question' })

    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('Answer for School motto'), { target: { value: 'New answer' } })
    expect(hasActiveEditorActivity()).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save answer for School motto' })).toBeNull()
    await advanceAutosave()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/viewbooks/12/fields/7')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ value: 'New answer', expectedVersion: 2 })
    expectDarkModeTokens(container)
  })

  it('shows open data context and field metadata before the secondary custom-field form', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<DataSourceInlineEditor viewbookId={12} fields={[field]} dataLockedAt={null} />)

    openPanel('Data Source')
    expect(screen.getByText('Open for direct editing')).toBeTruthy()
    expect(screen.getByText('School motto')).toBeTruthy()
    expect(screen.getAllByText('Text').length).toBeGreaterThan(0)
    expect(screen.getAllByText('School').length).toBeGreaterThan(0)
    expect(screen.getByText('Version 2')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Add custom field/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('retains the local answer and pauses after stale_version until an explicit retry uses the adopted version', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ error: 'stale_version', current: { value: 'Server answer', version: 5 } }, 409))
      .mockResolvedValueOnce(ok({ field: { ...field, value: 'Newer answer', version: 6 } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<DataSourceInlineEditor viewbookId={12} fields={[field]} dataLockedAt={null} />)
    openPanel('Data Source')

    fireEvent.change(screen.getByLabelText('Answer for School motto'), { target: { value: 'My answer' } })
    await advanceAutosave()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ value: 'My answer', expectedVersion: 2 })

    expect(screen.getByText('Your draft was kept')).toBeTruthy()
    expect(screen.getByText('A newer answer exists. Retry to save against the latest version.')).toBeTruthy()
    expect((screen.getByLabelText('Answer for School motto') as HTMLInputElement).value).toBe('My answer')
    await advanceAutosave(5000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Retry my answer for School motto' }))
    await advanceAutosave(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ value: 'My answer', expectedVersion: 5 })
  })

  it('keeps locked-baseline amendments explicit and never debounces them', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('crypto', { randomUUID: () => 'mutation-1' })
    const amendment = { id: 9, proposedValue: 'Proposal', status: 'pending' }
    const fetchMock = vi.fn().mockResolvedValue(ok({ amendment }))
    vi.stubGlobal('fetch', fetchMock)
    render(<DataSourceInlineEditor viewbookId={12} fields={[field]} dataLockedAt="2026-07-17T00:00:00.000Z" />)
    openPanel('Data Source')

    fireEvent.change(screen.getByLabelText('Answer for School motto'), { target: { value: 'Proposal' } })
    await advanceAutosave(5000)
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save answer for School motto' }))
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      mode: 'amend', value: 'Proposal', clientMutationId: 'mutation-1',
    })
  })

  it('defaults disclosures collapsed while keeping editor children mounted', () => {
    render(<WelcomeNoteInlineEditor viewbookId={12} welcomeNote="Old note" />)
    const trigger = screen.getByRole('button', { name: /Welcome note/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('region', { hidden: true }).hasAttribute('hidden')).toBe(true)
    expect(screen.getByLabelText('Welcome note')).toBeTruthy()
    expect(document.querySelector('details[data-operator-inline-editor]')).toBeNull()
  })

  it('keeps a dirty panel open when the operator tries to collapse it', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    render(<WelcomeNoteInlineEditor viewbookId={12} welcomeNote="Old note" />)

    const trigger = screen.getByRole('button', { name: /Welcome note/ })
    fireEvent.change(screen.getByLabelText('Welcome note'), { target: { value: 'Unsaved note' } })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Unsaved')).toBeTruthy()

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('uses readable section titles and human-readable milestone status labels', () => {
    vi.stubGlobal('fetch', vi.fn())
    const sectionRender = render(<SectionTextInlineEditor viewbookId={12} section={section} />)
    expect(screen.getByRole('button', { name: /Brand Guidelines copy/ })).toBeTruthy()
    sectionRender.unmount()

    const secondMilestone = { ...milestone, id: 5, title: 'Second milestone', sortOrder: 2 }
    render(<MilestoneQuickEditor viewbookId={12} milestones={[milestone, secondMilestone]} />)
    openPanel('Process & Milestones')
    expect(screen.getAllByText('Upcoming').length).toBeGreaterThan(0)
    const firstGroup = screen.getByRole('group', { name: 'Old milestone' })
    const secondGroup = screen.getByRole('group', { name: 'Second milestone' })
    expect(within(firstGroup).getByLabelText('Milestone title')).toBeTruthy()
    expect(within(secondGroup).getByLabelText('Milestone title')).toBeTruthy()
    const status = within(firstGroup).getByLabelText('Milestone status') as HTMLSelectElement
    expect(status.querySelector('option[value="upcoming"]')?.textContent).toBe('Upcoming')
    expect(status.querySelector('option[value="current"]')?.textContent).toBe('Current')
    expect(status.querySelector('option[value="done"]')?.textContent).toBe('Done')
  })
})

// ---------------------------------------------------------------------------
// PR3 Steps 1–2: each controller reports its own {dirty,busy,conflict,focused}
// to the per-section activity registry (additive to, and independent of, the
// existing useEditorActivity/useAutosave sync registry — C4). The two
// aggregators roll up their child rows AND must release a dirty/paused child's
// entry on unmount (Codex fix #8 — else a permanent hard pin).
// ---------------------------------------------------------------------------

function Providers({ children }: { children: ReactNode }) {
  return <SelectionProvider><SectionActivityProvider>{children}</SectionActivityProvider></SelectionProvider>
}

function AggReadout({ sectionKey }: { sectionKey: SectionKey }) {
  const reg = useSectionActivityContext()
  const a = reg.aggregateFor(sectionKey)
  return <span data-testid="agg">{[a.dirty, a.busy, a.conflict, a.focused].map(String).join(',')}</span>
}

function agg(): { dirty: boolean; busy: boolean; conflict: boolean; focused: boolean } {
  const [dirty, busy, conflict, focused] = screen.getByTestId('agg').textContent!.split(',').map((v) => v === 'true')
  return { dirty, busy, conflict, focused }
}

describe('operator inline editors — section-activity reporting', () => {
  it('welcome editor reports focus and dirty (and reaches idle) under the welcome key', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<Providers><WelcomeNoteInlineEditor viewbookId={12} welcomeNote="Old note" /><AggReadout sectionKey="welcome" /></Providers>)
    expect(agg()).toEqual({ dirty: false, busy: false, conflict: false, focused: false })
    const textarea = screen.getByLabelText('Welcome note')
    act(() => { textarea.focus() })
    expect(agg().focused).toBe(true)
    fireEvent.change(textarea, { target: { value: 'Changed note' } })
    expect(agg().dirty).toBe(true)
    act(() => { textarea.blur() })
    expect(agg().focused).toBe(false)
  })

  it('section-copy editor reports under its own section key', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<Providers><SectionTextInlineEditor viewbookId={12} section={section} /><AggReadout sectionKey="brand" /></Providers>)
    const intro = screen.getByLabelText('Intro for brand')
    act(() => { intro.focus() })
    expect(agg().focused).toBe(true)
    fireEvent.change(intro, { target: { value: 'New intro' } })
    expect(agg().dirty).toBe(true)
  })

  it('theme editor reports under the brand section', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<Providers><ThemeInlineEditor viewbookId={12} theme={DEFAULT_THEME} /><AggReadout sectionKey="brand" /></Providers>)
    const color = screen.getByLabelText('primary color')
    act(() => { color.focus() })
    expect(agg().focused).toBe(true)
    fireEvent.change(color, { target: { value: '#abcdef' } })
    expect(agg().dirty).toBe(true)
  })

  it('docs editor reports under the strategy section', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<Providers><DocsInlineEditor viewbookId={12} docs={{ global: [], own: [] }} /><AggReadout sectionKey="strategy" /></Providers>)
    openPanel('Strategy PDFs')
    const title = screen.getByLabelText('PDF title')
    act(() => { title.focus() })
    expect(agg().focused).toBe(true)
    fireEvent.change(title, { target: { value: 'New guide' } })
    expect(agg().dirty).toBe(true)
  })

  it('milestone aggregator rolls up a dirty child AND releases it when the child unmounts', () => {
    vi.stubGlobal('fetch', vi.fn())
    function Harness({ withRow }: { withRow: boolean }) {
      return (
        <Providers>
          <MilestoneQuickEditor viewbookId={12} milestones={withRow ? [milestone] : []} />
          <AggReadout sectionKey="milestones" />
        </Providers>
      )
    }
    const { rerender } = render(<Harness withRow={true} />)
    openPanel('Process & Milestones')
    fireEvent.change(screen.getByLabelText('Milestone title'), { target: { value: 'Changed milestone' } })
    expect(agg().dirty).toBe(true)
    // A refresh drops the dirty row: its aggregate entry MUST be removed on
    // unmount, or the milestones section stays dirty forever → permanent pin.
    act(() => { rerender(<Harness withRow={false} />) })
    expect(agg().dirty).toBe(false)
  })

  it('data-source aggregator surfaces a field pause as section conflict until an explicit retry clears it', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ error: 'stale_version', current: { value: 'Server answer', version: 5 } }, 409))
      .mockResolvedValueOnce(ok({ field: { ...field, value: 'My answer', version: 6 } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<Providers><DataSourceInlineEditor viewbookId={12} fields={[field]} dataLockedAt={null} /><AggReadout sectionKey="data-source" /></Providers>)
    openPanel('Data Source')

    fireEvent.change(screen.getByLabelText('Answer for School motto'), { target: { value: 'My answer' } })
    await advanceAutosave()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(agg().conflict).toBe(true)

    // The pause holds the conflict — a quiet interval must NOT clear it.
    await advanceAutosave(5000)
    expect(agg().conflict).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Retry my answer for School motto' }))
    await advanceAutosave(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(agg().conflict).toBe(false)
  })
})
