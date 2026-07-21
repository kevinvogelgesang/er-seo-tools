'use client'

// Company-wide Section copy editor (Feature A, Task 10) — /viewbooks/settings.
// Edits the ⓘ tooltip copy (purpose/whatThis/whatWeNeed) per section, rendered
// into every viewbook. Per-viewbook overrides live in each viewbook's own
// editor and are not touched here.
//
// Codex plan-fix 5: `initial[key]` is the RESOLVED value (code default ←
// company-wide) — it prefills the fields but CANNOT serve as the code default
// after a Reset/DELETE. Each row also gets `defaultCopy`, computed here from
// the client-safe `SECTION_COPY` module, and Reset restores THAT, not `initial`.
import { useState } from 'react'
import type { SectionKey } from '@/lib/viewbook/theme'
import type { ResolvedSectionCopy } from '@/lib/viewbook/section-copy-content'
import { SECTION_COPY } from '@/lib/viewbook/section-copy'
import { SECTION_TITLES } from '@/components/viewbook/public/section-titles'
import { jsonFetch } from './viewbook-admin-shared'
import {
  editorLabelClass,
  editorTextareaClass,
  editorPrimaryBtnClass,
  editorDestructiveBtnClass,
} from '@/components/viewbook/editor'

export function SectionCopyEditor({
  sectionKeys,
  initial,
}: {
  sectionKeys: readonly SectionKey[]
  initial: Record<SectionKey, ResolvedSectionCopy>
}) {
  return (
    <div className="space-y-6">
      {sectionKeys.map((key) => (
        <SectionRow
          key={key}
          sectionKey={key}
          initial={initial[key]}
          defaultCopy={{
            purpose: SECTION_COPY[key].purpose,
            whatThis: SECTION_COPY[key].whatThis,
            whatWeNeed: SECTION_COPY[key].whatWeNeed,
          }}
        />
      ))}
    </div>
  )
}

function SectionRow({
  sectionKey,
  initial,
  defaultCopy,
}: {
  sectionKey: SectionKey
  initial: ResolvedSectionCopy
  defaultCopy: ResolvedSectionCopy // code default — the post-Reset value
}) {
  const [purpose, setPurpose] = useState(initial.purpose)
  const [whatThis, setWhatThis] = useState(initial.whatThis)
  const [whatWeNeed, setWhatWeNeed] = useState(initial.whatWeNeed ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    setBusy(true)
    setErr(null)
    try {
      await jsonFetch(`/api/viewbooks/section-copy/${sectionKey}`, {
        method: 'PUT',
        body: JSON.stringify({
          purpose,
          whatThis,
          whatWeNeed: whatWeNeed.trim() === '' ? null : whatWeNeed,
        }),
      })
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  // Reset to default: await the DELETE FIRST, then reflect the CODE default
  // locally (Codex plan-fix 5 — `initial` is the resolved value, not the code
  // default; the reset must show the default, never fall back to `initial`).
  // A genuine (non-not_found) delete failure must NOT reset the fields — the
  // DB row still exists, so showing the default would lie about persisted
  // state. Tolerate `not_found` — no company-wide row existed means we're
  // already at default — and fall through to reset the fields in that case.
  const reset = async () => {
    setBusy(true)
    setErr(null)
    try {
      await jsonFetch(`/api/viewbooks/section-copy/${sectionKey}`, { method: 'DELETE' })
    } catch (e) {
      if (!(e instanceof Error && e.message === 'not_found')) {
        setErr(String(e))
        setBusy(false)
        return
      }
    }
    setPurpose(defaultCopy.purpose)
    setWhatThis(defaultCopy.whatThis)
    setWhatWeNeed(defaultCopy.whatWeNeed ?? '')
    setBusy(false)
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-navy-border p-4 space-y-2">
      <h3 className="font-semibold text-navy dark:text-white">{SECTION_TITLES[sectionKey]}</h3>
      <div>
        <label className={editorLabelClass}>Chapter one-liner — {sectionKey}</label>
        <textarea
          aria-label={`Chapter one-liner — ${sectionKey}`}
          className={editorTextareaClass}
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          disabled={busy}
        />
      </div>
      <div>
        <label className={editorLabelClass}>What this is — {sectionKey}</label>
        <textarea
          aria-label={`What this is — ${sectionKey}`}
          className={editorTextareaClass}
          value={whatThis}
          onChange={(e) => setWhatThis(e.target.value)}
          disabled={busy}
        />
      </div>
      <div>
        <label className={editorLabelClass}>What we need — {sectionKey}</label>
        <textarea
          aria-label={`What we need — ${sectionKey}`}
          className={editorTextareaClass}
          value={whatWeNeed}
          onChange={(e) => setWhatWeNeed(e.target.value)}
          disabled={busy}
        />
      </div>
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          aria-label={`Save ${sectionKey}`}
          disabled={busy}
          className={editorPrimaryBtnClass}
          onClick={save}
        >
          Save
        </button>
        <button
          type="button"
          aria-label={`Reset ${sectionKey} to default`}
          disabled={busy}
          className={editorDestructiveBtnClass}
          onClick={reset}
        >
          Reset to default
        </button>
      </div>
    </div>
  )
}
