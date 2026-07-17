// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FeedbackTab, type AdminFeedbackThread } from './FeedbackTab'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('FeedbackTab', () => {
  it('resolves an item through the ownership-fenced operator route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ feedback: { id: 4, resolvedAt: new Date().toISOString(), resolvedBy: 'operator@example.com' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<FeedbackTab viewbookId={9} threads={[{
      reviewLinkId: 2, label: 'Homepage', feedback: [{
        id: 4, body: 'Please revise', authorName: 'Alex', authorKind: 'client', createdAt: new Date(), resolvedAt: null, resolvedBy: null,
      }],
    }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    await waitFor(() => expect(screen.getByText('Resolved by operator@example.com')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/9/feedback/4/resolve', { method: 'POST' })
  })

  // Final-review fix (P1): `rows` used to be seeded ONCE from `threads` and
  // never resynced — a background load() bringing a new comment (or another
  // operator's resolve) never appeared until a full page reload.
  it('reconciles when the threads prop is refreshed with a new comment', () => {
    const base: AdminFeedbackThread = {
      reviewLinkId: 2,
      label: 'Homepage',
      feedback: [
        { id: 4, body: 'First', authorName: 'Alex', authorKind: 'client', createdAt: new Date(), resolvedAt: null, resolvedBy: null },
      ],
    }
    const { rerender } = render(<FeedbackTab viewbookId={9} threads={[base]} />)
    expect(screen.getByText('First')).toBeTruthy()
    expect(screen.queryByText('Second, from another session')).toBeNull()

    const refreshed: AdminFeedbackThread = {
      ...base,
      feedback: [
        ...base.feedback,
        { id: 5, body: 'Second, from another session', authorName: 'Sam', authorKind: 'client', createdAt: new Date(), resolvedAt: null, resolvedBy: null },
      ],
    }
    rerender(<FeedbackTab viewbookId={9} threads={[refreshed]} />)

    expect(screen.getByText('Second, from another session')).toBeTruthy()
  })
})
