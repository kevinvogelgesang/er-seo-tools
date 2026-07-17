// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FeedbackThread } from './FeedbackThread'
import { useEditorActivity } from './useViewbookSync'

vi.mock('./useViewbookSync', async () => {
  const actual = await vi.importActual<typeof import('./useViewbookSync')>('./useViewbookSync')
  return { ...actual, useEditorActivity: vi.fn(actual.useEditorActivity) }
})

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.mocked(useEditorActivity).mockClear() })

describe('FeedbackThread', () => {
  it('renders summaries as text and submits a generated mutation id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ feedback: { id: 2, body: '<b>new</b>', authorName: 'Alex', authorKind: 'client', resolvedAt: null, createdAt: new Date().toISOString() } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<FeedbackThread token="token-1" reviewLinkId={7} initialFeedback={[{
      id: 1, body: '<script>alert(1)</script>', authorName: null, authorKind: 'client', resolvedAt: null, createdAt: new Date(),
    }]} />)
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Feedback'), { target: { value: 'Please revise' } })
    fireEvent.change(screen.getByLabelText('Name (as reported)'), { target: { value: 'Alex' } })
    const submit = screen.getByRole('button', { name: 'Send feedback' })
    expect(submit.className).toContain('bg-[var(--vb-primary)]')
    expect(submit.className).toContain('text-[var(--vb-on-primary)]')
    expect(submit.className).not.toContain('--viewbook-primary')
    fireEvent.click(submit)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const init = fetchMock.mock.calls[0][1]
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ reviewLinkId: 7, body: 'Please revise', authorName: 'Alex' })
    expect(body.clientMutationId).toMatch(/^[0-9a-f-]{36}$/)
  })

  // Final-review fix (P1): `items` used to be seeded ONCE from
  // `initialFeedback` and never resynced, so a comment arriving via a
  // background router.refresh() (another session, or an operator resolving
  // one) never appeared until a full page reload.
  it('reconciles when a refreshed initialFeedback prop brings a new item while idle', () => {
    const first = { id: 1, body: 'First comment', authorName: null, authorKind: 'client', resolvedAt: null, createdAt: new Date() }
    const { rerender } = render(<FeedbackThread token="token-1" reviewLinkId={7} initialFeedback={[first]} />)
    expect(screen.getByText('First comment')).toBeTruthy()
    expect(screen.queryByText('Second comment (from another session)')).toBeNull()

    const second = { id: 2, body: 'Second comment (from another session)', authorName: 'Jamie', authorKind: 'operator', resolvedAt: null, createdAt: new Date() }
    rerender(<FeedbackThread token="token-1" reviewLinkId={7} initialFeedback={[first, second]} />)

    expect(screen.getByText('Second comment (from another session)')).toBeTruthy()
  })

  // Final-review fix (P1): after a successful submit, only `body` used to
  // clear — a non-empty `authorName` left `dirty` (and the registry entry)
  // permanently active, suppressing the shared refresher for the rest of
  // the session.
  it('reads the registry as inactive after a successful submit with a name, once released', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        feedback: { id: 2, body: 'Please revise', authorName: 'Alex', authorKind: 'client', resolvedAt: null, createdAt: new Date().toISOString() },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<FeedbackThread token="token-1" reviewLinkId={7} />)

    const bodyField = screen.getByLabelText('Feedback')
    const nameField = screen.getByLabelText('Name (as reported)')
    fireEvent.change(bodyField, { target: { value: 'Please revise' } })
    fireEvent.change(nameField, { target: { value: 'Alex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())

    fireEvent.blur(nameField) // relatedTarget defaults to null — focus leaves the form

    const calls = vi.mocked(useEditorActivity).mock.calls
    const lastCallForThisThread = [...calls].reverse().find(([id]) => id === 'feedback-7')
    expect(lastCallForThisThread?.[1]).toBe(false)
  })
})
