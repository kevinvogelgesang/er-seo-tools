// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

// SiteAuditExportBar imports @/lib/events/client at module scope (subscribeTopic/
// subscribeHealth), so it MUST be mocked before the component is imported — same
// idiom as useAuditPoller.test.ts / lib/widgets/queue-poll.test.ts.
vi.mock('@/lib/events/client', () => {
  let invalidate: () => void = () => {}
  let health: (h: boolean) => void = () => {}
  let lastTopic: string | undefined
  return {
    subscribeTopic: (topic: string, cb: () => void) => {
      lastTopic = topic
      invalidate = cb
      return () => {}
    },
    subscribeHealth: (cb: (h: boolean) => void) => {
      health = cb
      cb(false)
      return () => {}
    },
    __fire: () => invalidate(),
    __setHealth: (h: boolean) => health(h),
    __lastTopic: () => lastTopic,
  }
})
import * as eventsClient from '@/lib/events/client'
const { __fire, __setHealth, __lastTopic } = eventsClient as unknown as {
  __fire: () => void
  __setHealth: (h: boolean) => void
  __lastTopic: () => string | undefined
}

import SiteAuditExportBar from './SiteAuditExportBar'

const ID = 'site-1'

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('SiteAuditExportBar', () => {
  it('renders share button and export links with the right hrefs', () => {
    render(<SiteAuditExportBar siteAuditId={ID} hasPrevious={true} initialReportGeneratedAt={null} />)

    expect(screen.getByText('Share')).toBeTruthy()
    expect(screen.getByText('Violations CSV').getAttribute('href')).toBe(`/api/site-audit/${ID}/csv`)
    expect(screen.getByText('Changes CSV').getAttribute('href')).toBe(`/api/site-audit/${ID}/csv?sheet=changes`)
    expect(screen.getByText('VPAT scaffold').getAttribute('href')).toBe(`/api/site-audit/${ID}/vpat`)
    expect(screen.getByText('PDF report')).toBeTruthy()
  })

  it('hides the Changes CSV link when hasPrevious is false', () => {
    render(<SiteAuditExportBar siteAuditId={ID} hasPrevious={false} initialReportGeneratedAt={null} />)
    expect(screen.queryByText('Changes CSV')).toBeNull()
    expect(screen.getByText('Violations CSV')).toBeTruthy()
  })

  it('starts in ready state with Download + Regenerate when initialReportGeneratedAt is set', () => {
    render(
      <SiteAuditExportBar siteAuditId={ID} hasPrevious={false} initialReportGeneratedAt="2026-06-12T10:00:00.000Z" />,
    )
    const download = screen.getByText('Download report')
    expect(download.getAttribute('href')).toBe(`/api/site-audit/${ID}/report`)
    expect(download.getAttribute('title')).toContain('2026-06-12T10:00:00.000Z')
    expect(screen.getByText('Regenerate')).toBeTruthy()
    expect(screen.queryByText('PDF report')).toBeNull()
  })

  it('click → POST → rendering → poll returns ready → Download link appears', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ queued: true })
      if (url === `/api/site-audit/${ID}/report/status`) {
        return jsonResponse({ state: 'ready', generatedAt: '2026-06-12T11:00:00.000Z' })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    render(<SiteAuditExportBar siteAuditId={ID} hasPrevious={false} initialReportGeneratedAt={null} />)

    await act(async () => {
      fireEvent.click(screen.getByText('PDF report'))
    })

    expect(fetchMock).toHaveBeenCalledWith(`/api/site-audit/${ID}/report`, { method: 'POST' })
    expect(screen.getByText('Rendering report…')).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    const download = screen.getByText('Download report')
    expect(download.getAttribute('href')).toBe(`/api/site-audit/${ID}/report`)
    expect(download.getAttribute('title')).toContain('2026-06-12T11:00:00.000Z')
    expect(screen.getByText('Regenerate')).toBeTruthy()
    // Polling stopped: only the POST + one status call happened.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps polling while status is rendering', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ queued: true })
      return jsonResponse({ state: 'rendering', generatedAt: null })
    })

    render(<SiteAuditExportBar siteAuditId={ID} hasPrevious={false} initialReportGeneratedAt={null} />)
    await act(async () => {
      fireEvent.click(screen.getByText('PDF report'))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })

    expect(screen.getByText('Rendering report…')).toBeTruthy()
    // POST + 3 status polls (2s, 4s, 6s)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('poll returning none flips to error then reverts to clickable', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ queued: true })
      return jsonResponse({ state: 'none', generatedAt: null })
    })

    render(<SiteAuditExportBar siteAuditId={ID} hasPrevious={false} initialReportGeneratedAt={null} />)
    await act(async () => {
      fireEvent.click(screen.getByText('PDF report'))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(screen.getByText('Report failed — retry')).toBeTruthy()

    // Polling stopped after the failure.
    const callsAtError = fetchMock.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(fetchMock.mock.calls.length).toBe(callsAtError)

    // Reverted to the clickable 'none' state (no prior report).
    expect(screen.getByText('PDF report')).toBeTruthy()
    expect(screen.queryByText('Report failed — retry')).toBeNull()
  })

  it('non-OK POST flips to error and reverts to ready when a previous report exists', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async () => jsonResponse({ error: 'busy' }, false))

    render(
      <SiteAuditExportBar siteAuditId={ID} hasPrevious={false} initialReportGeneratedAt="2026-06-12T10:00:00.000Z" />,
    )
    await act(async () => {
      fireEvent.click(screen.getByText('Regenerate'))
    })

    expect(screen.getByText('Report failed — retry')).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    // Previous report still downloadable → reverts to ready, not none.
    expect(screen.getByText('Download report')).toBeTruthy()
    expect(screen.getByText('Regenerate')).toBeTruthy()
  })

  it('clears the polling interval on unmount', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ queued: true })
      return jsonResponse({ state: 'rendering', generatedAt: null })
    })

    const { unmount } = render(
      <SiteAuditExportBar siteAuditId={ID} hasPrevious={false} initialReportGeneratedAt={null} />,
    )
    await act(async () => {
      fireEvent.click(screen.getByText('PDF report'))
    })
    const callsBefore = fetchMock.mock.calls.length

    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchMock.mock.calls.length).toBe(callsBefore)
  })

  // ── A5 Task 18: SSE-aware poll ──────────────────────────────────────────

  it('subscribes to report:<siteAuditId> while rendering', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ queued: true })
      return jsonResponse({ state: 'rendering', generatedAt: null })
    })
    render(<SiteAuditExportBar siteAuditId={ID} hasPrevious={false} initialReportGeneratedAt={null} />)
    await act(async () => {
      fireEvent.click(screen.getByText('PDF report'))
    })
    expect(__lastTopic()).toBe(`report:${ID}`)
  })

  it('SSE invalidate triggers an immediate status refetch', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ queued: true })
      return jsonResponse({ state: 'ready', generatedAt: '2026-06-12T12:00:00.000Z' })
    })
    render(<SiteAuditExportBar siteAuditId={ID} hasPrevious={false} initialReportGeneratedAt={null} />)
    await act(async () => {
      fireEvent.click(screen.getByText('PDF report'))
    })
    const callsBefore = fetchMock.mock.calls.length

    await act(async () => {
      __fire()
    })

    expect(fetchMock.mock.calls.length).toBe(callsBefore + 1)
    expect(screen.getByText('Download report')).toBeTruthy()
  })

  it('while unhealthy, cadence stays at the original 2s interval', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ queued: true })
      return jsonResponse({ state: 'rendering', generatedAt: null })
    })
    render(<SiteAuditExportBar siteAuditId={ID} hasPrevious={false} initialReportGeneratedAt={null} />)
    await act(async () => {
      fireEvent.click(screen.getByText('PDF report'))
    })
    const callsBefore = fetchMock.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(fetchMock.mock.calls.length).toBe(callsBefore + 1)
  })

  it('demotes to the 30s safety cadence once SSE is healthy, and re-arms fast when it drops', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ queued: true })
      return jsonResponse({ state: 'rendering', generatedAt: null })
    })
    render(<SiteAuditExportBar siteAuditId={ID} hasPrevious={false} initialReportGeneratedAt={null} />)
    await act(async () => {
      fireEvent.click(screen.getByText('PDF report'))
    })
    const callsAfterPost = fetchMock.mock.calls.length

    // Health flips true: an immediate refetch fires, and the cadence demotes.
    await act(async () => {
      __setHealth(true)
    })
    expect(fetchMock.mock.calls.length).toBe(callsAfterPost + 1)

    // Well under the 30s safety cadence — no new fetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(fetchMock.mock.calls.length).toBe(callsAfterPost + 1)

    // Health drops: re-arm fast (2000ms).
    await act(async () => {
      __setHealth(false)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(fetchMock.mock.calls.length).toBe(callsAfterPost + 2)
  })
})
