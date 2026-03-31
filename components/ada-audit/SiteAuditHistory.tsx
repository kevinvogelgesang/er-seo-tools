'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Spinner } from '@/components/Spinner'
import Link from 'next/link'
import type { SiteAuditDetail } from '@/lib/ada-audit/types'

function ScoreBadge({ score }: { score?: number | null }) {
  if (score == null) return <span className="text-navy/25 dark:text-white/25">—</span>
  const color = score >= 80
    ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400'
    : score >= 50
      ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
      : 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400'
  return (
    <span className={`text-[11px] font-body font-semibold px-2 py-0.5 rounded ${color}`}>
      {score}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    complete: 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400',
    error:    'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400',
    running:  'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400',
    pending:  'bg-gray-100 dark:bg-navy-light text-gray-600 dark:text-white/60',
    queued:   'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400',
  }
  return (
    <span className={`text-[10px] font-body font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${map[status] ?? map.pending}`}>
      {status}
    </span>
  )
}

export default function SiteAuditHistory() {
  const [audits, setAudits] = useState<SiteAuditDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/site-audit')
      if (!res.ok) throw new Error('Failed to load history')
      const data = await res.json()
      setAudits(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Smart polling: poll lightweight queue endpoint when there are active/queued audits
  const auditsRef = useRef(audits)
  auditsRef.current = audits
  const hasActive = audits.some(a => ['queued', 'pending', 'running'].includes(a.status))

  useEffect(() => {
    if (!hasActive) return

    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/site-audit/queue')
        if (!res.ok) return
        const queue: { active: { id: string; pagesTotal: number; pagesComplete: number; pagesError: number } | null; queued: { id: string }[] } = await res.json()

        const activeIds = new Set<string>()
        if (queue.active) activeIds.add(queue.active.id)
        for (const q of queue.queued) activeIds.add(q.id)

        const current = auditsRef.current
        const wasActive = current.filter(a => ['queued', 'pending', 'running'].includes(a.status))
        const needsReload = wasActive.some(a => !activeIds.has(a.id))

        if (needsReload) {
          void load()
        } else {
          setAudits(prev => prev.map(a => {
            if (queue.active && a.id === queue.active.id) {
              return { ...a, status: 'running', pagesTotal: queue.active.pagesTotal, pagesComplete: queue.active.pagesComplete, pagesError: queue.active.pagesError }
            }
            const queuedItem = queue.queued.find(q => q.id === a.id)
            if (queuedItem && a.status !== 'queued') {
              return { ...a, status: 'queued' }
            }
            return a
          }))
        }
      } catch { /* ignore */ }
    }, 8000)

    return () => clearInterval(timer)
  }, [hasActive, load])

  async function handleDelete(id: string) {
    setDeleting(id)
    setConfirmDeleteId(null)
    try {
      await fetch(`/api/site-audit/${id}`, { method: 'DELETE' })
      setAudits((prev) => prev.filter((a) => a.id !== id))
    } catch {
      setError('Failed to delete site audit')
    } finally {
      setDeleting(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-[13px] font-body text-navy/50 dark:text-white/50">
        <Spinner className="w-4 h-4 mr-2" />
        Loading…
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-[13px] font-body text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg px-4 py-3">
        {error}
      </div>
    )
  }

  if (audits.length === 0) {
    return (
      <p className="text-[13px] font-body text-navy/50 dark:text-white/50 text-center py-8">
        No site audits yet. Run your first site audit above.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] font-body">
        <thead>
          <tr className="text-left border-b border-gray-200 dark:border-navy-border">
            <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Domain</th>
            <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Client</th>
            <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Pages</th>
            <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Score</th>
            <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Violations</th>
            <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Status</th>
            <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Date</th>
            <th className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-navy-border">
          {audits.map((a) => {
            const agg = a.summary?.aggregate
            return (
              <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-navy-light group">
                <td className="py-2.5 pr-4">
                  <Link
                    href={`/ada-audit/site/${a.id}`}
                    className="text-navy/80 dark:text-white/80 hover:text-orange transition-colors font-medium"
                  >
                    {a.domain}
                  </Link>
                </td>
                <td className="py-2.5 pr-4 text-navy/50 dark:text-white/50">
                  {a.clientName ?? <span className="text-navy/25 dark:text-white/25">—</span>}
                </td>
                <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">
                  {a.status === 'queued'
                    ? <span className="text-amber-600 dark:text-amber-400">queued</span>
                    : a.status === 'running' || a.status === 'pending'
                      ? <span>{a.pagesComplete}/{a.pagesTotal > 0 ? a.pagesTotal : '?'}</span>
                      : <span>{a.pagesComplete + a.pagesError}</span>
                  }
                </td>
                <td className="py-2.5 pr-4">
                  <ScoreBadge score={(a as SiteAuditDetail & { score?: number | null }).score} />
                </td>
                <td className="py-2.5 pr-4">
                  {agg ? (
                    <div className="flex flex-wrap gap-2 text-[11px] font-body">
                      {agg.critical > 0 && <span className="font-semibold text-red-600 dark:text-red-400">{agg.critical} crit</span>}
                      {agg.serious  > 0 && <span className="font-semibold text-orange-600 dark:text-orange-400">{agg.serious} ser</span>}
                      {agg.total === 0 && <span className="font-semibold text-green-600 dark:text-green-400">Clean</span>}
                    </div>
                  ) : <span className="text-navy/25 dark:text-white/25">—</span>}
                </td>
                <td className="py-2.5 pr-4">
                  <StatusBadge status={a.status} />
                </td>
                <td className="py-2.5 pr-4 text-navy/40 dark:text-white/40 whitespace-nowrap">
                  {new Date(a.createdAt).toLocaleDateString()}
                </td>
                <td className="py-2.5 text-right">
                  {confirmDeleteId === a.id ? (
                    <span className="flex items-center justify-end gap-2">
                      <span className="text-[11px] text-navy/50 dark:text-white/50">Delete?</span>
                      <button onClick={() => handleDelete(a.id)} className="text-[11px] font-semibold text-red-600 dark:text-red-400 hover:text-red-800">Yes</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="text-[11px] text-navy/50 dark:text-white/50 hover:text-navy dark:hover:text-white">No</button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(a.id)}
                      disabled={deleting === a.id}
                      className="text-[11px] text-navy/30 dark:text-white/30 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
