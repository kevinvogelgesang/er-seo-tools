'use client'

import { useState } from 'react'
import { Spinner } from '@/components/Spinner'
import type { ImpactLevel } from '@/lib/ada-audit/types'
import type { GroupedViolation } from './useGroupedViolations'
import { safeExternalHref } from '@/lib/safe-external-href'

interface Props {
  groupedViolations: GroupedViolation[]
  loading: boolean
  error?: string | null
}

const IMPACT_STYLES: Record<ImpactLevel, { badge: string; dot: string }> = {
  critical: { badge: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/30',       dot: 'bg-red-500' },
  serious:  { badge: 'bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/30', dot: 'bg-orange-500' },
  moderate: { badge: 'bg-yellow-100 dark:bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-500/30', dot: 'bg-yellow-500' },
  minor:    { badge: 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/30',   dot: 'bg-blue-400' },
}

function ImpactBadge({ impact }: { impact: ImpactLevel }) {
  const s = IMPACT_STYLES[impact]
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-body font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${s.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {impact}
    </span>
  )
}

function ViolationCard({ violation }: { violation: GroupedViolation }) {
  const [expanded, setExpanded] = useState(false)
  const helpHref = safeExternalHref(violation.helpUrl)

  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-gray-50 dark:hover:bg-navy-light transition-colors"
      >
        <span className="mt-0.5 flex-shrink-0">
          <ImpactBadge impact={violation.impact} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-body font-semibold text-navy dark:text-white leading-snug">{violation.help}</p>
          <p className="text-[12px] font-body text-navy/50 dark:text-white/50 mt-1">
            Affects {violation.affectedPages.length} page{violation.affectedPages.length !== 1 ? 's' : ''}
            {' · '}
            {violation.totalNodes} total element{violation.totalNodes !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {helpHref && (
            <a
              href={helpHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-body text-navy/40 dark:text-white/30 hover:text-orange dark:hover:text-orange transition-colors"
              title="Learn more about this violation"
              onClick={(e) => e.stopPropagation()}
            >
              Learn more ↗
            </a>
          )}
          <svg
            className={`w-4 h-4 text-navy/40 dark:text-white/40 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded: affected pages list */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-navy-border divide-y divide-gray-100 dark:divide-navy-border">
          {violation.affectedPages.map((ap) => {
            const urlDisplay = ap.url.replace(/^https?:\/\//, '')
            return (
              <div key={ap.adaAuditId} className="flex items-center gap-3 px-4 py-2.5">
                <svg className="w-3.5 h-3.5 flex-shrink-0 text-navy/25 dark:text-white/25" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="flex-1 min-w-0 text-[12px] font-body text-navy/70 dark:text-white/70 truncate" title={ap.url}>
                  {urlDisplay}
                </span>
                <span className="text-[11px] font-body text-navy/40 dark:text-white/40 flex-shrink-0">
                  {ap.nodeCount} element{ap.nodeCount !== 1 ? 's' : ''}
                </span>
                <a
                  href={`/ada-audit/${ap.adaAuditId}`}
                  className="flex-shrink-0 text-[11px] font-body font-semibold text-orange hover:text-orange-light transition-colors"
                >
                  View audit ↗
                </a>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function GroupedViolationsView({ groupedViolations, loading, error }: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-[13px] font-body text-navy/50 dark:text-white/50">
        <Spinner />
        Loading violation data across all pages…
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-6 py-8 text-center text-[13px] font-body text-red-600 dark:text-red-400">
        {error}
      </div>
    )
  }

  if (groupedViolations.length === 0) {
    return (
      <div className="px-6 py-8 text-center text-[13px] font-body text-navy/40 dark:text-white/40">
        No violations found across audited pages.
      </div>
    )
  }

  return (
    <div className="px-6 py-4 space-y-2">
      <p className="text-[12px] font-body text-navy/40 dark:text-white/40">
        {groupedViolations.length} unique violation{groupedViolations.length !== 1 ? 's' : ''} across all pages
      </p>
      {groupedViolations.map((violation) => (
        <ViolationCard key={violation.id} violation={violation} />
      ))}
    </div>
  )
}
