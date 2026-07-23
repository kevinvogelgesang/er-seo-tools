'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ViewbookEditorPanel,
  ViewbookEditorStatus,
  editorDestructiveBtnClass,
  HexColorInput,
  editorInputClass,
  editorLabelClass,
  editorPrimaryBtnClass,
  editorSecondaryBtnClass,
  editorTextareaClass,
  editorWellClass,
  type ViewbookEditorStatusState,
} from '@/components/viewbook/editor'
import { SECTION_TITLES } from '@/components/viewbook/public/section-titles'
import { StatusPill, type Tone } from '@/components/ui/StatusPill'
import { CATALOG_CATEGORIES } from '@/lib/viewbook/catalog'
import type {
  OperatorFieldData,
  OperatorMilestoneData,
  OperatorSectionData,
  OperatorViewbookData,
} from '@/lib/viewbook/operator-data'
import type { PublicDocRow } from '@/lib/viewbook/public-types'
import type { ResolvedThemeFont, ResolvedThemeFonts } from '@/lib/viewbook/resolved-theme-fonts'
import { FONT_MANIFEST } from '@/lib/viewbook/font-manifest'
import { SECTION_KEYS, type ViewbookTheme } from '@/lib/viewbook/theme'
import {
  requestRefresh,
  useAutosave,
  useBaselineSync,
  useEditorActivity,
  useFocusWithin,
} from '../useViewbookSync'
import { OperatorRequestError, operatorRequest } from './operator-api'
import { useReportSectionActivity } from './inspector/useSectionActivity'
import { SectionQuickControls } from './SectionQuickControls'
import { ThemeDraftWriter } from './ThemeDraftWriter'
import { commitThemeDraft, getCommittedTheme, initializeThemeDraft, setThemeDraft } from './theme-store'

const sameTheme = (a: ViewbookTheme, b: ViewbookTheme) => JSON.stringify(a) === JSON.stringify(b)

type PanelActivity = {
  dirty: boolean
  busy: boolean
  error: string | null
  conflict?: boolean
}

function visualStatus(activity: PanelActivity): { state: ViewbookEditorStatusState; message?: ReactNode } {
  if (activity.conflict) return { state: 'conflict', message: 'Conflict' }
  if (activity.error) return { state: 'error', message: activity.error }
  if (activity.busy) return { state: 'saving' }
  if (activity.dirty) return { state: 'dirty' }
  return { state: 'idle' }
}

