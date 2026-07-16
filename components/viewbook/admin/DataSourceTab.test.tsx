// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  it('adopts stale server truth instead of clobbering it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'stale_version', current: { value: 'Server answer', version: 3 } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<DataSourceTab viewbook={viewbook} onChanged={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Value for School name'), { target: { value: 'Overwrite' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save School name' }))
    await waitFor(() => expect((screen.getByLabelText('Value for School name') as HTMLInputElement).value).toBe('Server answer'))
    expect(screen.getByText('A newer answer was loaded.')).toBeTruthy()
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
    expect(screen.queryByRole('button', { name: 'Lock in' })).toBeNull()
  })
})
