// @vitest-environment jsdom
//
// Task 6: SettingsTab's stage-move buttons (Advance / Roll back) + the
// confirm-then-force path for advancing out of post-contract with an
// incomplete ack. Renders SettingsTab directly (DataSourceTab precedent —
// SettingsTabViewbook is a narrow Pick<ViewbookDetail, ...> so the test
// doesn't have to construct a full ViewbookDetail). DOM-native assertions,
// no jest-dom.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsTab, type SettingsTabViewbook } from './ViewbookEditor'
import { __resetSyncRegistry } from '@/components/viewbook/public/useViewbookSync'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  __resetSyncRegistry()
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function mkVb(overrides: Partial<SettingsTabViewbook> = {}): SettingsTabViewbook {
  return {
    id: 7,
    kind: 'upgrade',
    notifyEmail: null,
    stage: 'kickoff',
    pcCompletedAt: '2026-07-01T00:00:00.000Z',
    csmName: null,
    sections: [],
    ...overrides,
  }
}

function stubFetch(handleStage?: (init: RequestInit | undefined) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/viewbook-content/team') return jsonResponse({ content: [] })
    if (url === '/api/viewbooks/7/stage' && init?.method === 'POST') {
      return handleStage ? handleStage(init) : jsonResponse({ stage: 'website-specifics' })
    }
    throw new Error(`unexpected fetch ${url} ${init?.method ?? 'GET'}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('SettingsTab stage-move buttons', () => {
  it('renders Advance and Roll back, disabling Roll back at the first stage and Advance at the last', async () => {
    stubFetch()
    const { rerender } = render(<SettingsTab vb={mkVb({ stage: 'post-contract' })} onChanged={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'Roll back' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Advance' }) as HTMLButtonElement).disabled).toBe(false)

    rerender(<SettingsTab vb={mkVb({ stage: 'building' })} onChanged={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'Advance' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Roll back' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('Roll back POSTs {direction: back, expectedStage}', async () => {
    const fetchMock = stubFetch((init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ direction: 'back', expectedStage: 'kickoff' })
      return jsonResponse({ stage: 'post-contract' })
    })
    const onChanged = vi.fn()
    render(<SettingsTab vb={mkVb({ stage: 'kickoff' })} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Roll back' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/7/stage', expect.objectContaining({ method: 'POST' }))
  })

  it('Advance from a non-post-contract stage POSTs forward without a confirm or force', async () => {
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)
    const fetchMock = stubFetch((init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ direction: 'forward', expectedStage: 'kickoff' })
      return jsonResponse({ stage: 'website-specifics' })
    })
    const onChanged = vi.fn()
    render(<SettingsTab vb={mkVb({ stage: 'kickoff', pcCompletedAt: null })} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Advance' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalled()
  })

  it('Advance out of post-contract with pcCompletedAt already set POSTs forward without a confirm or force', async () => {
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)
    const fetchMock = stubFetch((init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ direction: 'forward', expectedStage: 'post-contract' })
      return jsonResponse({ stage: 'kickoff' })
    })
    render(<SettingsTab vb={mkVb({ stage: 'post-contract', pcCompletedAt: '2026-07-01T00:00:00.000Z' })} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Advance' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('Advance out of post-contract with pcCompletedAt null prompts a confirm; declining sends nothing', async () => {
    const confirmSpy = vi.fn(() => false)
    vi.stubGlobal('confirm', confirmSpy)
    const fetchMock = stubFetch()
    render(<SettingsTab vb={mkVb({ stage: 'post-contract', pcCompletedAt: null })} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Advance' }))
    expect(confirmSpy).toHaveBeenCalledWith('Acknowledgments incomplete — advance anyway?')
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/viewbooks/7/stage')).toBe(false)
  })

  it('Advance out of post-contract with pcCompletedAt null: confirming re-POSTs with force:true', async () => {
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)
    const fetchMock = stubFetch((init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ direction: 'forward', expectedStage: 'post-contract', force: true })
      return jsonResponse({ stage: 'kickoff' })
    })
    const onChanged = vi.fn()
    render(<SettingsTab vb={mkVb({ stage: 'post-contract', pcCompletedAt: null })} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Advance' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/7/stage', expect.objectContaining({ method: 'POST' }))
  })
})
