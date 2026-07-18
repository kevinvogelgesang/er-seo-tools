// @vitest-environment jsdom
//
// Task 7 — the operator note editors autosave (design D6): the note BODY is
// an inline value editor, so it must persist via a debounced PATCH, never an
// explicit Save button. Image add/delete are STRUCTURAL actions and keep
// explicit controls. Fake-timer + mocked-fetch harness mirrors
// useViewbookSync.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { __resetSyncRegistry } from './useViewbookSync'
import { AssessmentNotesEditors } from './AssessmentNotesEditors'

async function flushAsync(times = 10) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

function okResponse(body: unknown = { ok: true }) {
  return { ok: true, status: 200, json: async () => body }
}

beforeEach(() => {
  vi.useFakeTimers()
  __resetSyncRegistry()
})

afterEach(() => {
  cleanup()
  __resetSyncRegistry()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function renderLeaf() {
  return render(
    <AssessmentNotesEditors
      viewbookId={7}
      token="tok"
      generalHtml=""
      userBehaviourHtml=""
      images={[]}
    />,
  )
}

describe('AssessmentNotesEditors', () => {
  it('autosaves the note body with a single debounced PATCH — no explicit Save button', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', fetchMock)
    renderLeaf()

    const editor = screen.getByLabelText('General assessment notes')
    act(() => {
      editor.innerHTML = '<p>typed</p>'
      fireEvent.input(editor)
    })
    // Debounced — nothing fires before the trailing window elapses.
    expect(fetchMock).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
      await flushAsync()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/viewbooks/7/assessment/notes')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ field: 'general', html: '<p>typed</p>' })

    // The note body is autosaved — there is NO explicit save button for it.
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })

  it('adds a user-behaviour image via an explicit multipart POST', async () => {
    const fetchMock = vi.fn(async () => okResponse({ filename: 'new.png' }))
    vi.stubGlobal('fetch', fetchMock)
    renderLeaf()

    const fileInput = screen.getByLabelText(/Add image/i) as HTMLInputElement
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } })
      await flushAsync()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/viewbooks/7/assessment/images')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('deletes an existing image via an explicit DELETE control', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AssessmentNotesEditors
        viewbookId={7}
        token="tok"
        generalHtml=""
        userBehaviourHtml=""
        images={[{ id: 42, filename: 'old.png', sortOrder: 0 }]}
      />,
    )

    const del = screen.getByRole('button', { name: /delete image/i })
    await act(async () => {
      fireEvent.click(del)
      await flushAsync()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/viewbooks/7/assessment/images/42')
    expect(init.method).toBe('DELETE')
  })
})
