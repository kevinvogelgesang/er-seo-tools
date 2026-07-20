'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { CATALOG_CATEGORIES } from '@/lib/viewbook/catalog'
import { CATEGORY_LABELS } from '@/lib/viewbook/category-labels'
import { useEditorActivity, useFocusWithin } from '@/components/viewbook/public/useViewbookSync'
import {
  ViewbookEditorPanel,
  ViewbookEditorStatus,
  editorDestructiveBtnClass,
  editorInputClass,
  editorLabelClass,
  editorPrimaryBtnClass,
  editorSecondaryBtnClass,
  editorTextareaClass,
  editorWellClass,
} from '@/components/viewbook/editor'
import { StatusPill } from '@/components/ui/StatusPill'

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

function readableCategory(category: string): string {
  return category.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function countLabel(count: number, singular: string): string {
  const plural = singular === 'category' ? 'categories' : `${singular}s`
  return `${count} ${count === 1 ? singular : plural}`
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

  const activeFields = useMemo(() => fields.filter((field) => !field.archivedAt), [fields])
  const archivedFields = useMemo(() => fields.filter((field) => field.archivedAt), [fields])
  const groups = useMemo(() => {
    const grouped = new Map<string, AdminViewbookField[]>()
    for (const field of activeFields) {
      const rows = grouped.get(field.category) ?? []
      rows.push(field)
      grouped.set(field.category, rows)
    }
    const catalogOrder: readonly string[] = CATALOG_CATEGORIES
    const categories = [
      ...catalogOrder.filter((category) => grouped.has(category)),
      ...[...grouped.keys()].filter((category) => !catalogOrder.includes(category)).sort(),
    ]
    return categories.map((category) => [category, grouped.get(category)!] as const)
  }, [activeFields])
  const amendmentCount = activeFields.reduce((total, field) => total + field.amendments.length, 0)

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
    <div className="min-w-0 max-w-full space-y-5 overflow-x-hidden font-body text-sm">
      {lockedAt ? (
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 dark:border-teal-500/30 dark:bg-teal-500/10">
          <div className="flex items-start gap-3">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="mt-0.5 h-5 w-5 shrink-0 text-teal-700 dark:text-teal-300">
              <rect x="5" y="10" width="14" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill label="Locked baseline" tone="success" />
                <p className="font-semibold text-teal-950 dark:text-teal-100">Locked by {lockedBy ?? 'operator'} on {formatDate(lockedAt)}</p>
              </div>
              <p className="mt-1 text-xs text-teal-800 dark:text-teal-200/80">Future baseline changes are recorded as amendments, preserving the approved answer below.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex items-start gap-3">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300">
                <path d="M12 9v4m0 4h.01M10.3 4.3 2.7 18a2 2 0 0 0 1.75 3h15.1a2 2 0 0 0 1.75-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
              </svg>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill label="Open" tone="warning" />
                  <p className="font-semibold text-amber-950 dark:text-amber-100">Baseline answers are still editable</p>
                </div>
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-200/80">Lock the Data Source once the client has approved these answers. Locking cannot be undone here.</p>
              </div>
            </div>
            <button disabled={locking} onClick={() => void lock()} className={editorPrimaryBtnClass}>
              {locking ? 'Locking…' : 'Lock in'}
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      <dl className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          countLabel(activeFields.length, 'active field'),
          countLabel(groups.length, 'category'),
          countLabel(amendmentCount, 'amendment'),
          lockedAt ? 'Locked' : 'Open',
        ].map((value, index) => (
          <div key={`${value}-${index}`} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-navy-border dark:bg-navy-deep/40">
            <dt className="sr-only">{['Fields', 'Categories', 'Amendments', 'State'][index]}</dt>
            <dd className="font-semibold text-navy dark:text-white">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="min-w-0 max-w-full space-y-4">
        {groups.map(([category, rows]) => {
          const answered = rows.filter((field) => field.value !== null && field.value !== '').length
          return (
          <ViewbookEditorPanel
            key={category}
            id={`data-source-category-${category}`}
            title={CATEGORY_LABELS[category] ?? readableCategory(category)}
            description={`${countLabel(rows.length, 'field')} · ${answered} answered`}
            defaultOpen={false}
          >
            <div className="min-w-0 max-w-full space-y-3">
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
            </div>
          </ViewbookEditorPanel>
          )
        })}
        {activeFields.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-gray-500 dark:border-navy-border dark:text-white/55">No active Data Source fields.</div>
        )}
      </div>

      <CustomFieldForm viewbookId={viewbook.id} onCreated={(field) => {
        setFields((current) => [...current, field])
        onChanged()
      }} />

      {archivedFields.length > 0 && (
        <ViewbookEditorPanel
          title="Archived fields"
          description="Removed from active Data Source work."
          status={<StatusPill label={countLabel(archivedFields.length, 'field')} tone="neutral" />}
        >
          <div className="space-y-3 opacity-75">
            {archivedFields.map((field) => (
              <AdminFieldCard key={field.id} viewbookId={viewbook.id} field={field} lockedAt={lockedAt} onUpdated={replaceField} />
            ))}
          </div>
        </ViewbookEditorPanel>
      )}
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
  const [open, setOpen] = useState(false)
  const { focused, onFocus, onBlur } = useFocusWithin()

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

  const forceOpen = label.trim() !== '' || busy || error !== null
  return (
    <ViewbookEditorPanel
      title="Add custom field"
      description="Create a client-specific question outside the standard catalog."
      open={forceOpen || open}
      onOpenChange={setOpen}
      status={<ViewbookEditorStatus state={error ? 'error' : busy ? 'saving' : label.trim() ? 'dirty' : 'idle'} message={error} />}
    >
      <form onSubmit={submit} onFocus={onFocus} onBlur={onBlur} className="min-w-0 max-w-full space-y-3">
        <div className="grid min-w-0 gap-3 sm:grid-cols-3">
          <label className={`min-w-0 ${editorLabelClass}`}>
            Label
            <input aria-label="Custom field label" required maxLength={200} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Question label" className={`mt-1 ${editorInputClass}`} />
          </label>
          <label className={`min-w-0 ${editorLabelClass}`}>
            Field type
            <select aria-label="Custom field type" value={fieldType} onChange={(event) => setFieldType(event.target.value as typeof fieldType)} className={`mt-1 ${editorInputClass}`}>
              {FIELD_TYPES.map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <label className={`min-w-0 ${editorLabelClass}`}>
            Category
            <select aria-label="Custom field category" value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className={`mt-1 ${editorInputClass}`}>
              {CATALOG_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <button disabled={busy || !label.trim()} className={editorSecondaryBtnClass}>{busy ? 'Adding…' : 'Add field'}</button>
      </form>
    </ViewbookEditorPanel>
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
  const [conflict, setConflict] = useState<{ serverValue: string | null; serverVersion: number } | null>(null)
  const { focused, onFocus, onBlur } = useFocusWithin()

  useEffect(() => {
    if (!conflict) setDraft(displayValue(field))
    setLabel(field.label)
  }, [field, conflict])

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
        if (body.error === 'stale_version') {
          setConflict({ serverValue: body.current.value, serverVersion: body.current.version })
        } else {
          setDraft(displayValue(next))
          setMessage('This baseline is locked.')
        }
        return
      }
      if (!response.ok) throw new Error(body.error || 'save_failed')
      onUpdated({ ...field, ...body.field })
      setConflict(null)
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

  const fieldState = field.archivedAt ? 'Archived' : lockedBaseline ? 'Locked baseline' : lockedAt ? 'Editable after lock' : 'Editable baseline'
  const fieldTone = field.archivedAt ? 'neutral' : lockedBaseline ? 'success' : 'running'
  const editorStatus = conflict ? 'conflict' : busy ? 'saving' : message === 'Saved' || message === 'Label saved' || message === 'Amendment recorded' ? 'saved' : dirty ? 'dirty' : 'idle'

  return (
    <article onFocus={onFocus} onBlur={onBlur} className="min-w-0 max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {field.defKey === null && !field.archivedAt ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className={`min-w-0 flex-1 ${editorLabelClass}`}>
                Field label
                <input aria-label={`Label for ${field.label}`} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={200} className={`mt-1 ${editorInputClass}`} />
              </label>
              <button disabled={busy || !label.trim() || label === field.label} onClick={() => void saveLabel()} className={`self-end ${editorSecondaryBtnClass}`}>Save label</button>
            </div>
          ) : <h4 className="font-display font-semibold text-navy [overflow-wrap:anywhere] dark:text-white">{field.label}</h4>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill label={fieldState} tone={fieldTone} />
            <span className="text-xs text-gray-500 dark:text-white/50">{readableCategory(field.category)} · {field.fieldType} · version {field.version}</span>
            {field.archivedAt && <span className="text-xs text-gray-500 dark:text-white/50">Archived {formatDate(field.archivedAt)}</span>}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ViewbookEditorStatus state={editorStatus} message={conflict ? 'Version conflict' : message && !['Saved', 'Label saved', 'Amendment recorded'].includes(message) ? message : undefined} />
          {!field.archivedAt && <button disabled={busy} onClick={() => void archive()} className={editorDestructiveBtnClass}>Archive</button>}
        </div>
      </div>

      {editable && (
        <div className={`mt-4 space-y-3 ${editorWellClass}`}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-white/50">Editable baseline answer</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-white/50">Saved directly until this field becomes part of a locked baseline.</p>
          </div>
          <label className={editorLabelClass}>
            Value for {field.label}
            {field.fieldType === 'text'
              ? <input value={draft} onChange={(event) => setDraft(event.target.value)} className={`mt-1 ${editorInputClass}`} />
              : <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} className={`mt-1 ${editorTextareaClass}`} />}
          </label>
          {conflict && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-amber-900 dark:text-amber-200">Your draft was kept</p>
                  <p className="mt-1 text-xs text-amber-800 dark:text-amber-200/80">The saved answer changed to version {conflict.serverVersion}. Review your draft, then retry to save it against the latest version.</p>
                </div>
                <button type="button" disabled={busy} onClick={() => void saveValue()} aria-label={`Retry saving ${field.label}`} className={editorSecondaryBtnClass}>Retry</button>
              </div>
            </div>
          )}
          {!conflict && <button disabled={busy} onClick={() => void saveValue()} className={editorPrimaryBtnClass} aria-label={`Save ${field.label}`}>Save answer</button>}
        </div>
      )}

      {lockedBaseline && !field.archivedAt && (
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <div className={editorWellClass}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-white/50">Locked baseline value</p>
            <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] text-navy dark:text-white/90">{displayValue(field) || 'Not provided yet'}</p>
          </div>
          <form onSubmit={propose} className={editorWellClass}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-white/50">Amendment draft</p>
            <label className={`mt-2 ${editorLabelClass}`}>
              Operator amendment for {field.label}
              <textarea required value={amendment} onChange={(event) => setAmendment(event.target.value)} rows={3} className={`mt-1 ${editorTextareaClass}`} />
            </label>
            <button disabled={busy || !amendment.trim()} className={`mt-3 ${editorSecondaryBtnClass}`}>Record amendment</button>
          </form>
        </div>
      )}

      {field.amendments.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-white/50">Amendment history</p>
          <ol className="mt-2 space-y-3 border-l border-teal-300 pl-4 dark:border-teal-500/40">
            {field.amendments.map((item) => (
              <li key={item.id} className="relative">
                <span aria-hidden="true" className="absolute -left-[1.2rem] top-1 h-2 w-2 rounded-full bg-teal-500 ring-4 ring-white dark:ring-navy-card" />
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-navy dark:text-white/90">{item.value}</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-white/50">{formatDate(item.createdAt)} · {item.author}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </article>
  )
}
