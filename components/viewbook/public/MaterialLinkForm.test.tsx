// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MaterialLinkForm } from './MaterialLinkForm'
import { __resetSyncRegistry, requestRefresh } from './useViewbookSync'

vi.mock('./useViewbookSync', async () => {
  const actual = await vi.importActual<typeof import('./useViewbookSync')>('./useViewbookSync')
  return { ...actual, requestRefresh: vi.fn() }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.mocked(requestRefresh).mockClear()
  __resetSyncRegistry()
})

describe('MaterialLinkForm', () => {
  it('submits label, https URL, optional reported name, and a mutation id', async () => {
    const onCreated = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ material: { id: 1, label: 'Logo', url: 'https://example.com/logo' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<MaterialLinkForm token="token-1" onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText('Link label'), { target: { value: 'Logo' } })
    fireEvent.change(screen.getByLabelText('HTTPS URL'), { target: { value: 'https://example.com/logo' } })
    fireEvent.change(screen.getByLabelText('Name (as reported)'), { target: { value: 'Alex' } })
    const submit = screen.getByRole('button', { name: 'Add link' })
    expect(submit.className).toContain('bg-[var(--vb-primary)]')
    expect(submit.className).toContain('text-[var(--vb-on-primary)]')
    expect(submit.className).not.toContain('--viewbook-primary')
    fireEvent.click(submit)
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
    expect(requestRefresh).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ label: 'Logo', url: 'https://example.com/logo', authorName: 'Alex' })
    expect(body.clientMutationId).toMatch(/^[0-9a-f-]{36}$/)
  })
})
