// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FeedbackTab } from './FeedbackTab'

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
})
