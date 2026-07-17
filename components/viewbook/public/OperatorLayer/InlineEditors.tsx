'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { CATALOG_CATEGORIES } from '@/lib/viewbook/catalog'
import type {
  OperatorFieldData,
  OperatorMilestoneData,
  OperatorSectionData,
  OperatorViewbookData,
} from '@/lib/viewbook/operator-data'
import type { PublicDocRow } from '@/lib/viewbook/public-types'
import { FONT_CATALOG, SECTION_KEYS, type ViewbookTheme } from '@/lib/viewbook/theme'
import {
  requestRefresh,
  useBaselineSync,
  useEditorActivity,
  useFocusWithin,
} from '../useViewbookSync'
import { OperatorRequestError, operatorRequest } from './operator-api'

const inputClass = 'w-full rounded border border-black/15 bg-white px-3 py-2 text-sm text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600'
const saveClass = 'rounded bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2'

function EditorPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details data-operator-inline-editor className="border-b border-teal-900/10 bg-white px-4 py-2 text-black">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-teal-900">Edit {title}</summary>
      <div className="mt-3 space-y-3 pb-2">{children}</div>
    </details>
  )
}

export function WelcomeNoteInlineEditor({ viewbookId, welcomeNote }: { viewbookId: number; welcomeNote: string | null }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const focus = useFocusWithin()
  const { draft, setDraft, dirty, commit } = useBaselineSync(welcomeNote ?? '', focus.focused || busy)
  useEditorActivity('operator-welcome-note', dirty || busy || focus.focused)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await operatorRequest(`/api/viewbooks/${viewbookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ welcomeNote: draft || null }),
      })
      commit(draft)
      requestRefresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <EditorPanel title="welcome note">
      <div onFocus={focus.onFocus} onBlur={focus.onBlur}>
        <label className="block text-xs font-medium text-black/65">
          Welcome note
          <textarea aria-label="Welcome note" rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} className={`mt-1 ${inputClass}`} />
        </label>
        <button type="button" disabled={busy || !dirty} onClick={() => void save()} className={`mt-2 ${saveClass}`}>Save welcome note</button>
        {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
      </div>
    </EditorPanel>
  )
}

export function SectionTextInlineEditor({ viewbookId, section }: { viewbookId: number; section: OperatorSectionData }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const focus = useFocusWithin()
  const intro = useBaselineSync(section.introNote ?? '', focus.focused || busy)
  const narrative = useBaselineSync(section.narrative ?? '', focus.focused || busy)
  const showNarrative = section.sectionKey === 'brand' || section.sectionKey === 'assessment'
  const dirty = intro.dirty || (showNarrative && narrative.dirty)
  useEditorActivity(`operator-section-text-${section.sectionKey}`, dirty || busy || focus.focused)

  async function save() {
    setBusy(true)
    setError(null)
    const payload = {
      introNote: intro.draft || null,
      ...(showNarrative ? { narrative: narrative.draft || null } : {}),
    }
    try {
      await operatorRequest(`/api/viewbooks/${viewbookId}/sections/${section.sectionKey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      intro.commit(intro.draft)
      if (showNarrative) narrative.commit(narrative.draft)
      requestRefresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <EditorPanel title={`${section.sectionKey} copy`}>
      <div className="space-y-2" onFocus={focus.onFocus} onBlur={focus.onBlur}>
        <label className="block text-xs font-medium text-black/65">
          Intro note
          <textarea aria-label={`Intro for ${section.sectionKey}`} rows={2} value={intro.draft} onChange={(event) => intro.setDraft(event.target.value)} className={`mt-1 ${inputClass}`} />
        </label>
        {showNarrative && (
          <label className="block text-xs font-medium text-black/65">
            Narrative
            <textarea aria-label={`Narrative for ${section.sectionKey}`} rows={4} value={narrative.draft} onChange={(event) => narrative.setDraft(event.target.value)} className={`mt-1 ${inputClass}`} />
          </label>
        )}
        <button type="button" disabled={busy || !dirty} onClick={() => void save()} className={saveClass}>Save {section.sectionKey} copy</button>
        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      </div>
    </EditorPanel>
  )
}

export function MilestoneQuickEditor({ viewbookId, milestones }: { viewbookId: number; milestones: OperatorMilestoneData[] }) {
  return (
    <EditorPanel title="milestones">
      <div className="space-y-3">
        {milestones.map((milestone) => <MilestoneRow key={milestone.id} viewbookId={viewbookId} milestone={milestone} />)}
        {milestones.length === 0 && <p className="text-sm text-black/50">No milestones yet.</p>}
      </div>
    </EditorPanel>
  )
}

function MilestoneRow({ viewbookId, milestone }: { viewbookId: number; milestone: OperatorMilestoneData }) {
  const server = {
    title: milestone.title,
    status: milestone.status,
    targetDate: milestone.targetDate?.slice(0, 10) ?? '',
  }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const focus = useFocusWithin()
  const { draft, setDraft, dirty, commit } = useBaselineSync(server, focus.focused || busy, (a, b) => JSON.stringify(a) === JSON.stringify(b))
  useEditorActivity(`operator-milestone-${milestone.id}`, dirty || busy || focus.focused)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await operatorRequest(`/api/viewbooks/${viewbookId}/milestones/${milestone.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.title, status: draft.status, targetDate: draft.targetDate || null }),
      })
      commit(draft)
      requestRefresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2 rounded border border-black/10 bg-black/[0.02] p-3 sm:grid-cols-[1fr_auto_auto_auto]" onFocus={focus.onFocus} onBlur={focus.onBlur}>
      <input aria-label="Milestone title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className={inputClass} />
      <select aria-label="Milestone status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} className={inputClass}>
        <option value="upcoming">upcoming</option>
        <option value="current">current</option>
        <option value="done">done</option>
      </select>
      <input aria-label="Milestone target date" type="date" value={draft.targetDate} onChange={(event) => setDraft({ ...draft, targetDate: event.target.value })} className={inputClass} />
      <button type="button" disabled={busy || !dirty || !draft.title.trim()} onClick={() => void save()} className={saveClass}>Save milestone</button>
      {error && <p role="alert" className="text-xs text-red-700 sm:col-span-4">{error}</p>}
    </div>
  )
}

const COLOR_FIELDS = ['primary', 'secondary', 'tertiary'] as const

export function ThemeInlineEditor({ viewbookId, theme }: { viewbookId: number; theme: ViewbookTheme }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const focus = useFocusWithin()
  const { draft, setDraft, dirty, commit } = useBaselineSync(theme, focus.focused || busy, (a, b) => JSON.stringify(a) === JSON.stringify(b))
  useEditorActivity('operator-theme', dirty || busy || focus.focused)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const body = await operatorRequest<{ theme?: ViewbookTheme }>(`/api/viewbooks/${viewbookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: draft }),
      })
      commit(body.theme ?? draft)
      requestRefresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  async function upload(kind: 'logo' | 'hero', sectionKey: string | null, file: File) {
    setBusy(true)
    setError(null)
    const form = new FormData()
    form.set('kind', kind)
    if (sectionKey) form.set('sectionKey', sectionKey)
    form.set('file', file)
    try {
      const body = await operatorRequest<{ theme: ViewbookTheme }>(`/api/viewbooks/${viewbookId}/assets`, { method: 'POST', body: form })
      commit(body.theme)
      requestRefresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'upload_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <EditorPanel title="theme">
      <div className="space-y-3" onFocus={focus.onFocus} onBlur={focus.onBlur}>
        <div className="flex flex-wrap gap-4">
          {COLOR_FIELDS.map((field) => (
            <label key={field} className="flex items-center gap-2 text-sm text-black/70">
              <span className="capitalize">{field}</span>
              <input type="color" aria-label={`${field} color`} value={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} />
              <code className="text-xs text-black/50">{draft[field]}</code>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-4">
          {(['headingFont', 'bodyFont'] as const).map((field) => (
            <label key={field} className="text-xs font-medium text-black/65">
              {field === 'headingFont' ? 'Heading font' : 'Body font'}
              <select value={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} className={`ml-2 ${inputClass}`}>
                {Object.entries(FONT_CATALOG).map(([key, value]) => <option key={key} value={key}>{value.family}</option>)}
              </select>
            </label>
          ))}
        </div>
        <label className="block text-xs font-medium text-black/65">
          Logo {draft.logo ? '(uploaded)' : ''}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void upload('logo', null, file)
          }} className="mt-1 block text-xs" />
        </label>
        <details className="text-xs text-black/65">
          <summary className="cursor-pointer font-medium">Section hero images</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {SECTION_KEYS.map((sectionKey) => (
              <label key={sectionKey} className="flex items-center justify-between gap-2">
                <span>{sectionKey}{draft.sectionHeroes[sectionKey] ? ' ✓' : ''}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void upload('hero', sectionKey, file)
                }} className="max-w-48" />
              </label>
            ))}
          </div>
        </details>
        <button type="button" disabled={busy || !dirty} onClick={() => void save()} className={saveClass}>{busy ? 'Saving…' : 'Save theme'}</button>
        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      </div>
    </EditorPanel>
  )
}

