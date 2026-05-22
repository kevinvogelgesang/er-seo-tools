'use client'

import { useEffect, useState } from 'react'
import type { AxeViolation, ImpactLevel } from '@/lib/ada-audit/types'
import { safeExternalHref } from '@/lib/safe-external-href'
import { keyForNode, keyForPageViolation } from '@/lib/ada-audit/checks-keys-browser'
import type { SinglePageChecksContext, SiteCheckContext } from './AuditIssueTabs'

interface Props {
  violation: AxeViolation
  auditId?: string
  checksContext?: SinglePageChecksContext
  siteCheckContext?: SiteCheckContext
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

export default function AuditIssueCard({ violation, auditId, checksContext, siteCheckContext }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [showDev, setShowDev] = useState(false)

  const wcagTags = violation.tags.filter((t) => t.startsWith('wcag') || t.startsWith('best-practice'))
  const displayNodes = violation.nodes
  const helpHref = safeExternalHref(violation.helpUrl)

  // Pre-compute per-node keys (single-page audit checkboxes)
  const [nodeKeys, setNodeKeys] = useState<string[]>([])
  useEffect(() => {
    if (!checksContext) return
    let cancelled = false
    Promise.all(
      violation.nodes.map((n) =>
        keyForNode({ ruleId: violation.id, target: (n.target ?? []) as string[] }),
      ),
    ).then((ks) => { if (!cancelled) setNodeKeys(ks) })
    return () => { cancelled = true }
  }, [violation, checksContext])

  // Pre-compute the per-page-violation key (site audit checkbox)
  const [violationKey, setViolationKey] = useState<string>('')
  useEffect(() => {
    if (!siteCheckContext) return
    let cancelled = false
    keyForPageViolation({ pageUrl: siteCheckContext.pageUrl, ruleId: violation.id }).then((k) => {
      if (!cancelled) setViolationKey(k)
    })
    return () => { cancelled = true }
  }, [siteCheckContext, violation.id])

  // Single-page rollup: rule is "struck" when every node is checked
  const allNodesChecked = !!(
    checksContext &&
    nodeKeys.length > 0 &&
    nodeKeys.every((k) => checksContext.checks.has('node', k))
  )

  // Site-audit per-violation check
  const siteViolationChecked = !!(
    siteCheckContext &&
    violationKey &&
    siteCheckContext.checks.has('page-violation', violationKey)
  )

  // Combined "struck" state for visual treatment.
  // - Single-page: strike when all nodes checked
  // - Site audit: strike when per-violation box checked
  const ruleStruck = allNodesChecked || siteViolationChecked

  const showSinglePageRuleCheckbox = !!checksContext && checksContext.triageMode
  const showSiteViolationCheckbox = !!siteCheckContext && siteCheckContext.triageMode
  const checkboxDisabledSingle = !!checksContext && (checksContext.readOnly || !checksContext.checks.loaded || checksContext.checks.pending || nodeKeys.length === 0)
  const checkboxDisabledSite = !!siteCheckContext && (siteCheckContext.readOnly || !siteCheckContext.checks.loaded || !violationKey || siteCheckContext.checks.pending)

  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-xl overflow-hidden shadow-sm">
      {/* Always-visible header */}
      <div className="flex items-start gap-2 px-4 py-3.5">
        {showSinglePageRuleCheckbox && (
          <input
            type="checkbox"
            className="mt-1 flex-shrink-0 accent-orange"
            checked={allNodesChecked}
            disabled={checkboxDisabledSingle}
            onChange={(e) => {
              if (!checksContext) return
              const target = e.currentTarget.checked
              const entries = nodeKeys.map((k) => ({ scope: 'node', key: k, checked: target }))
              void checksContext.checks.setManyChecks(entries)
            }}
            aria-label={`Mark rule ${violation.id} as resolved`}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {showSiteViolationCheckbox && (
          <input
            type="checkbox"
            className="mt-1 flex-shrink-0 accent-orange"
            checked={siteViolationChecked}
            disabled={checkboxDisabledSite}
            onChange={(e) => {
              if (!siteCheckContext) return
              void siteCheckContext.checks.setCheck('page-violation', violationKey, e.currentTarget.checked)
            }}
            aria-label={`Mark violation ${violation.id} as resolved`}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <button
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex-1 flex items-start gap-3 text-left hover:bg-gray-50 dark:hover:bg-navy-light transition-colors -mx-2 -my-1 px-2 py-1 rounded"
        >
          <span className="mt-0.5 flex-shrink-0">
            <ImpactBadge impact={violation.impact} />
          </span>
          <div className="flex-1 min-w-0">
            <p className={`text-[13px] font-body font-semibold leading-snug ${ruleStruck ? 'line-through text-navy/40 dark:text-white/30' : 'text-navy dark:text-white'}`}>{violation.help}</p>
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
      </div>

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
              {displayNodes.map((node, i) => {
                const nodeKey = nodeKeys[i]
                const nodeChecked = !!(checksContext && nodeKey && checksContext.checks.has('node', nodeKey))
                const showNodeCheckbox = !!checksContext && checksContext.triageMode
                const nodeStruck = nodeChecked
                return (
                  <div key={i} className="rounded-lg overflow-hidden border border-gray-800">
                    {showNodeCheckbox && (
                      <div className="bg-gray-50 dark:bg-navy-deep px-3 py-1.5 border-b border-gray-200 dark:border-navy-border flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="accent-orange"
                          checked={nodeChecked}
                          disabled={!checksContext || checksContext.readOnly || !checksContext.checks.loaded || !nodeKey || checksContext.checks.pending}
                          onChange={(e) => {
                            if (!checksContext || !nodeKey) return
                            void checksContext.checks.setCheck('node', nodeKey, e.currentTarget.checked)
                          }}
                          aria-label={`Mark node as resolved`}
                        />
                        <span className="text-[11px] font-body text-navy/50 dark:text-white/50">
                          Element {i + 1}
                        </span>
                      </div>
                    )}
                    <pre className={`bg-gray-900 text-green-400 text-[11px] font-mono px-3 py-2.5 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed ${nodeStruck ? 'line-through opacity-50' : ''}`}>
                      {node.html}
                    </pre>
                    {node.failureSummary && (
                      <div className={`bg-gray-50 dark:bg-navy-deep border-t border-gray-200 dark:border-navy-border px-3 py-2 text-[11px] font-body text-navy/70 dark:text-white/70 leading-relaxed ${nodeStruck ? 'line-through opacity-50' : ''}`}>
                        {node.failureSummary}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
