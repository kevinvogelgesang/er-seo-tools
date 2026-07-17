'use client'

// pc-invite client islands (PR5 Task 7, spec §8): the add-teammate form and
// the per-member resend button, both POSTing
// `/api/viewbook/[token]/team-members` (lib/viewbook/team-members.ts —
// `addTeamMember`/`resendInvite`, mode-dispatched). Mirrors
// MaterialLinkForm.tsx's shape (useFocusWithin + useEditorActivity while
// dirty/focused/busy) and KickoffNextButton's fetch+requestRefresh pattern.
import { FormEvent, useId, useState } from 'react'
import { requestRefresh, useEditorActivity, useFocusWithin } from './useViewbookSync'

export function TeamInviteForm({ token, disabled }: { token: string; disabled: boolean }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { focused, onFocus, onBlur } = useFocusWithin()
  const instanceId = useId()

  const registryId = `team-invite-form-${instanceId}`
  const dirty = name.trim() !== '' || email.trim() !== ''
  useEditorActivity(registryId, focused || busy || dirty)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/viewbook/${encodeURIComponent(token)}/team-members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'create', name, email, clientMutationId: crypto.randomUUID() }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Could not add this teammate. Please try again.')
      setName('')
      setEmail('')
      requestRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this teammate. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (disabled) {
    return <p className="text-sm text-black/50">You&rsquo;ve reached the 15-person invite limit.</p>
  }

  return (
    <form onSubmit={submit} onFocus={onFocus} onBlur={onBlur} className="space-y-3">
      <label className="block text-sm font-medium">Name
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 w-full rounded-lg border border-black/15 bg-white p-3 text-black disabled:opacity-60"
          disabled={busy}
        />
      </label>
      <label className="block text-sm font-medium">Email
        <input
          required
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 w-full rounded-lg border border-black/15 bg-white p-3 text-black disabled:opacity-60"
          disabled={busy}
        />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button
        disabled={busy || !name.trim() || !email.trim()}
        className="rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60"
        style={{ background: 'var(--vb-primary)', color: 'var(--vb-on-primary)' }}
      >
        {busy ? 'Adding…' : 'Invite teammate'}
      </button>
    </form>
  )
}

export function ResendInviteButton({ token, memberId }: { token: string; memberId: number }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEditorActivity(`resend-invite-${memberId}`, busy)

  async function resend() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/viewbook/${encodeURIComponent(token)}/team-members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'resend', memberId }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'resend_failed')
      setMessage('Invite resent')
      requestRefresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'resend_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void resend()}
        disabled={busy}
        className="rounded-full border border-black/15 px-3 py-1 text-xs font-semibold disabled:opacity-60"
      >
        {busy ? 'Sending…' : 'Resend invite'}
      </button>
      {message && <p className="mt-1 text-xs text-black/50">{message}</p>}
    </div>
  )
}
