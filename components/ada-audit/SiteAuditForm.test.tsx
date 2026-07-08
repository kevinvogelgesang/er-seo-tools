// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(''),   // SiteAuditForm uses this (prefillDomain)
}))

import SiteAuditForm from './SiteAuditForm'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); pushMock.mockReset() })

describe('SiteAuditForm SEO intent (C11 PR 2a)', () => {
  it('SEO intent sends seoOnly:true and routes to /seo-parser?scan=', async () => {
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
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/seo-parser?scan=A1'))
  })
})
