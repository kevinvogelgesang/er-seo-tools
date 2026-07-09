// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import RecentsTable from './RecentsTable'
import type { RecentItem } from '@/lib/ada-audit/recents-query'

const item = (over: Partial<RecentItem> = {}): RecentItem => ({
  type: 'site-ada', id: 'a1', createdAt: '2026-07-08T10:00:00.000Z', label: 'client-a.example',
  href: '/ada-audit/site/a1', status: 'complete', score: 92, startedAt: null, completedAt: null,
  clientName: 'Client A', requestedBy: 'Alice', deletable: false, ...over,
})

beforeEach(() => {
  // Full-variant mounts fetch /api/clients for the filter dropdown.
  vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([])))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

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

  it('C16: home variant hides search/filter/delete/load-more', () => {
    render(<RecentsTable initialItems={[item({ type: 'sf-upload', deletable: true })]} initialNextCursor="1~page~x"
      initialScope="all" operator={null} variant="home" />)
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull()
  })
})