function useAggregatePanelActivity() {
  const [items, setItems] = useState<Record<string, PanelActivity>>({})
  const report = useCallback((key: string, next: PanelActivity) => {
    setItems((current) => {
      const previous = current[key]
      if (
        previous &&
        previous.dirty === next.dirty &&
        previous.busy === next.busy &&
        previous.error === next.error &&
        previous.conflict === next.conflict
      ) return current
      return { ...current, [key]: next }
    })
  }, [])
  // Codex fix #8: a child row that unmounts while dirty/paused (e.g. a refresh
  // drops it) must be removed, or its lingering entry keeps the section
  // aggregate dirty/conflict forever → a permanent hard pin that fail-closes
  // every OTHER section. Idempotent; a no-op when the key is already gone.
  const remove = useCallback((key: string) => {
    setItems((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }, [])
  const values = Object.values(items)
  const conflict = values.some((item) => item.conflict)
  const error = values.find((item) => item.error)?.error ?? null
  return {
    report,
    remove,
    activity: {
      dirty: values.some((item) => item.dirty),
      busy: values.some((item) => item.busy),
      error,
      conflict,
    },
  }
}

function EditorPanel({
  title,
  description,
  activity = { dirty: false, busy: false, error: null },
  children,
}: {
  title: string
  description?: ReactNode
  activity?: PanelActivity
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const forceOpen = activity.dirty || Boolean(activity.error) || Boolean(activity.conflict)
  const status = visualStatus(activity)

  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])

  return (
    <div data-operator-inline-editor>
      <ViewbookEditorPanel
        title={title}
        description={description}
        defaultOpen={false}
        open={open || forceOpen}
        onOpenChange={(next) => {
          if (!next && forceOpen) return
          setOpen(next)
        }}
        status={<ViewbookEditorStatus state={status.state} message={status.message} />}
      >
        {children}
      </ViewbookEditorPanel>
    </div>
  )
}

export function WelcomeNoteInlineEditor({ viewbookId, welcomeNote }: { viewbookId: number; welcomeNote: string | null }) {
  const focus = useFocusWithin()
  const { draft, setDraft, dirty, commit } = useBaselineSync(welcomeNote ?? '', focus.focused)
  const autosave = useAutosave({
    editorId: 'operator-welcome-note',
    draft,
    dirty,
    active: focus.focused,
    save: async (value) => {
      await operatorRequest(`/api/viewbooks/${viewbookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ welcomeNote: value || null }),
      })
      return value
    },
    commit,
  })

  const activity = { dirty, busy: autosave.saving, error: autosave.error }
  useReportSectionActivity('welcome', 'operator-welcome-note', {
    dirty, busy: autosave.saving, conflict: false, focused: focus.focused,
  })

  return (
    <EditorPanel
      title="Welcome note"
      description="Shown near the top of the client’s welcome section."
      activity={activity}
    >
      <div onFocus={focus.onFocus} onBlur={(event) => { focus.onBlur(event); autosave.flushOnBlur(event) }}>
        <label htmlFor="operator-welcome-note" className={editorLabelClass}>Welcome note</label>
        <textarea
          id="operator-welcome-note"
          aria-label="Welcome note"
          aria-describedby="operator-welcome-note-help"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className={`mt-1 ${editorTextareaClass}`}
        />
        <p id="operator-welcome-note-help" className="mt-1.5 text-xs text-gray-500 dark:text-white/55">
          Keep this short and personal; the client sees it before the section content.
        </p>
      </div>
    </EditorPanel>
  )
}

export function SectionTextInlineEditor({ viewbookId, section }: { viewbookId: number; section: OperatorSectionData }) {
  const focus = useFocusWithin()
  const intro = useBaselineSync(section.introNote ?? '', focus.focused)
  const narrative = useBaselineSync(section.narrative ?? '', focus.focused)
  const showNarrative = section.sectionKey === 'brand' || section.sectionKey === 'assessment'
  const dirty = intro.dirty || (showNarrative && narrative.dirty)
  const combinedDraft = useMemo(() => ({
    introNote: intro.draft,
    ...(showNarrative ? { narrative: narrative.draft } : {}),
  }), [intro.draft, narrative.draft, showNarrative])
  const autosave = useAutosave({
    editorId: `operator-section-text-${section.sectionKey}`,
    draft: combinedDraft,
    dirty,
    active: focus.focused,
    save: async (value) => {
      await operatorRequest(`/api/viewbooks/${viewbookId}/sections/${section.sectionKey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          introNote: value.introNote || null,
          ...(showNarrative ? { narrative: value.narrative || null } : {}),
        }),
      })
      return value
    },
    commit: (value) => {
      intro.commit(value.introNote)
      if (showNarrative) narrative.commit(value.narrative ?? '')
    },
  })

  const activity = { dirty, busy: autosave.saving, error: autosave.error }
  useReportSectionActivity(section.sectionKey, `operator-section-text-${section.sectionKey}`, {
    dirty, busy: autosave.saving, conflict: false, focused: focus.focused,
  })
  const sectionTitle = SECTION_TITLES[section.sectionKey]

  return (
    <EditorPanel
      title={`${sectionTitle} copy`}
      description="Edit the supporting copy displayed inside this client section."
      activity={activity}
    >
      <div className="space-y-4" onFocus={focus.onFocus} onBlur={(event) => { focus.onBlur(event); autosave.flushOnBlur(event) }}>
        <div>
          <label htmlFor={`operator-${section.sectionKey}-intro`} className={editorLabelClass}>Intro note</label>
          <textarea
            id={`operator-${section.sectionKey}-intro`}
            aria-label={`Intro for ${section.sectionKey}`}
            aria-describedby={`operator-${section.sectionKey}-intro-help`}
            rows={2}
            value={intro.draft}
            onChange={(event) => intro.setDraft(event.target.value)}
            className={`mt-1 ${editorTextareaClass}`}
          />
          <p id={`operator-${section.sectionKey}-intro-help`} className="mt-1.5 text-xs text-gray-500 dark:text-white/55">
            Appears directly beneath the {sectionTitle} heading.
          </p>
        </div>
        {showNarrative && (
          <div>
            <label htmlFor={`operator-${section.sectionKey}-narrative`} className={editorLabelClass}>Narrative</label>
            <textarea
              id={`operator-${section.sectionKey}-narrative`}
              aria-label={`Narrative for ${section.sectionKey}`}
              aria-describedby={`operator-${section.sectionKey}-narrative-help`}
              rows={4}
              value={narrative.draft}
              onChange={(event) => narrative.setDraft(event.target.value)}
              className={`mt-1 ${editorTextareaClass}`}
            />
            <p id={`operator-${section.sectionKey}-narrative-help`} className="mt-1.5 text-xs text-gray-500 dark:text-white/55">
              Longer context shown within the section’s main content.
            </p>
          </div>
        )}
      </div>
    </EditorPanel>
  )
}

export function MilestoneQuickEditor({ viewbookId, milestones }: { viewbookId: number; milestones: OperatorMilestoneData[] }) {
  const aggregate = useAggregatePanelActivity()
  const focus = useFocusWithin()
  useReportSectionActivity('milestones', 'operator-milestones-agg', {
    dirty: aggregate.activity.dirty,
    busy: aggregate.activity.busy,
    conflict: !!aggregate.activity.conflict,
    focused: focus.focused,
  })
  return (
    <div onFocus={focus.onFocus} onBlur={focus.onBlur}>
      <EditorPanel
        title="Process & Milestones"
        description="Update existing milestones shown on the client timeline."
        activity={aggregate.activity}
      >
        <div className="space-y-3">
          {milestones.map((milestone) => (
            <MilestoneRow
              key={milestone.id}
              viewbookId={viewbookId}
              milestone={milestone}
              reportActivity={aggregate.report}
              removeActivity={aggregate.remove}
            />
          ))}
          {milestones.length === 0 && <p className="text-sm text-gray-500 dark:text-white/55">No milestones yet.</p>}
        </div>
      </EditorPanel>
    </div>
  )
}

