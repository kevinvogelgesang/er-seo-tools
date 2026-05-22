'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { AuditBatchMember } from '@/lib/ada-audit/types'
import { formatDuration, formatDurationHover } from '@/lib/ada-audit/duration'

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  pending: 'Pending',
  running: 'Running',
  'pdfs-running': 'Scanning PDFs',
  'lighthouse-running': 'Running Lighthouse',
  complete: 'Complete',
  error: 'Error',
  cancelled: 'Cancelled',
}

const STATUS_COLOR: Record<string, string> = {
  queued: 'bg-gray-100 dark:bg-gray-500/15 text-gray-700 dark:text-gray-300',
  pending: 'bg-gray-100 dark:bg-gray-500/15 text-gray-700 dark:text-gray-300',
  running: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400',
  'pdfs-running': 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400',
  'lighthouse-running': 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400',
  complete: 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400',
  error: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400',
  cancelled: 'bg-slate-100 dark:bg-slate-500/15 text-slate-600 dark:text-slate-400',
}

interface Props {
  member: AuditBatchMember
  onCancelled?: () => void
}

export default function QueueMemberRow({ member, onCancelled }: Props) {
  // Inline confirm pattern — first click prompts, second click commits.
  const [confirming, setConfirming] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const durationStart = member.startedAt ? new Date(member.startedAt) : null
  const durationEnd = member.completedAt ? new Date(member.completedAt) : null
  const duration = formatDuration(durationStart, durationEnd)

  async function handleCancel() {
    setConfirming(false)
    setCancelling(true)
    setError(null)
    try {
      const res = await fetch(`/api/site-audit/${member.id}/cancel`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      onCancelled?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <tr className="border-b border-gray-50 dark:border-navy-border/50 hover:bg-gray-50/50 dark:hover:bg-navy-deep/30">
      <td className="px-6 py-3 font-body text-[13px] text-navy dark:text-white">
        <Link href={`/ada-audit/site/${member.id}`} className="hover:text-orange">
          {member.domain}
        </Link>
      </td>
      <td className="px-6 py-3 font-body text-[12px] text-navy/60 dark:text-white/60">
        {member.clientName ?? '—'}
      </td>
      <td className="px-6 py-3">
        <span className={`text-[11px] font-body font-semibold px-2 py-0.5 rounded ${STATUS_COLOR[member.status] ?? STATUS_COLOR.queued}`}>
          {STATUS_LABEL[member.status] ?? member.status}
        </span>
      </td>
      <td className="px-6 py-3 font-body text-[12px] text-navy/60 dark:text-white/60">
        {member.status === 'cancelled' ? (
          <span className="text-slate-500 dark:text-slate-400">—</span>
        ) : (
          <>
            {member.pagesComplete}/{member.pagesTotal}
            {member.pagesError > 0 ? ` (${member.pagesError} errored)` : ''}
          </>
        )}
      </td>
      <td className="px-6 py-3 font-body text-[12px] text-navy dark:text-white">
        {member.score ?? '—'}
      </td>
      <td className="px-6 py-3 font-body text-[11px] text-navy/40 dark:text-white/40 whitespace-nowrap">
        {duration !== null ? (
          <span title={formatDurationHover(durationStart, durationEnd) ?? ''}>{duration}</span>
        ) : '—'}
      </td>
      <td className="px-6 py-3 text-right">
        {member.status === 'queued' && (
          error ? (
            <button
              onClick={() => { setError(null); setConfirming(true) }}
              className="text-[11px] font-body text-red-600 dark:text-red-400 hover:underline"
              title={error}
            >
              Retry
            </button>
          ) : confirming ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-[11px] text-navy/50 dark:text-white/50">Cancel audit?</span>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="text-[11px] font-semibold text-red-600 dark:text-red-400 hover:text-red-800 disabled:opacity-50"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={cancelling}
                className="text-[11px] text-navy/50 dark:text-white/50 hover:text-navy dark:hover:text-white"
              >
                No
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              disabled={cancelling}
              className="text-[11px] font-body text-navy/40 dark:text-white/40 hover:text-red-500 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          )
        )}
      </td>
    </tr>
  )
}
