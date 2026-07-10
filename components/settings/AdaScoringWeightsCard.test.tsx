// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DEFAULT_ADA_V4_WEIGHTS } from '@/lib/scoring/ada-v4'
import { AdaScoringWeightsCard } from './AdaScoringWeightsCard'

const WEIGHTS = { critical: 40, serious: 30, moderate: 15, minor: 5, needsReview: 10, advisoryDiscount: 0.4 }

function mockFetch(putResponse: { ok: boolean; json: () => Promise<unknown> } = { ok: true, json: async () => ({ weights: WEIGHTS }) }) {
  return vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return Promise.resolve(putResponse)
    return Promise.resolve({ ok: true, json: async () => ({ weights: WEIGHTS }) })
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AdaScoringWeightsCard', () => {
  it('renders all six labeled inputs after the GET resolves', async () => {
    vi.stubGlobal('fetch', mockFetch())
    render(<AdaScoringWeightsCard />)

    expect(await screen.findByText('Critical cap')).toBeTruthy()
    expect(screen.getByText('Serious cap')).toBeTruthy()
    expect(screen.getByText('Moderate cap')).toBeTruthy()
    expect(screen.getByText('Minor cap')).toBeTruthy()
    expect(screen.getByText('Needs-review cap')).toBeTruthy()
    expect(screen.getByText('Advisory discount (0–1)')).toBeTruthy()
  })

  it('Save PUTs the whole weights object and shows Saved.', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<AdaScoringWeightsCard />)

    await screen.findByText('Critical cap')
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(screen.getAllByText('Saved.').length).toBeGreaterThan(0))

    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(putCall).toBeTruthy()
    const [url, init] = putCall as [string, RequestInit]
    expect(url).toBe('/api/settings/ada-scoring-weights')
    expect(JSON.parse(init.body as string)).toEqual(WEIGHTS)
  })

  it('renders the server error string on a 400 response', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: false, json: async () => ({ error: 'Caps sum to 110 — they are absolute deductions and must sum to at most 100.' }) }))
    render(<AdaScoringWeightsCard />)

    await screen.findByText('Critical cap')
    fireEvent.click(screen.getByText('Save'))

    expect(await screen.findByText(/Caps sum to 110/)).toBeTruthy()
  })

  it('Reset to defaults restores DEFAULT_ADA_V4_WEIGHTS in the inputs', async () => {
    vi.stubGlobal('fetch', mockFetch())
    render(<AdaScoringWeightsCard />)

    const criticalInput = (await screen.findByText('Critical cap')).querySelector('input') as HTMLInputElement
    fireEvent.change(criticalInput, { target: { value: '99' } })
    expect(criticalInput.value).toBe('99')

    fireEvent.click(screen.getByText('Reset to defaults'))
    expect(criticalInput.value).toBe(String(DEFAULT_ADA_V4_WEIGHTS.critical))
  })
})
