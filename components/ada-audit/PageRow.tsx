'use client'

import { useState, useEffect } from 'react'
import { Spinner } from '@/components/Spinner'
import type { SitePageResult, StoredAxeResults } from '@/lib/ada-audit/types'
import AuditIssueTabs from './AuditIssueTabs'
import type { UseChecksReturn } from './useChecks'
import { keyForPage, keyForPageViolation } from '@/lib/ada-audit/checks-keys-browser'
import { safeExternalHref } from '@/lib/safe-external-href'

function ImpactCount({ n, color }: { n: number; color: string }) {
  if (n === 0) return <span className="text-navy/20 dark:text-white/20">—</span>
  return <span className={`font-semibold ${color}`}>{n}</span>
}

interface PageRowProps {
  page: SitePageResult
  triageMode: boolean
  readOnly: boolean
  checks: UseChecksReturn
  shareMode: boolean
}

export default function PageRow({ page, triageMode, readOnly, checks, shareMode }: PageRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [violations, setViolations] = useState<StoredAxeResults['violations'] | null>(null)
  const [loading, setLoading] = useState(false)

  // Pre-compute page + per-violation keys for this page.
  const [pageKey, setPageKey] = useState<string>('')
  const [violationKeyMap, setViolationKeyMap] = useState<Record<string, string>>({})

  useEffect(() => {
    if (shareMode) return // triage keys are an internal-only affordance
    let cancelled = false
    ;(async () => {
      const pk = await keyForPage({ pageUrl: page.url })
      const vks: Record<string, string> = {}
      for (const ruleId of page.violationIds ?? []) {
        vks[ruleId] = await keyForPageViolation({ pageUrl: page.url, ruleId })
      }
      if (!cancelled) {
        setPageKey(pk)
        setViolationKeyMap(vks)
      }
    })()
    return () => { cancelled = true }
  }, [page.url, page.violationIds, shareMode])

  const violationKeys = Object.values(violationKeyMap)
  const allViolationsChecked =
    violationKeys.length > 0 &&
    violationKeys.every((k) => checks.has('page-violation', k))
  const pageChecked = !!pageKey && checks.has('page', pageKey)
  const pageStruck = pageChecked || allViolationsChecked

  async function handleExpand() {
    if (shareMode) return // public view: expansion fetches a cookie-gated API
    if (expanded) { setExpanded(false); return }
    setExpanded(true)
    if (violations !== null) return
    setLoading(true)
    try {
      const res = await fetch(`/api/ada-audit/${page.adaAuditId}`)
      if (res.ok) {
        const data = await res.json()
        setViolations(data.results?.violations ?? [])
      }
    } catch { /* leave null */ } finally {
      setLoading(false)
    }
  }

  const urlDisplay = page.url.replace(/^https?:\/\//, '')
  const sc = page.scorecard
  const pageHref = safeExternalHref(page.url)

  const colSpan = triageMode ? 7 : 6

  return (
    <>
      <tr
        className={`border-b border-gray-100 dark:border-navy-border transition-colors ${shareMode ? '' : 'hover:bg-gray-50 dark:hover:bg-navy-light cursor-pointer'} ${expanded ? 'bg-gray-50 dark:bg-navy-light' : ''}`}
        onClick={shareMode ? undefined : handleExpand}
      >
        {triageMode && (
          <td className="py-2.5 pl-4 pr-2 w-8" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              className="accent-orange"
              checked={pageStruck}
              disabled={readOnly || !checks.loaded || !pageKey || checks.pending}
              onChange={(e) => void checks.setCheck('page', pageKey, e.currentTarget.checked)}
              aria-label={`Mark page ${page.url} as handled`}
            />
          </td>
        )}
        <td className={`py-2.5 pr-3 ${triageMode ? 'pl-2' : 'pl-4'}`}>
          <div className="flex items-center gap-2">
            {!shareMode && (
              <svg
                className={`w-3 h-3 flex-shrink-0 text-navy/30 dark:text-white/30 transition-transform ${expanded ? 'rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            )}
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`text-[12px] font-body truncate max-w-xs ${pageStruck ? 'line-through text-navy/40 dark:text-white/30' : 'text-navy/80 dark:text-white/80'}`}
                title={page.url}
              >
                {urlDisplay}
              </span>
              {pageHref && (
                <a
                  href={pageHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 text-navy/40 dark:text-white/30 hover:text-orange dark:hover:text-orange transition-colors"
                  title={`Open ${page.url}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              )}
            </div>
          </div>
        </td>
        <td className="py-2.5 pr-3 text-[12px] font-body text-center">
          {page.status === 'error'
            ? <span className="text-[10px] font-body bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400 px-2 py-0.5 rounded" title={page.error ?? ''}>error</span>
            : <ImpactCount n={sc?.critical ?? 0} color="text-red-600" />}
        </td>
        <td className="py-2.5 pr-3 text-[12px] font-body text-center">
          {page.status !== 'error' && <ImpactCount n={sc?.serious ?? 0} color="text-orange-600" />}
        </td>
        <td className="py-2.5 pr-3 text-[12px] font-body text-center">
          {page.status !== 'error' && <ImpactCount n={sc?.moderate ?? 0} color="text-yellow-600" />}
        </td>
        <td className="py-2.5 pr-3 text-[12px] font-body text-center">
          {page.status !== 'error' && <ImpactCount n={sc?.minor ?? 0} color="text-blue-600" />}
        </td>
        <td className="py-2.5 pr-4 text-[12px] font-body font-semibold text-navy/70 dark:text-white/70 text-center">
          {page.status !== 'error' && (sc?.total ?? 0)}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 dark:bg-navy-deep border-b border-gray-100 dark:border-navy-border">
          <td colSpan={colSpan} className="px-8 py-4">
            {loading ? (
              <div className="flex items-center gap-2 text-[12px] font-body text-navy/40 dark:text-white/40 py-2">
                <Spinner />
                Loading violations…
              </div>
            ) : page.status === 'error' ? (
              <p className="text-[12px] font-body text-red-600 dark:text-red-400 py-2">{page.error}</p>
            ) : violations !== null ? (
              <div className="space-y-3">
                <AuditIssueTabs
                  violations={violations}
                  siteCheckContext={{
                    pageUrl: page.url,
                    triageMode,
                    readOnly,
                    checks,
                  }}
                />
                <a
                  href={`/ada-audit/${page.adaAuditId}`}
                  className="inline-block text-[12px] font-body font-semibold text-orange hover:text-orange-light transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  View full audit ↗
                </a>
              </div>
            ) : (
              <p className="text-[12px] font-body text-navy/40 dark:text-white/40 py-2">Could not load violations.</p>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
