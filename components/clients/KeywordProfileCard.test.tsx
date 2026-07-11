// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { KeywordProfileCard } from './KeywordProfileCard'

const emptyProfile = { institutionType: null, programs: [], suggestions: null, locale: null, hasLiveScan: false }
const scannedProfile = { ...emptyProfile, hasLiveScan: true }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const mockFetch = (impl: (url: string, init?: RequestInit) => { status: number; body: unknown }) => {
  ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init?: RequestInit) => {
    const { status, body } = impl(String(url), init)
    return new Response(JSON.stringify(body), { status })
  })
}

describe('KeywordProfileCard', () => {
  it('renders empty states', () => {
    render(<KeywordProfileCard clientId={1} initialProfile={emptyProfile} archived={false} />)
    expect(screen.getByText('Keyword Profile')).toBeTruthy()
    expect(screen.getByText(/No programs yet/i)).toBeTruthy()
  })

  it('renders roster entries and suggestions with evidence chips', () => {
    render(<KeywordProfileCard clientId={1} archived={false} initialProfile={{
      institutionType: 'trade',
      programs: [{ name: 'Dental Assisting', confirmed: true, source: 'suggested' }],
      suggestions: {
        v: 1, derivedFromRunId: 'r', derivedAt: '2026-07-10T00:00:00Z',
        suggestions: [{ name: 'Cosmetology', evidence: ['slug', 'schema'] }], dismissedNames: [],
      },
      locale: { locationCode: 2840, languageCode: 'en', marketLabel: 'United States — English' },
      hasLiveScan: true,
    }} />)
    expect(screen.getByText('Dental Assisting')).toBeTruthy()
    expect(screen.getByText('Cosmetology')).toBeTruthy()
    expect(screen.getByText('slug')).toBeTruthy()
    expect(screen.getByText('schema')).toBeTruthy()
  })

  it('suggest button is INITIALLY disabled with a hint when hasLiveScan is false (plan-Codex #6)', () => {
    render(<KeywordProfileCard clientId={1} initialProfile={emptyProfile} archived={false} />)
    const btn = screen.getByRole('button', { name: /suggest from latest scan/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(screen.getByText(/run a site seo scan first/i)).toBeTruthy()
  })

  it('confirm sends the EXACT op payload then refetches the profile', async () => {
    const calls: { method: string; url: string; body?: unknown }[] = []
    mockFetch((url, init) => {
      calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (init?.method === 'PATCH') return { status: 200, body: scannedProfile }
      return { status: 200, body: { ...scannedProfile, programs: [{ name: 'Cosmetology', confirmed: true }] } }
    })
    render(<KeywordProfileCard clientId={7} archived={false} initialProfile={{
      ...scannedProfile,
      suggestions: {
        v: 1, derivedFromRunId: 'r', derivedAt: '2026-07-10T00:00:00Z',
        suggestions: [{ name: 'Cosmetology', evidence: ['slug'] }], dismissedNames: [],
      },
    }} />)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH')
      expect(patch?.url).toContain('/api/clients/7/keyword-profile')
      expect(patch?.body).toEqual({ confirmSuggestion: 'Cosmetology' })
      expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1)
    })
    expect(await screen.findByText('Cosmetology')).toBeTruthy()
  })

  it('dismiss, roster remove, and locale select send their exact payloads', async () => {
    const bodies: unknown[] = []
    // Stateful mock server: PATCH applies the received ops to a mutable
    // serverProfile and GET returns its CURRENT state, mirroring the real
    // route. The component's full-profile refetch-and-replace (the spec's
    // LWW posture) then keeps the untouched roster row visible for the
    // subsequent Remove click — a fixed GET body would contradict what a
    // real server returns mid-sequence.
    const serverProfile = {
      ...scannedProfile,
      programs: [{ name: 'Old Prog', confirmed: true }] as unknown,
      suggestions: {
        v: 1, derivedFromRunId: 'r', derivedAt: '2026-07-10T00:00:00Z',
        suggestions: [{ name: 'Cosmetology', evidence: ['slug'] }], dismissedNames: [] as string[],
      } as { suggestions: { name: string }[]; dismissedNames: string[] } | null,
      locale: null as unknown,
    }
    mockFetch((url, init) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        bodies.push(body)
        if (typeof body.dismissSuggestion === 'string' && serverProfile.suggestions) {
          serverProfile.suggestions = {
            ...serverProfile.suggestions,
            suggestions: serverProfile.suggestions.suggestions.filter((s) => s.name !== body.dismissSuggestion),
            dismissedNames: [...serverProfile.suggestions.dismissedNames, body.dismissSuggestion.toLowerCase()],
          }
        }
        if ('programs' in body) serverProfile.programs = body.programs
        if ('locale' in body) serverProfile.locale = body.locale
      }
      return { status: 200, body: serverProfile }
    })
    render(<KeywordProfileCard clientId={7} archived={false}
      initialProfile={JSON.parse(JSON.stringify(serverProfile))} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    await waitFor(() => expect(bodies).toContainEqual({ dismissSuggestion: 'Cosmetology' }))
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    await waitFor(() => expect(bodies).toContainEqual({ programs: [] }))
    fireEvent.change(screen.getByLabelText(/keyword locale/i), { target: { value: '2124:fr' } })
    await waitFor(() => expect(bodies).toContainEqual({
      locale: { locationCode: 2124, languageCode: 'fr', marketLabel: 'Canada — French' },
    }))
  })

  it('surfaces the 409 no_live_scan_run hint after a failed suggest (stale hasLiveScan)', async () => {
    mockFetch(() => ({ status: 409, body: { error: 'no_live_scan_run' } }))
    render(<KeywordProfileCard clientId={1} initialProfile={scannedProfile} archived={false} />)
    fireEvent.click(screen.getByRole('button', { name: /suggest from latest scan/i }))
    expect(await screen.findByText(/no completed site seo scan/i)).toBeTruthy()
  })

  it('disables all controls when archived', () => {
    render(<KeywordProfileCard clientId={1} initialProfile={emptyProfile} archived={true} />)
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true)
  })
})
