// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ViewbookCard } from './ViewbookCard'

type FetchCall = { url: string; init?: RequestInit }
let calls: FetchCall[] = []

const row = (over: Record<string, unknown> = {}) => ({
  id: 5,
  clientName: 'Acme College',
  clientArchived: false,
  kind: 'upgrade',
  token: 'tok-123',
  revoked: false,
  currentMilestone: 'Design',
  activityCount: 0,
  dataLockedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  ...over,
})

function mockFetch(routes: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return { ok: true, status: 200, json: async () => routes(url, init) } as Response
    }),
  )
}

beforeEach(() => {
  calls = []
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ViewbookCard', () => {
  it('shows the editor link + copy button when a viewbook exists', async () => {
    mockFetch(() => ({ viewbooks: [row()] }))
    await act(async () => {
      render(<ViewbookCard clientId={1} clientName="Acme College" />)
    })
    const link = screen.getByRole('link', { name: /open editor/i })
    expect(link.getAttribute('href')).toBe('/viewbooks/5')
    expect(screen.getByText(/copy public link/i)).toBeTruthy()
  })

  it('creates a viewbook via POST {clientId, kind} when none exists', async () => {
    let created = false
    mockFetch((url, init) => {
      if (url === '/api/viewbooks' && init?.method === 'POST') {
        created = true
        return { viewbook: { id: 9, token: 't' } }
      }
      return { viewbooks: created ? [row({ id: 9 })] : [] }
    })
    await act(async () => {
      render(<ViewbookCard clientId={1} clientName="Acme College" />)
    })
    const btn = screen.getByRole('button', { name: /create viewbook/i })
    await act(async () => {
      fireEvent.click(btn)
    })
    const post = calls.find((c) => c.init?.method === 'POST')
    expect(post).toBeTruthy()
    expect(JSON.parse(String(post?.init?.body))).toEqual({ clientId: 1, kind: 'upgrade' })
    expect(screen.getByRole('link', { name: /open editor/i })).toBeTruthy()
  })
})
