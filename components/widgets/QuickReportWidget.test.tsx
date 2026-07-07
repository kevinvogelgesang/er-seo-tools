// components/widgets/QuickReportWidget.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))

import { QuickReportWidget } from './QuickReportWidget'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); pushMock.mockReset() })

function stubClientsThenReport(reportResponse: { status: number; body: any }) {
  vi.stubGlobal('fetch', vi.fn((url: string, opts?: any) => {
    if (url === '/api/clients' && (!opts || opts.method === undefined)) {
      return Promise.resolve({ ok: true, json: async () => [{ id: 1, name: 'Acme' }] })
    }
    if (url === '/api/reports') {
      return Promise.resolve({ ok: reportResponse.status < 400, status: reportResponse.status, json: async () => reportResponse.body })
    }
    return Promise.reject(new Error('unexpected ' + url))
  }))
}

describe('QuickReportWidget', () => {
  it('generates a report and redirects to /reports on 201', async () => {
    stubClientsThenReport({ status: 201, body: { batchId: 'b1', reportIds: ['r1'] } })
    render(<QuickReportWidget size="wide" />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Acme' })).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/client/i), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/reports'))
  })

  it('surfaces the ineligible-clients message on 422', async () => {
    stubClientsThenReport({ status: 422, body: { error: 'ineligible_clients', ineligibleClients: [{ id: 1, name: 'Acme', reason: 'no GA4' }] } })
    render(<QuickReportWidget size="wide" />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Acme' })).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/client/i), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))
    await waitFor(() => expect(screen.getByText(/no GA4|not eligible/i)).toBeTruthy())
    expect(pushMock).not.toHaveBeenCalled()
  })
})
