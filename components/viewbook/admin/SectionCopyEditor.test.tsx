// @vitest-environment jsdom
// DOM-native assertions only — this repo has NO jest-dom.
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { SectionCopyEditor } from './SectionCopyEditor'

afterEach(cleanup)
beforeEach(() => { vi.restoreAllMocks() })

const initial = {
  brand: { purpose: 'P', whatThis: 'T', whatWeNeed: 'N' },
} as any

describe('SectionCopyEditor', () => {
  it('renders a section row with prefilled fields and PUTs on save', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SectionCopyEditor sectionKeys={['brand'] as any} initial={initial} />)
    const whatThis = screen.getByLabelText('What this is — brand') as HTMLTextAreaElement
    expect(whatThis.value).toBe('T')
    fireEvent.change(whatThis, { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', { name: /save brand/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/viewbooks/section-copy/brand')
    expect((opts as any).method).toBe('PUT')
  })

  it('Reset DELETEs the company-wide row and restores the code default field values', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    // initial here is a RESOLVED (company-wide) value that differs from the code default
    render(<SectionCopyEditor sectionKeys={['brand'] as any} initial={initial} />)
    fireEvent.click(screen.getByRole('button', { name: /reset brand to default/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/viewbooks/section-copy/brand')
    expect((opts as any).method).toBe('DELETE')
    // field now shows the code default (SECTION_COPY.brand.whatThis), not the resolved 'T'
    // — observed AFTER the awaited DELETE resolves, per the restored ordering.
    const whatThis = screen.getByLabelText('What this is — brand') as HTMLTextAreaElement
    await waitFor(() => expect(whatThis.value).not.toBe('T'))
  })

  it('on a genuine DELETE failure (non-not_found), does NOT reset the fields and shows an error', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: 'server_error' }), { status: 500 })
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<SectionCopyEditor sectionKeys={['brand'] as any} initial={initial} />)
    fireEvent.click(screen.getByRole('button', { name: /reset brand to default/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/viewbooks/section-copy/brand')
    expect((opts as any).method).toBe('DELETE')
    // fields must still show the resolved `initial` value — the DB row was
    // NOT deleted, so the UI must not lie about persisted state.
    await waitFor(() => expect(screen.getByText('Error: server_error')).toBeTruthy())
    const whatThis = screen.getByLabelText('What this is — brand') as HTMLTextAreaElement
    expect(whatThis.value).toBe('T')
  })
})
