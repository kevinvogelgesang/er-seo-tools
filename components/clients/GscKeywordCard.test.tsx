// @vitest-environment jsdom
// components/clients/GscKeywordCard.test.tsx
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { GscKeywordCard } from './GscKeywordCard'
import type { GscSnapshotSummary } from '@/lib/keywords/gsc-snapshot'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function makeSummary(overrides: Partial<GscSnapshotSummary> = {}): GscSnapshotSummary {
  return {
    fetchedAt: '2026-07-10T12:00:00.000Z',
    gscSiteUrl: 'sc-domain:example.com',
    window: { start: '2026-04-10T00:00:00.000Z', end: '2026-07-07T00:00:00.000Z' },
    thresholds: { minImpressions: 10, cannibalizationMinShare: 0.2, cannibalizationMinPageImpressions: 10 },
    counts: { wins: 12, opportunities: 8, quickWins: 5, cannibalizedQueries: 6 },
    queryAtLimit: false,
    queryPageAtLimit: false,
    wins: [],
    opportunities: [],
    quickWins: [],
    cannibalization: Array.from({ length: 6 }, (_, i) => ({
      query: `query ${i + 1}`,
      queryImpressions: 100,
      observedPageImpressions: 90,
      observedPageCoverage: 0.9,
      pages: [
        { page: `https://example.com/a${i}`, impressions: 60, clicks: 3, share: 0.6 },
        { page: `https://example.com/b${i}`, impressions: 30, clicks: 1, share: 0.3 },
      ],
    })),
    ...overrides,
  }
}

describe('GscKeywordCard', () => {
  it('unmapped: shows a "Map a GSC property" hint and makes no fetch call', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<GscKeywordCard clientId={1} initial={{ gscMapped: false, summary: null }} />)
    expect(screen.getByText(/Map a GSC property/i)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
  })

  it('empty: mapped but never fetched shows a Refresh CTA', () => {
    render(<GscKeywordCard clientId={1} initial={{ gscMapped: true, summary: null }} />)
    expect(screen.getByText(/No keyword snapshot yet/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
  })

  it('loaded: shows counts, fetchedAt/window line, the hedged caption, and only the top 5 cannibalization rows', () => {
    const summary = makeSummary()
    render(<GscKeywordCard clientId={1} initial={{ gscMapped: true, summary }} />)
    expect(screen.getByText(/Fetched/)).toBeTruthy()
    expect(screen.getByText('12 wins')).toBeTruthy()
    expect(screen.getByText('8 opportunities')).toBeTruthy()
    expect(screen.getByText('5 quick wins')).toBeTruthy()
    expect(screen.getByText('6 cannibalized')).toBeTruthy()
    expect(screen.getByText(/observed in this GSC window/i)).toBeTruthy()
    expect(screen.getByText('query 1')).toBeTruthy()
    expect(screen.getByText('query 5')).toBeTruthy()
    expect(screen.queryByText('query 6')).toBeNull()
    expect(screen.queryByText(/may be truncated/i)).toBeNull()
  })

  it('omits the "may be truncated" notice when neither at-limit flag is set', () => {
    render(<GscKeywordCard clientId={1} initial={{ gscMapped: true, summary: makeSummary() }} />)
    expect(screen.queryByText(/may be truncated/i)).toBeNull()
  })

  it('shows the "may be truncated" notice when queryAtLimit is set', () => {
    render(<GscKeywordCard clientId={1} initial={{ gscMapped: true, summary: makeSummary({ queryAtLimit: true }) }} />)
    expect(screen.getByText(/may be truncated/i)).toBeTruthy()
  })

  it('shows the "may be truncated" notice when queryPageAtLimit is set', () => {
    render(<GscKeywordCard clientId={1} initial={{ gscMapped: true, summary: makeSummary({ queryPageAtLimit: true }) }} />)
    expect(screen.getByText(/may be truncated/i)).toBeTruthy()
  })

  it('refresh click POSTs and replaces the summary from the response', async () => {
    const next = makeSummary({ counts: { wins: 20, opportunities: 8, quickWins: 5, cannibalizedQueries: 6 } })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ summary: next }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<GscKeywordCard clientId={7} initial={{ gscMapped: true, summary: null }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText('20 wins')
    expect(fetchMock).toHaveBeenCalledWith('/api/clients/7/gsc-snapshot', expect.objectContaining({ method: 'POST' }))
  })

  it('error: gsc_access_denied shows copy distinct from gsc_not_mapped, and keeps the prior summary', async () => {
    const summary = makeSummary()
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'gsc_access_denied' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<GscKeywordCard clientId={1} initial={{ gscMapped: true, summary }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText(/service account/i)
    expect(screen.queryByText(/no GSC property is mapped/i)).toBeNull()
    expect(screen.getByText('12 wins')).toBeTruthy()
  })

  it('error: gsc_not_mapped shows copy distinct from gsc_access_denied', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'gsc_not_mapped' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<GscKeywordCard clientId={1} initial={{ gscMapped: true, summary: null }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText(/no GSC property is mapped/i)
    expect(screen.queryByText(/service account/i)).toBeNull()
  })

  it('disables the button and shows "Refreshing…" while the request is in flight', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    const pending = new Promise((resolve) => {
      resolveFetch = resolve
    })
    const fetchMock = vi.fn().mockReturnValue(pending)
    vi.stubGlobal('fetch', fetchMock)
    render(<GscKeywordCard clientId={1} initial={{ gscMapped: true, summary: null }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Refreshing…' })
      expect(button.hasAttribute('disabled')).toBe(true)
    })
    resolveFetch({ ok: true, json: async () => ({ summary: makeSummary() }) })
    await screen.findByRole('button', { name: 'Refresh' })
  })
})
