'use client'

import { useEffect, useState } from 'react'
import type { StoredAxeResults, AuditScorecard, AuditPdfRow } from '@/lib/ada-audit/types'
import type { LighthouseSummary } from '@/lib/ada-audit/lighthouse-types'
import AuditScorecardComponent from './AuditScorecard'
import AuditIssueTabs from './AuditIssueTabs'
import ComplianceBanner from './ComplianceBanner'
import ShareAuditButton from './ShareAuditButton'
import ReScanButton from './ReScanButton'
import RescanBanner from './RescanBanner'
import LighthouseSection from './LighthouseSection'
import PdfIssuesSection from './PdfIssuesSection'
import { KnownLimitationsNotice } from './KnownLimitationsNotice'
import { safeExternalHref } from '@/lib/safe-external-href'
import { useChecks } from './useChecks'
import { ClientDate } from '@/components/ClientDate'

interface Props {
  results: StoredAxeResults
  url: string
  clientName: string | null
  createdAt: string
  auditId?: string
  wcagLevel?: string
  score?: number
  compliant?: boolean
  previousScore?: number | null
  fromAuditId?: string | null
  showRescan?: boolean
  readOnly?: boolean
  shareToken?: string
  lighthouseSummary?: LighthouseSummary | null
  lighthouseError?: string | null
  pdfs?: AuditPdfRow[]
}

function buildScorecard(results: StoredAxeResults): AuditScorecard {
  const v = results.violations
  return {
    critical:   v.filter((x) => x.impact === 'critical').length,
    serious:    v.filter((x) => x.impact === 'serious').length,
    moderate:   v.filter((x) => x.impact === 'moderate').length,
    minor:      v.filter((x) => x.impact === 'minor').length,
    total:      v.length,
    passed:     results.passes?.length ?? 0,
    incomplete: results.incomplete?.length ?? 0,
  }
}

export default function AuditResultsView({ results, url, clientName, createdAt, auditId, wcagLevel, score, compliant, previousScore, fromAuditId, showRescan, readOnly = false, shareToken, lighthouseSummary = null, lighthouseError = null, pdfs = [] }: Props) {
  const scorecard = buildScorecard(results)
  const wcagLabel = wcagLevel === 'wcag22aa' ? 'WCAG 2.1 AA + Best Practices' : 'WCAG 2.1 AA'
  const auditHref = safeExternalHref(url)

  const [triageMode, setTriageMode] = useState(false)

  useEffect(() => {
    if (!auditId) return
    const stored = localStorage.getItem(`er-triage-mode:${auditId}`)
    if (stored === '1') setTriageMode(true)
  }, [auditId])

  const onToggleTriage = () => {
    setTriageMode((prev) => {
      const next = !prev
      if (auditId) localStorage.setItem(`er-triage-mode:${auditId}`, next ? '1' : '0')
      return next
    })
  }

  const checksEndpoint = readOnly && shareToken
    ? `/api/ada-audit/share/${shareToken}/checks`
    : auditId
      ? `/api/ada-audit/${auditId}/checks`
      : ''

  const checks = useChecks({
    endpoint: checksEndpoint,
    enabled: !!checksEndpoint && (triageMode || readOnly),
    readOnly,
  })

  // In readOnly (share view), strikes display whenever any checks loaded.
  const displayChecks = triageMode || readOnly

  return (
    <div className="space-y-6">
      {fromAuditId && (
        <RescanBanner previousScore={previousScore ?? null} currentScore={score ?? null} />
      )}
      <ComplianceBanner />

      {/* Header */}
      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-start gap-3 px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
          <div className="w-8 h-8 rounded-lg bg-orange/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display font-bold text-[17px] text-navy dark:text-white truncate">Audit Results</h2>
              <span className="text-[10px] font-body font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-navy/10 dark:bg-white/10 text-navy/50 dark:text-white/50">
                {wcagLabel}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              {auditHref ? (
                <a
                  href={auditHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] font-body text-navy/50 dark:text-white/50 hover:text-orange truncate transition-colors"
                >
                  {url} ↗
                </a>
              ) : (
                <span className="text-[12px] font-body text-navy/50 dark:text-white/50 truncate">{url}</span>
              )}
              {clientName && (
                <span className="text-[12px] font-body text-navy/40 dark:text-white/40">{clientName}</span>
              )}
              <span className="text-[12px] font-body text-navy/40 dark:text-white/40">
                <ClientDate iso={createdAt} variant="dateTime" />
              </span>
            </div>
          </div>
          {auditId && !readOnly && (
            <div className="flex-shrink-0 flex items-center gap-2">
              <button
                type="button"
                onClick={onToggleTriage}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-body font-semibold border rounded-lg transition-colors ${triageMode ? 'bg-orange/10 border-orange text-orange' : 'border-gray-300 dark:border-navy-border text-navy/60 dark:text-white/60 hover:border-orange hover:text-orange'}`}
              >
                {triageMode ? 'Triage on' : 'Triage off'}
              </button>
              {showRescan && <ReScanButton url={url} wcagLevel={wcagLevel ?? 'wcag21aa'} auditId={auditId} />}
              <ShareAuditButton auditId={auditId} />
            </div>
          )}
        </div>
        <div className="p-6">
          <AuditScorecardComponent scorecard={scorecard} score={score} compliant={compliant} wcagLevel={wcagLevel} />
        </div>
      </div>

      {(results.domElementCount !== undefined && results.domElementCount < 50) && (
        <div className="flex gap-3 px-4 py-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl text-[12px] font-body text-red-800 dark:text-red-400 leading-relaxed">
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span>
            <strong>Unreliable result:</strong> Only {results.domElementCount} DOM elements were found in the static HTML snapshot.
            This page is likely JavaScript-rendered (React, Angular, etc.) — axe-core had almost nothing to scan,
            so a score of 100 does not reflect the actual rendered page. Use a browser-based tool like{' '}
            <a href="https://wave.webaim.org/" target="_blank" rel="noopener noreferrer" className="underline hover:text-red-900">WAVE</a>{' '}
            or the axe DevTools browser extension for accurate results.
          </span>
        </div>
      )}

      <KnownLimitationsNotice />

      {/* Lighthouse */}
      <LighthouseSection summary={lighthouseSummary} error={lighthouseError} />

      {/* Issues */}
      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
          <div className="w-8 h-8 rounded-lg bg-orange/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">Violations</h2>
        </div>
        <div className="p-6">
          <AuditIssueTabs
            violations={results.violations}
            incomplete={results.incomplete ?? []}
            auditId={readOnly ? undefined : auditId}
            checksContext={displayChecks ? { triageMode: displayChecks, readOnly, checks } : undefined}
          />
        </div>
      </div>

      {/* PDFs */}
      <PdfIssuesSection pdfs={pdfs} />
    </div>
  )
}
