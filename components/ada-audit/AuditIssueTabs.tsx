'use client'

import { useState } from 'react'
import type { AxeViolation, ImpactLevel } from '@/lib/ada-audit/types'
import AuditIssueCard from './AuditIssueCard'

interface AxeIncomplete {
  id: string
  help: string
  impact: ImpactLevel | null
  nodes: { html: string; failureSummary?: string; target?: string[] }[]
  tags?: string[]
  description?: string
  helpUrl?: string
}

interface Props {
  violations: AxeViolation[]
  incomplete?: AxeIncomplete[]
  auditId?: string
}

type TabId = 'all' | ImpactLevel | 'needs-review'

const VIOLATION_TABS: { id: TabId; label: string }[] = [
  { id: 'all',      label: 'All' },
  { id: 'critical', label: 'Critical' },
  { id: 'serious',  label: 'Serious' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'minor',    label: 'Minor' },
]

export default function AuditIssueTabs({ violations, incomplete = [], auditId }: Props) {
  const [active, setActive] = useState<TabId>('all')

  const showNeedsReview = incomplete.length > 0

  const TABS: { id: TabId; label: string }[] = [
    ...VIOLATION_TABS,
    ...(showNeedsReview ? [{ id: 'needs-review' as TabId, label: 'Needs Review' }] : []),
  ]

  const filtered = active === 'all'
    ? violations
    : active === 'needs-review'
      ? []
      : violations.filter((v) => v.impact === active)

  function countFor(id: TabId) {
    if (id === 'all') return violations.length
    if (id === 'needs-review') return incomplete.length
    return violations.filter((v) => v.impact === id).length
  }

  if (violations.length === 0 && incomplete.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
        <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-500/15 flex items-center justify-center">
          <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="text-[15px] font-body font-semibold text-navy dark:text-white">No violations found</p>
          <p className="text-[13px] font-body text-navy/50 dark:text-white/50 mt-1">
            axe-core found no accessibility violations on this page.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div role="tablist" className="flex gap-1 border-b border-gray-200 dark:border-navy-border">
        {TABS.map((tab) => {
          const count = countFor(tab.id)
          const isActive = active === tab.id
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-body font-semibold border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-orange text-orange'
                  : 'border-transparent text-navy/50 dark:text-white/50 hover:text-navy/80 dark:hover:text-white/80 hover:border-gray-300 dark:hover:border-navy-border'
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                  isActive ? 'bg-orange/15 text-orange' : 'bg-gray-100 dark:bg-navy-light text-navy/50 dark:text-white/50'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Issue cards */}
      {active === 'needs-review' ? (
        incomplete.length === 0 ? (
          <p className="text-[13px] font-body text-navy/50 dark:text-white/50 py-4 text-center">
            No items need review.
          </p>
        ) : (
          <div className="space-y-2">
            {incomplete.map((item) => (
              <AuditIssueCard
                key={item.id}
                auditId={auditId}
                violation={{
                  id: item.id,
                  impact: item.impact,
                  help: item.help,
                  description: item.description ?? '',
                  helpUrl: item.helpUrl ?? '',
                  tags: item.tags ?? [],
                  nodes: item.nodes,
                }}
              />
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50 py-4 text-center">
          No {active} violations found.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((v) => <AuditIssueCard key={v.id} violation={v} auditId={auditId} />)}
        </div>
      )}
    </div>
  )
}
