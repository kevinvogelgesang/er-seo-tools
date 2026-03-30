'use client'

import { useState } from 'react'
import type { AxeViolation, ImpactLevel } from '@/lib/ada-audit/types'
import AuditIssueCard from './AuditIssueCard'

interface Props {
  violations: AxeViolation[]
}

type TabId = 'all' | ImpactLevel

const TABS: { id: TabId; label: string }[] = [
  { id: 'all',      label: 'All' },
  { id: 'critical', label: 'Critical' },
  { id: 'serious',  label: 'Serious' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'minor',    label: 'Minor' },
]

export default function AuditIssueTabs({ violations }: Props) {
  const [active, setActive] = useState<TabId>('all')

  const filtered = active === 'all'
    ? violations
    : violations.filter((v) => v.impact === active)

  function countFor(id: TabId) {
    if (id === 'all') return violations.length
    return violations.filter((v) => v.impact === id).length
  }

  if (violations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
        <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
          <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="text-[15px] font-body font-semibold text-navy">No violations found</p>
          <p className="text-[13px] font-body text-navy/50 mt-1">
            axe-core found no accessibility violations on this page.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((tab) => {
          const count = countFor(tab.id)
          const isActive = active === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-body font-semibold border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-orange text-orange'
                  : 'border-transparent text-navy/50 hover:text-navy/80 hover:border-gray-300'
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                  isActive ? 'bg-orange/15 text-orange' : 'bg-gray-100 text-navy/50'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Issue cards */}
      {filtered.length === 0 ? (
        <p className="text-[13px] font-body text-navy/50 py-4 text-center">
          No {active} violations found.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((v) => <AuditIssueCard key={v.id} violation={v} />)}
        </div>
      )}
    </div>
  )
}
