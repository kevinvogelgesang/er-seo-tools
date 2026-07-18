'use client'

// Welcome note, per-section intro/narrative text, and per-client content
// overrides (strategy adjustments, process/milestones, etc.).

import { useState } from 'react'
import { SECTION_KEYS, type SectionKey } from '@/lib/viewbook/theme'
import { OVERRIDE_ELIGIBLE_KEYS } from '@/lib/viewbook/global-content-keys'
import { jsonFetch } from './viewbook-admin-shared'
import { useBaselineSync, useEditorActivity, useFocusWithin } from '@/components/viewbook/public/useViewbookSync'
import { SECTION_TITLES } from '@/components/viewbook/public/section-titles'
import {
  ViewbookEditorPanel,
  ViewbookEditorStatus,
  editorDestructiveBtnClass,
  editorLabelClass,
  editorPrimaryBtnClass,
  editorTextareaClass,
  editorWellClass,
} from '@/components/viewbook/editor'
import { StatusPill } from '@/components/ui/StatusPill'
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

const OVERRIDE_TITLES: Record<(typeof OVERRIDE_ELIGIBLE_KEYS)[number], string> = {
  process: 'Process',
  why: 'Why it matters',
  'seo-base': 'SEO foundation',
  'geo-base': 'GEO foundation',
  'eeat-base': 'E-E-A-T foundation',
  'process-milestones': 'Process milestones',
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
    <div className="space-y-8 font-body text-sm">
      {(error || savedFlash) && (
        <div aria-live="polite" className={error ? 'rounded-lg bg-red-50 p-3 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'rounded-lg bg-green-50 p-3 text-green-700 dark:bg-green-500/10 dark:text-green-300'}>
          {error ?? `Saved ${savedFlash}.`}
        </div>
      )}

      <StrategyDocsCard viewbookId={viewbookId} />

      <section className="space-y-3">
        <div>
          <h2 className="font-display text-base font-bold text-navy dark:text-white">Welcome</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Set the short note shown near the beginning of this client’s viewbook.</p>
        </div>
        <div data-content-editor onFocus={onFocus} onBlur={onBlur} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="viewbook-welcome-note" className="font-display font-semibold text-navy dark:text-white">Welcome note</label>
            <ViewbookEditorStatus state={busy ? 'saving' : welcomeDirty ? 'dirty' : savedFlash === 'welcome note' ? 'saved' : 'idle'} />
          </div>
          <textarea
            id="viewbook-welcome-note"
            value={welcome}
            onChange={(event) => setWelcome(event.target.value)}
            rows={3}
            placeholder="A brief welcome for this client"
            className={editorTextareaClass}
          />
          <button
            type="button"
            disabled={busy}
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
            className={`mt-3 ${editorPrimaryBtnClass}`}
          >
            <span className="sr-only">Save welcome note</span>
            <span aria-hidden="true">Save</span>
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-display text-base font-bold text-navy dark:text-white">Section copy</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Add contextual copy to individual viewbook sections. Each section saves independently.</p>
        </div>
        {SECTION_KEYS.map((key) => {
          const section = sections.find((item) => item.sectionKey === key)
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
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-display text-base font-bold text-navy dark:text-white">Client overrides</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Global content remains the default. Add an override only where this client needs different copy.</p>
        </div>
        {OVERRIDE_ELIGIBLE_KEYS.map((key) => (
          <OverrideRowEditor
            key={key}
            viewbookId={viewbookId}
            contentKey={key}
            body={overrides.find((item) => item.contentKey === key)?.body ?? ''}
            run={run}
          />
        ))}
      </section>
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
  sectionKey: SectionKey
  introNote: string | null
  narrative: string | null
  showNarrative: boolean
  run: (label: string, fn: () => Promise<unknown>, onSuccess?: () => void) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const { focused, onFocus, onBlur } = useFocusWithin()
  const { draft: intro, setDraft: setIntro, dirty: introDirty, commit: commitIntro } =
    useBaselineSync(introNote ?? '', focused)
  const { draft: narrativeDraft, setDraft: setNarrative, dirty: narrativeDirty, commit: commitNarrative } =
    useBaselineSync(narrative ?? '', focused)
  const dirty = introDirty || (showNarrative && narrativeDirty)
  useEditorActivity(`admin-content-section-${sectionKey}`, dirty || focused)

  const title = SECTION_TITLES[sectionKey]
  return (
    <div onFocus={onFocus} onBlur={onBlur}>
      <ViewbookEditorPanel
        title={title}
        description="Section copy"
        open={dirty || open}
        onOpenChange={setOpen}
        status={<ViewbookEditorStatus state={dirty ? 'dirty' : 'idle'} />}
      >
        <div className="space-y-3">
          <label className={editorLabelClass}>
            Intro note
            <span className="mt-0.5 block font-normal text-gray-500 dark:text-white/50">Shown directly under this section’s heading.</span>
            <textarea value={intro} onChange={(event) => setIntro(event.target.value)} rows={2} placeholder="Intro note (shown under the section header)" className={`mt-1 ${editorTextareaClass}`} />
          </label>
          {showNarrative && (
            <label className={editorLabelClass}>
              {sectionKey === 'brand' ? 'Design philosophy' : 'Assessment narrative'}
              <textarea
                value={narrativeDraft}
                onChange={(event) => setNarrative(event.target.value)}
                rows={4}
                placeholder={sectionKey === 'brand' ? 'Design philosophy prose' : 'Assessment narrative'}
                className={`mt-1 ${editorTextareaClass}`}
              />
            </label>
          )}
          <button
            type="button"
            onClick={() =>
              void run(
                sectionKey,
                () =>
                  jsonFetch(`/api/viewbooks/${viewbookId}/sections/${sectionKey}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(
                      showNarrative ? { introNote: intro || null, narrative: narrativeDraft || null } : { introNote: intro || null },
                    ),
                  }),
                () => {
                  commitIntro(intro)
                  if (showNarrative) commitNarrative(narrativeDraft)
                },
              )
            }
            className={editorPrimaryBtnClass}
          >
            Save {title}
          </button>
        </div>
      </ViewbookEditorPanel>
    </div>
  )
}

function OverrideRowEditor({
  viewbookId,
  contentKey,
  body,
  run,
}: {
  viewbookId: number
  contentKey: (typeof OVERRIDE_ELIGIBLE_KEYS)[number]
  body: string
  run: (label: string, fn: () => Promise<unknown>, onSuccess?: () => void) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const { focused, onFocus, onBlur } = useFocusWithin()
  const { draft: text, setDraft: setText, dirty: textDirty, commit: commitText } = useBaselineSync(body, focused)
  useEditorActivity(`admin-content-override-${contentKey}`, textDirty || focused)
  const overrideState = body ? 'Client override' : 'Using global content'

  return (
    <div onFocus={onFocus} onBlur={onBlur}>
      <ViewbookEditorPanel
        title={OVERRIDE_TITLES[contentKey]}
        description="Client-specific content"
        open={textDirty || open}
        onOpenChange={setOpen}
        status={(
          <span className="flex flex-wrap items-center justify-end gap-2">
            {textDirty && <ViewbookEditorStatus state="dirty" />}
            <StatusPill label={overrideState} tone={body ? 'running' : 'neutral'} />
          </span>
        )}
      >
        <div className="space-y-3">
          <div className={editorWellClass}>
            <p className="font-semibold text-navy dark:text-white">{overrideState}</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-white/55">
              {body ? 'This copy replaces the inherited global content for this client.' : 'Leave this empty to continue inheriting the centrally managed global content.'}
            </p>
          </div>
          <label className={editorLabelClass}>
            Override copy
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={4}
              placeholder="Client-specific adjustments to the base plan (plain text)"
              className={`mt-1 ${editorTextareaClass}`}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
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
              className={editorPrimaryBtnClass}
            >
              Save
            </button>
            {body && (
              <button
                type="button"
                onClick={() =>
                  void run(
                    `${contentKey} (removed)`,
                    () => jsonFetch(`/api/viewbooks/${viewbookId}/overrides/${contentKey}`, { method: 'DELETE' }),
                    () => commitText(''),
                  )
                }
                className={editorDestructiveBtnClass}
              >
                Remove override
              </button>
            )}
          </div>
        </div>
      </ViewbookEditorPanel>
    </div>
  )
}
