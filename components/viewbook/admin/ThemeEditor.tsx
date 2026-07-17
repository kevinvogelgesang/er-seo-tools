'use client'

// PR1 theme editor: colors + fonts + logo/hero attachment with an inline
// swatch/typography preview. The full shared public preview renderer arrives
// in PR2 (ThemePreview.tsx) and mounts beside this editor.

import { useState } from 'react'
import { FONT_MANIFEST } from '@/lib/viewbook/font-manifest'
import { SECTION_KEYS, type ViewbookTheme } from '@/lib/viewbook/theme'
import { jsonFetch } from './viewbook-admin-shared'
import { ThemePreview } from './ThemePreview'
import { useBaselineSync, useEditorActivity, useFocusWithin } from '@/components/viewbook/public/useViewbookSync'

function themeEquals(a: ViewbookTheme, b: ViewbookTheme): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const COLOR_FIELDS = ['primary', 'secondary', 'tertiary'] as const

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
    <div className="min-w-56 space-y-1 text-sm text-gray-700 dark:text-white/80">
      <label className="block">
        Search {kind.toLocaleLowerCase()} fonts
        <input
          aria-label={`Search ${kind.toLocaleLowerCase()} fonts`}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-navy-border dark:bg-navy-card dark:text-white"
        />
      </label>
      <label className="block">
        {kind} font
        <select
          aria-label={`${kind} font`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-navy-border dark:bg-navy-card dark:text-white"
        >
          {options.map(([key, font]) => <option key={key} value={key}>{font.family}</option>)}
        </select>
      </label>
    </div>
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

  // Final-review fix (P1): `draft` used to be seeded ONCE from `theme`
  // (`useState(theme)`), so a background `load()` that advances `theme`
  // (another admin session, or this editor's OWN save landing) never
  // reached the draft — `dirty` (previously `draft !== theme` directly)
  // would then read true FOREVER, permanently suppressing the shared
  // refresher. `useBaselineSync` reconciles while idle (not focused/busy)
  // and exposes `commit()` for `save()`/`upload()` to call immediately on
  // success, so THIS editor's own save doesn't trip the same bug the moment
  // busy flips back to false but before `load()`'s round trip completes.
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

  return (
    <div className="space-y-4" onFocus={onFocus} onBlur={onBlur}>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-4">
        {COLOR_FIELDS.map((field) => (
          <label key={field} className="flex items-center gap-2 text-sm text-gray-700 dark:text-white/80">
            <span className="capitalize">{field}</span>
            <input
              type="color"
              value={draft[field]}
              onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
              aria-label={`${field} color`}
            />
            <code className="text-xs text-gray-500 dark:text-white/50">{draft[field]}</code>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-4">
        <AdminFontPicker kind="Heading" value={draft.headingFont} onChange={(headingFont) => setDraft({ ...draft, headingFont })} />
        <AdminFontPicker kind="Body" value={draft.bodyFont} onChange={(bodyFont) => setDraft({ ...draft, bodyFont })} />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm text-gray-700 dark:text-white/80">
        <label className="flex items-center gap-2">
          <span>Logo {draft.logo ? '(uploaded)' : ''}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload('logo', null, f)
            }}
          />
        </label>
      </div>

      <details className="text-sm text-gray-700 dark:text-white/80">
        <summary className="cursor-pointer font-medium">Section hero images</summary>
        <div className="mt-2 space-y-2">
          {SECTION_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-2">
              <span className="w-32">{key}{draft.sectionHeroes[key] ? ' ✓' : ''}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void upload('hero', key, f)
                }}
              />
            </label>
          ))}
        </div>
      </details>

      {/* Shared public-renderer preview (PR2): the real SectionShell +
          theming primitives with the draft theme, live fonts included. */}
      <ThemePreview theme={draft} />

      <button
        onClick={() => void save()}
        disabled={busy}
        className="rounded bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save theme'}
      </button>
    </div>
  )
}
