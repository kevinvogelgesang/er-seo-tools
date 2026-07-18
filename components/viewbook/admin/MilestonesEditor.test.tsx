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
  it('renders a description textarea for a milestone once its edit row is open, seeded from the milestone', () => {
    render(<MilestonesEditor viewbookId={12} milestones={[milestone]} onChanged={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const description = screen.getByLabelText('Description') as HTMLTextAreaElement
    expect(description.value).toBe('Longer detail for the launch milestone')
    expect(description.maxLength).toBe(2000)
  })

  it('includes the edited description in the milestone PATCH payload alongside title/blurb', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ milestone: { ...milestone, description: 'Updated detail' } }))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()
    render(<MilestonesEditor viewbookId={12} milestones={[milestone]} onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
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

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ description: null })
  })
})
