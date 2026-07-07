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

  it('shows an inline error on a 400 and does not redirect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 400, ok: false, json: async () => ({ error: 'bad domain' }) }))
    render(<QuickSiteAuditWidget size="wide" />)
    fireEvent.change(screen.getByPlaceholderText(/example\.com/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    await waitFor(() => expect(screen.getByText(/bad domain/i)).toBeTruthy())
    expect(pushMock).not.toHaveBeenCalled()
  })
})
