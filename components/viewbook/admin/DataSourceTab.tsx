'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { CATALOG_CATEGORIES } from '@/lib/viewbook/catalog'
import { useEditorActivity, useFocusWithin } from '@/components/viewbook/public/useViewbookSync'

export interface AdminViewbookField {
  id: number
  defKey: string | null
  category: string
  label: string
  fieldType: string
  sortOrder: number
  value: string | null
  version: number
  valueUpdatedBy: string | null
  valueUpdatedAt: string | null
  archivedAt: string | null
  createdAt: string
  amendments: { id: number; value: string; author: string; createdAt: string }[]
}

export interface DataSourceViewbook {
  id: number
  dataLockedAt: string | null
  dataLockedBy: string | null
  fields: AdminViewbookField[]
}

const FIELD_TYPES = ['text', 'textarea', 'list'] as const

function displayValue(field: AdminViewbookField): string {
  if (field.value == null) return ''
  if (field.fieldType !== 'list') return field.value
  try {
    const parsed: unknown = JSON.parse(field.value)
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed.join('\n')
  } catch {
    // Keep malformed legacy text visible to the operator.
  }
  return field.value
}

function requestValue(fieldType: string, draft: string): string | string[] | null {
  if (!draft) return null
  if (fieldType !== 'list') return draft
  return draft.split('\n').map((item) => item.trim()).filter(Boolean)
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

async function requestJson(url: string, init: RequestInit): Promise<{ response: Response; body: Record<string, any> }> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({}))
  return { response, body }
}

