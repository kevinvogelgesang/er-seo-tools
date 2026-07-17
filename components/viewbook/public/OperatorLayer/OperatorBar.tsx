'use client'

import { useState } from 'react'
import { nextStage, prevStage, STAGE_LABELS, type ViewbookStage } from '@/lib/viewbook/stages'
import { PresentationToggle } from '../PresentationToggle'
import { requestRefresh, useEditorActivity } from '../useViewbookSync'
import { OperatorRequestError, operatorRequest } from './operator-api'

export function OperatorBar({
  viewbookId,
  operatorEmail,
  stage,
  pcCompletedAt,
}: {
  viewbookId: number
  operatorEmail: string
  stage: ViewbookStage
  pcCompletedAt: string | null
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEditorActivity('operator-stage-controls', busy)

  async function postMove(direction: 'forward' | 'back', force = false) {
    return operatorRequest(`/api/viewbooks/${viewbookId}/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, expectedStage: stage, ...(force ? { force: true } : {}) }),
    })
  }

  async function move(direction: 'forward' | 'back') {
    setBusy(true)
    setError(null)
    try {
      await postMove(direction)
      requestRefresh()
    } catch (caught) {
      if (
        caught instanceof OperatorRequestError &&
        caught.status === 409 &&
        caught.code === 'ack_incomplete' &&
        direction === 'forward' &&
        stage === 'post-contract' &&
        pcCompletedAt === null &&
        window.confirm('Acknowledgments are incomplete — advance anyway?')
      ) {
        try {
          await postMove(direction, true)
          requestRefresh()
          return
        } catch (forcedError) {
          setError(forcedError instanceof Error ? forcedError.message : 'stage_update_failed')
          return
        }
      }
      setError(caught instanceof Error ? caught.message : 'stage_update_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside
      id="vb-operator-bar"
      data-operator-bar
      aria-label="Viewbook editing controls"
      className="sticky top-0 z-50 border-b border-black/10 bg-white/95 px-4 py-2 text-sm text-black shadow-sm backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
        <span className="font-semibold">ER editing</span>
        <span className="rounded-full bg-teal-50 px-2.5 py-1 font-medium text-teal-800">{STAGE_LABELS[stage]}</span>
        <span className="text-xs text-black/45">{operatorEmail}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            disabled={busy || prevStage(stage) === null}
            onClick={() => void move('back')}
            className="rounded border border-black/15 bg-white px-3 py-1.5 font-medium text-black/70 disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          >
            Roll back
          </button>
          <button
            type="button"
            disabled={busy || nextStage(stage) === null}
            onClick={() => void move('forward')}
            className="rounded bg-teal-700 px-3 py-1.5 font-semibold text-white disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            {busy ? 'Updating…' : 'Advance'}
          </button>
          <PresentationToggle />
        </div>
      </div>
      {error && <p role="alert" className="mx-auto mt-1 max-w-6xl text-xs font-medium text-red-700">{error}</p>}
    </aside>
  )
}