function MilestoneRow({
  viewbookId,
  milestone,
  reportActivity,
  removeActivity,
}: {
  viewbookId: number
  milestone: OperatorMilestoneData
  reportActivity: (key: string, activity: PanelActivity) => void
  removeActivity: (key: string) => void
}) {
  const server = {
    title: milestone.title,
    status: milestone.status,
    targetDate: milestone.targetDate?.slice(0, 10) ?? '',
    description: milestone.description ?? '',
  }
  const focus = useFocusWithin()
  const { draft, setDraft, dirty, commit } = useBaselineSync(server, focus.focused, (a, b) => JSON.stringify(a) === JSON.stringify(b))
  const autosave = useAutosave({
    editorId: `operator-milestone-${milestone.id}`,
    draft,
    dirty,
    active: focus.focused,
    enabled: draft.title.trim().length > 0,
    save: async (value) => {
      await operatorRequest(`/api/viewbooks/${viewbookId}/milestones/${milestone.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: value.title,
          status: value.status,
          targetDate: value.targetDate || null,
          description: value.description || null,
        }),
      })
      return value
    },
    commit,
  })

  useEffect(() => {
    reportActivity(String(milestone.id), { dirty, busy: autosave.saving, error: autosave.error })
  }, [autosave.error, autosave.saving, dirty, milestone.id, reportActivity])

  // Latest-ref cleanup (mirrors useReportSectionActivity): drop this row's
  // aggregate entry on unmount WITHOUT churning on every activity bump.
  const removeRef = useRef(removeActivity)
  removeRef.current = removeActivity
  useEffect(() => () => removeRef.current(String(milestone.id)), [milestone.id])

  const statusLabel = draft.status === 'done' ? 'Done' : draft.status === 'current' ? 'Current' : 'Upcoming'
  const statusTone: Tone = draft.status === 'done' ? 'success' : draft.status === 'current' ? 'running' : 'neutral'
  const editStatus = visualStatus({ dirty, busy: autosave.saving, error: autosave.error })
  const headingId = `operator-milestone-${milestone.id}-heading`

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-navy-border dark:bg-navy-card"
      onFocus={focus.onFocus}
      onBlur={(event) => { focus.onBlur(event); autosave.flushOnBlur(event) }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-navy-border">
        <h3 id={headingId} className="mr-auto min-w-0 truncate font-display text-sm font-semibold text-navy dark:text-white">{draft.title || 'Untitled milestone'}</h3>
        <StatusPill label={statusLabel} tone={statusTone} />
        <ViewbookEditorStatus state={editStatus.state} message={editStatus.message} />
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-3">
        <label className={editorLabelClass}>
          Title
          <input aria-label="Milestone title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className={`mt-1 ${editorInputClass}`} />
        </label>
        <label className={editorLabelClass}>
          Status
          <select aria-label="Milestone status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} className={`mt-1 ${editorInputClass}`}>
            <option value="upcoming">Upcoming</option>
            <option value="current">Current</option>
            <option value="done">Done</option>
          </select>
        </label>
        <label className={editorLabelClass}>
          Target date
          <input aria-label="Milestone target date" type="date" value={draft.targetDate} onChange={(event) => setDraft({ ...draft, targetDate: event.target.value })} className={`mt-1 ${editorInputClass}`} />
        </label>
        <label className={`sm:col-span-3 ${editorLabelClass}`}>
          Description
          <textarea
            aria-label="Milestone description"
            rows={3}
            maxLength={2000}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            className={`mt-1 ${editorTextareaClass}`}
          />
        </label>
      </div>
    </div>
  )
}

const COLOR_FIELDS = ['primary', 'secondary', 'tertiary'] as const
const fileInputClass = 'block w-full text-xs text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-navy hover:file:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30 dark:text-white/60 dark:file:bg-white/10 dark:file:text-white dark:hover:file:bg-white/15'

function OperatorFontPicker({
  kind,
  value,
  resolvedFont,
  onChange,
}: {
  kind: 'Heading' | 'Body'
  value: string
  resolvedFont?: ResolvedThemeFont
  onChange: (key: string) => void
}) {
  const [search, setSearch] = useState('')
  const query = search.trim().toLocaleLowerCase()
  const manifestOptions = Object.entries(FONT_MANIFEST).filter(([key, font]) => (
    key === value || !query || `${font.family} ${key}`.toLocaleLowerCase().includes(query)
  ))
  const currentCatalogOption = resolvedFont?.key === value && !(value in FONT_MANIFEST)
    ? [[value, { family: resolvedFont.family }]] as const
    : []
  const options = [...currentCatalogOption, ...manifestOptions]

  return (
    <div className={`${editorWellClass} min-w-0 space-y-3`}>
      <label className={editorLabelClass}>
        Search {kind.toLocaleLowerCase()} fonts
        <input
          aria-label={`Search ${kind.toLocaleLowerCase()} fonts`}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className={`mt-1 ${editorInputClass}`}
        />
      </label>
      <label className={editorLabelClass}>
        {kind} font
        <select
          aria-label={`${kind} font`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`mt-1 ${editorInputClass}`}
        >
          {options.map(([key, font]) => <option key={key} value={key}>{font.family}</option>)}
        </select>
      </label>
    </div>
  )
}

export function ThemeInlineEditor({
  viewbookId,
  theme,
  resolvedFonts,
}: {
  viewbookId: number
  theme: ViewbookTheme
  resolvedFonts?: ResolvedThemeFonts
}) {
  const [busy, setBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const focus = useFocusWithin()
  const serverSeed = useRef<{ viewbookId: number; propTheme: ViewbookTheme; theme: ViewbookTheme } | null>(null)
  if (!serverSeed.current || serverSeed.current.viewbookId !== viewbookId) {
    serverSeed.current = { viewbookId, propTheme: theme, theme: getCommittedTheme(viewbookId) ?? theme }
  } else if (!sameTheme(serverSeed.current.propTheme, theme)) {
    serverSeed.current = { viewbookId, propTheme: theme, theme }
  }
  const { draft, setDraft, dirty, commit } = useBaselineSync(serverSeed.current.theme, focus.focused || busy, sameTheme)
  const autosave = useAutosave({
    editorId: 'operator-theme',
    draft,
    dirty,
    active: busy || focus.focused,
    save: async (value) => {
      const body = await operatorRequest<{ theme?: ViewbookTheme }>(`/api/viewbooks/${viewbookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: value }),
      })
      return body.theme ?? value
    },
    commit: (saved) => {
      commit(saved)
      commitThemeDraft(viewbookId, saved)
    },
  })
  useEffect(() => {
    initializeThemeDraft(viewbookId, theme)
    setThemeDraft(viewbookId, draft)
  }, [draft, theme, viewbookId])

  async function upload(kind: 'logo' | 'hero', sectionKey: string | null, file: File) {
    setBusy(true)
    setUploadError(null)
    const form = new FormData()
    form.set('kind', kind)
    if (sectionKey) form.set('sectionKey', sectionKey)
    form.set('file', file)
    try {
      const body = await operatorRequest<{ theme: ViewbookTheme }>(`/api/viewbooks/${viewbookId}/assets`, { method: 'POST', body: form })
      commit(body.theme)
      commitThemeDraft(viewbookId, body.theme)
      requestRefresh()
    } catch (caught) {
      setUploadError(caught instanceof Error ? caught.message : 'upload_failed')
    } finally {
      setBusy(false)
    }
  }

  const error = uploadError || autosave.error
  const activity = { dirty, busy: busy || autosave.saving, error }
  useReportSectionActivity('brand', 'operator-theme', {
    dirty, busy: busy || autosave.saving, conflict: false, focused: focus.focused,
  })

  return (
    <EditorPanel
      title="Viewbook theme"
      description="Brand the live client view with colors, type, and imagery."
      activity={activity}
    >
      <ThemeDraftWriter viewbookId={viewbookId} theme={theme} resolvedFonts={resolvedFonts} />
      <div className="space-y-6" onFocus={focus.onFocus} onBlur={(event) => { focus.onBlur(event); autosave.flushOnBlur(event) }}>
        <section aria-labelledby="operator-theme-colors">
          <h3 id="operator-theme-colors" className="font-display text-sm font-bold text-navy dark:text-white">Colors</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-white/55">These accents update across the client view as you work.</p>
          <div className="mt-3 grid gap-2">
            {COLOR_FIELDS.map((field) => (
              <div key={field} className={`${editorWellClass} flex flex-col gap-1.5 text-sm font-medium text-navy dark:text-white/80`}>
                <span className="capitalize">{field}</span>
                <HexColorInput
                  label={field}
                  value={draft[field]}
                  onChange={(next) => setDraft({ ...draft, [field]: next })}
                  swatchClassName="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-gray-300 bg-white p-1 dark:border-navy-border dark:bg-navy-light"
                  fieldClassName="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-2 py-1 font-mono text-xs uppercase text-navy dark:border-navy-border dark:bg-navy-light dark:text-white"
                />
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="operator-theme-typography">
          <h3 id="operator-theme-typography" className="font-display text-sm font-bold text-navy dark:text-white">Typography</h3>
          <div className="mt-3 grid gap-3">
            <OperatorFontPicker kind="Heading" value={draft.headingFont} resolvedFont={resolvedFonts?.heading} onChange={(headingFont) => setDraft({ ...draft, headingFont })} />
            <OperatorFontPicker kind="Body" value={draft.bodyFont} resolvedFont={resolvedFonts?.body} onChange={(bodyFont) => setDraft({ ...draft, bodyFont })} />
          </div>
        </section>

        <section aria-labelledby="operator-theme-assets">
          <h3 id="operator-theme-assets" className="font-display text-sm font-bold text-navy dark:text-white">Assets</h3>
          <div className="mt-3 space-y-3">
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-navy dark:text-white">Viewbook logo</span>
                <StatusPill label={draft.logo ? 'Uploaded' : 'Not uploaded'} tone={draft.logo ? 'success' : 'neutral'} />
              </div>
              <label className={editorLabelClass}>
                Replace logo
                <input
                  aria-label="Viewbook logo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void upload('logo', null, file)
                  }}
                  className={`mt-2 ${fileInputClass}`}
                />
              </label>
            </div>
            <ViewbookEditorPanel
              title="Section hero images"
              description="Optional imagery for individual client sections."
              defaultOpen={false}
            >
              <div className="grid gap-2">
                {SECTION_KEYS.map((sectionKey) => (
                  <label key={sectionKey} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-navy-border dark:bg-navy-card">
                    <span className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-navy dark:text-white">{SECTION_TITLES[sectionKey]}</span>
                      <StatusPill label={draft.sectionHeroes[sectionKey] ? 'Uploaded' : 'Not uploaded'} tone={draft.sectionHeroes[sectionKey] ? 'success' : 'neutral'} />
                    </span>
                    <input
                      aria-label={`Hero image for ${SECTION_TITLES[sectionKey]}`}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) void upload('hero', sectionKey, file)
                      }}
                      className={fileInputClass}
                    />
                  </label>
                ))}
              </div>
            </ViewbookEditorPanel>
          </div>
        </section>
        <p className="text-xs text-gray-500 dark:text-white/55">Theme changes preview live on this viewbook while you edit.</p>
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

  const activity = { dirty, busy, error }
  useReportSectionActivity('strategy', 'operator-docs', {
    dirty, busy, conflict: false, focused: focus.focused,
  })

  function docRow(doc: PublicDocRow, source: 'Global' | 'Viewbook') {
    return (
      <li key={`${source}-${doc.id}`} className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-navy-border dark:bg-navy-card sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-navy dark:text-white">{doc.title}</span>
            <StatusPill label={source} tone={source === 'Global' ? 'neutral' : 'running'} />
          </div>
          {doc.blurb && <p className="mt-1 text-xs text-gray-500 dark:text-white/55">{doc.blurb}</p>}
        </div>
        {source === 'Viewbook' && (
          <button
            type="button"
            aria-label={`Delete ${doc.title}`}
            disabled={busy}
            onClick={() => void remove(doc)}
            className={`${editorDestructiveBtnClass} !min-h-8 px-2.5 py-1 text-xs`}
          >
            Delete
          </button>
        )}
      </li>
    )
  }

  return (
    <EditorPanel
      title="Strategy PDFs"
      description="Manage the reference documents available to this client."
      activity={activity}
    >
      <div className="space-y-6" onFocus={focus.onFocus} onBlur={focus.onBlur}>
        <section aria-labelledby="operator-global-playbooks">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="operator-global-playbooks" className="font-display text-sm font-bold text-navy dark:text-white">Global playbooks</h3>
            <StatusPill label="Managed globally" tone="neutral" />
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Shared resources available across client viewbooks.</p>
          {docs.global.length > 0
            ? <ul className="mt-3 space-y-2">{docs.global.map((doc) => docRow(doc, 'Global'))}</ul>
            : <p className="mt-3 text-sm text-gray-500 dark:text-white/55">No global playbooks are currently available.</p>}
        </section>

        <section aria-labelledby="operator-viewbook-docs">
          <h3 id="operator-viewbook-docs" className="font-display text-sm font-bold text-navy dark:text-white">This viewbook</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-white/55">PDFs uploaded specifically for this client.</p>
          {ownDocs.length > 0
            ? <ul className="mt-3 space-y-2">{ownDocs.map((doc) => docRow(doc, 'Viewbook'))}</ul>
            : <p className="mt-3 text-sm text-gray-500 dark:text-white/55">No client-specific PDFs yet.</p>}
        </section>

        <section className={editorWellClass} aria-labelledby="operator-upload-pdf">
          <h3 id="operator-upload-pdf" className="font-display text-sm font-bold text-navy dark:text-white">Upload a PDF</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className={editorLabelClass}>
              Title
              <input aria-label="PDF title" value={title} onChange={(event) => setTitle(event.target.value)} className={`mt-1 ${editorInputClass}`} />
            </label>
            <label className={editorLabelClass}>
              Blurb
              <input aria-label="PDF blurb" value={blurb} onChange={(event) => setBlurb(event.target.value)} className={`mt-1 ${editorInputClass}`} />
            </label>
            <label className={`sm:col-span-2 ${editorLabelClass}`}>
              File
              <input aria-label="PDF file" type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className={`mt-2 ${fileInputClass}`} />
            </label>
          </div>
          <button type="button" disabled={busy || !file || !title.trim()} onClick={() => void upload()} className={`mt-3 ${editorPrimaryBtnClass}`}>{busy ? 'Uploading…' : 'Upload PDF'}</button>
        </section>
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

function humanize(value: string): string {
  return value.split('-').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ')
}

export function DataSourceInlineEditor({ viewbookId, fields, dataLockedAt }: { viewbookId: number; fields: OperatorFieldData[]; dataLockedAt: string | null }) {
  const [rows, setRows] = useState(fields)
  const aggregate = useAggregatePanelActivity()
  const focus = useFocusWithin()
  useReportSectionActivity('data-source', 'operator-data-source-agg', {
    dirty: aggregate.activity.dirty,
    busy: aggregate.activity.busy,
    conflict: !!aggregate.activity.conflict,
    focused: focus.focused,
  })
  useEffect(() => setRows(fields), [fields])
  const activeRows = rows.filter((field) => !field.archivedAt)
  return (
    <div onFocus={focus.onFocus} onBlur={focus.onBlur}>
    <EditorPanel
      title={SECTION_TITLES['data-source']}
      description="Review client answers, amendments, and custom fields."
      activity={aggregate.activity}
    >
      <div className="space-y-4">
        <div className={dataLockedAt
          ? 'rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10'
          : 'rounded-xl border border-teal-200 bg-teal-50 p-4 dark:border-teal-500/30 dark:bg-teal-500/10'}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label={dataLockedAt ? 'Locked' : 'Open'} tone={dataLockedAt ? 'warning' : 'success'} />
            <strong className="text-sm text-navy dark:text-white">{dataLockedAt ? 'Baseline locked for review' : 'Open for direct editing'}</strong>
          </div>
          <p className="mt-1.5 text-xs text-gray-600 dark:text-white/65">
            {dataLockedAt
              ? 'Baseline answers are protected. Record operator changes as amendments.'
              : 'Changes to existing answers autosave directly to the client data source.'}
          </p>
        </div>
        <div className="space-y-3">
          {activeRows.map((field) => (
            <OperatorFieldRow
              key={field.id}
              viewbookId={viewbookId}
              field={field}
              dataLockedAt={dataLockedAt}
              onUpdated={(next) => setRows((current) => current.map((item) => item.id === next.id ? next : item))}
              reportActivity={aggregate.report}
              removeActivity={aggregate.remove}
            />
          ))}
          {activeRows.length === 0 && <p className="text-sm text-gray-500 dark:text-white/55">No data-source fields yet.</p>}
        </div>
        <CustomFieldForm
          viewbookId={viewbookId}
          onCreated={(field) => setRows((current) => [...current, field])}
          reportActivity={aggregate.report}
          removeActivity={aggregate.remove}
        />
      </div>
    </EditorPanel>
    </div>
  )
}

function CustomFieldForm({
  viewbookId,
  onCreated,
  reportActivity,
  removeActivity,
}: {
  viewbookId: number
  onCreated: (field: OperatorFieldData) => void
  reportActivity: (key: string, activity: PanelActivity) => void
  removeActivity: (key: string) => void
}) {
  const [label, setLabel] = useState('')
  const [fieldType, setFieldType] = useState<(typeof FIELD_TYPES)[number]>('text')
  const [category, setCategory] = useState<(typeof CATALOG_CATEGORIES)[number]>('school')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const focus = useFocusWithin()
  const dirty = label.trim() !== ''
  useEditorActivity('operator-new-field', dirty || busy || focus.focused)

  useEffect(() => {
    reportActivity('new-field', { dirty, busy, error })
  }, [busy, dirty, error, reportActivity])

  const removeRef = useRef(removeActivity)
  removeRef.current = removeActivity
  useEffect(() => () => removeRef.current('new-field'), [])

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
    <EditorPanel
      title="Add custom field"
      description="Create an additional question without changing the standard catalog."
      activity={{ dirty, busy, error }}
    >
      <form onSubmit={submit} onFocus={focus.onFocus} onBlur={focus.onBlur} className="grid gap-3 sm:grid-cols-3">
        <label className={`sm:col-span-3 ${editorLabelClass}`}>
          Field label
          <input aria-label="Custom field label" required maxLength={200} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Question label" className={`mt-1 ${editorInputClass}`} />
        </label>
        <label className={editorLabelClass}>
          Field type
          <select aria-label="Custom field type" value={fieldType} onChange={(event) => setFieldType(event.target.value as typeof fieldType)} className={`mt-1 ${editorInputClass}`}>{FIELD_TYPES.map((type) => <option key={type} value={type}>{humanize(type)}</option>)}</select>
        </label>
        <label className={editorLabelClass}>
          Category
          <select aria-label="Custom field category" value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className={`mt-1 ${editorInputClass}`}>{CATALOG_CATEGORIES.map((item) => <option key={item} value={item}>{humanize(item)}</option>)}</select>
        </label>
        <div className="flex items-end">
          <button disabled={busy || !label.trim()} className={`${editorSecondaryBtnClass} w-full`}>Add field</button>
        </div>
      </form>
    </EditorPanel>
  )
}

