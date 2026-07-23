'use client'

// F1b Task 9 — the data-source field grid: an editable table of
// FieldTemplate rows plus the add-field form. fieldKey is IMMUTABLE once
// created (the PATCH route 400s a fieldKey body property) — existing rows
// always render it as static text, never an input.
import { useState } from 'react'
import { StatusPill } from '@/components/ui/StatusPill'
import {
  editorInputClass,
  editorLabelClass,
  editorPrimaryBtnClass,
  editorSecondaryBtnClass,
} from '@/components/viewbook/editor'
import { jsonFetch } from '../viewbook-admin-shared'
import { FIELD_KEY_RE, type TemplateFieldView } from './template-editor-types'

const FIELD_TYPES = ['text', 'textarea', 'list'] as const

export function FieldGrid({
  subsectionId,
  fields,
  sectionVersion,
  mutate,
}: {
  subsectionId: number
  fields: TemplateFieldView[]
  sectionVersion: number
  mutate: (label: string, fn: () => Promise<unknown>) => Promise<boolean>
}) {
  return (
    <div className="space-y-3">
      {fields.length === 0 && (
        <p className="rounded-lg border border-dashed border-gray-300 p-3 text-center text-xs text-gray-500 dark:border-navy-border dark:text-white/55">
          No data-source fields yet.
        </p>
      )}
      {fields.map((field) => (
        <FieldRow key={field.id} subsectionId={subsectionId} field={field} sectionVersion={sectionVersion} mutate={mutate} />
      ))}
      <AddFieldForm subsectionId={subsectionId} sectionVersion={sectionVersion} mutate={mutate} />
    </div>
  )
}

function FieldRow({
  subsectionId,
  field,
  sectionVersion,
  mutate,
}: {
  subsectionId: number
  field: TemplateFieldView
  sectionVersion: number
  mutate: (label: string, fn: () => Promise<unknown>) => Promise<boolean>
}) {
  const [label, setLabel] = useState(field.label)
  const [sortOrder, setSortOrder] = useState(field.sortOrder)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const archived = field.archivedAt !== null

  function save() {
    setSaveState('saving')
    // fieldType is intentionally NOT sent — patchField's contract has no
    // fieldType input at all (the route destructures only
    // version/label/sortOrder/archived off the body), so it's fixed once
    // created just like fieldKey; the row's select below is read-only.
    void mutate(`field ${field.fieldKey}`, () => jsonFetch(`/api/viewbook-templates/subsections/${subsectionId}/fields/${field.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: sectionVersion, label, sortOrder }),
    })).then((ok) => {
      setSaveState(ok ? 'saved' : 'failed')
      setTimeout(() => setSaveState('idle'), 4000)
    })
  }

  function toggleArchived() {
    void mutate(`field ${field.fieldKey} archive`, () => jsonFetch(`/api/viewbook-templates/subsections/${subsectionId}/fields/${field.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: sectionVersion, archived: !archived }),
    }))
  }

  return (
    <div className="grid gap-2 rounded-lg border border-gray-200 bg-gray-50/70 p-2 sm:grid-cols-12 sm:items-end dark:border-navy-border dark:bg-navy-deep/35">
      <div className="sm:col-span-3">
        <span className={editorLabelClass}>Field key</span>
        <p className="mt-1 truncate rounded-lg border border-transparent px-3 py-2 text-sm text-navy dark:text-white/80" title={field.fieldKey}>{field.fieldKey}</p>
      </div>
      <label className={`sm:col-span-3 ${editorLabelClass}`}>
        Field label
        <input aria-label={`Label for ${field.fieldKey}`} value={label} onChange={(event) => setLabel(event.target.value)} className={`mt-1 ${editorInputClass}`} />
      </label>
      <label className={`sm:col-span-2 ${editorLabelClass}`}>
        Field type
        <select aria-label={`Field type for ${field.fieldKey}`} value={field.fieldType} disabled className={`mt-1 ${editorInputClass}`}>
          {FIELD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
      </label>
      <label className={`sm:col-span-1 ${editorLabelClass}`}>
        Sort
        <input aria-label={`Sort order for ${field.fieldKey}`} type="number" value={sortOrder} onChange={(event) => setSortOrder(Number(event.target.value))} className={`mt-1 ${editorInputClass}`} />
      </label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <StatusPill label={archived ? 'Archived' : 'Active'} tone={archived ? 'warning' : 'neutral'} />
        <button type="button" onClick={toggleArchived} className={editorSecondaryBtnClass}>{archived ? 'Restore' : 'Archive'}</button>
      </div>
      <div className="sm:col-span-1 flex justify-end">
        <button type="button" disabled={saveState === 'saving'} onClick={save} className={editorPrimaryBtnClass}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : saveState === 'failed' ? 'Retry' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function AddFieldForm({
  subsectionId,
  sectionVersion,
  mutate,
}: {
  subsectionId: number
  sectionVersion: number
  mutate: (label: string, fn: () => Promise<unknown>) => Promise<boolean>
}) {
  const [fieldKey, setFieldKey] = useState('')
  const [label, setLabel] = useState('')
  const [fieldType, setFieldType] = useState<(typeof FIELD_TYPES)[number]>('text')
  const [keyError, setKeyError] = useState<string | null>(null)

  async function add() {
    if (!FIELD_KEY_RE.test(fieldKey)) {
      setKeyError('Invalid key — a-z, 0-9, dashes; permanent once created.')
      return
    }
    setKeyError(null)
    const ok = await mutate('field', () => jsonFetch(`/api/viewbook-templates/subsections/${subsectionId}/fields`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: sectionVersion, fieldKey, label, fieldType }),
    }))
    if (ok) {
      setFieldKey('')
      setLabel('')
      setFieldType('text')
    }
  }

  return (
    <div className="grid gap-2 rounded-lg border border-dashed border-gray-300 p-2 sm:grid-cols-12 sm:items-end dark:border-navy-border">
      <label className={`sm:col-span-3 ${editorLabelClass}`}>
        Field key
        <input aria-label="Field key" value={fieldKey} onChange={(event) => setFieldKey(event.target.value)} placeholder="new-field" className={`mt-1 ${editorInputClass}`} />
        <span className="mt-1 block text-[11px] text-gray-500 dark:text-white/45">a-z, 0-9, dashes; permanent</span>
      </label>
      <label className={`sm:col-span-3 ${editorLabelClass}`}>
        Label
        <input aria-label="Label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label" className={`mt-1 ${editorInputClass}`} />
      </label>
      <label className={`sm:col-span-2 ${editorLabelClass}`}>
        Field type
        <select aria-label="Field type" value={fieldType} onChange={(event) => setFieldType(event.target.value as (typeof FIELD_TYPES)[number])} className={`mt-1 ${editorInputClass}`}>
          {FIELD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
      </label>
      <div className="sm:col-span-4 flex justify-end">
        <button type="button" onClick={() => void add()} className={editorSecondaryBtnClass}>Add field</button>
      </div>
      {keyError && <p role="alert" className="sm:col-span-12 text-xs text-red-600 dark:text-red-400">{keyError}</p>}
    </div>
  )
}
