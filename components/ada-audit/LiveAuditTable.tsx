'use client'

import Link from 'next/link'
import type { LiveAuditChild } from '@/lib/ada-audit/types'

interface Props {
  rows: LiveAuditChild[]
}

function StatusPill({ status }: { status: LiveAuditChild['status'] }) {
  const styles: Record<LiveAuditChild['status'], string> = {
    complete:   'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400',
    error:      'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400',
    running:    'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400',
    pending:    'bg-gray-100 dark:bg-navy-light text-navy/60 dark:text-white/60',
    redirected: 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400',
  }
  return (
    <span
      className={`text-[10px] font-body font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${styles[status]}`}
    >
      {status}
    </span>
  )
}

function ImpactCounts({ child }: { child: LiveAuditChild }) {
  if (child.status !== 'complete' || !child.scorecard) {
    return <span className="text-navy/25 dark:text-white/25">—</span>
  }
  const sc = child.scorecard
  if (sc.total === 0) {
    return <span className="font-semibold text-green-600 dark:text-green-400 text-[11px]">Clean</span>
  }
  return (
    <span className="flex flex-wrap gap-2 text-[11px] font-body">
      {sc.critical > 0 && <span className="font-semibold text-red-600 dark:text-red-400">{sc.critical} crit</span>}
      {sc.serious > 0 && <span className="font-semibold text-orange-600 dark:text-orange-400">{sc.serious} ser</span>}
      {sc.moderate > 0 && <span className="font-semibold text-yellow-600 dark:text-yellow-400">{sc.moderate} mod</span>}
      {sc.minor > 0 && <span className="font-semibold text-blue-600 dark:text-blue-400">{sc.minor} min</span>}
    </span>
  )
}

export default function LiveAuditTable({ rows }: Props) {
  if (rows.length === 0) return null

  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden shadow-sm">
      <div className="px-6 py-3 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
        <h3 className="font-display font-bold text-[14px] text-navy dark:text-white">Pages so far</h3>
        <p className="text-[11px] font-body text-navy/50 dark:text-white/50">
          Updates as each page finishes — click a URL to open its audit.
        </p>
      </div>
      <table className="w-full text-[13px] font-body">
        <thead>
          <tr className="text-left bg-gray-50/50 dark:bg-navy-deep/30 border-b border-gray-100 dark:border-navy-border">
            <th className="px-6 py-2 text-[11px] uppercase tracking-wider font-semibold text-navy/50 dark:text-white/50">URL</th>
            <th className="px-6 py-2 text-[11px] uppercase tracking-wider font-semibold text-navy/50 dark:text-white/50">Status</th>
            <th className="px-6 py-2 text-[11px] uppercase tracking-wider font-semibold text-navy/50 dark:text-white/50">Violations</th>
          </tr>
        </thead>
        <tbody
          className="divide-y divide-gray-100 dark:divide-navy-border"
          aria-live="polite"
          aria-atomic="false"
        >
          {rows.map((c) => {
            const isTerminal = c.status === 'complete' || c.status === 'error' || c.status === 'redirected'
            return (
              <tr key={c.adaAuditId}>
                <td className="px-6 py-2.5 max-w-md">
                  {isTerminal ? (
                    <Link
                      href={`/ada-audit/${c.adaAuditId}`}
                      className="text-navy/80 dark:text-white/80 hover:text-orange transition-colors block truncate"
                      title={c.url}
                    >
                      {c.url.replace(/^https?:\/\//, '')}
                    </Link>
                  ) : (
                    <span className="text-navy/60 dark:text-white/60 block truncate" title={c.url}>
                      {c.url.replace(/^https?:\/\//, '')}
                    </span>
                  )}
                  {c.error && (
                    <div className="text-[11px] font-body text-red-600 dark:text-red-400 mt-0.5 truncate" title={c.error}>
                      {c.error}
                    </div>
                  )}
                </td>
                <td className="px-6 py-2.5"><StatusPill status={c.status} /></td>
                <td className="px-6 py-2.5"><ImpactCounts child={c} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
