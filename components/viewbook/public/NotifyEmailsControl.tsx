'use client'

// pc-setup notify-emails client island (PR5 Task 7, spec §5/§8): lets the
// client pick which already-known addresses (team members + the primary
// contact answer — the ONLY candidates the server allows, see
// lib/viewbook/notify-recipients.ts) get stage-change mail. PATCHes
// `/api/viewbook/[token]/setup` (lib/viewbook/setup.ts `setNotifyEmails`).
import { useState } from 'react'
import { requestRefresh, useEditorActivity } from './useViewbookSync'

export interface NotifyCandidate {
  email: string
  label: string
}

export function NotifyEmailsControl({
  token,
  candidates,
  initialSelected,
}: {
  token: string
  candidates: NotifyCandidate[]
  initialSelected: string[]
}) {
  const [selected, setSelected] = useState<string[]>(initialSelected)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEditorActivity('notify-emails', busy || dirty)

  function toggle(email: string) {
    setDirty(true)
    setSelected((prev) => (prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]))
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/viewbook/${encodeURIComponent(token)}/setup`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifyEmails: selected, clientMutationId: crypto.randomUUID() }),
      })
      const body = (await res.json().catch(() => ({}))) as { notifyEmails?: string[]; error?: string }
      if (!res.ok) throw new Error(body.error || 'save_failed')
      setSelected(body.notifyEmails ?? selected)
      setDirty(false)
      requestRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-black/50">
        Add a team member or primary contact email above to choose who gets notified when your project moves forward.
      </p>
    )
  }

  return (
    <div>
      <p className="text-sm font-semibold text-black/60">
        Who should we email when your project moves to the next stage?
      </p>
      <div className="mt-2 space-y-1">
        {candidates.map((c) => (
          <label key={c.email} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(c.email)}
              onChange={() => toggle(c.email)}
              disabled={busy}
            />
            {c.label} ({c.email})
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy || !dirty}
        className="mt-2 rounded-full border border-black/15 px-4 py-1 text-sm font-semibold disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
      {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  )
}
