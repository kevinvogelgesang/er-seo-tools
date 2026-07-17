'use client'

// Welcome note, per-section intro/narrative text, and per-client "your plan"
// content overrides.

import { useState } from 'react'
import { SECTION_KEYS } from '@/lib/viewbook/theme'
import { OVERRIDE_ELIGIBLE_KEYS } from '@/lib/viewbook/global-content-keys'
import { jsonFetch } from './viewbook-admin-shared'
import { useBaselineSync, useEditorActivity, useFocusWithin } from '@/components/viewbook/public/useViewbookSync'
import { StrategyDocsCard } from './StrategyDocsCard'

interface SectionRow {
  sectionKey: string
  state: string
  introNote: string | null
  narrative: string | null
}

interface OverrideRow {
  contentKey: string
  body: string
}

export function ContentTab({
  viewbookId,
  welcomeNote,
  sections,
  overrides,
  onChanged,
}: {
  viewbookId: number
  welcomeNote: string | null
  sections: SectionRow[]
  overrides: OverrideRow[]
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { focused, onFocus, onBlur } = useFocusWithin()

  // Final-review fix (P1): `welcome` used to be seeded ONCE from
  // `welcomeNote` and dirty was computed directly against the raw prop, so a
  // background `load()` advancing `welcomeNote` (including THIS tab's own
  // save landing) left `welcomeDirty` stuck true forever. `useBaselineSync`
  // reconciles while idle and `commitWelcome()` is called immediately on a
  // successful save (see `run`'s `onSuccess` param below).
  const { draft: welcome, setDraft: setWelcome, dirty: welcomeDirty, commit: commitWelcome } =
    useBaselineSync(welcomeNote ?? '', focused || busy)
  useEditorActivity('admin-content-welcome', welcomeDirty || busy || focused)

  async function run(label: string, fn: () => Promise<unknown>, onSuccess?: () => void) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onSuccess?.()
      setSavedFlash(label)
      setTimeout(() => setSavedFlash(null), 1500)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6 text-sm">
      {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
      {savedFlash && <p className="text-teal-600 dark:text-teal-400">Saved {savedFlash}.</p>}

      <StrategyDocsCard viewbookId={viewbookId} />

      <div onFocus={onFocus} onBlur={onBlur}>
        <label className="mb-1 block font-medium text-gray-700 dark:text-white/80">Welcome note</label>
        <textarea
          value={welcome}
          onChange={(e) => setWelcome(e.target.value)}
          rows={2}
          className="w-full rounded border border-gray-300 bg-white p-2 dark:border-navy-border dark:bg-navy-card dark:text-white"
        />
        <button
          onClick={() =>
            void run(
              'welcome note',
              () =>
                jsonFetch(`/api/viewbooks/${viewbookId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ welcomeNote: welcome || null }),
                }),
              () => commitWelcome(welcome),
            )
          }
          className="mt-1 rounded bg-teal-600 px-3 py-1 text-white hover:bg-teal-700"
        >
          Save
        </button>
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold text-gray-700 dark:text-white/80">Section intros & narratives</h3>
        {SECTION_KEYS.map((key) => {
          const section = sections.find((s) => s.sectionKey === key)
          return (
            <SectionTextRow
              key={key}
              viewbookId={viewbookId}
              sectionKey={key}
              introNote={section?.introNote ?? null}
              narrative={section?.narrative ?? null}
              showNarrative={key === 'assessment' || key === 'brand'}
              run={run}
            />
          )
        })}
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold text-gray-700 dark:text-white/80">Client-specific strategy adjustments (&ldquo;your plan&rdquo;)</h3>
        {OVERRIDE_ELIGIBLE_KEYS.map((key) => (
          <OverrideRowEditor
            key={key}
            viewbookId={viewbookId}
            contentKey={key}
            body={overrides.find((o) => o.contentKey === key)?.body ?? ''}
            run={run}
          />
        ))}
      </div>
    </div>
  )
}

function SectionTextRow({
  viewbookId,
  sectionKey,
  introNote,
  narrative,
  showNarrative,
  run,
}: {
  viewbookId: number
  sectionKey: string
  introNote: string | null
  narrative: string | null
  showNarrative: boolean
  run: (label: string, fn: () => Promise<unknown>, onSuccess?: () => void) => Promise<void>
}) {
  const { focused, onFocus, onBlur } = useFocusWithin()

  // Final-review fix (P1): see the welcome-note comment in ContentTab above
  // — same baseline-reconciliation pattern, applied per-row. No `busy` guard
  // here since this row has no local busy state of its own (saves route
  // through the shared `run` in the parent).
  const { draft: intro, setDraft: setIntro, dirty: introDirty, commit: commitIntro } =
    useBaselineSync(introNote ?? '', focused)
  const { draft: narr, setDraft: setNarr, dirty: narrDirty, commit: commitNarr } =
    useBaselineSync(narrative ?? '', focused)
  const dirty = introDirty || (showNarrative && narrDirty)
  useEditorActivity(`admin-content-section-${sectionKey}`, dirty || focused)

  return (
    <details className="rounded border border-gray-200 p-2 dark:border-navy-border" onFocus={onFocus} onBlur={onBlur}>
      <summary className="cursor-pointer font-medium text-gray-700 dark:text-white/80">{sectionKey}</summary>
      <div className="mt-2 space-y-2">
        <textarea
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          rows={2}
          placeholder="Intro note (shown under the section header)"
          className="w-full rounded border border-gray-300 bg-white p-2 dark:border-navy-border dark:bg-navy-card dark:text-white"
        />
        {showNarrative && (
          <textarea
            value={narr}
            onChange={(e) => setNarr(e.target.value)}
            rows={4}
            placeholder={sectionKey === 'brand' ? 'Design philosophy prose' : 'Assessment narrative'}
            className="w-full rounded border border-gray-300 bg-white p-2 dark:border-navy-border dark:bg-navy-card dark:text-white"
          />
        )}
        <button
          onClick={() =>
            void run(
              sectionKey,
              () =>
                jsonFetch(`/api/viewbooks/${viewbookId}/sections/${sectionKey}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(
                    showNarrative ? { introNote: intro || null, narrative: narr || null } : { introNote: intro || null },
                  ),
                }),
              () => {
                commitIntro(intro)
                if (showNarrative) commitNarr(narr)
              },
            )
          }
          className="rounded bg-teal-600 px-3 py-1 text-white hover:bg-teal-700"
        >
          Save
        </button>
      </div>
    </details>
  )
}

