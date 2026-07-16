// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FeedbackThread } from './FeedbackThread'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('FeedbackThread', () => {
  it('renders summaries as text and submits a generated mutation id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ feedback: { id: 2, body: '<b>new</b>', authorName: 'Alex', authorKind: 'client', resolvedAt: null, createdAt: new Date().toISOString() } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<FeedbackThread token="token-1" reviewLinkId={7} initialFeedback={[{
      id: 1, body: '<script>alert(1)</script>', authorName: null, authorKind: 'client', resolvedAt: null, createdAt: new Date(),
    }]} />)
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Feedback'), { target: { value: 'Please revise' } })
    fireEvent.change(screen.getByLabelText('Name (as reported)'), { target: { value: 'Alex' } })
    const submit = screen.getByRole('button', { name: 'Send feedback' })
    expect(submit.className).toContain('bg-[var(--vb-primary)]')
    expect(submit.className).toContain('text-[var(--vb-on-primary)]')
    expect(submit.className).not.toContain('--viewbook-primary')
    fireEvent.click(submit)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const init = fetchMock.mock.calls[0][1]
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ reviewLinkId: 7, body: 'Please revise', authorName: 'Alex' })
    expect(body.clientMutationId).toMatch(/^[0-9a-f-]{36}$/)
  })
})
