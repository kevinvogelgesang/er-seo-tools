'use client'

// Viewbook UX pass, Lane 4 Task 7 — the OPERATOR note editors for the
// assessment tab. Mounted by AssessmentSection ONLY when a verified operator
// is present; a public viewer never receives this client bundle.
//
// Design D6: the note BODIES are inline value editors, so they AUTOSAVE via
// the shared Lane-2 useAutosave + useBaselineSync state machine (trailing
// debounce, serialized in-flight, generation-guarded, blur-flush) — there is
// NO explicit Save button. Both editors register their dirty/saving state
// through useAutosave's `editorId`, so the single page refresher
// (useViewbookSync) never lands a router.refresh() mid-edit.
//
// Image add/delete are STRUCTURAL actions (not reversible text edits) and keep
// explicit controls; they register editor activity while in flight and call
// requestRefresh() on success so the server component reloads the gallery.
//
// LIGHT-ONLY: the public viewbook surface has no dark mode. (RichTextEditor is
// the shared admin editor and carries its own dark: variants, inert here.)
import { useEffect, useRef, useState } from 'react'
import { RichTextEditor } from '@/components/richtext/RichTextEditor'
import type { PublicAssessmentImage } from '@/lib/viewbook/public-types'
import { publicAssetUrl } from './ThemeStyle'
import {
  requestRefresh,
  useAutosave,
  useBaselineSync,
  useEditorActivity,
  useFocusWithin,
} from './useViewbookSync'

type NoteField = 'general' | 'userBehaviour'

async function postJsonError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  throw new Error(body.error || `${fallback}_${res.status}`)
}

function NoteEditor({
  viewbookId,
  field,
  label,
  ariaLabel,
  initialHtml,
  children,
}: {
  viewbookId: number
  field: NoteField
  label: string
  ariaLabel: string
  initialHtml: string
  children?: React.ReactNode
}) {
  const focus = useFocusWithin()
  const { draft, setDraft, dirty, commit } = useBaselineSync(initialHtml, focus.focused)
  const autosave = useAutosave<string, string>({
    editorId: `assessment-note-${field}-${viewbookId}`,
    draft,
    dirty,
    active: focus.focused,
    save: async (html) => {
      const res = await fetch(`/api/viewbooks/${viewbookId}/assessment/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, html }),
      })
      if (!res.ok) await postJsonError(res, 'save_failed')
      return html
    },
    commit,
  })

  return (
    <div>
      <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
        {label}
      </h3>
      <div
        className="mt-2"
        onFocus={focus.onFocus}
        onBlur={(event) => {
          focus.onBlur(event)
          autosave.flushOnBlur(event)
        }}
      >
        <RichTextEditor value={draft} onChange={setDraft} ariaLabel={ariaLabel} />
        {autosave.saving && <p aria-live="polite" className="mt-1 text-xs text-gray-500">Saving…</p>}
        {autosave.error && <p role="alert" className="mt-1 text-xs text-red-700">{autosave.error}</p>}
        {children}
      </div>
    </div>
  )
}

function UserBehaviourImages({
  viewbookId,
  token,
  initialImages,
}: {
  viewbookId: number
  token: string
  initialImages: PublicAssessmentImage[]
}) {
  const [images, setImages] = useState(initialImages)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Adopt the reloaded gallery after add/delete (router.refresh brings fresh
  // props). Safe while idle — the busy registration below gates the refresher
  // so this never fires mid-upload.
  useEffect(() => setImages(initialImages), [initialImages])
  useEditorActivity(`assessment-images-${viewbookId}`, busy)

  async function add(file: File) {
    setBusy(true)
    setError(null)
    const form = new FormData()
    form.set('file', file)
    try {
      const res = await fetch(`/api/viewbooks/${viewbookId}/assessment/images`, { method: 'POST', body: form })
      if (!res.ok) await postJsonError(res, 'upload_failed')
      requestRefresh() // POST returns only { filename }; reload to get the id-bearing row
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'upload_failed')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function remove(id: number) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/viewbooks/${viewbookId}/assessment/images/${id}`, { method: 'DELETE' })
      if (!res.ok) await postJsonError(res, 'delete_failed')
      setImages((current) => current.filter((img) => img.id !== id))
      requestRefresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'delete_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3">
      {images.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {images.map((img) => (
            <div key={img.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={publicAssetUrl(token, img.filename)}
                alt=""
                className="w-full rounded-lg border border-gray-300"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(img.id)}
                aria-label={`Delete image ${img.filename}`}
                className="absolute right-2 top-2 rounded bg-white/90 px-2 py-1 text-xs font-medium text-red-700 shadow disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
      <label className="mt-2 block text-xs font-medium text-gray-600">
        Add image
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void add(file)
          }}
          className="mt-1 block text-xs"
        />
      </label>
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  )
}

export function AssessmentNotesEditors({
  viewbookId,
  token,
  generalHtml,
  userBehaviourHtml,
  images,
}: {
  viewbookId: number
  token: string
  generalHtml: string
  userBehaviourHtml: string
  images: PublicAssessmentImage[]
}) {
  return (
    <>
      <NoteEditor
        viewbookId={viewbookId}
        field="general"
        label="General notes"
        ariaLabel="General assessment notes"
        initialHtml={generalHtml}
      />
      <NoteEditor
        viewbookId={viewbookId}
        field="userBehaviour"
        label="User Behaviour"
        ariaLabel="User behaviour notes"
        initialHtml={userBehaviourHtml}
      >
        <UserBehaviourImages viewbookId={viewbookId} token={token} initialImages={images} />
      </NoteEditor>
    </>
  )
}
