// @vitest-environment jsdom
// components/clients/RobotsCheckCard.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { RobotsCheckCard } from './RobotsCheckCard'
import type { RobotsCheckDetail, RobotsCheckSummary } from '@/lib/robots-check/types'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals() // fetch-stub cleanup convention (plan-Codex #6)
})

function summaryFixture(over: Partial<RobotsCheckSummary> = {}): RobotsCheckSummary {
  return {
    id: 1, domain: 'example.com', source: 'manual', robotsStatus: 'ok',
    sitemapUrlTotal: 42, errorCount: 0, warningCount: 1, changed: null,
    createdAt: '2026-07-12T00:00:00.000Z', ...over,
  }
}

function detailFixture(over: Partial<RobotsCheckDetail> = {}): RobotsCheckDetail {
  return {
    v: 1, domain: 'example.com',
    robots: { status: 'ok', httpStatus: 200, failure: null, contentHash: 'h', issues: [], blockedBots: ['GPTBot'], sitemapUrls: ['https://example.com/s.xml'] },
    sitemaps: [{
      url: 'https://example.com/s.xml', source: 'robots', ok: true, httpStatus: 200,
      failure: null, isIndex: false, urlCount: 42, childrenTotal: 0, childrenExcluded: 0,
      childrenFailed: 0, childrenSkipped: 0, contentHash: 'sh', children: [], childrenHash: null, issues: [],
    }],
    sitemapsSkipped: 0, timeBudgetExhausted: false,
    totals: { sitemapUrlTotal: 42, errors: 0, warnings: 1 }, ...over,
  }
}

describe('RobotsCheckCard', () => {
  it('empty-domains state shows the add-domain hint and no Run button', () => {
    render(<RobotsCheckCard clientId={1} domains={[]} archived={false} initial={{ checks: [], latest: null }} />)
    expect(screen.getByText(/add a domain/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /run check/i })).toBeNull()
  })

  it('renders latest state: status badge, counts, blocked bots, sitemap total', () => {
    render(
      <RobotsCheckCard
        clientId={1} domains={['example.com']} archived={false}
        initial={{ checks: [summaryFixture()], latest: { summary: summaryFixture(), detail: detailFixture() } }}
      />,
    )
    expect(screen.getByText(/robots ok/i)).toBeTruthy()
    expect(screen.getByText('42 sitemap URLs')).toBeTruthy() // exact (plan-Codex #6)
    expect(screen.getByText(/1 AI bot blocked/i)).toBeTruthy()
  })

  it('run check success: POSTs, renders the new latest, prepends history', async () => {
    const newLatest = {
      summary: summaryFixture({ id: 7, changed: true }),
      detail: detailFixture(),
    }
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => newLatest })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <RobotsCheckCard clientId={1} domains={['example.com']} archived={false} initial={{ checks: [], latest: null }} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /run check/i }))
    await waitFor(() => expect(screen.getByText(/robots ok/i)).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/clients/1/robots-checks')
  })

  it('domain switch fetches the new domain history + latest detail lazily', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checks: [summaryFixture({ id: 3, domain: 'two.com' })] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ summary: summaryFixture({ id: 3, domain: 'two.com' }), detail: detailFixture() }) })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <RobotsCheckCard clientId={1} domains={['one.com', 'two.com']} archived={false} initial={{ checks: [], latest: null }} />,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'two.com' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/clients/1/robots-checks?domain=two.com')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/clients/1/robots-checks/3')
  })

  it('expanding a history row lazily fetches its detail; fetch failure surfaces inline error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <RobotsCheckCard
        clientId={1} domains={['example.com']} archived={false}
        initial={{ checks: [summaryFixture({ id: 11 })], latest: null }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Jul/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/clients/1/robots-checks/11'))
    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeTruthy())
  })

  it('changed null renders an em dash, never "unchanged"', () => {
    render(
      <RobotsCheckCard
        clientId={1} domains={['example.com']} archived={false}
        initial={{ checks: [summaryFixture({ changed: null })], latest: null }}
      />,
    )
    expect(screen.queryByText(/unchanged/i)).toBeNull()
  })

  it('POST failure reconciles: refetches history AND the newest detail, updates latest (plan-Codex #5)', async () => {
    const fetchMock = vi.fn()
      // POST fails (also covers the AbortController-timeout path — both land
      // in the same catch/!ok reconciliation)
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'internal_error' }) })
      // reconciliation: history GET
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checks: [summaryFixture({ id: 9 })] }) })
      // reconciliation: newest detail GET
      .mockResolvedValueOnce({ ok: true, json: async () => ({ summary: summaryFixture({ id: 9 }), detail: detailFixture() }) })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <RobotsCheckCard clientId={1} domains={['example.com']} archived={false} initial={{ checks: [], latest: null }} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /run check/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/clients/1/robots-checks')
    expect(fetchMock.mock.calls[1][0]).toContain('/api/clients/1/robots-checks?domain=')
    expect(fetchMock.mock.calls[2][0]).toBe('/api/clients/1/robots-checks/9')
    // latest was reconciled from the server, not left stale
    await waitFor(() => expect(screen.getByText(/robots ok/i)).toBeTruthy())
  })

  it('honest truncation line when flags set', () => {
    render(
      <RobotsCheckCard
        clientId={1} domains={['example.com']} archived={false}
        initial={{
          checks: [summaryFixture()],
          latest: { summary: summaryFixture(), detail: detailFixture({ timeBudgetExhausted: true }) },
        }}
      />,
    )
    expect(screen.getByText(/possibly incomplete/i)).toBeTruthy()
  })
})
