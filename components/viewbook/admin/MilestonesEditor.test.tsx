// @vitest-environment jsdom
//
// Task 4 (viewbook process-milestones UX pass): the admin milestone editor
// gained a `description` textarea alongside title/blurb/status/target-date,
// wired into the same explicit-Save PATCH the other edit-row fields already
// use (no autosave here — EditFields is an explicit-Save form).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MilestonesEditor } from './MilestonesEditor'
import { useEditorActivity } from '@/components/viewbook/public/useViewbookSync'

vi.mock('@/components/viewbook/public/useViewbookSync', async () => {
  const actual = await vi.importActual<typeof import('@/components/viewbook/public/useViewbookSync')>(
    '@/components/viewbook/public/useViewbookSync',
  )
  return { ...actual, useEditorActivity: vi.fn(actual.useEditorActivity) }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.mocked(useEditorActivity).mockClear()
})

function ok(body: unknown = { ok: true }) {
  return { ok: true, json: async () => body }
}

const milestone = {
  id: 4,
  title: 'Launch',
  blurb: 'Kickoff blurb',
  description: 'Longer detail for the launch milestone',
  sortOrder: 1,
  status: 'upcoming',
  targetDate: null,
}

describe('MilestonesEditor', () => {
  it('renders stacked milestone summaries with order, semantic status, due date, and secondary blurb', () => {
    const { container } = render(
      <MilestonesEditor
        viewbookId={12}
        milestones={[{ ...milestone, targetDate: '2026-08-15T00:00:00.000Z' }]}
        onChanged={vi.fn()}
      />,
    )

    expect(screen.getByText('Order 1')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Launch' })).toBeTruthy()
    expect(screen.getByText('Upcoming')).toBeTruthy()
    expect(screen.getByText('Kickoff blurb')).toBeTruthy()
    expect(screen.getByText(/Due/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit Launch' })).toBeTruthy()
    expect(container.innerHTML.includes('dark' + ':')).toBe(true)
  })

  it('renders a description textarea for a milestone once its edit row is open, seeded from the milestone', () => {
    render(<MilestonesEditor viewbookId={12} milestones={[milestone]} onChanged={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Launch' }))

    const description = screen.getByLabelText('Description') as HTMLTextAreaElement
    expect(description.value).toBe('Longer detail for the launch milestone')
    expect(description.maxLength).toBe(2000)
    expect(screen.getByLabelText('Title')).toBeTruthy()
    expect(screen.getByLabelText('Target date')).toBeTruthy()
    expect(screen.getByLabelText('Order')).toBeTruthy()
    expect((screen.getByLabelText('Status') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByRole('group', { name: 'Milestone edit actions' })).toBeTruthy()
  })

  it('includes the edited description in the milestone PATCH payload alongside title/blurb', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ milestone: { ...milestone, description: 'Updated detail' } }))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()
    render(<MilestonesEditor viewbookId={12} milestones={[milestone]} onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Launch' }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated detail' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/viewbooks/12/milestones/4')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      title: 'Launch',
      blurb: 'Kickoff blurb',
      description: 'Updated detail',
      sortOrder: 1,
      targetDate: null,
    })
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
  })

  it('sends null when the description is cleared out', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ milestone: { ...milestone, description: null } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<MilestonesEditor viewbookId={12} milestones={[milestone]} onChanged={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Launch' }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ description: null })
  })

  it('keeps creation explicit in its own row and preserves the POST body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ milestone: { ...milestone, id: 5, sortOrder: 2 } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<MilestonesEditor viewbookId={12} milestones={[milestone]} onChanged={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('New milestone title'), { target: { value: 'Build' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add milestone' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/viewbooks/12/milestones')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ title: 'Build', sortOrder: 2 })
  })

  it('preserves compact status-transition PATCH bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ milestone: { ...milestone, status: 'current' } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<MilestonesEditor viewbookId={12} milestones={[milestone]} onChanged={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Make current' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/viewbooks/12/milestones/4')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: 'current' })
  })

  it('requires confirmation before deleting and preserves the DELETE request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    const confirmMock = vi.fn(() => false)
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', confirmMock)
    render(<MilestonesEditor viewbookId={12} milestones={[milestone]} onChanged={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Launch' }))
    expect(confirmMock).toHaveBeenCalledWith('Delete “Launch”?')
    expect(fetchMock).not.toHaveBeenCalled()

    confirmMock.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Launch' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/12/milestones/4', { method: 'DELETE' })
  })

  it('renders a clear empty state without hiding the creation row', () => {
    render(<MilestonesEditor viewbookId={12} milestones={[]} onChanged={vi.fn()} />)

    expect(screen.getByText('No milestones yet')).toBeTruthy()
    expect(screen.getByLabelText('New milestone title')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add milestone' })).toBeTruthy()
  })
})
