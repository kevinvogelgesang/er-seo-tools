// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { ActivityFeed } from './ActivityFeed'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ActivityFeed', () => {
  it('loads and renders the operator feed', async () => {
    const createdAt = '2026-07-17T18:30:00.000Z'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ items: [{ id: 1, kind: 'feedback', actor: 'client', summary: 'Client added feedback', createdAt }], nextCursor: null }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<ActivityFeed viewbookId={12} />)
    await waitFor(() => expect(screen.getByText('Client added feedback')).toBeTruthy())
    expect(screen.getByText('Feedback')).toBeTruthy()
    expect(screen.getByText('client')).toBeTruthy()
    expect(container.querySelector('ol[data-activity-timeline]')).not.toBeNull()
    expect(container.querySelector('time')?.getAttribute('dateTime')).toBe(createdAt)
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/12/activity')
  })
})
