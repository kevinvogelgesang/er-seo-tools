'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import PaginatedSection from './PaginatedSection'
import type { PaginatedResponse, QueueStatusWithBatch, SiteAuditDetail } from '@/lib/ada-audit/types'

const PAGE_SIZE = 25
const URL_PARAM = 'recentSitesPage'
const ACTIVE_STATUSES = ['queued', 'pending', 'running', 'pdfs-running', 'lighthouse-running'] as const

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
  const colorMap: Record<string, string> = {
    complete:          'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400',
    error:             'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400',
    running:           'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400',
    pending:           'bg-gray-100 dark:bg-navy-light text-gray-600 dark:text-white/60',
    queued:            'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400',
    cancelled:         'bg-slate-100 dark:bg-slate-500/15 text-slate-600 dark:text-slate-400',
    'pdfs-running':    'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400',
    'lighthouse-running': 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400',
  }
  const labelMap: Record<string, string> = {
    complete:          'Complete',
    error:             'Error',
    running:           'Running',
    pending:           'Pending',
    queued:            'Queued',
    cancelled:         'Cancelled',
    'pdfs-running':    'Scanning PDFs',
    'lighthouse-running': 'Running Lighthouse',
  }
  return (
    <span className={`text-[10px] font-body font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${colorMap[status] ?? colorMap.pending}`}>
      {labelMap[status] ?? status}
    </span>
  )
}

const HEADER_ICON = (
  <svg className="w-4 h-4 text-orange" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
  </svg>
)

interface Props {
  /** Lifted queue snapshot from the parent's 5s poll. `null` until the
   *  first poll resolves. */
  queueStatus: QueueStatusWithBatch | null
}

export default function SiteAuditHistory({ queueStatus }: Props) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const page = Math.max(1, parseInt(searchParams.get(URL_PARAM) ?? '1', 10) || 1)

  const [data, setData] = useState<PaginatedResponse<SiteAuditDetail> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  // Track `data` via a ref so the error-gate read inside fetchPage doesn't
  // require `data` in fetchPage's deps. Without this, the queueStatus effect
  // below would loop: setData → fetchPage identity change → effect re-runs →
  // setData → ... (the render-loop codex flagged).
  const dataRef = useRef<PaginatedResponse<SiteAuditDetail> | null>(null)
  dataRef.current = data

  const fetchPage = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch(`/api/site-audit?page=${page}&pageSize=${PAGE_SIZE}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: PaginatedResponse<SiteAuditDetail> = await res.json()
      setData(json)
      setError(null)
    } catch (e) {
      if (dataRef.current === null) {
        setError(e instanceof Error ? e.message : 'Failed to load')
      } else {
        console.warn('[SiteAuditHistory] poll failed:', e)
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [page])

  useEffect(() => {
    void fetchPage(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const setPage = useCallback((next: number) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 1) params.delete(URL_PARAM)
    else params.set(URL_PARAM, String(next))
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [router, searchParams])

  // queueStatus arrives via props from AuditIndexTabs (single lifted 5s poll).
  // We react to it: merge live counts into matching rows, and trigger a
  // full re-fetch when any previously-active row drops out of the queue
  // (completion-edge refresh — without this, rows stay frozen at "running"
  // visually until the next page change).
  const items = data?.items ?? []
  const totalCount = data?.totalCount ?? 0
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    if (!queueStatus) return

    const activeIds = new Set<string>()
    if (queueStatus.active) activeIds.add(queueStatus.active.id)
    for (const q of queueStatus.queued) activeIds.add(q.id)

    const current = itemsRef.current
    const wasActive = current.filter(a => (ACTIVE_STATUSES as readonly string[]).includes(a.status))
    const needsReload = wasActive.some(a => !activeIds.has(a.id))

    if (needsReload) {
      void fetchPage(true)
      return
    }

    // Merge live queue counts into matching rows without re-fetching.
    // Return `prev` unchanged when no row actually changed — otherwise React
    // would treat each merge as a new state and re-run the effect (loop).
    setData(prev => {
      if (!prev) return prev
      let changed = false
      const nextItems = prev.items.map(a => {
        if (queueStatus.active && a.id === queueStatus.active.id) {
          // Preserve `pdfs-running` or `lighthouse-running` if the row
          // already has it — forcing 'running' would visually demote
          // rows that have moved on to the post-pages drain phases.
          const liveStatus =
            a.status === 'pdfs-running' || a.status === 'lighthouse-running'
              ? a.status
              : 'running'
          if (
            a.status === liveStatus &&
            a.pagesTotal === queueStatus.active.pagesTotal &&
            a.pagesComplete === queueStatus.active.pagesComplete &&
            a.pagesError === queueStatus.active.pagesError
          ) {
            return a
          }
          changed = true
          return {
            ...a,
            status: liveStatus,
            pagesTotal: queueStatus.active.pagesTotal,
            pagesComplete: queueStatus.active.pagesComplete,
            pagesError: queueStatus.active.pagesError,
          }
        }
        const queuedItem = queueStatus.queued.find(q => q.id === a.id)
        if (queuedItem && a.status !== 'queued') {
          changed = true
          return { ...a, status: 'queued' }
        }
        return a
      })
      if (!changed) return prev
      return { ...prev, items: nextItems }
    })
  }, [queueStatus, fetchPage])

  async function handleDelete(id: string) {
    setDeleting(id)
    setConfirmDeleteId(null)
    try {
      await fetch(`/api/site-audit/${id}`, { method: 'DELETE' })
      // Re-fetch the current page so totals/pagination stay correct.
      void fetchPage(true)
    } catch {
      setError('Failed to delete site audit')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <PaginatedSection
      title="Recent Site Audits"
      icon={HEADER_ICON}
      rowCount={totalCount}
      pageSize={PAGE_SIZE}
      page={page}
      onPageChange={setPage}
      loading={loading}
      error={error}
      onRetry={() => void fetchPage(false)}
      empty="No site audits yet. Run your first site audit above."
    >
      <div className="overflow-x-auto px-6 py-3">
        <table className="w-full text-[13px] font-body">
          <thead>
            <tr className="text-left border-b border-gray-200 dark:border-navy-border">
              <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Domain</th>
              <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Client</th>
              <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Requested by</th>
              <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Pages</th>
              <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Score</th>
              <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Violations</th>
              <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Status</th>
              <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Date</th>
              <th className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-navy-border">
            {items.map((a) => {
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
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60 whitespace-nowrap">
                    {a.requestedBy ?? <span className="text-navy/25 dark:text-white/25">—</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">
                    {a.status === 'queued'
                      ? <span className="text-amber-600 dark:text-amber-400">queued</span>
                      : a.status === 'cancelled'
                        ? <span className="text-slate-500 dark:text-slate-400">—</span>
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
    </PaginatedSection>
  )
}