export function DocsInlineEditor({ viewbookId, docs }: { viewbookId: number; docs: { global: PublicDocRow[]; own: PublicDocRow[] } }) {
  const [ownDocs, setOwnDocs] = useState(docs.own)
  const [title, setTitle] = useState('')
  const [blurb, setBlurb] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const focus = useFocusWithin()
  const dirty = title.trim() !== '' || blurb.trim() !== '' || file !== null
  useEditorActivity('operator-docs', dirty || busy || focus.focused)
  useEffect(() => setOwnDocs(docs.own), [docs.own])

  async function upload() {
    if (!file || !title.trim()) return
    setBusy(true)
    setError(null)
    const form = new FormData()
    form.set('title', title.trim())
    if (blurb.trim()) form.set('blurb', blurb.trim())
    form.set('file', file)
    try {
      const body = await operatorRequest<{ doc?: PublicDocRow }>(`/api/viewbooks/${viewbookId}/docs`, { method: 'POST', body: form })
      if (body.doc) setOwnDocs((current) => [...current, body.doc!])
      setTitle('')
      setBlurb('')
      setFile(null)
      requestRefresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'upload_failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove(doc: PublicDocRow) {
    if (!window.confirm(`Delete “${doc.title}”?`)) return
    setBusy(true)
    setError(null)
    try {
      await operatorRequest(`/api/viewbooks/${viewbookId}/docs/${doc.id}`, { method: 'DELETE' })
      setOwnDocs((current) => current.filter((item) => item.id !== doc.id))
      requestRefresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'delete_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <EditorPanel title="strategy PDFs">
      <div className="space-y-3" onFocus={focus.onFocus} onBlur={focus.onBlur}>
        {docs.global.length > 0 && <p className="text-xs text-black/50">{docs.global.length} global playbook PDF{docs.global.length === 1 ? '' : 's'} (managed globally)</p>}
        <ul className="space-y-1">
          {ownDocs.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 rounded border border-black/10 px-3 py-2 text-sm">
              <span>{doc.title}</span>
              <button type="button" disabled={busy} onClick={() => void remove(doc)} className="text-xs font-medium text-red-700 underline">Delete</button>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <label className="text-xs font-medium text-black/65">PDF title<input aria-label="PDF title" value={title} onChange={(event) => setTitle(event.target.value)} className={`mt-1 ${inputClass}`} /></label>
          <label className="text-xs font-medium text-black/65">Blurb<input aria-label="PDF blurb" value={blurb} onChange={(event) => setBlurb(event.target.value)} className={`mt-1 ${inputClass}`} /></label>
          <label className="text-xs font-medium text-black/65">PDF file<input aria-label="PDF file" type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-2 block max-w-56" /></label>
        </div>
        <button type="button" disabled={busy || !file || !title.trim()} onClick={() => void upload()} className={saveClass}>{busy ? 'Uploading…' : 'Upload PDF'}</button>
        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      </div>
    </EditorPanel>
  )
}

const FIELD_TYPES = ['text', 'textarea', 'list'] as const

function displayFieldValue(field: OperatorFieldData): string {
  if (field.value == null) return ''
  if (field.fieldType !== 'list') return field.value
  try {
    const parsed: unknown = JSON.parse(field.value)
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed.join('\n')
  } catch {
    // Preserve malformed legacy text so an operator can repair it.
  }
  return field.value
}

function fieldRequestValue(fieldType: string, draft: string): string | string[] | null {
  if (!draft) return null
  if (fieldType !== 'list') return draft
  return draft.split('\n').map((item) => item.trim()).filter(Boolean)
}

export function DataSourceInlineEditor({ viewbookId, fields, dataLockedAt }: { viewbookId: number; fields: OperatorFieldData[]; dataLockedAt: string | null }) {
  const [rows, setRows] = useState(fields)
  useEffect(() => setRows(fields), [fields])
  return (
    <EditorPanel title="Data Source">
      <CustomFieldForm viewbookId={viewbookId} onCreated={(field) => setRows((current) => [...current, field])} />
      <div className="space-y-3">
        {rows.filter((field) => !field.archivedAt).map((field) => (
          <OperatorFieldRow key={field.id} viewbookId={viewbookId} field={field} dataLockedAt={dataLockedAt} onUpdated={(next) => setRows((current) => current.map((item) => item.id === next.id ? next : item))} />
        ))}
      </div>
    </EditorPanel>
  )
}

function CustomFieldForm({ viewbookId, onCreated }: { viewbookId: number; onCreated: (field: OperatorFieldData) => void }) {
  const [label, setLabel] = useState('')
  const [fieldType, setFieldType] = useState<(typeof FIELD_TYPES)[number]>('text')
  const [category, setCategory] = useState<(typeof CATALOG_CATEGORIES)[number]>('school')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const focus = useFocusWithin()
  useEditorActivity('operator-new-field', label.trim() !== '' || busy || focus.focused)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = await operatorRequest<{ field: Omit<OperatorFieldData, 'amendments'> }>(`/api/viewbooks/${viewbookId}/fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, fieldType, category }),
      })
      onCreated({ ...body.field, amendments: [] })
      setLabel('')
      requestRefresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'create_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} onFocus={focus.onFocus} onBlur={focus.onBlur} className="grid gap-2 rounded border border-black/10 bg-black/[0.02] p-3 sm:grid-cols-[1fr_auto_auto_auto]">
      <input aria-label="Custom field label" required maxLength={200} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Question label" className={inputClass} />
      <select aria-label="Custom field type" value={fieldType} onChange={(event) => setFieldType(event.target.value as typeof fieldType)} className={inputClass}>{FIELD_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
      <select aria-label="Custom field category" value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className={inputClass}>{CATALOG_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select>
      <button disabled={busy || !label.trim()} className={saveClass}>Add field</button>
      {error && <p role="alert" className="text-xs text-red-700 sm:col-span-4">{error}</p>}
    </form>
  )
}

function OperatorFieldRow({
  viewbookId,
  field,
  dataLockedAt,
  onUpdated,
}: {
  viewbookId: number
  field: OperatorFieldData
  dataLockedAt: string | null
  onUpdated: (field: OperatorFieldData) => void
}) {
  const [draft, setDraft] = useState(() => displayFieldValue(field))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const focus = useFocusWithin()
  const lockedBaseline = dataLockedAt !== null && new Date(field.createdAt).getTime() <= new Date(dataLockedAt).getTime()
  const dirty = draft !== displayFieldValue(field)
  useEditorActivity(`operator-field-${field.id}`, dirty || busy || focus.focused)
  useEffect(() => setDraft(displayFieldValue(field)), [field])

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      const payload = lockedBaseline
        ? { mode: 'amend', value: fieldRequestValue(field.fieldType, draft), clientMutationId: crypto.randomUUID() }
        : { value: fieldRequestValue(field.fieldType, draft), expectedVersion: field.version }
      const body = await operatorRequest<{ field?: Partial<OperatorFieldData>; amendment?: OperatorFieldData['amendments'][number] }>(`/api/viewbooks/${viewbookId}/fields/${field.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (lockedBaseline && body.amendment) {
        onUpdated({ ...field, amendments: [...field.amendments, body.amendment] })
        setDraft(displayFieldValue(field))
      } else {
        onUpdated({ ...field, ...body.field })
      }
      setMessage(lockedBaseline ? 'Amendment recorded' : 'Saved')
      requestRefresh()
    } catch (caught) {
      // 409 stale_version reconciliation (Codex PR8 review, P2): mirror the
      // admin FieldEditor — adopt the current version/value the server returned
      // so the NEXT save sends a fresh `expectedVersion` instead of resending
      // the obsolete one forever. Without this, the dirty draft suppresses the
      // live refresh and every retry re-conflicts (stuck until manual reload).
      if (
        caught instanceof OperatorRequestError &&
        caught.status === 409 &&
        caught.code === 'stale_version'
      ) {
        const current = caught.body.current as { value?: string | null; version?: number } | undefined
        if (current && typeof current.version === 'number') {
          const nextValue = current.value ?? null
          onUpdated({ ...field, value: nextValue, version: current.version })
          setDraft(displayFieldValue({ ...field, value: nextValue }))
          setMessage('A newer answer was loaded.')
          return
        }
      }
      setMessage(caught instanceof Error ? caught.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded border border-black/10 p-3" onFocus={focus.onFocus} onBlur={focus.onBlur}>
      <label className="block text-xs font-medium text-black/65">
        {lockedBaseline ? `Operator amendment for ${field.label}` : `Answer for ${field.label}`}
        {field.fieldType === 'text'
          ? <input aria-label={`Answer for ${field.label}`} value={draft} onChange={(event) => setDraft(event.target.value)} className={`mt-1 ${inputClass}`} />
          : <textarea aria-label={`Answer for ${field.label}`} rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} className={`mt-1 ${inputClass}`} />}
      </label>
      <button type="button" disabled={busy || !dirty} onClick={() => void save()} aria-label={`Save answer for ${field.label}`} className={`mt-2 ${saveClass}`}>{lockedBaseline ? 'Record amendment' : 'Save answer'}</button>
      {message && <p aria-live="polite" className="mt-2 text-xs text-black/60">{message}</p>}
    </div>
  )
}

export function InlineSectionEditors({ viewbookId, section, operatorData }: { viewbookId: number; section: OperatorSectionData; operatorData: OperatorViewbookData }) {
  return (
    <>
      <SectionTextInlineEditor viewbookId={viewbookId} section={section} />
      {section.sectionKey === 'welcome' && <WelcomeNoteInlineEditor viewbookId={viewbookId} welcomeNote={operatorData.welcomeNote} />}
      {section.sectionKey === 'milestones' && <MilestoneQuickEditor viewbookId={viewbookId} milestones={operatorData.milestones} />}
      {section.sectionKey === 'brand' && <ThemeInlineEditor viewbookId={viewbookId} theme={operatorData.theme} />}
      {section.sectionKey === 'strategy' && <DocsInlineEditor viewbookId={viewbookId} docs={operatorData.docs} />}
      {section.sectionKey === 'data-source' && <DataSourceInlineEditor viewbookId={viewbookId} fields={operatorData.fields} dataLockedAt={operatorData.dataLockedAt} />}
    </>
  )
}
