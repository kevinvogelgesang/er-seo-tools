// components/widgets/KpiStripWidget.test.tsx
// @vitest-environment jsdom
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { KpiStripWidget } from './KpiStripWidget'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const full = { activeScans: 2, avgAda: 81, avgSeo: 74, openCriticals: 9 }

describe('KpiStripWidget', () => {
  it('renders the four fleet numbers with their labels', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => full }))
    render(<KpiStripWidget size="xl" />)
    await waitFor(() => expect(screen.getByText('81')).toBeTruthy())
    expect(screen.getByText('74')).toBeTruthy()
    expect(screen.getByText('9')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText(/active scans/i)).toBeTruthy()
    expect(screen.getByText(/avg ada/i)).toBeTruthy()
    expect(screen.getByText(/avg seo/i)).toBeTruthy()
    expect(screen.getByText(/open criticals/i)).toBeTruthy()
  })

  it('renders "—" for null averages instead of 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ activeScans: 0, avgAda: null, avgSeo: null, openCriticals: 0 }),
    }))
    render(<KpiStripWidget size="wide" />)
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2))
    // openCriticals 0 is a real count, not "—"
    expect(screen.getByText(/open criticals/i)).toBeTruthy()
  })

  it('fault-isolates a failed queue: activeScans "—" while scores still render (Codex fix 7)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ activeScans: null, avgAda: 81, avgSeo: 74, openCriticals: 9 }),
    }))
    render(<KpiStripWidget size="xl" />)
    await waitFor(() => expect(screen.getByText('81')).toBeTruthy())
    expect(screen.getByText('74')).toBeTruthy()
    expect(screen.getByText('9')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy() // active scans degraded
  })

  it('shows a degraded note on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    render(<KpiStripWidget size="wide" />)
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeTruthy())
  })
})
