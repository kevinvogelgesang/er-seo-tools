'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import { useEditorActivity, useFocusWithin } from './useViewbookSync'
import { publicAssetUrl } from './ThemeStyle'
import { FeedbackScreenshots } from './FeedbackScreenshots'

export interface PublicFeedbackItem {
  id: number
  body: string
  authorName: string | null
  authorKind: string
  resolvedAt: string | Date | null
  createdAt: string | Date
  images?: string[]
}

interface Props {
  token: string
  reviewLinkId: number
  initialFeedback?: PublicFeedbackItem[]
}

const MAX_IMAGES = 3
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export function FeedbackThread({ token, reviewLinkId, initialFeedback = [] }: Props) {
  const [items, setItems] = useState(initialFeedback)
  const [body, setBody] = useState('')
  const [authorName, setAuthorName] = useState('')
  // Final-review fix (P1): the dirty check compares against the last
  // SUBMITTED name, not '' — previously only `body` cleared on a successful
  // submit, so a non-empty `authorName` left `dirty` true forever, silently
  // suppressing the shared refresher for the rest of the session.
  const [committedAuthorName, setCommittedAuthorName] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { focused, onFocus, onBlur } = useFocusWithin()

  // PR2 Task 6: registration ONLY — this island keeps its own optimistic
  // append and never calls requestRefresh(); it just suppresses the shared
  // refresher while the operator/client has unsent feedback drafted.
  const registryId = `feedback-${reviewLinkId}`
  const dirty = body.trim() !== '' || authorName.trim() !== committedAuthorName.trim() || files.length > 0
  useEditorActivity(registryId, focused || busy || dirty)

  // Final-review fix (P1): `items` used to be seeded ONCE from
  // `initialFeedback` and never resynced, so a comment from another session
  // (or an operator resolving one) that arrived via a background
  // router.refresh() never appeared here. Reconcile whenever the incoming
  // list's content actually changes (the key includes resolvedAt so a
  // resolve-only change is picked up too), keeping any LOCAL optimistic item
  // not yet reflected in the incoming list (this session's own
  // just-submitted item racing the refresh).
  const incomingKey = initialFeedback.map((item) => `${item.id}:${item.resolvedAt ?? ''}`).join('|')
  useEffect(() => {
    setItems((current) => {
      const incomingIds = new Set(initialFeedback.map((item) => item.id))
      const localOnly = current.filter((item) => !incomingIds.has(item.id))
      return [...initialFeedback, ...localOnly]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingKey])

  function pickFiles(list: FileList | null) {
    setError(null)
    if (!list) return
    const next = [...files, ...Array.from(list)].slice(0, MAX_IMAGES)
    const oversize = next.find((file) => file.size > MAX_IMAGE_BYTES)
    if (oversize) {
      setError(`"${oversize.name}" is over the 10 MB image limit.`)
      return
    }
    setFiles(next)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const endpoint = `/api/viewbook/${encodeURIComponent(token)}/feedback`
      const clientMutationId = crypto.randomUUID()
      let response: Response
      if (files.length > 0) {
        const form = new FormData()
        form.set('reviewLinkId', String(reviewLinkId))
        form.set('body', body)
        if (authorName.trim()) form.set('authorName', authorName.trim())
        form.set('clientMutationId', clientMutationId)
        for (const file of files) form.append('images', file)
        response = await fetch(endpoint, { method: 'POST', body: form })
      } else {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reviewLinkId,
            body,
            authorName: authorName.trim() || null,
            clientMutationId,
          }),
        })
      }
      if (!response.ok) throw new Error('Could not send feedback. Please try again.')
      const payload = await response.json()
      setItems((current) => current.some((item) => item.id === payload.feedback.id)
        ? current : [...current, payload.feedback])
      setBody('')
      setFiles([])
      setCommittedAuthorName(authorName)
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
          {/* ViewbookFeedback intentionally retains its pre-U1 two-value
              client/operator authorKind contract; authenticated members map
              to client here while their exact identity lives in activity. */}
          <span>{item.authorName ? `${item.authorName} (as reported)` : item.authorKind === 'client' ? 'Client' : 'Project team'}</span>
          {item.resolvedAt && <span aria-label="Resolved">✓ Resolved</span>}
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm">{item.body}</p>
        {(item.images?.length ?? 0) > 0 && (
          <FeedbackScreenshots
            filenames={item.images ?? []}
            hrefFor={(filename) => publicAssetUrl(token, filename)}
          />
        )}
      </article>)}
    </div>
    <form onSubmit={submit} onFocus={onFocus} onBlur={onBlur} className="space-y-3">
      <label className="block text-sm font-medium">Feedback
        <textarea required value={body} onChange={(event) => setBody(event.target.value)}
          className="mt-1 min-h-24 w-full rounded-lg border border-current/20 bg-transparent p-3" />
      </label>
      <label className="block text-sm font-medium">Name (as reported)
        <input value={authorName} onChange={(event) => setAuthorName(event.target.value)} maxLength={120}
          className="mt-1 w-full rounded-lg border border-current/20 bg-transparent p-3" />
      </label>
      <div className="space-y-2">
        <label className="block text-sm font-medium">
          Screenshots <span className="font-normal opacity-60">(optional, up to {MAX_IMAGES})</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            disabled={files.length >= MAX_IMAGES}
            onChange={(event) => pickFiles(event.target.files)}
            className="mt-1 block w-full text-xs opacity-80 file:mr-3 file:rounded-md file:border-0 file:bg-black/10 file:px-3 file:py-1.5 file:font-semibold disabled:opacity-40"
          />
        </label>
        {files.length > 0 && (
          <ul className="space-y-1 text-xs" aria-label="Screenshots to send">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 rounded border border-current/15 px-2 py-1">
                <span className="min-w-0 truncate">{file.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  className="shrink-0 font-semibold underline opacity-70 hover:opacity-100"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button disabled={busy || !body.trim()} className="rounded-lg bg-[var(--vb-primary)] px-4 py-2 text-sm font-semibold text-[var(--vb-on-primary)] disabled:opacity-50">
        {busy ? 'Sending…' : 'Send feedback'}
      </button>
    </form>
  </div>
}
