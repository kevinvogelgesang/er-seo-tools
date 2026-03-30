'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { AuditListItem } from '@/lib/ada-audit/types'

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    complete: 'bg-green-100 text-green-700',
    error:    'bg-red-100 text-red-700',
    running:  'bg-blue-100 text-blue-700',
    pending:  'bg-gray-100 text-gray-600',
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

export default function AuditHistory() {
  const [audits, setAudits] = useState<AuditListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ada-audit')
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

  async function handleDelete(id: string) {
    setDeleting(id)
    setConfirmDeleteId(null)
    try {
      await fetch(`/api/ada-audit/${id}`, { method: 'DELETE' })
      setAudits((prev) => prev.filter((a) => a.id !== id))
    } catch {
      setError('Failed to delete audit')
    } finally {
      setDeleting(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-[13px] font-body text-navy/50">
        <svg className="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading…
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-[13px] font-body text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
        {error}
      </div>
    )
  }

  if (audits.length === 0) {
    return (
      <p className="text-[13px] font-body text-navy/50 text-center py-8">
        No audits yet. Run your first audit above.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] font-body">
        <thead>
          <tr className="text-left border-b border-gray-200">
            <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50">URL</th>
            <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50">Client</th>
            <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50">Issues</th>
            <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50">Status</th>
            <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50">Date</th>
            <th className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-navy/50 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {audits.map((a) => (
            <tr key={a.id} className="hover:bg-gray-50 group">
              <td className="py-2.5 pr-4 max-w-[240px]">
                <Link
                  href={`/ada-audit/${a.id}`}
                  className="text-navy/80 hover:text-orange transition-colors truncate block"
                  title={a.url}
                >
                  {a.url.replace(/^https?:\/\//, '')}
                </Link>
              </td>
              <td className="py-2.5 pr-4 text-navy/50">
                {a.clientName ?? <span className="text-navy/25">—</span>}
              </td>
              <td className="py-2.5 pr-4">
                {a.scorecard ? (
                  <div className="flex flex-wrap gap-2">
                    <IssueCount n={a.scorecard.critical} label="crit" color="text-red-600" />
                    <IssueCount n={a.scorecard.serious}  label="ser"  color="text-orange-600" />
                    <IssueCount n={a.scorecard.moderate} label="mod"  color="text-yellow-600" />
                    <IssueCount n={a.scorecard.minor}    label="min"  color="text-blue-600" />
                    {a.scorecard.total === 0 && (
                      <span className="text-[11px] font-body text-green-600 font-semibold">Clean</span>
                    )}
                  </div>
                ) : (
                  <span className="text-navy/25">—</span>
                )}
              </td>
              <td className="py-2.5 pr-4">
                <StatusBadge status={a.status} />
              </td>
              <td className="py-2.5 pr-4 text-navy/40 whitespace-nowrap">
                {new Date(a.createdAt).toLocaleDateString()}
              </td>
              <td className="py-2.5 text-right">
                {confirmDeleteId === a.id ? (
                  <span className="flex items-center justify-end gap-2">
                    <span className="text-[11px] text-navy/50">Delete?</span>
                    <button
                      onClick={() => handleDelete(a.id)}
                      className="text-[11px] font-semibold text-red-600 hover:text-red-800"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-[11px] text-navy/50 hover:text-navy"
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(a.id)}
                    disabled={deleting === a.id}
                    className="text-[11px] text-navy/30 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
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
  )
}
