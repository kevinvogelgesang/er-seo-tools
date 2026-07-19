'use client'

import { useEffect, useRef, useState } from 'react'
import { editorSecondaryBtnClass } from '@/components/viewbook/editor'
import { SECTION_TITLES } from '@/components/viewbook/public/section-titles'
import { StatusPill, type Tone } from '@/components/ui/StatusPill'
import type { OperatorSectionData } from '@/lib/viewbook/operator-data'
import { navigateToAnchor } from '@/components/viewbook/public/viewbook-navigate'
import { requestRefresh, useEditorActivity, useFocusWithin } from '../useViewbookSync'
import { useReportSectionActivity } from './inspector/useSectionActivity'
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
  variant = 'rail',
}: {
  viewbookId: number
  section: OperatorSectionData
  pcCompletedAt: string | null
  variant?: 'rail' | 'embedded'
}) {
  const [state, setState] = useState(section.state)
  const [acknowledgedAt, setAcknowledgedAt] = useState(section.acknowledgedAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const focus = useFocusWithin()
  // These status controls are DISCRETE mutations (Show/Hide/Mark done/Reset ack)
  // with no draft to protect — so their SYNC-registry activity is `busy` ONLY,
  // never `busy || focus.focused`. Registering focus here wedged the shared
  // refresher: a status button stays focused after a click (and Reset-ack
  // UNMOUNTS its own focused button, so the container onBlur never fires and
  // focus sticks true forever) → the page-global registry never returns to idle
  // → the deferred requestRefresh() never flushes → the mutation "needs a
  // reload" and blocks every later reset. `busy` alone still holds the refresh
  // across the in-flight write. (The per-section pinning registry below keeps
  // `focused` — that's a separate concern and safely releases on unmount.)
  useEditorActivity(`operator-section-controls-${section.sectionKey}`, busy)
  // Fix #10: ALSO report to the Context-Lens per-section activity registry so a
  // status mutation / focus pins THIS section's pane in the inspector.
  useReportSectionActivity(section.sectionKey, `operator-section-controls-${section.sectionKey}`, {
    dirty: false,
    busy,
    conflict: false,
    focused: focus.focused,
  })

  useEffect(() => setState(section.state), [section.state])
  useEffect(() => setAcknowledgedAt(section.acknowledgedAt), [section.acknowledgedAt])

  // Fix #11: post-Show navigation. When the refreshed `section.state` prop
  // transitions hidden → active (i.e. a Show landed and the operator read model
  // reloaded the now-visible section into the canvas), scroll to its anchor
  // ONCE. navigateToAnchor no-ops if the canvas target isn't mounted yet — that
  // is fine, no mount-watcher. Keyed on the PROP so we fire after the refresh,
  // never on the optimistic local flip (canvas node isn't there yet then).
  const prevPropState = useRef(section.state)
  useEffect(() => {
    const prev = prevPropState.current
    prevPropState.current = section.state
    if (prev === 'hidden' && section.state === 'active') {
      navigateToAnchor(section.sectionKey, `#${section.sectionKey}`)
    }
  }, [section.state, section.sectionKey])

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
    // Fix #12: a real confirm gate before the destructive DELETE — mirrors the
    // force-advance confirm pattern (OperatorBar). CANCEL must fire nothing.
    if (typeof window !== 'undefined' && !window.confirm(
      `Reset the client's acknowledgment of "${SECTION_TITLES[section.sectionKey]}"? They'll be asked to acknowledge it again.`,
    )) return
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
  const statePill: { label: string; tone: Tone } = state === 'hidden'
    ? { label: 'Hidden', tone: 'warning' }
    : state === 'done'
      ? { label: 'Complete', tone: 'success' }
      : { label: 'Visible', tone: 'neutral' }
  const embedded = variant === 'embedded'
  return (
    <div
      data-operator-section-controls={section.sectionKey}
      data-operator-section-controls-variant={variant}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      className={embedded
        ? 'w-full font-body text-xs text-navy dark:text-white'
        : 'border-y border-gray-200 bg-gray-50/95 font-body text-xs text-navy dark:border-navy-border dark:bg-navy-deep/95 dark:text-white'}
    >
      {/* Content centred to the section reading column (max-w-5xl) so the ER
          controls line up with the regularly visible section content. */}
      <div className={embedded
        ? 'flex w-full flex-wrap items-center gap-2 p-3'
        : 'mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2 px-6 py-2.5'}>
        <div className="mr-auto min-w-0 flex-1">
          {!embedded && <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-white/45">Editing section</span>}
          <span className="block truncate font-display text-sm font-semibold text-navy dark:text-white">{SECTION_TITLES[section.sectionKey]}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill label={statePill.label} tone={statePill.tone} />
          {acknowledgedAt && <StatusPill label="Acknowledged" tone="success" />}
        </div>
        {busy && <span role="status" aria-live="polite" className="text-xs font-medium text-teal-700 dark:text-teal-300">Updating section…</span>}
        <div role="group" aria-label={`${SECTION_TITLES[section.sectionKey]} actions`} className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void setSectionState(state === 'hidden' ? 'active' : 'hidden')}
            className={editorSecondaryBtnClass}
          >
            {state === 'hidden' ? 'Show' : 'Hide'}
          </button>
          {doneable && state !== 'hidden' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void setSectionState(state === 'done' ? 'active' : 'done')}
              className={editorSecondaryBtnClass}
            >
              {state === 'done' ? 'Reopen' : 'Mark done'}
            </button>
          )}
          {sectionSupportsAck(section.sectionKey) && acknowledgedAt && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void resetAck()}
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/15 dark:focus-visible:ring-offset-navy-card"
            >
              Reset ack
            </button>
          )}
        </div>
        {error && (
          <span role="alert" className="rounded-lg bg-red-50 px-2.5 py-1.5 font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </span>
        )}
      </div>
    </div>
  )
}
