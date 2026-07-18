'use client'

import { useState } from 'react'
import { FONT_MANIFEST } from '@/lib/viewbook/font-manifest'
import { SECTION_KEYS, type ViewbookTheme } from '@/lib/viewbook/theme'
import { jsonFetch } from './viewbook-admin-shared'
import { ThemePreview } from './ThemePreview'
import { useBaselineSync, useEditorActivity, useFocusWithin } from '@/components/viewbook/public/useViewbookSync'
import { SECTION_TITLES } from '@/components/viewbook/public/section-titles'
import {
  ViewbookEditorPanel,
  ViewbookEditorStatus,
  editorInputClass,
  editorLabelClass,
  editorPrimaryBtnClass,
  editorWellClass,
} from '@/components/viewbook/editor'
import { StatusPill } from '@/components/ui/StatusPill'

function themeEquals(a: ViewbookTheme, b: ViewbookTheme): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const COLOR_FIELDS = ['primary', 'secondary', 'tertiary'] as const
const fileInputClass = 'block w-full text-xs text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:font-semibold file:text-navy hover:file:bg-gray-200 dark:text-white/60 dark:file:bg-white/10 dark:file:text-white dark:hover:file:bg-white/15'

function AdminFontPicker({
  kind,
  value,
  onChange,
}: {
  kind: 'Heading' | 'Body'
  value: string
  onChange: (key: string) => void
}) {
  const [search, setSearch] = useState('')
  const query = search.trim().toLocaleLowerCase()
  const options = Object.entries(FONT_MANIFEST).filter(([key, font]) => (
    key === value || !query || `${font.family} ${key}`.toLocaleLowerCase().includes(query)
  ))

  return (
    <fieldset aria-label={`${kind} typography`} className={editorWellClass}>
      <legend className="px-1 font-display text-sm font-semibold text-navy dark:text-white">{kind}</legend>
      <div className="mt-1 space-y-3">
        <label className={editorLabelClass}>
          Search fonts
          <input
            aria-label={`Search ${kind.toLocaleLowerCase()} fonts`}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Find a ${kind.toLocaleLowerCase()} font`}
            className={`mt-1 ${editorInputClass}`}
          />
        </label>
        <label className={editorLabelClass}>
          Selected font
          <select
            aria-label={`${kind} font`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={`mt-1 ${editorInputClass}`}
          >
            {options.map(([key, font]) => <option key={key} value={key}>{font.family}</option>)}
          </select>
        </label>
        <p
          className="truncate text-base text-navy dark:text-white/85"
          style={{ fontFamily: `'${FONT_MANIFEST[value as keyof typeof FONT_MANIFEST]?.family ?? 'Inter'}', sans-serif` }}
        >
          {kind === 'Heading' ? 'A confident viewbook heading' : 'Clear, readable client body copy'}
        </p>
      </div>
    </fieldset>
  )
}

export function ThemeEditor({
  viewbookId,
  theme,
  onSaved,
}: {
  viewbookId: number
  theme: ViewbookTheme
  onSaved: (theme: ViewbookTheme) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { focused, onFocus, onBlur } = useFocusWithin()

  // Keep the draft synchronized with background refreshes while idle, and
  // commit successful writes immediately so the shared refresher never sees
  // this editor as permanently dirty.
  const { draft, setDraft, dirty, commit } = useBaselineSync<ViewbookTheme>(theme, focused || busy, themeEquals)
  useEditorActivity('admin-theme', dirty || busy || focused)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await jsonFetch<{ theme: ViewbookTheme }>(`/api/viewbooks/${viewbookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: draft }),
      })
      const saved = res.theme ?? draft
      commit(saved)
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  async function upload(kind: 'logo' | 'hero', sectionKey: string | null, file: File) {
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('kind', kind)
      if (sectionKey) form.set('sectionKey', sectionKey)
      form.set('file', file)
      const res = await fetch(`/api/viewbooks/${viewbookId}/assets`, { method: 'POST', body: form })
      const body = (await res.json()) as { theme?: ViewbookTheme; error?: string }
      if (!res.ok || !body.theme) throw new Error(body.error || 'upload_failed')
      commit(body.theme)
      onSaved(body.theme)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload_failed')
    } finally {
      setBusy(false)
    }
  }

  const uploadedHeroCount = SECTION_KEYS.filter((key) => draft.sectionHeroes[key]).length
  return (
    <div onFocus={onFocus} onBlur={onBlur} className="font-body">
      <div data-testid="theme-editor-layout" className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-base font-bold text-navy dark:text-white">Theme controls</h2>
                <ViewbookEditorStatus state={error ? 'error' : busy ? 'saving' : dirty ? 'dirty' : 'idle'} message={error} />
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Changes appear in the client preview immediately and are published when you save.</p>
            </div>
            <button type="button" onClick={() => void save()} disabled={busy} className={editorPrimaryBtnClass}>
              {busy ? 'Saving…' : 'Save theme'}
            </button>
          </div>

          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card" aria-labelledby="admin-theme-colors">
            <div>
              <h2 id="admin-theme-colors" className="font-display text-base font-bold text-navy dark:text-white">Colors</h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Set the primary brand band and supporting accents used throughout the client view.</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {COLOR_FIELDS.map((field) => (
                <label key={field} data-color-control className={`${editorWellClass} flex items-center gap-3 text-sm font-medium text-navy dark:text-white/80`}>
                  <input
                    type="color"
                    value={draft[field]}
                    onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                    aria-label={`${field} color`}
                    className="h-12 w-16 shrink-0 cursor-pointer rounded-lg border border-gray-300 bg-white p-1 dark:border-navy-border dark:bg-navy-light"
                  />
                  <span className="min-w-0">
                    <span className="block capitalize">{field}</span>
                    <code className="mt-0.5 block text-xs font-normal text-gray-500 dark:text-white/55">{draft[field].toUpperCase()}</code>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card" aria-labelledby="admin-theme-typography">
            <div>
              <h2 id="admin-theme-typography" className="font-display text-base font-bold text-navy dark:text-white">Typography</h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Choose heading and body families independently from the approved font catalog.</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <AdminFontPicker kind="Heading" value={draft.headingFont} onChange={(headingFont) => setDraft({ ...draft, headingFont })} />
              <AdminFontPicker kind="Body" value={draft.bodyFont} onChange={(bodyFont) => setDraft({ ...draft, bodyFont })} />
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card" aria-labelledby="admin-theme-logo">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="admin-theme-logo" className="font-display text-base font-bold text-navy dark:text-white">Logo</h2>
                <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Upload the client mark used by the public viewbook.</p>
              </div>
              <StatusPill label={draft.logo ? 'Uploaded' : 'Not uploaded'} tone={draft.logo ? 'success' : 'neutral'} />
            </div>
            <label className={`mt-4 ${editorLabelClass}`}>
              {draft.logo ? 'Replace logo' : 'Upload logo'}
              <span className="mt-2 flex min-h-11 items-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 dark:border-navy-border dark:bg-navy-deep/40">
                <input
                  aria-label="Viewbook logo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void upload('logo', null, file)
                  }}
                  className={fileInputClass}
                />
              </span>
            </label>
          </section>

          <ViewbookEditorPanel
            title="Hero assets"
            description="Optional section-specific imagery for the client view."
            status={<StatusPill label={`${uploadedHeroCount}/${SECTION_KEYS.length} uploaded`} tone={uploadedHeroCount > 0 ? 'success' : 'neutral'} />}
            defaultOpen={false}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {SECTION_KEYS.map((sectionKey) => (
                <label key={sectionKey} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-navy-border dark:bg-navy-card">
                  <span className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-navy dark:text-white">{SECTION_TITLES[sectionKey]}</span>
                    <StatusPill label={draft.sectionHeroes[sectionKey] ? 'Uploaded' : 'Not uploaded'} tone={draft.sectionHeroes[sectionKey] ? 'success' : 'neutral'} />
                  </span>
                  <span className="flex min-h-10 items-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2 py-1.5 dark:border-navy-border dark:bg-navy-deep/40">
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
                  </span>
                </label>
              ))}
            </div>
          </ViewbookEditorPanel>
        </div>

        <aside data-testid="theme-editor-preview-column" className="min-w-0 self-start lg:sticky lg:top-6">
          <ThemePreview theme={draft} />
        </aside>
      </div>
    </div>
  )
}
