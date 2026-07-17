// @vitest-environment jsdom
//
// Codex PR5 fix-wave findings 2+3: `initialSelected` can carry an address no
// longer in `candidates` (e.g. an edited primary-contact answer) with no
// checkbox left to remove it, so a save would submit the stale value and hit
// the route's 400 invalid_notify_recipient; and `toggle` let a user check a
// 6th candidate even though the route caps at 5. Covers both: the stale
// selection is reconciled away (never submitted) and a 6th checkbox is
// disabled once 5 are selected.
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NotifyEmailsControl, type NotifyCandidate } from './NotifyEmailsControl'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const CANDIDATES: NotifyCandidate[] = [
  { email: 'member@example.com', label: 'Member' },
  { email: 'primary@example.com', label: 'Primary contact' },
]

describe('NotifyEmailsControl', () => {
  it('drops a stale initialSelected address not present in candidates, and never submits it', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ notifyEmails: ['member@example.com'] }) })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <NotifyEmailsControl
        token="t"
        candidates={CANDIDATES}
        initialSelected={['member@example.com', 'stale@example.com']}
      />,
    )

    const memberCheckbox = screen.getByRole('checkbox', { name: /Member \(member@example.com\)/ }) as HTMLInputElement
    expect(memberCheckbox.checked).toBe(true)
    // No checkbox renders for the stale address — it fell out of candidates.
    expect(screen.queryByText(/stale@example\.com/)).toBeNull()

    // Toggling the still-valid candidate off and back on dirties the form so
    // Save is enabled, then verify the posted body excludes the stale email.
    fireEvent.click(memberCheckbox)
    fireEvent.click(memberCheckbox)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string) as { notifyEmails: string[] }
    expect(body.notifyEmails).toEqual(['member@example.com'])
  })

  it('disables an unchecked checkbox once 5 are already selected (route caps at 5)', () => {
    const sixCandidates: NotifyCandidate[] = [
      { email: 'a@example.com', label: 'A' },
      { email: 'b@example.com', label: 'B' },
      { email: 'c@example.com', label: 'C' },
      { email: 'd@example.com', label: 'D' },
      { email: 'e@example.com', label: 'E' },
      { email: 'f@example.com', label: 'F' },
    ]
    const fiveSelected = sixCandidates.slice(0, 5).map((c) => c.email)

    render(<NotifyEmailsControl token="t" candidates={sixCandidates} initialSelected={fiveSelected} />)

    const sixthCheckbox = screen.getByRole('checkbox', { name: /F \(f@example\.com\)/ }) as HTMLInputElement
    expect(sixthCheckbox.disabled).toBe(true)
    expect(sixthCheckbox.checked).toBe(false)

    // Clicking a disabled checkbox is a no-op in the DOM — selection state
    // (mirrored by the already-checked boxes staying checked) is unaffected.
    fireEvent.click(sixthCheckbox)
    expect(sixthCheckbox.checked).toBe(false)

    const firstCheckbox = screen.getByRole('checkbox', { name: /A \(a@example\.com\)/ }) as HTMLInputElement
    expect(firstCheckbox.checked).toBe(true)
    expect(firstCheckbox.disabled).toBe(false) // already-checked boxes stay togglable (uncheck is always allowed)

    expect(screen.getByText(/Maximum 5 recipients/)).toBeDefined()
  })
})
