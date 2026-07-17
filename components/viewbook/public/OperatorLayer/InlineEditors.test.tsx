// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type {
  OperatorFieldData,
  OperatorMilestoneData,
  OperatorSectionData,
} from '@/lib/viewbook/operator-data'
import { requestRefresh, useEditorActivity } from '../useViewbookSync'
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
})

function ok(body: unknown = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function expectActive(prefix: string) {
  expect(vi.mocked(useEditorActivity).mock.calls.some(([id, active]) => id.startsWith(prefix) && active)).toBe(true)
}

function expectLightOnly(container: HTMLElement) {
  expect(container.innerHTML.includes('dark' + ':')).toBe(false)
}

const section: OperatorSectionData = {
  sectionKey: 'brand',
  state: 'active',
  doneAt: null,
  acknowledgedAt: null,
  introNote: 'Old intro',
  narrative: 'Old narrative',
}

const milestone: OperatorMilestoneData = {
  id: 4,
  title: 'Old milestone',
  blurb: null,
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

describe('light-only operator inline editors', () => {
  it('adapts the admin welcome-note editor and saves through the existing viewbook PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<WelcomeNoteInlineEditor viewbookId={12} welcomeNote="Old note" />)
    fireEvent.change(screen.getByLabelText('Welcome note'), { target: { value: 'New note' } })
    expectActive('operator-welcome-note')
    fireEvent.click(screen.getByRole('button', { name: 'Save welcome note' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/viewbooks/12')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ welcomeNote: 'New note' })
    expectLightOnly(container)
  })

  it('adapts the admin section intro/narrative row and saves both through section PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<SectionTextInlineEditor viewbookId={12} section={section} />)
    fireEvent.change(screen.getByLabelText('Intro for brand'), { target: { value: 'New intro' } })
    fireEvent.change(screen.getByLabelText('Narrative for brand'), { target: { value: 'New narrative' } })
    expectActive('operator-section-text-brand')
    fireEvent.click(screen.getByRole('button', { name: 'Save brand copy' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/viewbooks/12/sections/brand')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      introNote: 'New intro',
      narrative: 'New narrative',
    })
    expectLightOnly(container)
  })

  it('adapts the admin milestone row and saves status, title, and date through milestone PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ milestone }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<MilestoneQuickEditor viewbookId={12} milestones={[milestone]} />)
    fireEvent.change(screen.getByLabelText('Milestone title'), { target: { value: 'Launch' } })
    fireEvent.change(screen.getByLabelText('Milestone status'), { target: { value: 'current' } })
    fireEvent.change(screen.getByLabelText('Milestone target date'), { target: { value: '2026-08-01' } })
    expectActive('operator-milestone-4')
    fireEvent.click(screen.getByRole('button', { name: 'Save milestone' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/viewbooks/12/milestones/4')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      title: 'Launch', status: 'current', targetDate: '2026-08-01',
    })
    expectLightOnly(container)
  })

  it('adapts the admin theme controls and saves through the existing theme PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ theme: { ...DEFAULT_THEME, primary: '#abcdef' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<ThemeInlineEditor viewbookId={12} theme={DEFAULT_THEME} />)
    fireEvent.change(screen.getByLabelText('primary color'), { target: { value: '#abcdef' } })
    expectActive('operator-theme')
    fireEvent.click(screen.getByRole('button', { name: 'Save theme' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/viewbooks/12')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).theme.primary).toBe('#abcdef')
    expectLightOnly(container)
  })

  it('adapts strategy-doc management and uploads through the existing docs route', async () => {
    const doc = { id: 3, title: 'New guide', blurb: null, filename: 'guide.pdf', sortOrder: 1 }
    const fetchMock = vi.fn().mockResolvedValue(ok({ doc }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<DocsInlineEditor viewbookId={12} docs={{ global: [], own: [] }} />)
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
    expectLightOnly(container)
  })

  it('adapts Data Source custom-field and answer editing to the existing field routes', async () => {
    const created = { ...field, id: 8, label: 'New question', value: null, version: 0 }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ field: created }, 201))
      .mockResolvedValueOnce(ok({ field: { ...field, value: 'New answer', version: 3 } }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(
      <DataSourceInlineEditor viewbookId={12} fields={[field]} dataLockedAt={null} />,
    )
    fireEvent.change(screen.getByLabelText('Custom field label'), { target: { value: 'New question' } })
    expectActive('operator-new-field')
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/viewbooks/12/fields')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ label: 'New question' })

    fireEvent.change(screen.getByLabelText('Answer for School motto'), { target: { value: 'New answer' } })
    expectActive('operator-field-7')
    fireEvent.click(screen.getByRole('button', { name: 'Save answer for School motto' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/viewbooks/12/fields/7')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ value: 'New answer', expectedVersion: 2 })
    expectLightOnly(container)
  })
})