function OperatorFieldRow({
  viewbookId,
  field,
  dataLockedAt,
  onUpdated,
  reportActivity,
  removeActivity,
}: {
  viewbookId: number
  field: OperatorFieldData
  dataLockedAt: string | null
  onUpdated: (field: OperatorFieldData) => void
  reportActivity: (key: string, activity: PanelActivity) => void
  removeActivity: (key: string) => void
}) {
  const [draft, setDraft] = useState(() => displayFieldValue(field))
  const [baseline, setBaseline] = useState(() => ({
    value: displayFieldValue(field),
    version: field.version,
  }))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const focus = useFocusWithin()
  const lockedBaseline = dataLockedAt !== null && new Date(field.createdAt).getTime() <= new Date(dataLockedAt).getTime()
  const dirty = draft !== baseline.value
  const autosave = useAutosave<string, OperatorFieldData>({
    editorId: `operator-field-${field.id}`,
    draft,
    dirty,
    enabled: !lockedBaseline,
    active: busy || focus.focused,
    save: async (value) => {
      const body = await operatorRequest<{ field?: Partial<OperatorFieldData> }>(`/api/viewbooks/${viewbookId}/fields/${field.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: fieldRequestValue(field.fieldType, value),
          expectedVersion: baseline.version,
        }),
      })
      return { ...field, ...body.field }
    },
    commit: (next) => {
      const value = displayFieldValue(next)
      setBaseline({ value, version: next.version })
      setDraft(value)
      onUpdated(next)
      setMessage('Saved')
    },
    onError: (caught) => {
      if (
        caught instanceof OperatorRequestError &&
        caught.status === 409 &&
        caught.code === 'stale_version'
      ) {
        const current = caught.body.current as { value?: string | null; version?: number } | undefined
        if (current && typeof current.version === 'number') {
          const next = { ...field, value: current.value ?? null, version: current.version }
          setBaseline({ value: displayFieldValue(next), version: current.version })
          onUpdated(next)
          setMessage('A newer answer exists. Your draft was kept.')
          return 'pause'
        }
      }
    },
  })

  useEffect(() => {
    const nextValue = displayFieldValue(field)
    setBaseline((current) => {
      if (current.version === field.version && current.value === nextValue) return current
      if (draft === current.value) setDraft(nextValue)
      return { value: nextValue, version: field.version }
    })
  }, [draft, field])

  const successfulMessage = message === 'Saved' || message === 'Amendment recorded'
  const legacyConflictMessage = message === 'A newer answer exists. Your draft was kept.'
  const messageError = message && !successfulMessage && !legacyConflictMessage ? message : null
  const activity: PanelActivity = {
    dirty,
    busy: busy || autosave.saving,
    error: autosave.paused ? null : (autosave.error || messageError),
    conflict: autosave.paused,
  }

  useEffect(() => {
    reportActivity(`field-${field.id}`, activity)
  }, [activity.busy, activity.conflict, activity.dirty, activity.error, field.id, reportActivity])

  // Latest-ref unmount cleanup — a dirty/paused row dropped by a refresh must
  // release its aggregate entry, or the section stays conflict/dirty forever.
  const removeRef = useRef(removeActivity)
  removeRef.current = removeActivity
  useEffect(() => () => removeRef.current(`field-${field.id}`), [field.id])

  async function recordAmendment() {
    if (!lockedBaseline) return
    setBusy(true)
    setMessage(null)
    try {
      const body = await operatorRequest<{ amendment?: OperatorFieldData['amendments'][number] }>(`/api/viewbooks/${viewbookId}/fields/${field.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'amend',
          value: fieldRequestValue(field.fieldType, draft),
          clientMutationId: crypto.randomUUID(),
        }),
      })
      if (body.amendment) {
        onUpdated({ ...field, amendments: [...field.amendments, body.amendment] })
        setDraft(displayFieldValue(field))
      }
      setMessage('Amendment recorded')
      requestRefresh()
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  const editStatus = successfulMessage && !dirty && !activity.busy
    ? { state: 'saved' as const, message: undefined }
    : visualStatus(activity)
  const cardClass = autosave.paused
    ? 'rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10'
    : lockedBaseline
      ? 'rounded-xl border border-gray-300 bg-gray-50 p-4 shadow-sm dark:border-navy-border dark:bg-navy-deep/55'
      : 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card'

  return (
    <article className={cardClass} onFocus={focus.onFocus} onBlur={(event) => { focus.onBlur(event); autosave.flushOnBlur(event) }}>
      <header className="mb-4 flex flex-wrap items-start gap-2">
        <div className="mr-auto min-w-0">
          <h3 className="font-display text-sm font-bold text-navy dark:text-white">{field.label}</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <StatusPill label={humanize(field.fieldType)} tone="neutral" />
            <StatusPill label={humanize(field.category)} tone="neutral" />
            <span className="inline-flex items-center text-[11px] font-semibold text-gray-500 dark:text-white/50">Version {baseline.version}</span>
          </div>
        </div>
        <StatusPill label={lockedBaseline ? 'Locked baseline' : 'Editable baseline'} tone={lockedBaseline ? 'warning' : 'success'} />
        <ViewbookEditorStatus state={editStatus.state} message={editStatus.message} />
      </header>

      <div className={lockedBaseline && dirty
        ? 'rounded-lg border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-500/30 dark:bg-amber-500/10'
        : ''}>
        <label className={editorLabelClass}>
          {lockedBaseline ? 'Amendment draft' : 'Answer'}
        {field.fieldType === 'text'
          ? <input aria-label={`Answer for ${field.label}`} value={draft} onChange={(event) => setDraft(event.target.value)} className={`mt-1 ${editorInputClass}`} />
          : <textarea aria-label={`Answer for ${field.label}`} rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} className={`mt-1 ${editorTextareaClass}`} />}
        </label>
        {lockedBaseline && (
          <>
            <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">The locked baseline stays unchanged until this amendment is reviewed.</p>
            <button type="button" disabled={busy || !dirty} onClick={() => void recordAmendment()} aria-label={`Save answer for ${field.label}`} className={`mt-3 ${editorPrimaryBtnClass}`}>Record amendment</button>
          </>
        )}
      </div>

      {!lockedBaseline && autosave.paused && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-100/70 p-3 dark:border-amber-500/40 dark:bg-amber-500/15">
          <strong className="block text-sm text-amber-900 dark:text-amber-200">Your draft was kept</strong>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">A newer answer exists. Retry to save against the latest version.</p>
          <button type="button" onClick={autosave.resume} aria-label={`Retry my answer for ${field.label}`} className={`mt-3 ${editorSecondaryBtnClass}`}>Retry my answer</button>
        </div>
      )}

      {message === 'Amendment recorded' && <p aria-live="polite" className="mt-3 text-xs font-medium text-green-700 dark:text-green-300">Amendment recorded</p>}

      {lockedBaseline && field.amendments.length > 0 && (
        <section className="mt-4 border-t border-gray-200 pt-4 dark:border-navy-border" aria-label={`Amendment history for ${field.label}`}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-white/55">Amendment history</h4>
          <ol className="mt-2 space-y-2">
            {field.amendments.map((amendment) => (
              <li key={amendment.id} className={`${editorWellClass} text-xs text-gray-600 dark:text-white/65`}>
                <p className="whitespace-pre-wrap text-sm text-navy dark:text-white/80">{amendment.value}</p>
                <p className="mt-1">{amendment.author}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  )
}

export function InlineSectionEditors({ viewbookId, section, operatorData }: { viewbookId: number; section: OperatorSectionData; operatorData: OperatorViewbookData }) {
  // Centre the inline editors to the section reading column (max-w-5xl) with a
  // little vertical breathing room, so ER editing UI matches the width of the
  // regularly visible section content.
  //
  // Intent-group DOM contract (Codex fix #7): controllers are wrapped in stable
  // `data-vb-inspector-group` regions so PR2's hidden-row `select(key,…,group)`
  // and PR4's group chrome have a durable seam. `content` and `status` are
  // ALWAYS mounted; the section-specific group (assets/documents/data) mounts
  // only for its owning section. `status` is an empty placeholder PR4 fills.
  return (
    <div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-3 font-body sm:px-6">
      <div data-vb-inspector-group="content" className="space-y-3">
        <SectionTextInlineEditor viewbookId={viewbookId} section={section} />
        {section.sectionKey === 'welcome' && <WelcomeNoteInlineEditor viewbookId={viewbookId} welcomeNote={operatorData.welcomeNote} />}
        {section.sectionKey === 'milestones' && <MilestoneQuickEditor viewbookId={viewbookId} milestones={operatorData.milestones} />}
      </div>
      {section.sectionKey === 'brand' && (
        <div data-vb-inspector-group="assets" className="space-y-3">
          <ThemeInlineEditor viewbookId={viewbookId} theme={operatorData.theme} resolvedFonts={operatorData.resolvedThemeFonts} />
        </div>
      )}
      {section.sectionKey === 'strategy' && (
        <div data-vb-inspector-group="documents" className="space-y-3">
          <DocsInlineEditor viewbookId={viewbookId} docs={operatorData.docs} />
        </div>
      )}
      {section.sectionKey === 'data-source' && (
        <div data-vb-inspector-group="data" className="space-y-3">
          <DataSourceInlineEditor viewbookId={viewbookId} fields={operatorData.fields} dataLockedAt={operatorData.dataLockedAt} />
        </div>
      )}
      <div data-vb-inspector-group="status">
        {/* PR4: the ONE Status mutation owner. Show/Hide/Mark-done/Reset-ack
            live in the section's pane — no rail, no HiddenSectionsList; the
            outline row selects this pane's Status group. */}
        <SectionQuickControls
          viewbookId={viewbookId}
          section={section}
          pcCompletedAt={operatorData.pcCompletedAt}
          variant="embedded"
        />
      </div>
    </div>
  )
}
