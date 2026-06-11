// @vitest-environment jsdom
// B5 archive/restore flow on the manage page.
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ClientsPage from './page'

type FetchCall = { url: string; init?: RequestInit }
let calls: FetchCall[] = []

const clientRow = (over: Record<string, unknown> = {}) => ({
  id: 1, name: 'Acme College', domains: [], seedUrls: null, seedUrlsUpdatedAt: null,
  teamworkTasklistId: null, archivedAt: null, createdAt: '2026-01-01T00:00:00.000Z', ...over,
})

function mockFetch(routes: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const body = routes(url, init)
    return { ok: true, status: 200, json: async () => body } as Response
  }))
}

beforeEach(() => { calls = [] })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

describe('manage page archive flow', () => {
  it('loads with includeArchived=1 and hides archived rows by default', async () => {
    mockFetch(() => [clientRow(), clientRow({ id: 2, name: 'Old School', archivedAt: '2026-06-01T00:00:00.000Z' })])
    render(<ClientsPage />)
    await flush()
    expect(calls[0].url).toBe('/api/clients?includeArchived=1')
    expect(screen.getByText('Acme College')).toBeTruthy()
    expect(screen.queryByText('Old School')).toBeNull()
    expect(screen.getByText(/Show 1 archived/)).toBeTruthy()
  })

  it('archives via PATCH {archived:true} after confirm', async () => {
    mockFetch((url, init) => {
      if (init?.method === 'PATCH') return clientRow({ archivedAt: '2026-06-11T00:00:00.000Z' })
      return [clientRow()]
    })
    render(<ClientsPage />)
    await flush()
    fireEvent.click(screen.getByLabelText('Archive client'))
    fireEvent.click(screen.getByText('Yes'))
    await flush()
    const patch = calls.find((c) => c.init?.method === 'PATCH')!
    expect(patch.url).toBe('/api/clients/1')
    expect(JSON.parse(String(patch.init!.body))).toEqual({ archived: true })
    // Row left the active list
    expect(screen.queryByText('Acme College')).toBeNull()
  })

  it('shows archived rows with Restore and hard Delete when toggled', async () => {
    mockFetch((url, init) => {
      if (init?.method === 'PATCH') return clientRow({ id: 2, name: 'Old School', archivedAt: null })
      return [clientRow(), clientRow({ id: 2, name: 'Old School', archivedAt: '2026-06-01T00:00:00.000Z' })]
    })
    render(<ClientsPage />)
    await flush()
    fireEvent.click(screen.getByText(/Show 1 archived/))
    expect(screen.getByText('Old School')).toBeTruthy()
    expect(screen.getByText(/Archived/)).toBeTruthy()
    fireEvent.click(screen.getByText('Restore'))
    await flush()
    const patch = calls.find((c) => c.init?.method === 'PATCH')!
    expect(JSON.parse(String(patch.init!.body))).toEqual({ archived: false })
  })
})
