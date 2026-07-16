// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { ActivityFeed } from './ActivityFeed'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ActivityFeed', () => {
  it('loads and renders the operator feed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ items: [{ id: 1, kind: 'feedback', actor: 'client', summary: 'Client added feedback', createdAt: new Date().toISOString() }], nextCursor: null }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ActivityFeed viewbookId={12} />)
    await waitFor(() => expect(screen.getByText('Client added feedback')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/12/activity')
  })
})