function OverrideRowEditor({
  viewbookId,
  contentKey,
  body,
  run,
}: {
  viewbookId: number
  contentKey: string
  body: string
  run: (label: string, fn: () => Promise<unknown>, onSuccess?: () => void) => Promise<void>
}) {
  const { focused, onFocus, onBlur } = useFocusWithin()

  // Final-review fix (P1): same baseline-reconciliation pattern as the
  // welcome note / section rows above.
  const { draft: text, setDraft: setText, dirty: textDirty, commit: commitText } = useBaselineSync(body, focused)
  useEditorActivity(`admin-content-override-${contentKey}`, textDirty || focused)

  return (
    <details className="rounded border border-gray-200 p-2 dark:border-navy-border" onFocus={onFocus} onBlur={onBlur}>
      <summary className="cursor-pointer font-medium text-gray-700 dark:text-white/80">{contentKey}</summary>
      <div className="mt-2 space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Client-specific adjustments to the base plan (plain text)"
          className="w-full rounded border border-gray-300 bg-white p-2 dark:border-navy-border dark:bg-navy-card dark:text-white"
        />
        <div className="flex gap-2">
          <button
            onClick={() =>
              void run(
                contentKey,
                () =>
                  jsonFetch(`/api/viewbooks/${viewbookId}/overrides/${contentKey}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ body: text }),
                  }),
                () => commitText(text),
              )
            }
            disabled={!text}
            className="rounded bg-teal-600 px-3 py-1 text-white hover:bg-teal-700 disabled:opacity-50"
          >
            Save
          </button>
          {body && (
            <button
              onClick={() =>
                void run(
                  `${contentKey} (removed)`,
                  () => jsonFetch(`/api/viewbooks/${viewbookId}/overrides/${contentKey}`, { method: 'DELETE' }),
                  () => commitText(''),
                )
              }
              className="rounded border border-red-300 px-3 py-1 text-red-600 hover:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              Remove override
            </button>
          )}
        </div>
      </div>
    </details>
  )
}
