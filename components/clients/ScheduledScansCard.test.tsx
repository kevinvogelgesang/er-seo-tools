// @vitest-environment jsdom
// components/clients/ScheduledScansCard.test.tsx
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ScheduledScansCard, humanizeCadence } from './ScheduledScansCard'
import type { ClientScheduleRow } from '@/lib/services/client-schedules'

const row: ClientScheduleRow = {
  id: 'sched1', domain: 'a.example.edu', wcagLevel: 'wcag21aa',
  cadence: 'weekly:1@06:00', enabled: true, nextRunAt: '2026-06-15T06:00:00.000Z',
  lastRun: { id: 'audit1', status: 'complete', completedAt: '2026-06-08T06:10:00.000Z', score: 82 },
  lastDelta: 12,
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ schedules: [] }) }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('humanizeCadence', () => {
  it.each([
    ['weekly:1@06:00', 'Weekly · Mon 06:00'],
    ['monthly:15@23:30', 'Monthly · day 15 23:30'],
    ['every:30m', 'every:30m'], // unknown shape falls through raw
  ])('%s → %s', (cadence, label) => {
    expect(humanizeCadence(cadence)).toBe(label)
  })
})

describe('ScheduledScansCard', () => {
  it('renders schedule rows with cadence, level, last run score, and delta', () => {
    render(<ScheduledScansCard clientId={1} domains={['a.example.edu']} archived={false} initial={[row]} />)
    expect(screen.getByText('a.example.edu')).toBeTruthy()
    expect(screen.getByText('Weekly · Mon 06:00')).toBeTruthy()
    expect(screen.getByText('WCAG 2.1 AA')).toBeTruthy()
    expect(screen.getByText(/complete · 82/)).toBeTruthy()
    expect(screen.getByText('▲ 12')).toBeTruthy()
    expect((screen.getByText(/complete · 82/) as HTMLAnchorElement).getAttribute('href')).toBe('/ada-audit/site/audit1')
  })

  it('shows Paused instead of next-run for disabled schedules', () => {
    render(
      <ScheduledScansCard
        clientId={1}
        domains={['a.example.edu']}
        archived={false}
        initial={[{ ...row, enabled: false }]}
      />,
    )
    expect(screen.getByText('Paused')).toBeTruthy()
    expect(screen.getByText('Resume')).toBeTruthy()
  })

  it('renders the empty state and hides Add for archived clients', () => {
    render(<ScheduledScansCard clientId={1} domains={['a.example.edu']} archived={true} initial={[]} />)
    expect(screen.getByText('No scheduled scans.')).toBeTruthy()
    expect(screen.queryByText('+ Add schedule')).toBeNull()
  })

  it('create flow POSTs the composed cadence and refreshes from GET', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'new' }) }) // POST
      .mockResolvedValueOnce({ ok: true, json: async () => ({ schedules: [row] }) }) // refresh GET
    vi.stubGlobal('fetch', fetchMock)
    render(<ScheduledScansCard clientId={1} domains={['a.example.edu']} archived={false} initial={[]} />)
    fireEvent.click(screen.getByText('+ Add schedule'))
    fireEvent.click(screen.getByText('Create'))
    await screen.findByText('a.example.edu')
    expect(fetchMock).toHaveBeenCalledWith('/api/clients/1/schedules', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ domain: 'a.example.edu', cadence: 'weekly:1@06:00', wcagLevel: 'wcag21aa' })
  })

  it('surfaces API errors inline', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'schedule_exists' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ScheduledScansCard clientId={1} domains={['a.example.edu']} archived={false} initial={[]} />)
    fireEvent.click(screen.getByText('+ Add schedule'))
    fireEvent.click(screen.getByText('Create'))
    await screen.findByText('schedule_exists')
  })

  it('pause PATCHes enabled:false and refreshes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }) // PATCH
      .mockResolvedValueOnce({ ok: true, json: async () => ({ schedules: [{ ...row, enabled: false }] }) }) // refresh
    vi.stubGlobal('fetch', fetchMock)
    render(<ScheduledScansCard clientId={1} domains={['a.example.edu']} archived={false} initial={[row]} />)
    fireEvent.click(screen.getByText('Pause'))
    await screen.findByText('Paused')
    expect(fetchMock).toHaveBeenCalledWith('/api/clients/1/schedules/sched1', expect.objectContaining({ method: 'PATCH' }))
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ enabled: false })
  })

  it('delete asks for confirmation and DELETEs on accept', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }) // DELETE
      .mockResolvedValueOnce({ ok: true, json: async () => ({ schedules: [] }) }) // refresh
    vi.stubGlobal('fetch', fetchMock)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ScheduledScansCard clientId={1} domains={['a.example.edu']} archived={false} initial={[row]} />)
    fireEvent.click(screen.getByText('Delete'))
    await screen.findByText('No scheduled scans.')
    expect(confirmSpy).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/api/clients/1/schedules/sched1', expect.objectContaining({ method: 'DELETE' }))
    confirmSpy.mockRestore()
  })

  it('delete declined → no request', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<ScheduledScansCard clientId={1} domains={['a.example.edu']} archived={false} initial={[row]} />)
    fireEvent.click(screen.getByText('Delete'))
    expect(fetchMock).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })
})
