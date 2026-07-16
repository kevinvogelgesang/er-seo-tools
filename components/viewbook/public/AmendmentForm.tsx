'use client'

import { FormEvent, useEffect, useState } from 'react'
import { registerEditorActivity, requestRefresh } from './useViewbookSync'

function amendmentValue(fieldType: string, draft: string): string | string[] {
  if (fieldType !== 'list') return draft
  return draft.split('\n').map((item) => item.trim()).filter(Boolean)
}

export function AmendmentForm({
  token,
  fieldId,
  fieldType,
  label,
}: {
  token: string
  fieldId: number
  fieldType: string
  label: string
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)

  // PR2 Task 6: active while there's an unsaved proposed change, mid-submit,
  // or focused — dispose on unmount.
  const registryId = `amendment-${fieldId}`
  useEffect(() => {
    registerEditorActivity(registryId, focused || busy || draft.trim() !== '')
    return () => registerEditorActivity(registryId, false)
  }, [registryId, focused, busy, draft])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/viewbook/${encodeURIComponent(token)}/answers`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'amend',
          fieldId,
          value: amendmentValue(fieldType, draft),
          clientMutationId: crypto.randomUUID(),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Could not propose this change.')
      setDraft('')
      requestRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not propose this change.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-lg bg-black/[0.03] p-3">
      <label className="block text-sm font-semibold text-black/60">
        Proposed change for {label}
        <textarea
          required
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          rows={fieldType === 'text' ? 2 : 4}
          placeholder={fieldType === 'list' ? 'One item per line' : 'Describe the corrected answer'}
          className="mt-1 w-full rounded-lg border border-black/15 bg-white p-3 font-normal text-black"
        />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button
        disabled={busy || !draft.trim()}
        className="rounded-lg bg-[var(--vb-primary)] px-4 py-2 text-sm font-semibold text-[var(--vb-on-primary)] disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Propose change'}
      </button>
    </form>
  )
}
