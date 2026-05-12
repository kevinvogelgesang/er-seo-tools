'use client'

import { useState } from 'react'
import type { AxeViolation, ImpactLevel } from '@/lib/ada-audit/types'
import { safeExternalHref } from '@/lib/safe-external-href'

interface Props {
  violation: AxeViolation
  auditId?: string
}

const IMPACT_STYLES: Record<NonNullable<ImpactLevel>, { badge: string; dot: string }> = {
  critical: { badge: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/30',    dot: 'bg-red-500' },
  serious:  { badge: 'bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/30', dot: 'bg-orange-500' },
  moderate: { badge: 'bg-yellow-100 dark:bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-500/30', dot: 'bg-yellow-500' },
  minor:    { badge: 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/30',   dot: 'bg-blue-400' },
}

function ImpactBadge({ impact }: { impact: ImpactLevel | null }) {
  if (!impact) return null
  const s = IMPACT_STYLES[impact]
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-body font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${s.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {impact}
    </span>
  )
}

export default function AuditIssueCard({ violation, auditId }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [showDev, setShowDev] = useState(false)

  const wcagTags = violation.tags.filter((t) => t.startsWith('wcag') || t.startsWith('best-practice'))
  const displayNodes = violation.nodes
  const helpHref = safeExternalHref(violation.helpUrl)

  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-xl overflow-hidden shadow-sm">
      {/* Always-visible header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-gray-50 dark:hover:bg-navy-light transition-colors"
      >
        <span className="mt-0.5 flex-shrink-0">
          <ImpactBadge impact={violation.impact} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-body font-semibold text-navy dark:text-white leading-snug">{violation.help}</p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {wcagTags.map((tag) => (
              <span key={tag} className="text-[10px] font-body bg-gray-100 dark:bg-navy-light text-navy/60 dark:text-white/60 px-1.5 py-0.5 rounded">
                {tag}
              </span>
            ))}
            <span className="text-[10px] font-body text-navy/40 dark:text-white/40">
              {violation.nodes.length} element{violation.nodes.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <svg
          aria-hidden="true"
          className={`w-4 h-4 flex-shrink-0 mt-0.5 text-navy/40 dark:text-white/40 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded: plain-language description */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-navy-border px-4 py-3.5 space-y-3">
          <p className="text-[13px] font-body text-navy/80 dark:text-white/80 leading-relaxed">{violation.description}</p>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowDev((d) => !d)}
              aria-expanded={showDev}
              className="text-[12px] font-body font-semibold text-orange hover:text-orange-light transition-colors"
            >
              {showDev ? 'Hide developer details' : 'Show developer details'}
            </button>
            {helpHref && (
              <a
                href={helpHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] font-body text-navy/50 dark:text-white/50 hover:text-navy/80 dark:hover:text-white/80 transition-colors"
              >
                Learn more ↗
              </a>
            )}
          </div>

          {/* Element screenshot */}
          {showDev && violation.screenshotPath && auditId && (
            <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-navy-border mt-1">
              <div className="bg-gray-50 dark:bg-navy-deep px-3 py-1.5 text-[11px] font-body text-navy/50 dark:text-white/50 border-b border-gray-200 dark:border-navy-border">
                Screenshot — first affected element
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/ada-audit/screenshots/${auditId}/${violation.screenshotPath}`}
                alt={`Screenshot of element violating: ${violation.help}`}
                className="w-full max-h-64 object-contain bg-white"
                loading="lazy"
              />
            </div>
          )}

          {/* Developer details: code snippets */}
          {showDev && displayNodes.length > 0 && (
            <div className="space-y-3 mt-1">
              {displayNodes.map((node, i) => (
                <div key={i} className="rounded-lg overflow-hidden border border-gray-800">
                  <pre className="bg-gray-900 text-green-400 text-[11px] font-mono px-3 py-2.5 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                    {node.html}
                  </pre>
                  {node.failureSummary && (
                    <div className="bg-gray-50 dark:bg-navy-deep border-t border-gray-200 dark:border-navy-border px-3 py-2 text-[11px] font-body text-navy/70 dark:text-white/70 leading-relaxed">
                      {node.failureSummary}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
