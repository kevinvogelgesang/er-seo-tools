// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CsmPicker, GlobalContentEditor } from './GlobalContentEditor'

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

describe('GlobalContentEditor roster CSM fields', () => {
  it('identifies global impact and renders responsive team section cards', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/viewbook-docs') return jsonResponse({ docs: [] })
      if (url === '/api/viewbook-content/team') return jsonResponse({ content: roster })
      if (url === '/api/viewbook-content/pc-intro') return jsonResponse({ content: '' })
      if (url.startsWith('/api/viewbook-content/')) return jsonResponse({ content: { blocks: [] } })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<GlobalContentEditor />)

    expect(await screen.findByText('Affects every viewbook')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Meet the team' })).toBeTruthy()
    const member = container.querySelector('[data-team-member]') as HTMLElement
    expect(member).not.toBeNull()
    expect(member.className).toContain('sm:grid-cols-')
    expect(screen.getByRole('heading', { name: 'Post-contract welcome' })).toBeTruthy()
  })

  it('renders email/isCsm controls and canonicalizes the roster payload before saving', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/viewbook-docs') return jsonResponse({ docs: [] })
      if (url === '/api/viewbook-content/team' && init?.method === 'PUT') return jsonResponse({ ok: true })
      if (url === '/api/viewbook-content/team') return jsonResponse({ content: roster })
      if (url.startsWith('/api/viewbook-content/')) return jsonResponse({ content: { blocks: [] } })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<GlobalContentEditor />)

    const email = await screen.findByDisplayValue('casey@example.com')
    expect((screen.getByRole('checkbox', { name: 'CSM Casey CSM' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.change(email, { target: { value: ' CASEY@EXAMPLE.COM ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save roster' }))

    await waitFor(() => {
      const save = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/viewbook-content/team' && init?.method === 'PUT')
      expect(save).toBeDefined()
      const body = JSON.parse(String(save?.[1]?.body))
      expect(body.content[0]).toMatchObject({ email: 'casey@example.com', isCsm: true })
    })
  })

  it('surfaces invalid mailbox errors without sending a roster write', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/viewbook-docs') return jsonResponse({ docs: [] })
      if (url === '/api/viewbook-content/team') return jsonResponse({ content: roster })
      if (url.startsWith('/api/viewbook-content/')) return jsonResponse({ content: { blocks: [] } })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<GlobalContentEditor />)
    fireEvent.change(await screen.findByDisplayValue('casey@example.com'), { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save roster' }))
    expect(await screen.findByText('invalid_email')).toBeDefined()
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/viewbook-content/team' && init?.method === 'PUT')).toBe(false)
  })

  it('saves post-contract welcome content with the unchanged PUT body', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/viewbook-docs') return jsonResponse({ docs: [] })
      if (url === '/api/viewbook-content/pc-intro' && init?.method === 'PUT') return jsonResponse({ ok: true })
      if (url === '/api/viewbook-content/team') return jsonResponse({ content: roster })
      if (url === '/api/viewbook-content/pc-intro') return jsonResponse({ content: 'Original welcome' })
      if (url.startsWith('/api/viewbook-content/')) return jsonResponse({ content: { blocks: [] } })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<GlobalContentEditor />)

    const textarea = await screen.findByLabelText('Post-contract welcome')
    fireEvent.change(textarea, { target: { value: 'Updated welcome' } })
    const card = within(screen.getByRole('heading', { name: 'Post-contract welcome' }).closest('section') as HTMLElement)
    fireEvent.click(card.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/viewbook-content/pc-intro', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Updated welcome' }),
    }))
  })
})

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
