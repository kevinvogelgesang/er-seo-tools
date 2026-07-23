'use client'

// F1b Task 9 — one section's editor: title (own Save — patchSectionTemplate
// treats title and copy as independently-optional), section copy (own
// Save — ported from SectionCopyEditor's field layout + caps display), the
// subsection list, and the add-subsection form.
import { useEffect, useState } from 'react'
import { StatusPill } from '@/components/ui/StatusPill'
import {
  editorInputClass,
  editorLabelClass,
  editorPrimaryBtnClass,
  editorSecondaryBtnClass,
  editorTextareaClass,
} from '@/components/viewbook/editor'
import { jsonFetch } from '../viewbook-admin-shared'
import { SubsectionPanel } from './SubsectionPanel'
import { F2_HELPER_TEXT, FIELD_KEY_RE, SECTION_COPY_CAPS, type TemplateSectionView } from './template-editor-types'

type Mutate = (label: string, fn: () => Promise<unknown>) => Promise<boolean>

export function SectionPanel({
  section,
  mutate,
  onMoveUp,
  onMoveDown,
}: {
  section: TemplateSectionView
  mutate: Mutate
  onMoveUp?: () => void
  onMoveDown?: () => void
}) {
  return (
    <section data-section-key={section.templateKey} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card">
      <SectionHeader section={section} mutate={mutate} onMoveUp={onMoveUp} onMoveDown={onMoveDown} />
      <div className="mt-4">
        {section.copy === null ? (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            This section&apos;s copy is corrupt and can&apos;t be edited here — contact engineering.
          </p>
        ) : (
          <SectionCopyForm section={section} copy={section.copy} mutate={mutate} />
        )}
      </div>
      <div className="mt-4 space-y-3">
        {section.subsections.map((subsection) => (
          <SubsectionPanel key={subsection.id} section={section} subsection={subsection} mutate={mutate} />
        ))}
      </div>
      <div className="mt-4">
        <AddSubsectionForm section={section} mutate={mutate} />
      </div>
    </section>
  )
}

function SectionHeader({
  section,
  mutate,
  onMoveUp,
  onMoveDown,
}: {
  section: TemplateSectionView
  mutate: Mutate
  onMoveUp?: () => void
  onMoveDown?: () => void
}) {
  const [title, setTitle] = useState(section.title)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  useEffect(() => setTitle(section.title), [section.title])

  function save() {
    setSaveState('saving')
    void mutate(`${section.templateKey} title`, () => jsonFetch(`/api/viewbook-templates/sections/${section.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: section.version, title }),
    })).then((ok) => {
      setSaveState(ok ? 'saved' : 'failed')
      setTimeout(() => setSaveState('idle'), 4000)
    })
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <label className={`min-w-0 flex-1 ${editorLabelClass}`}>
        Section title
        <input aria-label={`Section title — ${section.templateKey}`} value={title} onChange={(event) => setTitle(event.target.value)} className={`mt-1 ${editorInputClass}`} />
        <span className="mt-1 block text-[11px] text-gray-500 dark:text-white/45">{F2_HELPER_TEXT}</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill label={section.templateKey} tone="neutral" />
        <StatusPill label={`${section.subsections.length} ${section.subsections.length === 1 ? 'subsection' : 'subsections'}`} tone="neutral" />
        {onMoveUp && <button type="button" aria-label={`Move ${section.templateKey} up`} onClick={onMoveUp} className={editorSecondaryBtnClass}>↑</button>}
        {onMoveDown && <button type="button" aria-label={`Move ${section.templateKey} down`} onClick={onMoveDown} className={editorSecondaryBtnClass}>↓</button>}
        <button type="button" aria-label={`Save ${section.templateKey} title`} disabled={saveState === 'saving'} onClick={save} className={editorPrimaryBtnClass}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : saveState === 'failed' ? 'Retry' : 'Save title'}
        </button>
      </div>
    </div>
  )
}

function SectionCopyForm({
  section,
  copy,
  mutate,
}: {
  section: TemplateSectionView
  copy: { purpose: string; whatThis: string; whatWeNeed: string | null }
  mutate: Mutate
}) {
  const [purpose, setPurpose] = useState(copy.purpose)
  const [whatThis, setWhatThis] = useState(copy.whatThis)
  const [whatWeNeed, setWhatWeNeed] = useState(copy.whatWeNeed ?? '')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')

  useEffect(() => setPurpose(copy.purpose), [copy.purpose])
  useEffect(() => setWhatThis(copy.whatThis), [copy.whatThis])
  useEffect(() => setWhatWeNeed(copy.whatWeNeed ?? ''), [copy.whatWeNeed])

  function save() {
    setSaveState('saving')
    void mutate(`${section.templateKey} copy`, () => jsonFetch(`/api/viewbook-templates/sections/${section.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: section.version,
        copy: { purpose, whatThis, whatWeNeed: whatWeNeed.trim() === '' ? null : whatWeNeed },
      }),
    })).then((ok) => {
      setSaveState(ok ? 'saved' : 'failed')
      setTimeout(() => setSaveState('idle'), 4000)
    })
  }

  return (
    <div className="space-y-2">
      <label className={editorLabelClass}>
        Purpose
        <textarea aria-label="Purpose" value={purpose} maxLength={SECTION_COPY_CAPS.purpose} onChange={(event) => setPurpose(event.target.value)} rows={2} className={`mt-1 ${editorTextareaClass}`} />
        <span className="mt-1 block text-[11px] text-gray-500 dark:text-white/45">{purpose.length}/{SECTION_COPY_CAPS.purpose}</span>
      </label>
      <label className={editorLabelClass}>
        What this is
        <textarea aria-label="What this is" value={whatThis} maxLength={SECTION_COPY_CAPS.whatThis} onChange={(event) => setWhatThis(event.target.value)} rows={2} className={`mt-1 ${editorTextareaClass}`} />
        <span className="mt-1 block text-[11px] text-gray-500 dark:text-white/45">{whatThis.length}/{SECTION_COPY_CAPS.whatThis}</span>
      </label>
      <label className={editorLabelClass}>
        What we need
        <textarea aria-label="What we need" value={whatWeNeed} maxLength={SECTION_COPY_CAPS.whatWeNeed} onChange={(event) => setWhatWeNeed(event.target.value)} rows={2} className={`mt-1 ${editorTextareaClass}`} />
        <span className="mt-1 block text-[11px] text-gray-500 dark:text-white/45">{whatWeNeed.length}/{SECTION_COPY_CAPS.whatWeNeed}</span>
      </label>
      <div className="flex items-center gap-2 pt-1">
        <button type="button" aria-label={`Save ${section.templateKey} section copy`} disabled={saveState === 'saving'} onClick={save} className={editorPrimaryBtnClass}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : saveState === 'failed' ? 'Save failed — retry' : 'Save section copy'}
        </button>
        {saveState === 'failed' && (
          <span role="alert" className="text-xs font-semibold text-red-700 dark:text-red-300">See the error at the top of the page.</span>
        )}
      </div>
    </div>
  )
}

