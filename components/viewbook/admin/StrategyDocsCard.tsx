'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PublicDocRow } from '@/lib/viewbook/public-types'

export function StrategyDocsCard({ viewbookId }: { viewbookId?: number }) {
  const [docs, setDocs] = useState<{ global: PublicDocRow[]; own: PublicDocRow[] }>({ global: [], own: [] })
  const [loaded, setLoaded] = useState(false)
  const [title, setTitle] = useState('')
  const [blurb, setBlurb] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const endpoint = viewbookId == null ? '/api/viewbook-docs' : `/api/viewbooks/${viewbookId}/docs`

  const load = useCallback(async () => {
    const res = await fetch(endpoint)
    const body = (await res.json().catch(() => ({}))) as {
      error?: string
      docs?: PublicDocRow[] | { global: PublicDocRow[]; own: PublicDocRow[] }
    }
    if (!res.ok) throw new Error(body.error || 'load_failed')
    if (Array.isArray(body.docs)) setDocs({ global: body.docs, own: [] })
    else setDocs(body.docs ?? { global: [], own: [] })
    setLoaded(true)
  }, [endpoint])

  useEffect(() => {
    void load().catch((err) => {
      setError(err instanceof Error ? err.message : 'load_failed')
      setLoaded(true)
    })
  }, [load])

  async function upload() {
    if (!file || !title.trim()) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('title', title.trim())
      if (blurb.trim()) form.set('blurb', blurb.trim())
      form.set('file', file)
      const res = await fetch(endpoint, { method: 'POST', body: form })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'upload_failed')
      setTitle('')
      setBlurb('')
      setFile(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload_failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove(doc: PublicDocRow, own: boolean) {
    if (!window.confirm(`Delete “${doc.title}”?`)) return
    setError(null)
    const url = own && viewbookId != null
      ? `/api/viewbooks/${viewbookId}/docs/${doc.id}`
      : `/api/viewbook-docs/${doc.id}`
    try {
      const res = await fetch(url, { method: 'DELETE' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'delete_failed')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete_failed')
    }
  }

  const empty = docs.global.length === 0 && docs.own.length === 0
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-navy-border dark:bg-navy-card">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80">Strategy PDFs</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-white/50">
        {viewbookId == null ? 'Global playbooks appear in every viewbook.' : 'Add PDFs specific to this viewbook.'}
      </p>
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <label className="text-xs text-gray-600 dark:text-white/60">
          PDF title
          <input
            aria-label="PDF title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-navy-border dark:bg-navy-card dark:text-white"
          />
        </label>
        <label className="text-xs text-gray-600 dark:text-white/60">
          Blurb (optional)
          <input
            value={blurb}
            onChange={(event) => setBlurb(event.target.value)}
            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-navy-border dark:bg-navy-card dark:text-white"
          />
        </label>
        <label className="text-xs text-gray-600 dark:text-white/60">
          PDF file
          <input
            aria-label="PDF file"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="mt-1 block max-w-56 text-xs"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={busy || !file || !title.trim()}
        onClick={() => void upload()}
        className="mt-3 rounded bg-teal-600 px-3 py-1 text-sm text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {busy ? 'Uploading…' : 'Upload PDF'}
      </button>

      {loaded && empty && <p className="mt-4 text-sm text-gray-400 dark:text-white/40">No strategy PDFs yet.</p>}
      {viewbookId != null && docs.global.length > 0 && (
        <DocList title="Global playbooks" docs={docs.global} />
      )}
      {docs.own.length > 0 && (
        <DocList title="This viewbook" docs={docs.own} onDelete={(doc) => void remove(doc, true)} />
      )}
      {viewbookId == null && docs.global.length > 0 && (
        <DocList title="Global playbooks" docs={docs.global} onDelete={(doc) => void remove(doc, false)} />
      )}
    </div>
  )
}

function DocList({
  title,
  docs,
  onDelete,
}: {
  title: string
  docs: PublicDocRow[]
  onDelete?: (doc: PublicDocRow) => void
}) {
  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-white/50">{title}</h3>
      <ul className="mt-2 divide-y divide-gray-100 rounded border border-gray-200 dark:divide-navy-border dark:border-navy-border">
        {docs.map((doc) => (
          <li key={doc.id} className="flex items-start justify-between gap-3 p-3 text-sm">
            <div>
              <p className="font-medium text-gray-800 dark:text-white/90">{doc.title}</p>
              {doc.blurb && <p className="mt-0.5 text-xs text-gray-500 dark:text-white/50">{doc.blurb}</p>}
            </div>
            {onDelete && (
              <button
                type="button"
                aria-label={`Delete ${doc.title}`}
                onClick={() => onDelete(doc)}
                className="text-xs text-red-600 underline dark:text-red-400"
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
