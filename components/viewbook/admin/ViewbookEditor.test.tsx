// @vitest-environment jsdom
//
// Task 6: SettingsTab's stage-move buttons (Advance / Roll back) + the
// confirm-then-force path for advancing out of post-contract with an
// incomplete ack. Renders SettingsTab directly (DataSourceTab precedent —
// SettingsTabViewbook is a narrow Pick<ViewbookDetail, ...> so the test
// doesn't have to construct a full ViewbookDetail). DOM-native assertions,
// no jest-dom.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ViewbookEditor, SettingsTab, type SettingsTabViewbook } from './ViewbookEditor'
import { publicViewbookUrl } from './viewbook-admin-shared'
import { SECTION_COPY_FIXTURE } from '@/components/viewbook/public/test-support/section-copy-fixture'
import { __resetSyncRegistry } from '@/components/viewbook/public/useViewbookSync'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  __resetSyncRegistry()
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function mkVb(overrides: Partial<SettingsTabViewbook> = {}): SettingsTabViewbook {
  return {
    id: 7,
    kind: 'upgrade',
    notifyEmail: null,
    stage: 'kickoff',
    pcCompletedAt: '2026-07-01T00:00:00.000Z',
    csmName: null,
    sections: [],
    ...overrides,
  }
}

function stubFetch(handleStage?: (init: RequestInit | undefined) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/viewbook-content/team') return jsonResponse({ content: [] })
    if (url === '/api/viewbooks/7/stage' && init?.method === 'POST') {
      return handleStage ? handleStage(init) : jsonResponse({ stage: 'website-specifics' })
    }
    throw new Error(`unexpected fetch ${url} ${init?.method ?? 'GET'}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('SettingsTab stage-move buttons', () => {
  it('renders Advance and Roll back, disabling Roll back at the first stage and Advance at the last', async () => {
    stubFetch()
    const { rerender } = render(<SettingsTab vb={mkVb({ stage: 'post-contract' })} onChanged={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'Roll back' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Advance' }) as HTMLButtonElement).disabled).toBe(false)

    rerender(<SettingsTab vb={mkVb({ stage: 'building' })} onChanged={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'Advance' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Roll back' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('Roll back POSTs {direction: back, expectedStage}', async () => {
    const fetchMock = stubFetch((init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ direction: 'back', expectedStage: 'kickoff' })
      return jsonResponse({ stage: 'post-contract' })
    })
    const onChanged = vi.fn()
    render(<SettingsTab vb={mkVb({ stage: 'kickoff' })} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Roll back' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/7/stage', expect.objectContaining({ method: 'POST' }))
  })

  it('Advance from a non-post-contract stage POSTs forward without a confirm or force', async () => {
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)
    const fetchMock = stubFetch((init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ direction: 'forward', expectedStage: 'kickoff' })
      return jsonResponse({ stage: 'website-specifics' })
    })
    const onChanged = vi.fn()
    render(<SettingsTab vb={mkVb({ stage: 'kickoff', pcCompletedAt: null })} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Advance' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalled()
  })

  it('Advance out of post-contract with pcCompletedAt already set POSTs forward without a confirm or force', async () => {
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)
    const fetchMock = stubFetch((init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ direction: 'forward', expectedStage: 'post-contract' })
      return jsonResponse({ stage: 'kickoff' })
    })
    render(<SettingsTab vb={mkVb({ stage: 'post-contract', pcCompletedAt: '2026-07-01T00:00:00.000Z' })} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Advance' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('Advance out of post-contract with pcCompletedAt null prompts a confirm; declining sends nothing', async () => {
    const confirmSpy = vi.fn(() => false)
    vi.stubGlobal('confirm', confirmSpy)
    const fetchMock = stubFetch()
    render(<SettingsTab vb={mkVb({ stage: 'post-contract', pcCompletedAt: null })} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Advance' }))
    expect(confirmSpy).toHaveBeenCalledWith('Acknowledgments incomplete — advance anyway?')
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/viewbooks/7/stage')).toBe(false)
  })

  it('Advance out of post-contract with pcCompletedAt null: confirming re-POSTs with force:true', async () => {
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)
    const fetchMock = stubFetch((init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ direction: 'forward', expectedStage: 'post-contract', force: true })
      return jsonResponse({ stage: 'kickoff' })
    })
    const onChanged = vi.fn()
    render(<SettingsTab vb={mkVb({ stage: 'post-contract', pcCompletedAt: null })} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Advance' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/7/stage', expect.objectContaining({ method: 'POST' }))
  })

  it('visually separates irreversible settings in a labeled danger zone', () => {
    stubFetch()
    render(<SettingsTab vb={mkVb()} onChanged={vi.fn()} />)

    const dangerZone = screen.getByRole('region', { name: 'Danger zone' })
    expect(within(dangerZone).getByRole('button', { name: 'Revoke link' })).toBeTruthy()
    expect(within(dangerZone).getByRole('button', { name: 'Delete viewbook' })).toBeTruthy()
    expect(dangerZone.getAttribute('class')).toContain('dark:')
  })
})

describe('ViewbookEditor shell', () => {
  function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }

  function mkFullViewbook(overrides: Record<string, unknown> = {}) {
    return {
      id: 3,
      kind: 'upgrade',
      token: 'tok-abc',
      revokedAt: null,
      welcomeNote: null,
      notifyEmail: null,
      dataLockedAt: null,
      dataLockedBy: null,
      stage: 'kickoff',
      pcCompletedAt: null,
      csmName: null,
      syncVersion: 1,
      theme: {
        primary: '#000',
        secondary: '#111',
        tertiary: '#222',
        headingFont: 'inter',
        bodyFont: 'inter',
        logo: null,
        sectionHeroes: {},
      },
      client: { name: 'Acme College', archivedAt: null },
      sections: [],
      milestones: [],
      contentOverrides: [],
      sectionCopy: SECTION_COPY_FIXTURE,
      fields: [],
      ...overrides,
    }
  }

  async function renderEditor(viewbook = mkFullViewbook()) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/api/viewbooks/3/docs') {
          return jsonResponse({ docs: { global: [], own: [] } })
        }
        return jsonResponse({ viewbook })
      }),
    )
    await act(async () => {
      render(<ViewbookEditor viewbookId={3} />)
    })
  }

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    __resetSyncRegistry()
  })

  it('renders a compact masthead with metadata and grouped public-view actions', async () => {
    await renderEditor()

    expect(await screen.findByRole('heading', { name: 'Acme College' })).toBeTruthy()
    expect(screen.getByText('upgrade')).toBeTruthy()
    expect(screen.getByText('Kickoff')).toBeTruthy()
    expect(screen.getByText('Link active')).toBeTruthy()
    const anchor = screen.getByRole('link', { name: 'Open public view' })
    expect(anchor?.getAttribute('href')).toBe(publicViewbookUrl('tok-abc'))
    expect(anchor?.getAttribute('target')).toBe('_blank')
    expect(anchor?.getAttribute('rel') ?? '').toContain('noopener')
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })

  it('copies the public URL from the secondary masthead action', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await renderEditor()

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(publicViewbookUrl('tok-abc')))
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeTruthy()
  })

  it('shows revoked link state without public-view actions', async () => {
    await renderEditor(mkFullViewbook({ revokedAt: '2026-07-01T00:00:00.000Z' }))

    expect(await screen.findByRole('heading', { name: 'Acme College' })).toBeTruthy()
    expect(screen.getByText('Link revoked')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open public view' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull()
  })

  it('uses accessible segmented tabs, separates Settings, and badges Feedback from loaded threads', async () => {
    const feedback = [
      { id: 1, body: 'First', authorName: null, authorKind: 'client', createdAt: '2026-07-01T00:00:00.000Z', resolvedAt: null, resolvedBy: null },
      { id: 2, body: 'Second', authorName: null, authorKind: 'client', createdAt: '2026-07-02T00:00:00.000Z', resolvedAt: null, resolvedBy: null },
    ]
    await renderEditor(mkFullViewbook({
      milestones: [{
        id: 4,
        title: 'Launch',
        blurb: null,
        description: null,
        sortOrder: 1,
        status: 'current',
        targetDate: null,
        reviewLinks: [{ id: 8, label: 'Homepage', url: 'https://example.com', kind: 'mockup', feedback }],
      }],
    }))

    const tablist = await screen.findByRole('tablist', { name: 'Viewbook editor sections' })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs).toHaveLength(7)
    const themeTab = within(tablist).getByRole('tab', { name: 'Theme' })
    const feedbackTab = within(tablist).getByRole('tab', { name: /Feedback/ })
    const settingsTab = within(tablist).getByRole('tab', { name: 'Settings' })
    expect(themeTab.getAttribute('aria-selected')).toBe('true')
    expect(themeTab.tabIndex).toBe(0)
    expect(feedbackTab.tabIndex).toBe(-1)
    expect(feedbackTab.textContent).toContain('2')
    expect(settingsTab.getAttribute('class')).toContain('border-l')

    fireEvent.click(feedbackTab)
    expect(feedbackTab.getAttribute('aria-selected')).toBe('true')
    expect(feedbackTab.tabIndex).toBe(0)
    expect(themeTab.getAttribute('aria-selected')).toBe('false')
    expect(themeTab.hasAttribute('aria-controls')).toBe(false)
    const tabpanel = screen.getByRole('tabpanel')
    expect(tabpanel.id).toBe('viewbook-editor-panel')
    expect(tabpanel.getAttribute('aria-labelledby')).toBe(feedbackTab.id)
    expect(tabpanel.tabIndex).toBe(0)
    expect(feedbackTab.getAttribute('aria-controls')).toBe(tabpanel.id)
  })

  it('supports roving focus and selection with Arrow, Home, and End keys', async () => {
    await renderEditor()

    const tablist = await screen.findByRole('tablist', { name: 'Viewbook editor sections' })
    const themeTab = within(tablist).getByRole('tab', { name: 'Theme' })
    const contentTab = within(tablist).getByRole('tab', { name: 'Content' })
    const settingsTab = within(tablist).getByRole('tab', { name: 'Settings' })

    themeTab.focus()
    fireEvent.keyDown(themeTab, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(contentTab)
    expect(contentTab.getAttribute('aria-selected')).toBe('true')
    expect(contentTab.tabIndex).toBe(0)
    expect(themeTab.tabIndex).toBe(-1)
    expect(contentTab.getAttribute('aria-controls')).toBe('viewbook-editor-panel')
    expect(themeTab.hasAttribute('aria-controls')).toBe(false)

    fireEvent.keyDown(contentTab, { key: 'End' })
    expect(document.activeElement).toBe(settingsTab)
    expect(settingsTab.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(settingsTab, { key: 'Home' })
    expect(document.activeElement).toBe(themeTab)
    expect(themeTab.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(themeTab, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(settingsTab)
    expect(settingsTab.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(settingsTab, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(themeTab)
    expect(themeTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(themeTab.id)
  })
})
