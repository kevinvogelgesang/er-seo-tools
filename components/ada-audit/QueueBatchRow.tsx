'use client'

import { useRef, useState } from 'react'
import { ClientDate } from '@/components/ClientDate'
import QueueMemberRow from './QueueMemberRow'
import type { AuditBatchDetail, AuditBatchSummary } from '@/lib/ada-audit/types'

function formatDuration(startedAt: string, closedAt: string): string {
  const ms = new Date(closedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

export default function QueueBatchRow({ batch }: { batch: AuditBatchSummary }) {
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<AuditBatchDetail | null>(null)
  const [editing, setEditing] = useState(false)
  const [labelDraft, setLabelDraft] = useState(batch.label ?? '')
  const [labelDisplay, setLabelDisplay] = useState<string | null>(batch.label)
  const [saveError, setSaveError] = useState<string | null>(null)
  const escapedRef = useRef(false)

  const toggleExpand = async () => {
    setExpanded((v) => !v)
    if (!detail) {
      try {
        const res = await fetch(`/api/audit-batches/${batch.id}`)
        if (res.ok) setDetail(await res.json() as AuditBatchDetail)
      } catch { /* leave detail null */ }
    }
  }

  const enterEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setLabelDraft(labelDisplay ?? '')
    setEditing(true)
  }

  const saveLabel = async () => {
    if (escapedRef.current) {
      escapedRef.current = false
      return
    }
    const next = labelDraft.trim()
    setSaveError(null)
    try {
      const res = await fetch(`/api/audit-batches/${batch.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: next === '' ? null : next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setSaveError(body.error ?? `HTTP ${res.status}`)
        return
      }
      if (next === '') {
        // User cleared the label — render auto-label client-side (null triggers it)
        setLabelDisplay(null)
        setLabelDraft('')
      } else {
        setLabelDisplay(next)
      }
      setEditing(false)
    } catch (e) {
      setSaveError((e as Error).message)
    }
  }

  return (
    <div className="border-b border-gray-100 dark:border-navy-border">
      <div className="flex items-center gap-3 px-6 py-3 group">
        {/* Expand button — flex-1, takes up the label/metadata region */}
        {editing ? (
          /* When editing: show input as sibling to the rename/expand controls */
          <div className="flex-1 min-w-0">
            <input
              autoFocus
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={() => void saveLabel()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { escapedRef.current = false; void saveLabel() }
                if (e.key === 'Escape') {
                  escapedRef.current = true
                  setEditing(false)
                  setLabelDraft(labelDisplay ?? '')
                }
              }}
              className="font-body text-[14px] bg-white dark:bg-navy-deep border border-gray-200 dark:border-navy-border rounded px-2 py-0.5 w-full max-w-sm"
            />
            {saveError && (
              <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">{saveError}</p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void toggleExpand()}
            aria-expanded={expanded}
            aria-controls={`batch-panel-${batch.id}`}
            className="flex-1 flex items-center gap-3 text-left min-w-0"
          >
            {/* Caret indicator */}
            <span className="text-navy/40 dark:text-white/40 group-hover:text-orange w-4 text-[12px] shrink-0">
              {expanded ? '▾' : '▸'}
            </span>
            {/* Label + metadata */}
            <div className="min-w-0">
              <span className="font-body text-[14px] text-navy dark:text-white truncate block">
                {labelDisplay !== null ? (
                  labelDisplay
                ) : (
                  <>Batch — <ClientDate iso={batch.startedAt} variant="dateTime" /></>
                )}
              </span>
              <p className="text-[11px] font-body text-navy/40 dark:text-white/40">
                Started <ClientDate iso={batch.startedAt} variant="dateTime" />
                {' · '}Closed <ClientDate iso={batch.closedAt} variant="dateTime" />
                {' '}({formatDuration(batch.startedAt, batch.closedAt)})
                {' · '}by {batch.operatorSummary}
              </p>
              {saveError && (
                <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">{saveError}</p>
              )}
            </div>
          </button>
        )}

        {/* Rename button — sibling to expand button, NOT nested inside it */}
        {!editing && (
          <button
            type="button"
            aria-label="Rename batch"
            onClick={enterEdit}
            className="opacity-0 group-hover:opacity-100 text-navy/40 dark:text-white/40 hover:text-orange text-[14px] shrink-0 transition-opacity"
          >
            ✎
          </button>
        )}

        {/* Right-aligned audit count summary */}
        <div className="text-[12px] font-body text-navy/60 dark:text-white/60 whitespace-nowrap shrink-0">
          {batch.auditCount} audits · {batch.completeCount} complete{batch.errorCount > 0 ? ` · ${batch.errorCount} errored` : ''}
        </div>
      </div>

      {expanded && (
        <div id={`batch-panel-${batch.id}`} className="bg-gray-50/50 dark:bg-navy-deep/30">
          {detail ? (
            <table className="w-full">
              <tbody>
                {detail.members.map((m) => <QueueMemberRow key={m.id} member={m} />)}
              </tbody>
            </table>
          ) : (
            <div className="px-6 py-4 text-[12px] font-body text-navy/50 dark:text-white/50">Loading…</div>
          )}
        </div>
      )}
    </div>
  )
}
