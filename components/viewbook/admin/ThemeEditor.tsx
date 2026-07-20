'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { FONT_MANIFEST } from '@/lib/viewbook/font-manifest'
import type { CatalogFont, CatalogSearchResult } from '@/lib/viewbook/font-catalog'
import { SECTION_KEYS, type ViewbookTheme } from '@/lib/viewbook/theme'
import { jsonFetch } from './viewbook-admin-shared'
import { ThemePreview } from './ThemePreview'
import { useBaselineSync, useEditorActivity, useFocusWithin } from '@/components/viewbook/public/useViewbookSync'
import { SECTION_TITLES } from '@/components/viewbook/public/section-titles'
import {
  HexColorInput,
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
const fileInputClass = 'block w-full min-w-0 max-w-full text-xs text-gray-600 file:mr-3 file:max-w-full file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:font-semibold file:text-navy hover:file:bg-gray-200 dark:text-white/60 dark:file:bg-white/10 dark:file:text-white dark:hover:file:bg-white/15'

type FontCatalogModule = typeof import('@/lib/viewbook/font-catalog')

function readableFontKey(key: string): string {
  return key.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toLocaleUpperCase())
}

function ensureAdminFontStylesheet(key: string, font: Pick<CatalogFont, 'gfQuery'>): void {
  if (typeof document === 'undefined') return
  const exists = [...document.head.querySelectorAll<HTMLLinkElement>('link[data-vb-admin-font-key]')]
    .some((link) => link.dataset.vbAdminFontKey === key)
  if (exists) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?${font.gfQuery}&display=swap`
  link.dataset.vbAdminFontKey = key
  document.head.append(link)
}

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
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [catalog, setCatalog] = useState<FontCatalogModule | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLFieldSetElement>(null)
  const generatedId = useId().replaceAll(':', '')
  const listboxId = `admin-${kind.toLocaleLowerCase()}-font-list-${generatedId}`

  async function loadCatalog() {
    if (catalog || loading) return
    setLoading(true)
    setLoadError(false)
    try {
      // Bundle boundary: the 94 KiB snapshot belongs only to this lazy admin
      // chunk. Public client modules never statically import this module.
      setCatalog(await import('@/lib/viewbook/font-catalog'))
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  const recommended = useMemo<CatalogSearchResult[]>(() => Object.entries(FONT_MANIFEST).map(([key, font]) => ({
    key,
    family: font.family,
    supportedWeights: font.supportedWeights,
    gfQuery: font.gfQuery,
  })), [])
  const response = catalog && search.trim()
    ? catalog.searchCatalogFonts(search, 50)
    : { results: recommended, total: recommended.length }
  const current = catalog?.resolveCatalogFont(value) ?? FONT_MANIFEST[value as keyof typeof FONT_MANIFEST] ?? null
  const currentName = current?.family ?? readableFontKey(value)
  const options = !search.trim() && current && !recommended.some((font) => font.key === value)
    ? [{ key: value, ...current }, ...response.results]
    : response.results

  useEffect(() => {
    setActiveIndex(-1)
  }, [search, open])

  useEffect(() => {
    if (current) ensureAdminFontStylesheet(value, current)
  }, [current, value])

  function selectFont(font: CatalogSearchResult) {
    ensureAdminFontStylesheet(font.key, font)
    onChange(font.key)
    setSearch('')
    setOpen(false)
    setActiveIndex(-1)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      setActiveIndex(-1)
      return
    }
    if (!open || options.length === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActiveIndex((index) => {
        if (event.key === 'Home') return 0
        if (event.key === 'End') return options.length - 1
        if (event.key === 'ArrowDown') return index < options.length - 1 ? index + 1 : 0
        return index > 0 ? index - 1 : options.length - 1
      })
      return
    }
    if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      selectFont(options[activeIndex])
    }
  }

  return (
    <fieldset
      ref={containerRef}
      aria-label={`${kind} typography`}
      className={`${editorWellClass} min-w-0 max-w-full`}
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <legend className="px-1 font-display text-sm font-semibold text-navy dark:text-white">{kind}</legend>
      <div className="mt-1 space-y-3">
        <label className={editorLabelClass}>
          Search fonts
          <input
            role="combobox"
            aria-label={`Search ${kind.toLocaleLowerCase()} fonts`}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={open}
            aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
            type="search"
            value={search}
            onFocus={() => {
              setOpen(true)
              void loadCatalog()
            }}
            onClick={() => {
              setOpen(true)
              void loadCatalog()
            }}
            onChange={(event) => {
              setSearch(event.target.value)
              setOpen(true)
              void loadCatalog()
            }}
            onKeyDown={onKeyDown}
            placeholder={`Find a ${kind.toLocaleLowerCase()} font`}
            className={`mt-1 ${editorInputClass}`}
          />
        </label>
        {open && (
          <div className="relative min-w-0">
            <div
              id={listboxId}
              role="listbox"
              aria-label={`${kind} font results`}
              className="max-h-64 min-w-0 overflow-y-auto overflow-x-hidden rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-navy-border dark:bg-navy-light"
            >
              {!search.trim() && (
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-white/50">Recommended</p>
              )}
              {options.map((font, index) => (
                <button
                  id={`${listboxId}-option-${index}`}
                  key={font.key}
                  type="button"
                  role="option"
                  aria-selected={font.key === value}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => ensureAdminFontStylesheet(font.key, font)}
                  onClick={() => selectFont(font)}
                  className={`block w-full min-w-0 rounded-md px-2 py-2 text-left text-sm break-words ${activeIndex === index ? 'bg-teal-50 text-teal-900 dark:bg-teal-500/15 dark:text-teal-100' : 'text-navy hover:bg-gray-50 dark:text-white dark:hover:bg-white/5'}`}
                  style={{ fontFamily: `'${font.family}', sans-serif` }}
                >
                  {font.family}
                </button>
              ))}
              {!loading && !loadError && options.length === 0 && (
                <p className="px-2 py-3 text-sm text-gray-500 dark:text-white/55">No fonts found.</p>
              )}
            </div>
            <p role="status" aria-live="polite" className="mt-1 text-xs text-gray-500 dark:text-white/55">
              {loading
                ? 'Loading font catalog…'
                : loadError
                  ? 'Font catalog could not be loaded.'
                  : search.trim() && response.total > options.length
                    ? `Showing ${options.length} of ${response.total} fonts`
                    : search.trim()
                      ? `${response.total} font${response.total === 1 ? '' : 's'} found`
                      : `${recommended.length} recommended fonts`}
            </p>
          </div>
        )}
        <p className="text-xs font-semibold text-gray-600 break-words dark:text-white/60">Selected: {currentName}</p>
        <p
          className="max-w-full break-words text-base text-navy dark:text-white/85"
          style={{ fontFamily: `'${currentName}', sans-serif` }}
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
    <div onFocus={onFocus} onBlur={onBlur} className="min-w-0 max-w-full font-body">
      <div data-testid="theme-editor-layout" className="min-w-0 max-w-full space-y-5">
        <div className="min-w-0 max-w-full space-y-4">
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
                <div key={field} data-color-control className={`${editorWellClass} flex flex-col gap-2 text-sm font-medium text-navy dark:text-white/80`}>
                  <span className="capitalize">{field}</span>
                  <HexColorInput
                    label={field}
                    value={draft[field]}
                    onChange={(next) => setDraft({ ...draft, [field]: next })}
                    swatchClassName="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-gray-300 bg-white p-1 dark:border-navy-border dark:bg-navy-light"
                    fieldClassName="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 font-mono text-xs uppercase text-navy dark:border-navy-border dark:bg-navy-light dark:text-white"
                  />
                </div>
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

        <div data-testid="theme-editor-preview-block" className="min-w-0 max-w-full">
          <ThemePreview theme={draft} />
        </div>
      </div>
    </div>
  )
}
