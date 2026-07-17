// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PublicField } from '@/lib/viewbook/public-types'
import { FieldEditor } from './FieldEditor'
import { __resetSyncRegistry, requestRefresh } from './useViewbookSync'

vi.mock('./useViewbookSync', async () => {
  const actual = await vi.importActual<typeof import('./useViewbookSync')>('./useViewbookSync')
  return { ...actual, requestRefresh: vi.fn() }
})

afterEach(() => {
  cleanup()
  vi.mocked(requestRefresh).mockClear()
  __resetSyncRegistry()
  vi.unstubAllGlobals()
})

const field: PublicField = {
  id: 7,
  label: 'School name',
  fieldType: 'text',
  value: 'Old answer',
  version: 2,
  createdAt: new Date(0).toISOString(),
  valueUpdatedBy: 'client',
  valueUpdatedAt: null,
  isCustom: false,
  amendments: [],
}

describe('FieldEditor', () => {
  it('turns a data_locked autosave race into an explicit amendment flow', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'data_locked', current: { value: 'Server truth', version: 3 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ amendment: { id: 9 } }),
      })
    vi.stubGlobal('fetch', fetchMock)
    render(<FieldEditor token="tok" field={field} />)

    const answer = screen.getByLabelText('Answer for School name')
    fireEvent.change(answer, { target: { value: 'Racing edit' } })
    fireEvent.blur(answer)
    await waitFor(() => expect(screen.getByText('These answers were just locked in.')).toBeTruthy())
    expect(screen.getByText('Server truth')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Proposed change for School name'), {
      target: { value: 'Please use this instead' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Propose change' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const amendment = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(amendment).toMatchObject({ mode: 'amend', fieldId: 7, value: 'Please use this instead' })
    expect(amendment.clientMutationId).toMatch(/^[0-9a-f-]{36}$/)
    await waitFor(() => expect(requestRefresh).toHaveBeenCalledOnce())
  })

  it('adopts stale current truth and uses its version on the next blur', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'stale_version', current: { value: 'New server answer', version: 5 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ field: { id: 7, value: 'Second edit', version: 6, valueUpdatedBy: 'client', valueUpdatedAt: null } }),
      })
    vi.stubGlobal('fetch', fetchMock)
    render(<FieldEditor token="tok" field={field} />)
    const answer = screen.getByLabelText('Answer for School name')
    fireEvent.change(answer, { target: { value: 'First edit' } })
    fireEvent.blur(answer)
    await waitFor(() => expect((answer as HTMLInputElement).value).toBe('New server answer'))
    fireEvent.change(answer, { target: { value: 'Second edit' } })
    fireEvent.blur(answer)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).expectedVersion).toBe(5)
    await waitFor(() => expect(requestRefresh).toHaveBeenCalledOnce())
  })

  // Final-review fix (P1): `current`/`draft` used to be seeded ONCE from the
  // `field` prop, so a router.refresh() bringing a genuinely newer server
  // value (another session's edit) never reached this island. Reconciles
  // while idle (not focused, not mid-save, draft untouched).
  it('adopts a newer field prop from a background refresh while idle', async () => {
    const { rerender } = render(<FieldEditor token="tok" field={field} />)
    const answer = screen.getByLabelText('Answer for School name') as HTMLInputElement
    expect(answer.value).toBe('Old answer')

    rerender(<FieldEditor token="tok" field={{ ...field, value: 'Someone else edited this', version: 3 }} />)

    await waitFor(() => expect(answer.value).toBe('Someone else edited this'))
  })

  it('does NOT clobber a focused, unsaved draft with a background refresh', async () => {
    const { rerender } = render(<FieldEditor token="tok" field={field} />)
    const answer = screen.getByLabelText('Answer for School name') as HTMLInputElement
    fireEvent.focus(answer)
    fireEvent.change(answer, { target: { value: 'My in-progress edit' } })

    rerender(<FieldEditor token="tok" field={{ ...field, value: 'Someone else edited this', version: 3 }} />)

    expect(answer.value).toBe('My in-progress edit')
  })
})
