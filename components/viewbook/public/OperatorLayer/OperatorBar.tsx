'use client'

import { useState } from 'react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { editorPrimaryBtnClass, editorSecondaryBtnClass } from '@/components/viewbook/editor'
import { StatusPill } from '@/components/ui/StatusPill'
import { nextStage, prevStage, STAGE_LABELS, type ViewbookStage } from '@/lib/viewbook/stages'
import { PresentationToggle, usePresentationMode } from '../PresentationToggle'
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
  const { initialized, presenting } = usePresentationMode()
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

  if (!initialized || presenting) return null

  return (
    <aside
      id="vb-operator-bar"
      data-operator-bar
      aria-label="Viewbook editing controls"
      className="sticky top-0 z-50 border-b border-gray-200 bg-white/90 font-body text-sm text-navy shadow-sm backdrop-blur-md dark:border-navy-border dark:bg-navy-deep/90 dark:text-white"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-2.5 sm:px-6 md:flex-row md:items-center">
        <div className="flex min-h-9 min-w-0 items-center gap-2.5">
          <span data-operator-status-dot aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-teal-500 shadow-[0_0_0_3px_rgba(20,184,166,0.15)] dark:bg-teal-400" />
          <span className="shrink-0 font-display font-bold">ER editing</span>
          <StatusPill label={STAGE_LABELS[stage]} tone="running" />
          <span className="min-w-0 truncate text-xs text-gray-500 dark:text-white/55">{operatorEmail}</span>
        </div>
        <div className="flex min-h-9 w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto md:justify-end">
          {busy && <span role="status" aria-live="polite" className="mr-auto text-xs font-medium text-teal-700 dark:text-teal-300 md:mr-0">Updating stage…</span>}
          <button
            type="button"
            disabled={busy || prevStage(stage) === null}
            onClick={() => void move('back')}
            className={editorSecondaryBtnClass}
          >
            Roll back
          </button>
          <button
            type="button"
            disabled={busy || nextStage(stage) === null}
            onClick={() => void move('forward')}
            className={editorPrimaryBtnClass}
          >
            Advance
          </button>
          <PresentationToggle />
          <ThemeToggle />
        </div>
      </div>
      {error && (
        <div role="alert" className="border-t border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <p className="mx-auto max-w-5xl px-4 py-2 text-xs font-medium sm:px-6">{error}</p>
        </div>
      )}
    </aside>
  )
}
