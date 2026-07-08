// components/widgets/RecentParsesWidget.test.tsx
// @vitest-environment jsdom
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { RecentParsesWidget } from './RecentParsesWidget'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const rows = [
  { id: 's1', kind: 'session', source: 'sf-upload', createdAt: '2026-07-06T10:00:00Z', status: 'complete', files: ['a.csv'], siteName: 'Example', clientId: 1, clientName: 'Acme', healthScore: 82, urlCount: 120 },
  { id: 'r1', kind: 'run', source: 'live-scan', createdAt: '2026-07-05T10:00:00Z', status: 'complete', files: [], siteName: 'Two', clientId: null, clientName: null, healthScore: 55, urlCount: 40 },
]

describe('RecentParsesWidget', () => {
  it('renders fetched parse rows', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => rows }))
    render(<RecentParsesWidget size="lg" />)
    await waitFor(() => expect(screen.getByText('Example')).toBeTruthy())
    expect(screen.getByText('82')).toBeTruthy()
  })

  it('deep-links sessions and live-scan runs to their respective results pages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => rows }))
    render(<RecentParsesWidget size="lg" />)
    await waitFor(() => expect(screen.getByText('Example')).toBeTruthy())
    expect(screen.getByText('Example').closest('a')?.getAttribute('href')).toBe('/seo-audits/results/s1')
    expect(screen.getByText('Two').closest('a')?.getAttribute('href')).toBe('/seo-audits/results/run/r1')
  })

  it('shows an empty state when there are no parses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
    render(<RecentParsesWidget size="sm" />)
    await waitFor(() => expect(screen.getByText(/no recent parses/i)).toBeTruthy())
  })

  it('shows a degraded note on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    render(<RecentParsesWidget size="sm" />)
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeTruthy())
  })
})
