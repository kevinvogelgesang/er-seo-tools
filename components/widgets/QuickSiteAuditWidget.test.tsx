// components/widgets/QuickSiteAuditWidget.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))

import { QuickSiteAuditWidget } from './QuickSiteAuditWidget'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); pushMock.mockReset() })

describe('QuickSiteAuditWidget', () => {
  it('POSTs the domain and redirects to the live audit page on 202', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 202, ok: true, json: async () => ({ id: 'abc', status: 'queued' }) }))
    render(<QuickSiteAuditWidget size="wide" />)
    fireEvent.change(screen.getByPlaceholderText(/example\.com/i), { target: { value: 'example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/ada-audit/site/abc'))
  })

  it('redirects to the existing audit on a 409 duplicate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 409, ok: false, json: async () => ({ error: 'in flight', id: 'dup' }) }))
    render(<QuickSiteAuditWidget size="wide" />)
    fireEvent.change(screen.getByPlaceholderText(/example\.com/i), { target: { value: 'example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/ada-audit/site/dup'))
  })

  it('C11: routes a seoOnly 409 duplicate to /seo-parser', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 409, ok: false, json: async () => ({ error: 'in flight', id: 'dup', seoOnly: true }) }))
    render(<QuickSiteAuditWidget size="wide" />)
    fireEvent.change(screen.getByPlaceholderText(/example\.com/i), { target: { value: 'example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/seo-parser?scan=dup'))
  })

  it('C11: new SEO 202 (no seoOnly in body) routes by local intent to /seo-parser?scan=', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body))
      expect(body.seoOnly).toBe(true)
      return { status: 202, ok: true, json: async () => ({ id: 'Q1', status: 'queued' }) } as Response
    }))
    render(<QuickSiteAuditWidget size="wide" />)
    fireEvent.click(screen.getByRole('button', { name: /SEO/i }))
    fireEvent.change(screen.getByPlaceholderText(/example\.com/i), { target: { value: 'x.edu' } })
    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/seo-parser?scan=Q1'))
  })

  it('shows an inline error on a 400 and does not redirect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 400, ok: false, json: async () => ({ error: 'bad domain' }) }))
    render(<QuickSiteAuditWidget size="wide" />)
    fireEvent.change(screen.getByPlaceholderText(/example\.com/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    await waitFor(() => expect(screen.getByText(/bad domain/i)).toBeTruthy())
    expect(pushMock).not.toHaveBeenCalled()
  })
})
