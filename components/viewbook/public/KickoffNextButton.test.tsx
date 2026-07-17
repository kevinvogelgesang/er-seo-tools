// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { KickoffNextButton } from './KickoffNextButton'
import { __resetSyncRegistry, requestRefresh } from './useViewbookSync'

vi.mock('./useViewbookSync', async () => {
  const actual = await vi.importActual<typeof import('./useViewbookSync')>('./useViewbookSync')
  return { ...actual, requestRefresh: vi.fn() }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.mocked(requestRefresh).mockClear()
  __resetSyncRegistry()
})

describe('KickoffNextButton', () => {
  it('confirms, posts the fenced forward move, and refreshes on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ stage: 'website-specifics' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('fetch', fetchMock)
    render(<KickoffNextButton viewbookId={42} />)
    fireEvent.click(screen.getByRole('button', { name: 'Move to Website Specifics' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/42/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'forward', expectedStage: 'kickoff' }),
    }))
    await waitFor(() => expect(requestRefresh).toHaveBeenCalledOnce())
  })
})
