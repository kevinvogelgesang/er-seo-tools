// @vitest-environment jsdom
import { render, screen, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { QuarterWeekWidget } from './QuarterWeekWidget'

beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-07-08T12:00:00')) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function stubFetch(plan: any, assignments: any[], clients: any[]) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.includes('/api/quarter-plan')) return Promise.resolve({ ok: true, json: async () => ({ plan, assignments }) })
    if (url.includes('/api/clients')) return Promise.resolve({ ok: true, json: async () => clients })
    return Promise.reject(new Error('unexpected url'))
  }))
}

describe('QuarterWeekWidget', () => {
  it('lists clients scheduled in the current week with names', async () => {
    stubFetch(
      { name: 'Q3', startDate: '2026-07-06', slotsPerWeek: 2, layouts: {}, updatedAt: '', teamworkPushedAt: null, teamworkPushSummary: null },
      [{ clientId: 1, week: 1, position: 0, priority: 1, status: 'in_progress', note: '', completed: false }],
      [{ id: 1, name: 'Acme' }],
    )
    render(<QuarterWeekWidget size="wide" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText('Acme')).toBeTruthy()
  })

  it('shows a no-plan state when plan is null', async () => {
    stubFetch(null, [], [])
    render(<QuarterWeekWidget size="sm" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText(/no quarter plan/i)).toBeTruthy()
  })

  it('shows a degraded note when the plan fetch errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    render(<QuarterWeekWidget size="sm" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText(/couldn.t load/i)).toBeTruthy()
  })
})
