'use client'

import { useState } from 'react'
import type { CommonIssue, CommonIssueTier, ImpactLevel } from '@/lib/ada-audit/types'
import { COMMON_ISSUE_MAX_CALLOUTS } from '@/lib/ada-audit/common-issues'
import { safeExternalHref } from '@/lib/safe-external-href'

interface Props {
  issues: CommonIssue[]
  /** Invoked with the ruleId when "View affected pages" is clicked. Wires up
   *  to setViewMode('by-violation') + setSelectedViolationId(ruleId) in the
   *  parent so the by-violation tab opens with that rule expanded + scrolled. */
  onViewAffectedPages: (ruleId: string) => void
}

const IMPACT_ACCENT: Record<ImpactLevel, { border: string; bg: string; chip: string; dot: string }> = {
  critical: {
    border: 'border-l-red-500 dark:border-l-red-400',
    bg:     'bg-red-50 dark:bg-red-500/10',
    chip:   'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/30',
    dot:    'bg-red-500',
  },
  serious: {
    border: 'border-l-orange-500 dark:border-l-orange-400',
    bg:     'bg-orange-50 dark:bg-orange-500/10',
    chip:   'bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/30',
    dot:    'bg-orange-500',
  },
  moderate: {
    border: 'border-l-yellow-500 dark:border-l-yellow-400',
    bg:     'bg-yellow-50 dark:bg-yellow-500/10',
    chip:   'bg-yellow-100 dark:bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-500/30',
    dot:    'bg-yellow-500',
  },
  minor: {
    border: 'border-l-blue-500 dark:border-l-blue-400',
    bg:     'bg-blue-50 dark:bg-blue-500/10',
    chip:   'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/30',
    dot:    'bg-blue-400',
  },
}

const TIER_LABEL: Record<CommonIssueTier, string> = {
  template: 'Template-wide',
  common: 'Shared component',
  recurring: 'Recurring element',
}

const TIER_CHIP: Record<CommonIssueTier, string> = {
  template:  'bg-navy/10 dark:bg-white/10 text-navy dark:text-white border-navy/15 dark:border-white/15',
  common:    'bg-navy/[0.06] dark:bg-white/[0.06] text-navy/80 dark:text-white/80 border-navy/10 dark:border-white/10',
  recurring: 'bg-transparent text-navy/60 dark:text-white/60 border-navy/15 dark:border-white/15',
}

function ancestorSentence(issue: CommonIssue): string {
  const { affectedPagesCount: hits, totalPagesScanned: n, sharedAncestor, ancestorConfidence } = issue
  const tier: CommonIssueTier = issue.tier ?? 'template'

  if (tier === 'template') {
    if (sharedAncestor && ancestorConfidence === 'all') {
      return `Appears on all ${n} scanned pages inside <${sharedAncestor}> — likely a one-time fix in your ${sharedAncestor} template.`
    }
    if (sharedAncestor && ancestorConfidence === 'majority') {
      return `Appears on ${hits} of ${n} scanned pages, most often inside <${sharedAncestor}> — likely a one-time template fix.`
    }
    return `Appears on ${hits} of ${n} scanned pages — likely a one-time template fix.`
  }

  if (tier === 'common') {
    if (sharedAncestor) {
      return `Appears on ${hits} of ${n} scanned pages, most often inside <${sharedAncestor}> — likely a shared component or layout block.`
    }
    return `Appears on ${hits} of ${n} scanned pages — likely a shared component or layout block.`
  }

  // recurring
  if (sharedAncestor) {
    return `Appears on ${hits} of ${n} scanned pages, most often inside <${sharedAncestor}> — may point to a recurring element or page-type pattern.`
  }
  return `Appears on ${hits} of ${n} scanned pages — may point to a recurring element or page-type pattern.`
}

function CommonIssueCard({ issue, onViewAffectedPages }: { issue: CommonIssue; onViewAffectedPages: (ruleId: string) => void }) {
  const accent = IMPACT_ACCENT[issue.impact]
  const helpHref = safeExternalHref(issue.helpUrl)
  const tier: CommonIssueTier = issue.tier ?? 'template'

  return (
    <div
      className={`border-l-4 ${accent.border} ${accent.bg} rounded-r-xl border border-l-4 border-gray-200 dark:border-navy-border px-4 py-3`}
    >
      <div className="flex items-start gap-3">
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-body font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${accent.chip} mt-0.5 flex-shrink-0`}>
          <span className={`w-1.5 h-1.5 rounded-full ${accent.dot}`} />
          {issue.impact}
        </span>
        <span className={`inline-flex items-center text-[10px] font-body font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${TIER_CHIP[tier]} mt-0.5 flex-shrink-0`}>
          {TIER_LABEL[tier]}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-body font-semibold text-[13px] text-navy dark:text-white leading-snug">
            {issue.help || issue.ruleId}
          </p>
          <p className="text-[12px] font-body text-navy/60 dark:text-white/60 mt-1">
            {ancestorSentence(issue)}
          </p>
          {issue.canonicalSelector && issue.examplePageUrl && (
            <p className="text-[12px] font-body text-navy/60 dark:text-white/60 mt-1">
              CSS selector:{' '}
              <code className="text-orange font-mono text-[11px]">{issue.canonicalSelector}</code>
              {' · '}
              <a
                href={safeExternalHref(issue.examplePageUrl) ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange hover:underline"
              >
                View on {issue.examplePageUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </a>
            </p>
          )}
          <div className="flex items-center gap-3 mt-2">
            <button
              type="button"
              onClick={() => onViewAffectedPages(issue.ruleId)}
              className="text-[11px] font-body font-semibold text-orange hover:text-orange-light transition-colors"
            >
              View affected pages →
            </button>
            {helpHref && (
              <a
                href={helpHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-body text-navy/40 dark:text-white/40 hover:text-orange transition-colors"
              >
                Learn more ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CommonIssueCallout({ issues, onViewAffectedPages }: Props) {
  const [expanded, setExpanded] = useState(false)

  if (issues.length === 0) return null

  const visible = expanded ? issues : issues.slice(0, COMMON_ISSUE_MAX_CALLOUTS)
  const overflow = issues.length - COMMON_ISSUE_MAX_CALLOUTS

  return (
    <div className="space-y-2 px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50/40 dark:bg-navy-deep/30">
      <p className="text-[11px] font-body font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">
        Site-wide patterns
        <span className="text-navy/30 dark:text-white/30 font-normal normal-case tracking-normal ml-2">
          {issues.length} issue{issues.length !== 1 ? 's' : ''} repeating across multiple pages
        </span>
      </p>
      <div className="space-y-2">
        {visible.map((issue) => (
          <CommonIssueCard
            key={issue.ruleId}
            issue={issue}
            onViewAffectedPages={onViewAffectedPages}
          />
        ))}
      </div>
      {overflow > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-[12px] font-body font-semibold text-orange hover:text-orange-light transition-colors"
        >
          {expanded ? 'Show fewer' : `+ ${overflow} more`}
        </button>
      )}
    </div>
  )
}