export function DataSourceTab({
  viewbook,
  onChanged,
}: {
  viewbook: DataSourceViewbook
  onChanged: () => void
}) {
  const [fields, setFields] = useState(viewbook.fields)
  const [lockedAt, setLockedAt] = useState(viewbook.dataLockedAt)
  const [lockedBy, setLockedBy] = useState(viewbook.dataLockedBy)
  const [error, setError] = useState<string | null>(null)
  const [locking, setLocking] = useState(false)

  useEffect(() => setFields(viewbook.fields), [viewbook.fields])
  useEffect(() => {
    setLockedAt(viewbook.dataLockedAt)
    setLockedBy(viewbook.dataLockedBy)
  }, [viewbook.dataLockedAt, viewbook.dataLockedBy])

  const groups = useMemo(() => {
    const grouped = new Map<string, AdminViewbookField[]>()
    for (const field of fields) {
      const rows = grouped.get(field.category) ?? []
      rows.push(field)
      grouped.set(field.category, rows)
    }
    return [...grouped.entries()]
  }, [fields])

  function replaceField(field: AdminViewbookField) {
    setFields((current) => current.map((item) => item.id === field.id ? field : item))
  }

  async function lock() {
    if (!confirm('Lock in the current Data Source answers? Baseline answers will become read-only.')) return
    setLocking(true)
    setError(null)
    try {
      const { response, body } = await requestJson(`/api/viewbooks/${viewbook.id}/lock`, { method: 'POST' })
      if (!response.ok) throw new Error(body.error || 'lock_failed')
      setLockedAt(body.dataLockedAt)
      setLockedBy(body.dataLockedBy)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'lock_failed')
    } finally {
      setLocking(false)
    }
  }

  return (
    <div className="space-y-5 text-sm">
      {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
      {lockedAt ? (
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-teal-900 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-200">
          Locked by {lockedBy ?? 'operator'} on {formatDate(lockedAt)}. Baseline changes are recorded as amendments.
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-amber-900 dark:text-amber-200">Answers remain editable until you lock in the baseline.</p>
          <button
            disabled={locking}
            onClick={() => void lock()}
            className="rounded bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {locking ? 'Locking…' : 'Lock in'}
          </button>
        </div>
      )}

      <CustomFieldForm viewbookId={viewbook.id} onCreated={(field) => {
        setFields((current) => [...current, field])
        onChanged()
      }} />

      {groups.map(([category, rows]) => (
        <section key={category} className="space-y-3">
          <h3 className="text-base font-bold capitalize text-gray-900 dark:text-white">{category.replaceAll('-', ' ')}</h3>
          {rows.map((field) => (
            <AdminFieldCard
              key={field.id}
              viewbookId={viewbook.id}
              field={field}
              lockedAt={lockedAt}
              onUpdated={(next) => {
                replaceField(next)
                onChanged()
              }}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

function CustomFieldForm({
  viewbookId,
  onCreated,
}: {
  viewbookId: number
  onCreated: (field: AdminViewbookField) => void
}) {
  const [label, setLabel] = useState('')
  const [fieldType, setFieldType] = useState<(typeof FIELD_TYPES)[number]>('text')
  const [category, setCategory] = useState<(typeof CATALOG_CATEGORIES)[number]>('school')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { focused, onFocus, onBlur } = useFocusWithin()

  // PR2 Task 6: active while a new-field label is drafted, mid-submit, or
  // focus remains within this form.
  useEditorActivity('admin-new-field', label.trim() !== '' || busy || focused)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { response, body } = await requestJson(`/api/viewbooks/${viewbookId}/fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, fieldType, category }),
      })
      if (!response.ok) throw new Error(body.error || 'create_failed')
      setLabel('')
      onCreated({ ...body.field, amendments: [] } as AdminViewbookField)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      onFocus={onFocus}
      onBlur={onBlur}
      className="rounded-xl border border-gray-200 bg-white p-4 dark:border-navy-border dark:bg-navy-card"
    >
      <h3 className="font-semibold text-gray-900 dark:text-white">Add custom field</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <input
          aria-label="Custom field label"
          required
          maxLength={200}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Question label"
          className="rounded border border-gray-300 bg-white px-3 py-2 dark:border-navy-border dark:bg-navy-light dark:text-white"
        />
        <select value={fieldType} onChange={(event) => setFieldType(event.target.value as typeof fieldType)} className="rounded border border-gray-300 bg-white px-3 py-2 dark:border-navy-border dark:bg-navy-light dark:text-white">
          {FIELD_TYPES.map((type) => <option key={type}>{type}</option>)}
        </select>
        <select value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className="rounded border border-gray-300 bg-white px-3 py-2 dark:border-navy-border dark:bg-navy-light dark:text-white">
          {CATALOG_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
        </select>
        <button disabled={busy || !label.trim()} className="rounded bg-teal-600 px-4 py-2 font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
          {busy ? 'Adding…' : 'Add field'}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-red-600 dark:text-red-400">{error}</p>}
    </form>
  )
}

function AdminFieldCard({
  viewbookId,
  field,
  lockedAt,
  onUpdated,
}: {
  viewbookId: number
  field: AdminViewbookField
  lockedAt: string | null
  onUpdated: (field: AdminViewbookField) => void
}) {
  const [draft, setDraft] = useState(() => displayValue(field))
  const [label, setLabel] = useState(field.label)
  const [amendment, setAmendment] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const { focused, onFocus, onBlur } = useFocusWithin()

  useEffect(() => {
    setDraft(displayValue(field))
    setLabel(field.label)
  }, [field])

  // PR2 Task 6 (Codex wave-2 fix 6): active while the value/label/amendment
  // draft differs from the loaded field, a save is in flight, or focus
  // remains within this card — this is what keeps the admin editor's
  // background poll from calling load() (which would reset the effect
  // above) while an operator is mid-edit.
  const dirty = draft !== displayValue(field) || label !== field.label || amendment.trim() !== ''
  useEditorActivity(`admin-field-${field.id}`, dirty || busy || focused)

  const lockedBaseline = lockedAt !== null && new Date(field.createdAt).getTime() <= new Date(lockedAt).getTime()
  const editable = !field.archivedAt && !lockedBaseline
  const endpoint = `/api/viewbooks/${viewbookId}/fields/${field.id}`

  async function saveValue() {
    setBusy(true)
    setMessage(null)
    try {
      const { response, body } = await requestJson(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: requestValue(field.fieldType, draft), expectedVersion: field.version }),
      })
      if (response.status === 409 && body.current) {
        const next = { ...field, value: body.current.value, version: body.current.version }
        onUpdated(next)
        setDraft(displayValue(next))
        setMessage(body.error === 'stale_version' ? 'A newer answer was loaded.' : 'This baseline is locked.')
        return
      }
      if (!response.ok) throw new Error(body.error || 'save_failed')
      onUpdated({ ...field, ...body.field })
      setMessage('Saved')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  async function saveLabel() {
    setBusy(true)
    setMessage(null)
    try {
      const { response, body } = await requestJson(endpoint, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }),
      })
      if (!response.ok) throw new Error(body.error || 'label_failed')
      onUpdated({ ...field, ...body.field })
      setMessage('Label saved')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'label_failed')
    } finally {
      setBusy(false)
    }
  }

  async function propose(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const { response, body } = await requestJson(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'amend',
          value: requestValue(field.fieldType, amendment),
          clientMutationId: crypto.randomUUID(),
        }),
      })
      if (!response.ok) throw new Error(body.error || 'amendment_failed')
      onUpdated({ ...field, amendments: [...field.amendments, body.amendment] })
      setAmendment('')
      setMessage('Amendment recorded')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'amendment_failed')
    } finally {
      setBusy(false)
    }
  }

  async function archive() {
    if (!confirm(`Archive “${field.label}”?`)) return
    setBusy(true)
    setMessage(null)
    try {
      const { response, body } = await requestJson(endpoint, { method: 'DELETE' })
      if (!response.ok) throw new Error(body.error || 'archive_failed')
      onUpdated({ ...field, archivedAt: new Date().toISOString() })
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'archive_failed')
    } finally {
      setBusy(false)
    }
  }

  const inputClass = 'w-full rounded border border-gray-300 bg-white px-3 py-2 dark:border-navy-border dark:bg-navy-light dark:text-white'
  return (
    <article
      onFocus={onFocus}
      onBlur={onBlur}
      className={`rounded-xl border p-4 ${field.archivedAt ? 'border-gray-200 bg-gray-100 opacity-60 dark:border-navy-border dark:bg-navy-light' : 'border-gray-200 bg-white dark:border-navy-border dark:bg-navy-card'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {field.defKey === null && !field.archivedAt ? (
            <div className="flex gap-2">
              <input aria-label={`Label for ${field.label}`} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={200} className={inputClass} />
              <button disabled={busy || !label.trim() || label === field.label} onClick={() => void saveLabel()} className="rounded border border-gray-300 px-3 py-2 text-gray-700 disabled:opacity-40 dark:border-navy-border dark:text-white/80">Save label</button>
            </div>
          ) : <h4 className="font-semibold text-gray-900 dark:text-white">{field.label}</h4>}
          <p className="mt-1 text-xs text-gray-500 dark:text-white/50">
            {field.fieldType} · version {field.version}
            {lockedAt && !lockedBaseline && !field.archivedAt ? ' · added after lock-in' : ''}
            {field.archivedAt ? ` · archived ${formatDate(field.archivedAt)}` : ''}
          </p>
        </div>
        {!field.archivedAt && <button disabled={busy} onClick={() => void archive()} className="text-xs font-semibold text-red-600 dark:text-red-400">Archive</button>}
      </div>

      {editable && (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-medium text-gray-600 dark:text-white/60">
            Value for {field.label}
            {field.fieldType === 'text'
              ? <input value={draft} onChange={(event) => setDraft(event.target.value)} className={`mt-1 ${inputClass}`} />
              : <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} className={`mt-1 ${inputClass}`} />}
          </label>
          <button disabled={busy} onClick={() => void saveValue()} className="rounded bg-teal-600 px-3 py-1.5 font-semibold text-white hover:bg-teal-700 disabled:opacity-50" aria-label={`Save ${field.label}`}>Save answer</button>
        </div>
      )}

      {lockedBaseline && !field.archivedAt && (
        <form onSubmit={propose} className="mt-3 space-y-2 rounded-lg bg-gray-50 p-3 dark:bg-navy-light">
          <p className="whitespace-pre-wrap text-gray-800 dark:text-white/90">{displayValue(field) || 'Not provided yet'}</p>
          <label className="block text-xs font-medium text-gray-600 dark:text-white/60">
            Operator amendment
            <textarea required value={amendment} onChange={(event) => setAmendment(event.target.value)} rows={3} className={`mt-1 ${inputClass}`} />
          </label>
          <button disabled={busy || !amendment.trim()} className="rounded border border-teal-600 px-3 py-1.5 font-semibold text-teal-700 disabled:opacity-50 dark:text-teal-300">Record amendment</button>
        </form>
      )}

      {field.amendments.length > 0 && <div className="mt-3 space-y-2">
        {field.amendments.map((item) => <div key={item.id} className="border-l-4 border-teal-500 pl-3">
          <p className="whitespace-pre-wrap text-gray-800 dark:text-white/90">{item.value}</p>
          <p className="text-xs text-gray-500 dark:text-white/50">{formatDate(item.createdAt)} · {item.author}</p>
        </div>)}
      </div>}
      {message && <p aria-live="polite" className="mt-2 text-xs text-gray-600 dark:text-white/60">{message}</p>}
    </article>
  )
}
