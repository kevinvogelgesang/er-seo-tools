'use client'

import { useEffect, useState } from 'react'
import type { OperatorSectionData } from '@/lib/viewbook/operator-data'
import { requestRefresh, useEditorActivity, useFocusWithin } from '../useViewbookSync'
import { operatorRequest } from './operator-api'

const ACKABLE = new Set(['pc-setup', 'pc-invite', 'data-source'])
const NOT_DONEABLE = new Set(['pc-intro', 'pc-thanks'])

export function sectionSupportsDone(sectionKey: string): boolean {
  return !NOT_DONEABLE.has(sectionKey)
}

export function sectionSupportsAck(sectionKey: string): boolean {
  return ACKABLE.has(sectionKey)
}

export function SectionQuickControls({
  viewbookId,
  section,
  pcCompletedAt,
}: {
  viewbookId: number
  section: OperatorSectionData
  pcCompletedAt: string | null
}) {
  const [state, setState] = useState(section.state)
  const [acknowledgedAt, setAcknowledgedAt] = useState(section.acknowledgedAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const focus = useFocusWithin()
  useEditorActivity(`operator-section-controls-${section.sectionKey}`, busy || focus.focused)

  useEffect(() => setState(section.state), [section.state])
  useEffect(() => setAcknowledgedAt(section.acknowledgedAt), [section.acknowledgedAt])

  // The thanks card does not exist as an actionable state before the
  // completion stamp. In particular, do not expose an inert Hide control.
  if (section.sectionKey === 'pc-thanks' && pcCompletedAt === null) return null

  async function setSectionState(next: OperatorSectionData['state']) {
    const previous = state
    setState(next)
    setBusy(true)
    setError(null)
    try {
      await operatorRequest(`/api/viewbooks/${viewbookId}/sections/${section.sectionKey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: next }),
      })
      requestRefresh()
    } catch (caught) {
      setState(previous)
      setError(caught instanceof Error ? caught.message : 'section_update_failed')
    } finally {
      setBusy(false)
    }
  }

  async function resetAck() {
    const previous = acknowledgedAt
    setAcknowledgedAt(null)
    setBusy(true)
    setError(null)
    try {
      await operatorRequest(`/api/viewbooks/${viewbookId}/ack/${section.sectionKey}`, { method: 'DELETE' })
      requestRefresh()
    } catch (caught) {
      setAcknowledgedAt(previous)
      setError(caught instanceof Error ? caught.message : 'ack_reset_failed')
    } finally {
      setBusy(false)
    }
  }

  const doneable = sectionSupportsDone(section.sectionKey)
  return (
    <div
      data-operator-section-controls={section.sectionKey}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      className="flex flex-wrap items-center gap-2 border-y border-teal-800/15 bg-teal-50 px-4 py-2 text-xs text-teal-950"
    >
      <span className="font-semibold">ER · {section.sectionKey}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void setSectionState(state === 'hidden' ? 'active' : 'hidden')}
        className="rounded border border-teal-900/20 bg-white px-2 py-1 font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
      >
        {state === 'hidden' ? 'Show' : 'Hide'}
      </button>
      {doneable && state !== 'hidden' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void setSectionState(state === 'done' ? 'active' : 'done')}
          className="rounded border border-teal-900/20 bg-white px-2 py-1 font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        >
          {state === 'done' ? 'Reopen' : 'Mark done'}
        </button>
      )}
      {sectionSupportsAck(section.sectionKey) && acknowledgedAt && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void resetAck()}
          className="rounded border border-amber-700/25 bg-amber-50 px-2 py-1 font-medium text-amber-900 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
        >
          Reset ack
        </button>
      )}
      {error && <span role="alert" className="font-medium text-red-700">{error}</span>}
    </div>
  )
}
