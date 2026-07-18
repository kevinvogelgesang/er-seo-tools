// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DataSourceTab } from './DataSourceTab'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const viewbook = {
  id: 4,
  dataLockedAt: null,
  dataLockedBy: null,
  fields: [{
    id: 8,
    defKey: 'school-name',
    category: 'school',
    label: 'School name',
    fieldType: 'text',
    sortOrder: 1,
    value: 'Old',
    version: 1,
    valueUpdatedBy: 'client',
    valueUpdatedAt: null,
    archivedAt: null,
    createdAt: new Date(0).toISOString(),
    amendments: [],
  }],
}

describe('DataSourceTab', () => {
  it('keeps a stale draft and retries it against the current server version', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'stale_version', current: { value: 'Server answer', version: 3 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ field: { ...viewbook.fields[0], value: 'Overwrite', version: 4 } }),
      })
    vi.stubGlobal('fetch', fetchMock)
    render(<DataSourceTab viewbook={viewbook} onChanged={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Value for School name'), { target: { value: 'Overwrite' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save School name' }))
    await screen.findByText('Your draft was kept')
    expect((screen.getByLabelText('Value for School name') as HTMLInputElement).value).toBe('Overwrite')
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/viewbooks/4/fields/8', expect.objectContaining({
      body: JSON.stringify({ value: 'Overwrite', expectedVersion: 1 }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Retry saving School name' }))
    await waitFor(() => expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/viewbooks/4/fields/8', expect.objectContaining({
      body: JSON.stringify({ value: 'Overwrite', expectedVersion: 3 }),
    })))
    await screen.findByText('Saved')
  })

  it('confirms lock-in and hides the button after success', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        dataLockedAt: '2026-07-16T12:00:00.000Z', dataLockedBy: 'operator@example.com', alreadyLocked: false,
      }),
    }))
    render(<DataSourceTab viewbook={viewbook} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Lock in' }))
    await waitFor(() => expect(screen.getByText(/Locked by operator@example.com/)).toBeTruthy())
    expect(screen.getAllByText('Locked baseline').length).toBeGreaterThan(0)
    expect(screen.getByText(/Future baseline changes are recorded as amendments/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Lock in' })).toBeNull()
  })

  it('summarizes active work and moves archived fields into a disclosure', () => {
    const categorizedViewbook = {
      ...viewbook,
      fields: [
        viewbook.fields[0],
        {
          ...viewbook.fields[0],
          id: 9,
          defKey: 'program-name',
          category: 'programs',
          label: 'Program name',
          amendments: [{ id: 91, value: 'Updated program', author: 'ER', createdAt: '2026-07-16T12:00:00.000Z' }],
        },
        {
          ...viewbook.fields[0],
          id: 10,
          defKey: null,
          label: 'Old custom field',
          archivedAt: '2026-07-15T12:00:00.000Z',
        },
      ],
    }
    render(<DataSourceTab viewbook={categorizedViewbook} onChanged={vi.fn()} />)

    expect(screen.getByText('2 active fields')).toBeTruthy()
    expect(screen.getByText('2 categories')).toBeTruthy()
    expect(screen.getByText('1 amendment')).toBeTruthy()
    expect(within(screen.getByText('State').parentElement as HTMLElement).getByText('Open')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'School' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Programs' })).toBeTruthy()

    const archivedTrigger = screen.getByRole('button', { name: /Archived fields/ })
    expect(archivedTrigger.getAttribute('aria-expanded')).toBe('false')
    const archivedBody = document.getElementById(archivedTrigger.getAttribute('aria-controls') as string)
    expect(archivedBody?.hidden).toBe(true)
    fireEvent.click(archivedTrigger)
    expect(archivedBody?.hidden).toBe(false)
    expect(screen.getByText('Old custom field')).toBeTruthy()
  })

  it('presents a locked baseline with amendment history and preserves the amendment body', async () => {
    const lockedViewbook = {
      ...viewbook,
      dataLockedAt: '2026-07-16T12:00:00.000Z',
      dataLockedBy: 'operator@example.com',
      fields: [{
        ...viewbook.fields[0],
        amendments: [{ id: 11, value: 'Earlier amendment', author: 'ER', createdAt: '2026-07-16T13:00:00.000Z' }],
      }],
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ amendment: { id: 12, value: 'New amendment', author: 'ER', createdAt: '2026-07-16T14:00:00.000Z' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('crypto', { randomUUID: () => 'mutation-123' })
    render(<DataSourceTab viewbook={lockedViewbook} onChanged={vi.fn()} />)

    expect(screen.getByText('Locked baseline value')).toBeTruthy()
    expect(screen.getByText('Amendment draft')).toBeTruthy()
    expect(screen.getByText('Amendment history')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Operator amendment for School name'), { target: { value: 'New amendment' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record amendment' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/4/fields/8', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ mode: 'amend', value: 'New amendment', clientMutationId: 'mutation-123' }),
    })))
  })
})
