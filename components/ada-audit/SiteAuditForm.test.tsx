// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(''),   // SiteAuditForm uses this (prefillDomain)
}))
// C16: the SF-upload card is a heavy client component (uploads, router) — stub it.
vi.mock('@/components/seo-parser/SeoUploadCard', () => ({ SeoUploadCard: () => <div data-testid="sf-upload-card" /> }))

import SiteAuditForm from './SiteAuditForm'
import type { QueueStatusWithBatch } from '@/lib/ada-audit/types'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); pushMock.mockReset() })

describe('SiteAuditForm queue banner IntentChip (C11 PR 2a)', () => {
  it('labels the active row and the seoOnly queued domain, not the ADA queued domain', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/clients') return { json: async () => [] } as Response
      return { ok: true, json: async () => ({}) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    const queueStatus: QueueStatusWithBatch = {
      active: {
        id: 'a1',
        domain: 'active-seo.com',
        status: 'running',
        pagesTotal: 10,
        pagesComplete: 3,
        pagesError: 0,
        pdfsTotal: 0,
        pdfsComplete: 0,
        pdfsError: 0,
        pdfsSkipped: 0,
        lighthouseTotal: 0,
        lighthouseComplete: 0,
        lighthouseError: 0,
        clientId: null,
        seoOnly: true,
      },
      queued: [
        { id: 'q1', domain: 'seo-queued.com', position: 1, clientId: null, seoOnly: true },
        { id: 'q2', domain: 'ada-queued.com', position: 2, clientId: null, seoOnly: false },
      ],
      batch: null,
    }
    render(<SiteAuditForm queueStatus={queueStatus} />)
    // Scope to the queue banner — the "Scan type" toggle button also renders the text "SEO".
    await waitFor(() => expect(screen.getByText(/New audits will be queued/i)).toBeTruthy())
    const banner = screen.getByText(/New audits will be queued/i).closest('div')!
    // one for the active row, one for the seoOnly queued domain — none for the ADA queued domain
    expect(within(banner).getAllByText('SEO').length).toBe(2)
  })
})

describe('SiteAuditForm SEO intent (C11 PR 2a)', () => {
  it('SEO intent sends seoOnly:true and routes to the site page (C16)', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/clients') return { json: async () => [] } as Response
      if (url === '/api/site-audit') {
        const body = JSON.parse(String(init!.body))
        expect(body.seoOnly).toBe(true)
        return { ok: true, status: 202, json: async () => ({ id: 'A1', status: 'queued' }) } as Response
      }
      return { ok: true, json: async () => ({ urls: ['https://x.edu/'], domain: 'x.edu' }) } as Response // discovery
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SiteAuditForm queueStatus={null} />)
    fireEvent.click(screen.getByRole('button', { name: /SEO/i }))          // intent toggle
    fireEvent.change(screen.getByLabelText(/Domain to audit/i), { target: { value: 'x.edu' } })
    fireEvent.click(screen.getByRole('button', { name: /^Discover Pages$/i }))
    await waitFor(() => screen.getByRole('button', { name: /^Audit \d/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Audit \d/i }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/ada-audit/site/A1'))
  })
})

describe('SiteAuditForm SF upload section (C16)', () => {
  it('SEO intent reveals a collapsed SF-upload section; expanding shows the card', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/clients') return { json: async () => [] } as Response
      return { ok: true, json: async () => ({}) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SiteAuditForm queueStatus={null} />)
    // default intent is ada — no SF section
    expect(screen.queryByText(/Screaming Frog exports/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /SEO/i }))
    const toggle = screen.getByRole('button', { name: /Screaming Frog exports/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('sf-upload-card')).toBeNull() // collapsed by default
    fireEvent.click(toggle)
    expect(screen.getByTestId('sf-upload-card')).toBeTruthy()
  })
})

describe('SiteAuditForm D7 notify checkbox', () => {
  const clientsStub = () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/clients') return { json: async () => [] } as Response
      return { ok: true, json: async () => ({}) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)
  }

  it('is hidden when notifyAvailable is false', async () => {
    clientsStub()
    render(<SiteAuditForm queueStatus={null} notifyAvailable={false} />)
    await waitFor(() => expect(screen.queryByText(/email me when this finishes/i)).toBeNull())
  })

  it('is shown and unchecked on load when notifyAvailable is true', async () => {
    clientsStub()
    render(<SiteAuditForm queueStatus={null} notifyAvailable={true} />)
    const cb = await screen.findByLabelText(/email me when this finishes/i) as HTMLInputElement
    expect(cb.checked).toBe(false)
  })

  it('stays unchecked after unmount/remount (never sticky)', async () => {
    clientsStub()
    const { unmount } = render(<SiteAuditForm queueStatus={null} notifyAvailable={true} />)
    fireEvent.click(await screen.findByLabelText(/email me when this finishes/i))
    unmount()
    render(<SiteAuditForm queueStatus={null} notifyAvailable={true} />)
    const cb = await screen.findByLabelText(/email me when this finishes/i) as HTMLInputElement
    expect(cb.checked).toBe(false)
  })
})
