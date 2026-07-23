// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthLanding } from './AuthLanding'
import { FragmentScrubber } from './FragmentScrubber'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  window.history.replaceState(null, '', '/viewbook/tok')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AuthLanding', () => {
  it('renders the invitation-only email prompt and always shows the non-oracle sent state', async () => {
    render(<AuthLanding token="tok" />)
    expect(screen.getByText(/invitation-only/i)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'person@example.com' } })
    fireEvent.submit(screen.getByRole('button', { name: /send sign-in link/i }).closest('form')!)

    await screen.findByText('If this address was invited, a link is on its way.')
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbook/tok/auth/request', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'person@example.com' }),
    }))
  })

  it('holds a fragment grant in memory, scrubs the URL, and waits for an explicit Continue click', async () => {
    window.history.replaceState(null, '', '/viewbook/tok#g=abc')
    render(<AuthLanding token="tok" />)
    const button = await screen.findByRole('button', { name: 'Continue' })
    expect(window.location.hash).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(button)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/viewbook/tok/auth/consume', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ g: 'abc' }),
    })))
  })

  it('falls back to a fresh email request when consume rejects the link', async () => {
    window.history.replaceState(null, '', '/viewbook/tok#g=expired')
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 401 }))
    render(<AuthLanding token="tok" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('That link has expired — request a fresh one.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /send sign-in link/i })).toBeTruthy()
  })

  it('accepts no viewbook payload props beyond the opaque URL token', () => {
    expect(Object.keys(<AuthLanding token="tok" />.props)).toEqual(['token'])
  })
})

describe('FragmentScrubber', () => {
  it('removes an authenticated #g fragment without consuming it', async () => {
    window.history.replaceState(null, '', '/viewbook/tok#g=another')
    render(<FragmentScrubber />)
    await waitFor(() => expect(window.location.hash).toBe(''))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
