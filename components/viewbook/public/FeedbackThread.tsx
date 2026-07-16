'use client'

import { FormEvent, useState } from 'react'

export interface PublicFeedbackItem {
  id: number
  body: string
  authorName: string | null
  authorKind: string
  resolvedAt: string | Date | null
  createdAt: string | Date
}

interface Props {
  token: string
  reviewLinkId: number
  initialFeedback?: PublicFeedbackItem[]
}

export function FeedbackThread({ token, reviewLinkId, initialFeedback = [] }: Props) {
  const [items, setItems] = useState(initialFeedback)
  const [body, setBody] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/viewbook/${encodeURIComponent(token)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewLinkId,
          body,
          authorName: authorName.trim() || null,
          clientMutationId: crypto.randomUUID(),
        }),
      })
      if (!response.ok) throw new Error('Could not send feedback. Please try again.')
      const payload = await response.json()
      setItems((current) => current.some((item) => item.id === payload.feedback.id)
        ? current : [...current, payload.feedback])
      setBody('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send feedback. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="space-y-4">
    <div className="space-y-2" aria-label="Feedback thread">
      {items.length === 0 && <p className="text-sm opacity-70">No feedback yet.</p>}
      {items.map((item) => <article key={item.id} className="rounded-lg border border-current/15 p-3">
        <div className="flex items-center justify-between gap-3 text-xs opacity-70">
          <span>{item.authorName ? `${item.authorName} (as reported)` : item.authorKind === 'client' ? 'Client' : 'Project team'}</span>
          {item.resolvedAt && <span aria-label="Resolved">✓ Resolved</span>}
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm">{item.body}</p>
      </article>)}
    </div>
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-medium">Feedback
        <textarea required value={body} onChange={(event) => setBody(event.target.value)}
          className="mt-1 min-h-24 w-full rounded-lg border border-current/20 bg-transparent p-3" />
      </label>
      <label className="block text-sm font-medium">Name (as reported)
        <input value={authorName} onChange={(event) => setAuthorName(event.target.value)} maxLength={120}
          className="mt-1 w-full rounded-lg border border-current/20 bg-transparent p-3" />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button disabled={busy || !body.trim()} className="rounded-lg bg-[var(--vb-primary)] px-4 py-2 text-sm font-semibold text-[var(--vb-on-primary)] disabled:opacity-50">
        {busy ? 'Sending…' : 'Send feedback'}
      </button>
    </form>
  </div>
}
