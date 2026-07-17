// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { KickoffNextButton, KickoffNextCta } from './KickoffNextButton'
import { PresentationModeProvider } from './PresentationToggle'
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

describe('KickoffNextButton', () => {
  it('confirms, posts the fenced forward move, and refreshes on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ stage: 'website-specifics' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('fetch', fetchMock)
    render(<KickoffNextButton viewbookId={42} />)
    fireEvent.click(screen.getByRole('button', { name: 'Move to Website Specifics' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/42/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'forward', expectedStage: 'kickoff' }),
    }))
    await waitFor(() => expect(requestRefresh).toHaveBeenCalledOnce())
  })
})

// FIX 2 (Codex PR8 review): during a screen-share the operator-only "Move to
// Website Specifics" mutation CTA must hide — the client should see the
// anonymous "Questions?" outro instead.
describe('KickoffNextCta presentation-awareness', () => {
  it('shows the anonymous outro (not the operator CTA) when presentation mode is ON', async () => {
    let value = 'true'
    vi.stubGlobal('localStorage', {
      getItem: () => value,
      setItem: (_key: string, next: string) => { value = next },
    })
    render(
      <PresentationModeProvider>
        <KickoffNextCta viewbookId={9} csmName="Dana" />
      </PresentationModeProvider>,
    )
    expect(await screen.findByText('Questions?')).toBeTruthy()
    expect(screen.getByText('Reach out to Dana, your primary contact.')).toBeTruthy()
    expect(screen.queryByText('Ready for the next step?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Move to Website Specifics' })).toBeNull()
  })

  it('renders the operator CTA when NOT presenting', async () => {
    let value: string | null = null
    vi.stubGlobal('localStorage', {
      getItem: () => value,
      setItem: (_key: string, next: string) => { value = next },
    })
    render(
      <PresentationModeProvider>
        <KickoffNextCta viewbookId={9} csmName="Dana" />
      </PresentationModeProvider>,
    )
    expect(await screen.findByRole('button', { name: 'Move to Website Specifics' })).toBeTruthy()
    expect(screen.getByText('Ready for the next step?')).toBeTruthy()
  })

  it('renders without throwing with NO PresentationModeProvider (anonymous branch safe default)', () => {
    // usePresentationMode must return a safe default (presenting:false) outside
    // a provider — the anonymous public tree renders kickoff content with no
    // operator layer, so a throw here would crash the public page.
    expect(() => render(<KickoffNextCta viewbookId={9} csmName={null} />)).not.toThrow()
    expect(screen.getByRole('button', { name: 'Move to Website Specifics' })).toBeTruthy()
  })
})
