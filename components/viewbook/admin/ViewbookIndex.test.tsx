// @vitest-environment jsdom
import { render, screen, cleanup, act, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ViewbookIndex } from './ViewbookIndex'
import { publicViewbookUrl } from './viewbook-admin-shared'

const row = (over: Record<string, unknown> = {}) => ({
  id: 5,
  clientName: 'Acme College',
  clientArchived: false,
  kind: 'upgrade',
  token: 'tok-123',
  revoked: false,
  currentMilestone: 'Design',
  stage: 'building',
  activityCount: 0,
  dataLockedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  ...over,
})

function mockFetch(routes: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      return { ok: true, status: 200, json: async () => routes(url, init) } as Response
    }),
  )
}

beforeEach(() => {})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ViewbookIndex', () => {
  it('renders the project-stage chip label for a listed viewbook', async () => {
    mockFetch((url) => {
      if (url === '/api/viewbooks') return { viewbooks: [row()] }
      if (url === '/api/clients') return { clients: [] }
      return {}
    })
    await act(async () => {
      render(<ViewbookIndex />)
    })
    expect(screen.getByText('Now Building')).toBeTruthy()
    // The milestone column keeps its own separate label — not conflated with stage.
    expect(screen.getByText('Design')).toBeTruthy()
    const viewbookRow = screen.getByText('Acme College').closest('tr')
    expect(viewbookRow).toBeTruthy()
    expect(within(viewbookRow as HTMLElement).getByText('Upgrade')).toBeTruthy()
    expect(within(viewbookRow as HTMLElement).getByText('Open')).toBeTruthy()
    expect(within(viewbookRow as HTMLElement).getByText('Link active')).toBeTruthy()
    expect(screen.getByRole('link', { name: /open editor/i }).className).toContain('bg-teal-600')
    expect(viewbookRow?.className).toContain('hover:bg-')
  })

  it('renders the row name as a new-tab link to the public viewbook page', async () => {
    mockFetch((url) => {
      if (url === '/api/viewbooks') return { viewbooks: [row()] }
      if (url === '/api/clients') return { clients: [] }
      return {}
    })
    await act(async () => {
      render(<ViewbookIndex />)
    })
    const nameLink = screen.getByRole('link', { name: 'Acme College' })
    expect(nameLink.getAttribute('href')).toBe(publicViewbookUrl('tok-123'))
    expect(nameLink.getAttribute('target')).toBe('_blank')
    expect(nameLink.getAttribute('rel') ?? '').toContain('noopener')
    // The existing in-app editor link must survive untouched.
    expect(screen.getByRole('link', { name: /open editor/i }).getAttribute('href')).toBe('/viewbooks/5')
  })

  it('renders the row name as plain text (no link) when the public link is revoked', async () => {
    mockFetch((url) => {
      if (url === '/api/viewbooks') return { viewbooks: [row({ revoked: true, clientArchived: true, dataLockedAt: '2026-07-10T00:00:00.000Z' })] }
      if (url === '/api/clients') return { clients: [] }
      return {}
    })
    await act(async () => {
      render(<ViewbookIndex />)
    })
    expect(screen.queryByRole('link', { name: 'Acme College' })).toBeNull()
    expect(screen.getByText('Acme College')).toBeTruthy()
    expect(screen.getByText('Archived client')).toBeTruthy()
    expect(screen.getByText('Link revoked')).toBeTruthy()
    expect(screen.getByText('Locked')).toBeTruthy()
    // The existing in-app editor link must survive untouched.
    expect(screen.getByRole('link', { name: /open editor/i }).getAttribute('href')).toBe('/viewbooks/5')
  })

  it('falls back to the raw stage value when it is not a known stage', async () => {
    mockFetch((url) => {
      if (url === '/api/viewbooks') return { viewbooks: [row({ stage: 'some-future-stage' })] }
      if (url === '/api/clients') return { clients: [] }
      return {}
    })
    await act(async () => {
      render(<ViewbookIndex />)
    })
    expect(screen.getByText('some-future-stage')).toBeTruthy()
  })

  it('creates a viewbook with the unchanged request body and reloads the table', async () => {
    let created = false
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      let body: unknown
      if (url === '/api/viewbooks' && init?.method === 'POST') {
        created = true
        body = { viewbook: { id: 8 } }
      } else if (url === '/api/viewbooks') {
        body = { viewbooks: created ? [row({ id: 8, clientName: 'Beta College', kind: 'new-build' })] : [] }
      } else if (url === '/api/clients') {
        body = { clients: [{ id: 3, name: 'Beta College', archivedAt: null }] }
      } else {
        body = {}
      }
      return { ok: true, status: 200, json: async () => body } as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { render(<ViewbookIndex />) })

    fireEvent.change(screen.getByLabelText('Client'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'new-build' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create viewbook' }))

    await waitFor(() => expect(screen.getByText('Beta College')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 3, kind: 'new-build' }),
    })
  })
})
