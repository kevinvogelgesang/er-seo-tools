// @vitest-environment jsdom
import { render, screen, cleanup, act } from '@testing-library/react'
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
})
