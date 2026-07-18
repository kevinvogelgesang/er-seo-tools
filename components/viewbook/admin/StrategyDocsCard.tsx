'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PublicDocRow } from '@/lib/viewbook/public-types'
import {
  ViewbookEditorStatus,
  editorDestructiveBtnClass,
  editorInputClass,
  editorLabelClass,
  editorPrimaryBtnClass,
  editorWellClass,
} from '@/components/viewbook/editor'

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
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-navy dark:text-white">Strategy PDFs</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-white/55">
            {viewbookId == null ? 'Global playbooks appear in every viewbook.' : 'Review inherited playbooks and add PDFs specific to this viewbook.'}
          </p>
        </div>
        <ViewbookEditorStatus state={error ? 'error' : busy ? 'saving' : 'idle'} message={error} />
      </div>

      <div className="mt-4 space-y-4">
        {loaded && empty && <p className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500 dark:border-navy-border dark:text-white/45">No strategy PDFs yet.</p>}
        {viewbookId != null && docs.global.length > 0 && (
          <DocList title="Global playbooks" docs={docs.global} source="Global" />
        )}
        {docs.own.length > 0 && (
          <DocList title="This viewbook" docs={docs.own} source="Viewbook" onDelete={(doc) => void remove(doc, true)} />
        )}
        {viewbookId == null && docs.global.length > 0 && (
          <DocList title="Global playbooks" docs={docs.global} source="Global" onDelete={(doc) => void remove(doc, false)} />
        )}
      </div>

      <div className={`mt-5 ${editorWellClass}`}>
        <div>
          <h3 className="font-display text-sm font-semibold text-navy dark:text-white">Upload a PDF</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-white/55">
            {viewbookId == null ? 'Add a global playbook for every viewbook.' : 'This file will appear only in this client’s viewbook.'}
          </p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className={editorLabelClass}>
            Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} className={`mt-1 ${editorInputClass}`} />
          </label>
          <label className={editorLabelClass}>
            Blurb
            <input value={blurb} onChange={(event) => setBlurb(event.target.value)} placeholder="Optional short description" className={`mt-1 ${editorInputClass}`} />
          </label>
          <label className={`sm:col-span-2 ${editorLabelClass}`}>
            File
            <span className="mt-1 flex min-h-11 items-center rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2 dark:border-navy-border dark:bg-navy-light">
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="block w-full text-xs text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:font-semibold file:text-navy hover:file:bg-gray-200 dark:text-white/60 dark:file:bg-white/10 dark:file:text-white dark:hover:file:bg-white/15"
              />
            </span>
          </label>
        </div>
        <button type="button" disabled={busy || !file || !title.trim()} onClick={() => void upload()} className={`mt-3 ${editorPrimaryBtnClass}`}>
          {busy ? 'Uploading…' : 'Upload PDF'}
        </button>
      </div>
    </section>
  )
}

function DocList({
  title,
  docs,
  source,
  onDelete,
}: {
  title: string
  docs: PublicDocRow[]
  source: 'Global' | 'Viewbook'
  onDelete?: (doc: PublicDocRow) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-white/50">{title}</h3>
        <span className="text-xs text-gray-400 dark:text-white/35">{docs.length} {docs.length === 1 ? 'file' : 'files'}</span>
      </div>
      <ul className="mt-2 space-y-2">
        {docs.map((doc) => (
          <li key={doc.id} className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50/70 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-navy-border dark:bg-navy-deep/35">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-navy dark:text-white/90">{doc.title}</p>
                <span data-document-source className="inline-flex rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-700 dark:bg-white/10 dark:text-white/65">{source}</span>
              </div>
              {doc.blurb && <p className="mt-1 text-xs text-gray-500 dark:text-white/50">{doc.blurb}</p>}
            </div>
            {onDelete && (
              <button type="button" aria-label={`Delete ${doc.title}`} onClick={() => onDelete(doc)} className={`shrink-0 ${editorDestructiveBtnClass}`}>Delete</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
