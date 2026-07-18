// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FeedbackTab, type AdminFeedbackThread } from './FeedbackTab'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('FeedbackTab', () => {
  it('resolves an item through the ownership-fenced operator route', async () => {
    const response = {
      ok: true, json: async () => ({ feedback: { id: 4, resolvedAt: new Date().toISOString(), resolvedBy: 'operator@example.com' } }),
    }
    let releaseRequest!: () => void
    const fetchMock = vi.fn(() => new Promise<typeof response>((resolve) => {
      releaseRequest = () => resolve(response)
    }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(<FeedbackTab viewbookId={9} threads={[{
      reviewLinkId: 2, label: 'Homepage', feedback: [{
        id: 4, body: 'Please revise', authorName: 'Alex', authorKind: 'client', createdAt: new Date(), resolvedAt: null, resolvedBy: null,
      }],
    }]} />)
    expect(screen.getByText('1 open')).toBeTruthy()
    expect(screen.getByText('0 resolved')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Resolve feedback from Alex: Please revise' }))
    expect(screen.getByRole('status').textContent).toContain('Resolving feedback from Alex')
    releaseRequest()
    await waitFor(() => expect(screen.getByText('Resolved by operator@example.com')).toBeTruthy())
    expect(screen.getByText('0 open')).toBeTruthy()
    expect(screen.getByText('1 resolved')).toBeTruthy()
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Please revise'))
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/9/feedback/4/resolve', { method: 'POST' })
  })

  it('keeps feedback open when resolve confirmation is cancelled', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => false))
    render(<FeedbackTab viewbookId={9} threads={[{
      reviewLinkId: 2, label: 'Homepage', feedback: [{
        id: 4, body: 'Please revise', authorName: 'Alex', authorKind: 'client', createdAt: new Date(), resolvedAt: null, resolvedBy: null,
      }],
    }]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Resolve feedback from Alex: Please revise' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText('1 open')).toBeTruthy()
  })

  it('handles resolve errors and leaves the action available to retry', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'resolve_failed' }) }))
    render(<FeedbackTab viewbookId={9} threads={[{
      reviewLinkId: 2, label: 'Homepage', feedback: [{
        id: 4, body: 'Please revise', authorName: 'Alex', authorKind: 'client', createdAt: new Date(), resolvedAt: null, resolvedBy: null,
      }],
    }]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Resolve feedback from Alex: Please revise' }))
    expect((await screen.findByRole('alert')).textContent).toContain('resolve_failed')
    expect(screen.getByRole('button', { name: 'Resolve feedback from Alex: Please revise' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByText('1 open')).toBeTruthy()
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
