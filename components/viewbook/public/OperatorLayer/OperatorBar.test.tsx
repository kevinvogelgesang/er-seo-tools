// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PresentationModeProvider } from '../PresentationToggle'
import { requestRefresh } from '../useViewbookSync'
import { OperatorBar } from './OperatorBar'

vi.mock('../useViewbookSync', async () => {
  const actual = await vi.importActual<typeof import('../useViewbookSync')>('../useViewbookSync')
  return { ...actual, requestRefresh: vi.fn() }
})

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: vi.fn(),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.mocked(requestRefresh).mockClear()
})

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('OperatorBar', () => {
  it('renders the current stage with advance and rollback controls', async () => {
    render(
      <PresentationModeProvider>
        <OperatorBar viewbookId={42} operatorEmail="operator@example.com" stage="kickoff" pcCompletedAt={null} />
      </PresentationModeProvider>,
    )
    expect(await screen.findByText('Kickoff')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Advance' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Roll back' })).toBeTruthy()
    expect(screen.getByText('operator@example.com')).toBeTruthy()
  })

  it('handles post-contract ack_incomplete by confirming and retrying with force', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ error: 'ack_incomplete' }, 409))
      .mockResolvedValueOnce(response({ stage: 'kickoff' }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(
      <PresentationModeProvider>
        <OperatorBar viewbookId={42} operatorEmail="operator@example.com" stage="post-contract" pcCompletedAt={null} />
      </PresentationModeProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Advance' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      direction: 'forward',
      expectedStage: 'post-contract',
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      direction: 'forward',
      expectedStage: 'post-contract',
      force: true,
    })
    expect(confirm).toHaveBeenCalledWith('Acknowledgments are incomplete — advance anyway?')
    expect(requestRefresh).toHaveBeenCalledOnce()
  })
})
