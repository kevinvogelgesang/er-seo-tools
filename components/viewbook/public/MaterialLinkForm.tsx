'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'

interface MaterialLink {
  id: number
  label: string
  url: string | null
}

interface Props {
  token: string
  onCreated?: (material: MaterialLink) => void
}

export function MaterialLinkForm({ token, onCreated }: Props) {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/viewbook/${encodeURIComponent(token)}/materials`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, url, authorName: authorName.trim() || null, clientMutationId: crypto.randomUUID() }),
      })
      if (!response.ok) throw new Error('Could not add this link. Please try again.')
      const payload = await response.json()
      onCreated?.(payload.material)
      setLabel('')
      setUrl('')
      setAuthorName('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this link. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return <form onSubmit={submit} className="space-y-3">
    <label className="block text-sm font-medium">Link label
      <input required value={label} onChange={(event) => setLabel(event.target.value)}
        className="mt-1 w-full rounded-lg border border-current/20 bg-transparent p-3" />
    </label>
    <label className="block text-sm font-medium">HTTPS URL
      <input required type="url" pattern="https://.*" value={url} onChange={(event) => setUrl(event.target.value)}
        className="mt-1 w-full rounded-lg border border-current/20 bg-transparent p-3" />
    </label>
    <label className="block text-sm font-medium">Name (as reported)
      <input value={authorName} onChange={(event) => setAuthorName(event.target.value)} maxLength={120}
        className="mt-1 w-full rounded-lg border border-current/20 bg-transparent p-3" />
    </label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <button disabled={busy || !label.trim() || !url.trim()} className="rounded-lg bg-[var(--vb-primary)] px-4 py-2 text-sm font-semibold text-[var(--vb-on-primary)] disabled:opacity-50">
      {busy ? 'Adding…' : 'Add link'}
    </button>
  </form>
}
