'use client'

import { useEffect, useState } from 'react'
import type { PublicField } from '@/lib/viewbook/public-types'
import { AmendmentForm } from './AmendmentForm'
import { requestRefresh, useEditorActivity } from './useViewbookSync'

function draftFromValue(fieldType: string, value: string | null): string {
  if (value == null) return ''
  if (fieldType !== 'list') return value
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed.join('\n')
  } catch {
    // Preserve malformed legacy text rather than blanking it in the editor.
  }
  return value
}

function requestValue(fieldType: string, draft: string): string | string[] | null {
  if (!draft) return null
  if (fieldType !== 'list') return draft
  return draft.split('\n').map((item) => item.trim()).filter(Boolean)
}

export function FieldEditor({ token, field }: { token: string; field: PublicField }) {
  const [current, setCurrent] = useState({ value: field.value, version: field.version })
  const [draft, setDraft] = useState(() => draftFromValue(field.fieldType, field.value))
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)

  // PR2 Task 6: this field is "active" (suppresses the shared refresher)
  // while focused, mid-save, or holding an unsaved draft — dispose on unmount.
  const dirty = draft !== draftFromValue(field.fieldType, current.value)
  const registryId = `field-${field.id}`
  useEditorActivity(registryId, focused || busy || dirty)

  // Final-review fix (P1): `current`/`draft` used to be seeded ONCE from the
  // `field` prop (`useState(field.value)`), so a router.refresh() that lands
  // a genuinely newer server value (another session's edit, or an amendment
  // approval) never reached this island — the stale draft just kept
  // showing. Reconcile while idle: adopt the incoming field value/version
  // ONLY when this field isn't focused/busy, the incoming prop is ACTUALLY
  // NEWER than what's already adopted (`field.version > current.version` —
  // NOT merely "different": `current` can already be ahead of the mount-time
  // `field` prop via a 409 conflict response or a successful save, and the
  // prop itself may not have caught up yet; a plain inequality check would
  // wrongly regress `current` back to that stale prop), AND the draft
  // hasn't locally diverged from the last-adopted value (an untouched
  // field, or one whose own save already landed via `current`) — a
  // genuinely dirty draft is left alone, matching the registry's existing
  // "never clobber a focused/dirty/busy editor" contract.
  useEffect(() => {
    if (focused || busy) return
    if (field.version <= current.version) return
    if (draft !== draftFromValue(field.fieldType, current.value)) return // diverged locally
    setCurrent({ value: field.value, version: field.version })
    setDraft(draftFromValue(field.fieldType, field.value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.value, field.version, focused, busy])

  async function save() {
    const value = requestValue(field.fieldType, draft)
    if (JSON.stringify(value) === JSON.stringify(requestValue(field.fieldType, draftFromValue(field.fieldType, current.value)))) {
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/viewbook/${encodeURIComponent(token)}/answers`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'edit', fieldId: field.id, value, expectedVersion: current.version }),
      })
      const body = await response.json().catch(() => ({}))
      if (response.status === 409 && body.current) {
        const next = { value: body.current.value as string | null, version: body.current.version as number }
        setCurrent(next)
        setDraft(draftFromValue(field.fieldType, next.value))
        if (body.error === 'data_locked') {
          setLocked(true)
          setMessage('These answers were just locked in.')
        } else {
          setMessage('A newer answer was loaded.')
        }
        return
      }
      if (!response.ok) throw new Error(body.error || 'Could not save this answer.')
      setCurrent({ value: body.field.value, version: body.field.version })
      setDraft(draftFromValue(field.fieldType, body.field.value))
      setMessage('Saved')
      requestRefresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save this answer.')
    } finally {
      setBusy(false)
    }
  }

  if (locked) {
    return (
      <div>
        {current.value == null || current.value === ''
          ? <p className="text-black/35">Not provided yet</p>
          : <p className="whitespace-pre-line">{draftFromValue(field.fieldType, current.value)}</p>}
        {message && <p aria-live="polite" className="mt-1 text-xs font-medium text-amber-700">{message}</p>}
        <AmendmentForm token={token} fieldId={field.id} fieldType={field.fieldType} label={field.label} />
      </div>
    )
  }

  const common = {
    'aria-label': `Answer for ${field.label}`,
    value: draft,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false)
      void save()
    },
    disabled: busy,
    className: 'mt-1 w-full rounded-lg border border-black/15 bg-white p-3 text-black disabled:opacity-60',
  }
  return (
    <div>
      <span className="sr-only">Current answer: {draft}</span>
      {field.fieldType === 'text'
        ? <input {...common} />
        : <textarea {...common} rows={field.fieldType === 'list' ? 4 : 5} placeholder={field.fieldType === 'list' ? 'One item per line' : undefined} />}
      {message && <p aria-live="polite" className="mt-1 text-xs text-black/50">{message}</p>}
    </div>
  )
}