function AddSubsectionForm({ section, mutate }: { section: TemplateSectionView; mutate: Mutate }) {
  const [subsectionKey, setSubsectionKey] = useState('')
  const [title, setTitle] = useState('')
  const [offeringWebsite, setOfferingWebsite] = useState(false)
  const [offeringVa, setOfferingVa] = useState(false)
  const [offeringPpc, setOfferingPpc] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)

  async function add() {
    if (!FIELD_KEY_RE.test(subsectionKey)) {
      setKeyError('Invalid key — a-z, 0-9, dashes.')
      return
    }
    setKeyError(null)
    const ok = await mutate('subsection', () => jsonFetch(`/api/viewbook-templates/sections/${section.id}/subsections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: section.version, subsectionKey, title, offeringWebsite, offeringVa, offeringPpc }),
    }))
    if (ok) {
      setSubsectionKey('')
      setTitle('')
      setOfferingWebsite(false)
      setOfferingVa(false)
      setOfferingPpc(false)
    }
  }

  return (
    <div data-testid="add-subsection-form" className="rounded-lg border border-dashed border-gray-300 p-3 dark:border-navy-border">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-white/45">Add subsection</h4>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className={editorLabelClass}>
          Subsection key
          <input aria-label="Subsection key" value={subsectionKey} onChange={(event) => setSubsectionKey(event.target.value)} placeholder="new-key" className={`mt-1 ${editorInputClass}`} />
        </label>
        <label className={editorLabelClass}>
          Subsection title
          <input aria-label="Subsection title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" className={`mt-1 ${editorInputClass}`} />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs font-medium text-gray-600 dark:text-white/65">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={offeringWebsite} onChange={(event) => setOfferingWebsite(event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500 dark:border-navy-border dark:bg-navy-light" />
          Website
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={offeringVa} onChange={(event) => setOfferingVa(event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500 dark:border-navy-border dark:bg-navy-light" />
          VA
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={offeringPpc} onChange={(event) => setOfferingPpc(event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500 dark:border-navy-border dark:bg-navy-light" />
          PPC
        </label>
      </div>
      {keyError && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{keyError}</p>}
      <div className="mt-2">
        <button type="button" onClick={() => void add()} className={editorSecondaryBtnClass}>Add subsection</button>
      </div>
    </div>
  )
}
