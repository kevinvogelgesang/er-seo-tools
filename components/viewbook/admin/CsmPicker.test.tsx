// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CsmPicker } from './CsmPicker'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const roster = [
  { name: 'Casey CSM', role: 'CSM', photo: null, blurb: '', isCsm: true, email: 'casey@example.com' },
  { name: 'Dana Designer', role: 'Designer', photo: null, blurb: '' },
]

describe('CsmPicker', () => {
  it('shows only flagged roster members and PATCHes the assignment', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/viewbook-content/team') return jsonResponse({ content: roster })
      if (String(input) === '/api/viewbooks/42/csm' && init?.method === 'PATCH') return jsonResponse({ ok: true })
      throw new Error(`unexpected fetch ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()
    render(<CsmPicker viewbookId={42} csmName={null} onChanged={onChanged} />)
    const select = await screen.findByRole('combobox', { name: 'Assigned CSM' })
    expect(screen.queryByRole('option', { name: 'Dana Designer' })).toBeNull()
    fireEvent.change(select, { target: { value: 'Casey CSM' } })
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/42/csm', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ csmName: 'Casey CSM' }),
    }))
  })

  it('keeps a dangling csmName clearable: renders it as a distinct selected option, and selecting Unassigned PATCHes null', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/viewbook-content/team') return jsonResponse({ content: roster })
      if (String(input) === '/api/viewbooks/42/csm' && init?.method === 'PATCH') return jsonResponse({ ok: true })
      throw new Error(`unexpected fetch ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()
    render(<CsmPicker viewbookId={42} csmName="Former CSM" onChanged={onChanged} />)

    const select = (await screen.findByRole('combobox', { name: 'Assigned CSM' })) as HTMLSelectElement
    await screen.findByRole('option', { name: 'Casey CSM' })
    await waitFor(() => expect(select.value).toBe('Former CSM'))
    expect(select.selectedOptions).toHaveLength(1)
    expect(select.selectedOptions[0].textContent).toBe('Former CSM — no longer a CSM')

    fireEvent.change(select, { target: { value: '' } })
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/42/csm', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ csmName: null }),
    }))
  })

  it('surfaces PATCH errors', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/viewbook-content/team') return jsonResponse({ content: roster })
      if (String(input) === '/api/viewbooks/42/csm') return jsonResponse({ error: 'invalid_csm' }, 400)
      throw new Error(`unexpected fetch ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<CsmPicker viewbookId={42} csmName={null} onChanged={vi.fn()} />)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Assigned CSM' }), { target: { value: 'Casey CSM' } })
    expect(await screen.findByText('invalid_csm')).toBeDefined()
  })
})
