// components/widgets/NeedsAttentionWidget.test.tsx
// @vitest-environment jsdom
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NeedsAttentionWidget } from './NeedsAttentionWidget'
import type { NeedsAttentionRow } from '@/lib/services/fleet-aggregates'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function row(i: number, over: Partial<NeedsAttentionRow> = {}): NeedsAttentionRow {
  return {
    clientId: i, name: `Client ${i}`, firstDomain: `c${i}.com`,
    score: 60, delta: -5, metric: 'seo', openCritical: 0, topAlert: null, ...over,
  }
}

describe('NeedsAttentionWidget', () => {
  it('renders ranked rows with name, score and a red negative-delta chip', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => [row(1, { score: 72, delta: -10 })],
    }))
    render(<NeedsAttentionWidget size="lg" />)
    await waitFor(() => expect(screen.getByText('Client 1')).toBeTruthy())
    expect(screen.getByText('72')).toBeTruthy()
    const chip = screen.getByText(/10/).closest('span')
    expect(chip?.className).toMatch(/red/) // tone="error" (Codex fix 6), not amber warning
    expect(screen.getByText('Client 1').closest('a')?.getAttribute('href')).toBe('/clients/1')
  })

  it('sm shows only the top 3 rows', async () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(i + 1))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => rows }))
    render(<NeedsAttentionWidget size="sm" />)
    await waitFor(() => expect(screen.getByText('Client 1')).toBeTruthy())
    expect(screen.getByText('Client 3')).toBeTruthy()
    expect(screen.queryByText('Client 4')).toBeNull()
  })

  it('lg shows the top 8 rows', async () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(i + 1))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => rows }))
    render(<NeedsAttentionWidget size="lg" />)
    await waitFor(() => expect(screen.getByText('Client 8')).toBeTruthy())
    expect(screen.queryByText('Client 9')).toBeNull()
  })

  it('shows the all-clear empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
    render(<NeedsAttentionWidget size="lg" />)
    await waitFor(() => expect(screen.getByText(/all clear/i)).toBeTruthy())
  })

  it('shows a degraded note on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    render(<NeedsAttentionWidget size="sm" />)
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeTruthy())
  })
})
