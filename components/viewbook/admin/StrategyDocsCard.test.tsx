// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrategyDocsCard } from './StrategyDocsCard'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const globalDoc = { id: 1, title: 'Global playbook', blurb: 'For everyone', filename: 'global.pdf', sortOrder: 1 }
const ownDoc = { id: 2, title: 'Client extra', blurb: 'For Acme', filename: 'own.pdf', sortOrder: 1 }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('StrategyDocsCard', () => {
  it('renders global and own scopes in the per-viewbook card', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ docs: { global: [globalDoc], own: [ownDoc] } })))
    render(<StrategyDocsCard viewbookId={42} />)
    expect(await screen.findByText('Global playbook')).toBeDefined()
    expect(screen.getByText('Client extra')).toBeDefined()
    expect(screen.getByText('Global playbooks')).toBeDefined()
    expect(screen.getByText('This viewbook')).toBeDefined()
    expect(screen.getByText('Global', { selector: '[data-document-source]' })).toBeDefined()
    expect(screen.getByText('Viewbook', { selector: '[data-document-source]' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Upload a PDF' })).toBeDefined()
  })

  it('surfaces an upload API error in the card', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ docs: [] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'payload_too_large' }, 413))
    vi.stubGlobal('fetch', fetchMock)
    render(<StrategyDocsCard />)
    await screen.findByText('No strategy PDFs yet.')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Big guide' } })
    fireEvent.change(screen.getByLabelText('File'), {
      target: { files: [new File(['%PDF-test'], 'big.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload PDF' }))
    expect(await screen.findByText('payload_too_large')).toBeDefined()
  })

  it('uploads the unchanged multipart fields and reloads the list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ docs: [] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ docs: [{ ...globalDoc, title: 'New guide' }] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<StrategyDocsCard />)
    await screen.findByText('No strategy PDFs yet.')
    const file = new File(['%PDF-test'], 'guide.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: ' New guide ' } })
    fireEvent.change(screen.getByLabelText('Blurb'), { target: { value: ' Short summary ' } })
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload PDF' }))

    await screen.findByText('New guide')
    const uploadCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(uploadCall?.[0]).toBe('/api/viewbook-docs')
    const body = uploadCall?.[1]?.body as FormData
    expect(body.get('title')).toBe('New guide')
    expect(body.get('blurb')).toBe('Short summary')
    expect(body.get('file')).toBe(file)
  })

  it('confirms and deletes an owned document, then reloads the list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ docs: { global: [globalDoc], own: [ownDoc] } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ docs: { global: [globalDoc], own: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(<StrategyDocsCard viewbookId={42} />)
    await screen.findByText('Client extra')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Client extra' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/viewbooks/42/docs/2',
      { method: 'DELETE' },
    ))
    await waitFor(() => expect(screen.queryByText('Client extra')).toBeNull())
  })
})
