// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import RecentsTable from './RecentsTable'
import type { RecentItem } from '@/lib/ada-audit/recents-query'

const item = (over: Partial<RecentItem> = {}): RecentItem => ({
  type: 'site-ada', id: 'a1', createdAt: '2026-07-08T10:00:00.000Z', label: 'client-a.example',
  href: '/ada-audit/site/a1', status: 'complete', score: 92, startedAt: null, completedAt: null,
  clientName: 'Client A', requestedBy: 'Alice', deletable: false, inFlight: false, ...over,
})

beforeEach(() => {
  // Full-variant mounts fetch /api/clients for the filter dropdown.
  vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([])))
})
// useRealTimers here (not per-test) so an assertion failure can't leak fake
// timers into later tests (plan Codex fix #6).
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('RecentsTable', () => {
  it('renders an Operator column with the requestedBy value', () => {
    render(<RecentsTable initialItems={[item()]} initialNextCursor={null} initialScope="all" operator="Alice" variant="full" />)
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('Operator')).toBeTruthy()
  })

  it('home variant shows the See all footer link', () => {
    render(<RecentsTable initialItems={[item()]} initialNextCursor={null} initialScope="mine" operator="Alice" variant="home" />)
    expect(screen.getByText(/See all recents/i)).toBeTruthy()
  })

  it('C16: renders the four type badges', () => {
    render(<RecentsTable initialItems={[
      item({ type: 'site-ada', id: '1' }),
      item({ type: 'site-seo', id: '2' }),
      item({ type: 'page', id: '3', label: 'https://a.example/p' }),
      item({ type: 'sf-upload', id: '4', deletable: true, label: 'internal_all.csv' }),
    ]} initialNextCursor={null} initialScope="all" operator={null} variant="full" />)
    expect(screen.getByText('Site ADA')).toBeTruthy()
    expect(screen.getByText('Site SEO')).toBeTruthy()
    expect(screen.getByText('Single Page')).toBeTruthy()
    expect(screen.getByText('SF Upload')).toBeTruthy()
  })

  it('C16: row links use item.href', () => {
    render(<RecentsTable initialItems={[item({ type: 'site-seo', id: 's1', href: '/seo-audits/results/run/r9' })]}
      initialNextCursor={null} initialScope="all" operator={null} variant="full" />)
    expect(screen.getByRole('link', { name: 'client-a.example' }).getAttribute('href')).toBe('/seo-audits/results/run/r9')
  })

  it('C16: sf-upload rows delete via two-step confirm → DELETE /api/parse/:id', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true })))
    render(<RecentsTable initialItems={[item({ type: 'sf-upload', id: 'sess1', deletable: true })]}
      initialNextCursor={null} initialScope="all" operator={null} variant="full" />)
    fireEvent.click(screen.getByRole('button', { name: /delete client-a.example/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/parse/sess1', expect.objectContaining({ method: 'DELETE' })))
    await waitFor(() => expect(screen.queryByText('client-a.example')).toBeNull())
  })

  it('C16: Load more appends the next page using nextCursor', async () => {
    const page2 = { items: [item({ id: 'b2', label: 'second-page.example' })], nextCursor: null }
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/clients')) return new Response(JSON.stringify([]))
      return new Response(JSON.stringify(page2))
    })
    render(<RecentsTable initialItems={[item({ id: 'a1' })]} initialNextCursor="123~site-ada~a1"
      initialScope="all" operator={null} variant="full" />)
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    await waitFor(() => expect(screen.getByText('second-page.example')).toBeTruthy())
    expect(screen.getByText('client-a.example')).toBeTruthy() // appended, not replaced
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull() // nextCursor null → hidden
    const loadMoreCall = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.includes('cursor='))
    expect(decodeURIComponent(loadMoreCall ?? '')).toContain('cursor=123~site-ada~a1')
  })

  // C17: live in-flight rows.
  it('polls the compact status endpoint for in-flight rows, merges updates, shows mini progress', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/ada-audit/recents/status')) {
        return new Response(JSON.stringify({ items: [{
          type: 'site-ada', id: 'a1', status: 'running', score: null,
          href: '/ada-audit/site/a1', startedAt: null, completedAt: null, inFlight: true,
          pagesDone: 12, pagesTotal: 40, progressPct: null, phaseLabel: null,
        }] }))
      }
      return new Response(JSON.stringify([]))
    })
    render(<RecentsTable initialItems={[item({ status: 'queued', inFlight: true, score: null })]}
      initialNextCursor={null} initialScope="all" operator={null} variant="full" />)
    // waitFor's internal interval never fires under vitest fake timers —
    // advance inside act() and assert directly (house pattern).
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(screen.getByText('running')).toBeTruthy()
    expect(screen.getByText('12/40 pages')).toBeTruthy()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/ada-audit/recents/status'))).toBe(true)
  })

  it('refetches the merged list once when an in-flight row settles', async () => {
    vi.useFakeTimers()
    let recentsFetches = 0
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/ada-audit/recents/status')) {
        return new Response(JSON.stringify({ items: [{
          type: 'site-ada', id: 'a1', status: 'complete', score: 88,
          href: '/ada-audit/site/a1', startedAt: null, completedAt: null, inFlight: false,
          pagesDone: null, pagesTotal: null, progressPct: null, phaseLabel: null,
        }] }))
      }
      if (url.includes('/api/ada-audit/recents?')) {
        recentsFetches++
        return new Response(JSON.stringify({ items: [item({ status: 'complete', score: 88 })], nextCursor: null }))
      }
      return new Response(JSON.stringify([]))
    })
    render(<RecentsTable initialItems={[item({ status: 'running', inFlight: true, score: null })]}
      initialNextCursor={null} initialScope="all" operator={null} variant="full" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(recentsFetches).toBe(1)
    // next tick: same settled key must not re-trigger the merged refetch
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(recentsFetches).toBe(1)
  })

  it('does not hit the status endpoint when nothing is in flight', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([])))
    render(<RecentsTable initialItems={[item()]} initialNextCursor={null} initialScope="all" operator={null} variant="full" />)
    await vi.advanceTimersByTimeAsync(30000)
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes('/recents/status'))).toBe(true)
  })

  it('C16: home variant hides search/filter/delete/load-more', () => {
    render(<RecentsTable initialItems={[item({ type: 'sf-upload', deletable: true })]} initialNextCursor="1~page~x"
      initialScope="all" operator={null} variant="home" />)
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull()
  })

  it('C14: renders a Prospect badge on prospect-linked rows', () => {
    render(<RecentsTable initialItems={[item({ type: 'site-ada', prospectLinked: true })]}
      initialNextCursor={null} initialScope="all" operator={null} variant="full" />)
    expect(screen.getByText('Prospect')).toBeTruthy()
  })

  it('C14: does not render a Prospect badge on non-prospect rows', () => {
    render(<RecentsTable initialItems={[item({ type: 'site-ada' })]}
      initialNextCursor={null} initialScope="all" operator={null} variant="full" />)
    expect(screen.queryByText('Prospect')).toBeNull()
  })
})
