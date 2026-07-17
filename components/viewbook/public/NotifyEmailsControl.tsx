'use client'

// pc-setup notify-emails client island (PR5 Task 7, spec §5/§8): lets the
// client pick which already-known addresses (team members + the primary
// contact answer — the ONLY candidates the server allows, see
// lib/viewbook/notify-recipients.ts) get stage-change mail. PATCHes
// `/api/viewbook/[token]/setup` (lib/viewbook/setup.ts `setNotifyEmails`).
import { useEffect, useState } from 'react'
import { requestRefresh, useEditorActivity } from './useViewbookSync'

export interface NotifyCandidate {
  email: string
  label: string
}

const MAX_NOTIFY_EMAILS = 5

export function NotifyEmailsControl({
  token,
  candidates,
  initialSelected,
}: {
  token: string
  candidates: NotifyCandidate[]
  initialSelected: string[]
}) {
  // Reconciled against `candidates` on init AND whenever `candidates` changes
  // below — a previously-selected address (e.g. an edited primary-contact
  // answer, or a removed team member) can fall out of the candidate set with
  // no checkbox left to uncheck it. A stale selection must never reach save.
  const [selected, setSelected] = useState<string[]>(() =>
    initialSelected.filter((email) => candidates.some((c) => c.email === email)),
  )
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEditorActivity('notify-emails', busy || dirty)

  useEffect(() => {
    setSelected((prev) => prev.filter((email) => candidates.some((c) => c.email === email)))
  }, [candidates])

  function toggle(email: string) {
    setDirty(true)
    setSelected((prev) => {
      if (prev.includes(email)) return prev.filter((e) => e !== email)
      // Client-side mirror of the route's MAX_NOTIFY_EMAILS=5 cap — checkboxes
      // past the cap are also disabled below, this guard is defense in depth.
      if (prev.length >= MAX_NOTIFY_EMAILS) return prev
      return [...prev, email]
    })
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
        {candidates.map((c) => {
          const checked = selected.includes(c.email)
          const atCap = !checked && selected.length >= MAX_NOTIFY_EMAILS
          return (
            <label key={c.email} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(c.email)}
                disabled={busy || atCap}
              />
              {c.label} ({c.email})
            </label>
          )
        })}
      </div>
      {selected.length >= MAX_NOTIFY_EMAILS && (
        <p className="mt-1 text-xs text-black/50">Maximum {MAX_NOTIFY_EMAILS} recipients.</p>
      )}
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
