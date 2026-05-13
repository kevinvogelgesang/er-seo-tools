'use client'

import { useState } from 'react'
import QueueMemberRow from './QueueMemberRow'
import type { AuditBatchDetail, AuditBatchSummary } from '@/lib/ada-audit/types'

function formatDuration(startedAt: string, closedAt: string): string {
  const ms = new Date(closedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function QueueBatchRow({ batch }: { batch: AuditBatchSummary }) {
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<AuditBatchDetail | null>(null)
  const [editing, setEditing] = useState(false)
  const [labelDraft, setLabelDraft] = useState(batch.label)
  const [labelDisplay, setLabelDisplay] = useState(batch.label)
  const [saveError, setSaveError] = useState<string | null>(null)

  const expand = async () => {
    setExpanded((v) => !v)
    if (!detail) {
      try {
        const res = await fetch(`/api/audit-batches/${batch.id}`)
        if (res.ok) setDetail(await res.json() as AuditBatchDetail)
      } catch { /* leave detail null */ }
    }
  }

  const saveLabel = async () => {
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
        // User cleared the label. The server now resolves it back to the
        // auto-label, so re-fetch the batch detail to get the resolved
        // display string. Falling back to "Batch — startedAt" client-side
        // would duplicate resolveBatchLabel() formatting and risk drift.
        const refreshed = await fetch(`/api/audit-batches/${batch.id}`)
        if (refreshed.ok) {
          const refreshedJson = await refreshed.json() as { label: string }
          setLabelDisplay(refreshedJson.label)
          setLabelDraft(refreshedJson.label)
        }
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
      <div className="flex items-center gap-3 px-6 py-3">
        <button
          type="button"
          onClick={expand}
          className="text-navy/40 dark:text-white/40 hover:text-orange w-4 text-[12px]"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={saveLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveLabel()
                if (e.key === 'Escape') { setEditing(false); setLabelDraft(labelDisplay) }
              }}
              className="font-body text-[14px] bg-white dark:bg-navy-deep border border-gray-200 dark:border-navy-border rounded px-2 py-0.5 w-full max-w-sm"
            />
          ) : (
            <button
              type="button"
              onClick={() => { setEditing(true); setLabelDraft(labelDisplay) }}
              className="font-body text-[14px] text-navy dark:text-white text-left hover:text-orange truncate"
              title="Click to rename"
            >
              {labelDisplay}
            </button>
          )}
          <p className="text-[11px] font-body text-navy/40 dark:text-white/40">
            Started {formatTime(batch.startedAt)} · Closed {formatTime(batch.closedAt)} ({formatDuration(batch.startedAt, batch.closedAt)})
          </p>
          {saveError && (
            <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">{saveError}</p>
          )}
        </div>
        <div className="text-[12px] font-body text-navy/60 dark:text-white/60 whitespace-nowrap">
          {batch.auditCount} audits · {batch.completeCount} complete{batch.errorCount > 0 ? ` · ${batch.errorCount} errored` : ''}
        </div>
      </div>
      {expanded && (
        <div className="bg-gray-50/50 dark:bg-navy-deep/30">
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
