// components/ada-audit/ClientsAuditSummary.test.tsx
// @vitest-environment jsdom
//
// A5 Task 21: the two existing 30s polls (client audit-summary list +
// site-audit queue status) each gain a topic subscription for an immediate
// invalidate-triggered refetch. Per the task plan, the 30s cadence is kept
// AS-IS for both (no fast/safety tiering here — unlike the report/prospect/
// batch-detail migrations) — the SSE win is purely the immediate refetch.
import { render, screen, cleanup, act } from '@testing-library/react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

let mockSearch = ''
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock('./BulkQueueModal', () => ({ default: () => null }))

vi.mock('@/lib/events/client', () => {
  const topicHandlers = new Map<string, () => void>()
  return {
    subscribeTopic: (topic: string, cb: () => void) => {
      topicHandlers.set(topic, cb)
      return () => { topicHandlers.delete(topic) }
    },
    subscribeHealth: () => () => {},
    __fireTopic: (topic: string) => topicHandlers.get(topic)?.(),
    __hasTopic: (topic: string) => topicHandlers.has(topic),
  }
})
import * as eventsClient from '@/lib/events/client'
const { __fireTopic, __hasTopic } = eventsClient as unknown as {
  __fireTopic: (topic: string) => void
  __hasTopic: (topic: string) => boolean
}

import ClientsAuditSummary from './ClientsAuditSummary'

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body }
}

async function flushAsync(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

let fetchMock: ReturnType<typeof vi.fn>

const CLIENTS = [
  { clientId: 1, clientName: 'Acme', firstDomain: 'acme.test', latestSiteAudit: null },
]

function routeFetch() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/clients/audit-summary') return jsonResponse(CLIENTS)
    if (url === '/api/site-audit/queue') return jsonResponse({ active: null, queued: [], batch: null })
    throw new Error(`unexpected fetch: ${url}`)
  })
}

beforeEach(() => {
  mockSearch = ''
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ClientsAuditSummary — SSE-aware polls (A5 Task 21)', () => {
  it('subscribes to both client-audit-summary and queue topics', async () => {
    routeFetch()
    render(<ClientsAuditSummary />)
    await act(async () => { await flushAsync() })
    expect(__hasTopic('client-audit-summary')).toBe(true)
    expect(__hasTopic('queue')).toBe(true)
  })

  it('invalidate on client-audit-summary triggers an immediate refetch of the client list', async () => {
    routeFetch()
    render(<ClientsAuditSummary />)
    await act(async () => { await flushAsync() })
    const before = fetchMock.mock.calls.filter((c) => c[0] === '/api/clients/audit-summary').length

    await act(async () => {
      __fireTopic('client-audit-summary')
      await flushAsync()
    })

    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/clients/audit-summary').length).toBe(before + 1)
  })

  it('invalidate on queue triggers an immediate refetch of queue status', async () => {
    routeFetch()
    render(<ClientsAuditSummary />)
    await act(async () => { await flushAsync() })
    const before = fetchMock.mock.calls.filter((c) => c[0] === '/api/site-audit/queue').length

    await act(async () => {
      __fireTopic('queue')
      await flushAsync()
    })

    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/site-audit/queue').length).toBe(before + 1)
  })

  it('keeps the 30s cadence for both polls (unchanged by SSE)', async () => {
    routeFetch()
    render(<ClientsAuditSummary />)
    await act(async () => { await flushAsync() })
    const clientsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/clients/audit-summary').length
    const queueBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/site-audit/queue').length

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })

    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/clients/audit-summary').length).toBe(clientsBefore + 1)
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/site-audit/queue').length).toBe(queueBefore + 1)
  })

  it('renders the fetched client row', async () => {
    routeFetch()
    render(<ClientsAuditSummary />)
    await act(async () => { await flushAsync() })
    expect(screen.getByText('Acme')).toBeTruthy()
  })
})
