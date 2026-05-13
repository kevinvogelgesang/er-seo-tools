'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import PaginatedSection from './PaginatedSection'
import type { AuditListItem, PaginatedResponse } from '@/lib/ada-audit/types'

const PAGE_SIZE = 25
const URL_PARAM = 'recentPagesPage'

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    complete: 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400',
    error:    'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400',
    running:  'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400',
    pending:  'bg-gray-100 dark:bg-navy-light text-gray-600 dark:text-white/60',
  }
  return (
    <span className={`text-[10px] font-body font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${map[status] ?? map.pending}`}>
      {status}
    </span>
  )
}

function IssueCount({ n, label, color }: { n: number; label: string; color: string }) {
  if (n === 0) return null
  return (
    <span className={`text-[11px] font-body font-semibold ${color}`}>
      {n} {label}
    </span>
  )
}

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

const HEADER_ICON = (
  <svg className="w-4 h-4 text-orange" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
  </svg>
)

export default function AuditHistory() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const page = Math.max(1, parseInt(searchParams.get(URL_PARAM) ?? '1', 10) || 1)

  const [data, setData] = useState<PaginatedResponse<AuditListItem> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const fetchPage = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch(`/api/ada-audit?page=${page}&pageSize=${PAGE_SIZE}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: PaginatedResponse<AuditListItem> = await res.json()
      setData(json)
      setError(null)
    } catch (e) {
      if (data === null) {
        setError(e instanceof Error ? e.message : 'Failed to load')
      } else {
        console.warn('[AuditHistory] poll failed:', e)
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [page, data])

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

  async function handleDelete(id: string) {
    setDeleting(id)
    setConfirmDeleteId(null)
    try {
      await fetch(`/api/ada-audit/${id}`, { method: 'DELETE' })
      // Re-fetch the current page so totals/pagination stay correct.
      void fetchPage(true)
    } catch {
      setError('Failed to delete audit')
    } finally {
      setDeleting(null)
    }
  }

  const items = data?.items ?? []
  const totalCount = data?.totalCount ?? 0

  return (
    <PaginatedSection
      title="Recent Page Audits"
      icon={HEADER_ICON}
      rowCount={totalCount}
      pageSize={PAGE_SIZE}
      page={page}
      onPageChange={setPage}
      loading={loading}
      error={error}
      onRetry={() => void fetchPage(false)}
      empty="No audits yet. Run your first audit above."
    >
      <div className="overflow-x-auto px-6 py-3">
        <table className="w-full text-[13px] font-body">
          <thead>
            <tr className="text-left border-b border-gray-200 dark:border-navy-border">
              <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">URL</th>
              <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Client</th>
              <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Score</th>
              <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Issues</th>
              <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Status</th>
              <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Date</th>
              <th className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-navy-border">
            {items.map((a) => (
              <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-navy-light group">
                <td className="py-2.5 pr-4 max-w-[240px]">
                  <Link
                    href={`/ada-audit/${a.id}`}
                    className="text-navy/80 dark:text-white/80 hover:text-orange transition-colors truncate block"
                    title={a.url}
                  >
                    {a.url.replace(/^https?:\/\//, '')}
                  </Link>
                </td>
                <td className="py-2.5 pr-4 text-navy/50 dark:text-white/50">
                  {a.clientName ?? <span className="text-navy/25 dark:text-white/25">—</span>}
                </td>
                <td className="py-2.5 pr-4">
                  <ScoreBadge score={(a as AuditListItem & { score?: number | null }).score} />
                </td>
                <td className="py-2.5 pr-4">
                  {a.scorecard ? (
                    <div className="flex flex-wrap gap-2">
                      <IssueCount n={a.scorecard.critical} label="crit" color="text-red-600 dark:text-red-400" />
                      <IssueCount n={a.scorecard.serious}  label="ser"  color="text-orange-600 dark:text-orange-400" />
                      <IssueCount n={a.scorecard.moderate} label="mod"  color="text-yellow-600 dark:text-yellow-400" />
                      <IssueCount n={a.scorecard.minor}    label="min"  color="text-blue-600 dark:text-blue-400" />
                      {a.scorecard.total === 0 && (
                        <span className="text-[11px] font-body text-green-600 font-semibold">Clean</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-navy/25 dark:text-white/25">—</span>
                  )}
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
                      <button
                        onClick={() => handleDelete(a.id)}
                        className="text-[11px] font-semibold text-red-600 dark:text-red-400 hover:text-red-800"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-[11px] text-navy/50 dark:text-white/50 hover:text-navy dark:hover:text-white"
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(a.id)}
                      disabled={deleting === a.id}
                      className="text-[11px] text-navy/30 dark:text-white/30 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                      title="Delete audit"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PaginatedSection>
  )
}
