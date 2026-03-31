'use client'

import { useState } from 'react'
import type { SiteAuditSummary, SitePageResult, AuditScorecard } from '@/lib/ada-audit/types'
import AuditScorecardComponent from './AuditScorecard'
import AuditIssueTabs from './AuditIssueTabs'
import type { StoredAxeResults } from '@/lib/ada-audit/types'

interface Props {
  domain: string
  clientName: string | null
  createdAt: string
  pagesTotal: number
  pagesError: number
  summary: SiteAuditSummary
}

function ImpactCount({ n, color }: { n: number; color: string }) {
  if (n === 0) return <span className="text-navy/20">—</span>
  return <span className={`font-semibold ${color}`}>{n}</span>
}

function PageRow({ page }: { page: SitePageResult }) {
  const [expanded, setExpanded] = useState(false)
  const [violations, setViolations] = useState<StoredAxeResults['violations'] | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleExpand() {
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

  return (
    <>
      <tr
        className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${expanded ? 'bg-gray-50' : ''}`}
        onClick={handleExpand}
      >
        <td className="py-2.5 pr-3 pl-4">
          <div className="flex items-center gap-2">
            <svg
              className={`w-3 h-3 flex-shrink-0 text-navy/30 transition-transform ${expanded ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-[12px] font-body text-navy/80 truncate max-w-xs" title={page.url}>
              {urlDisplay}
            </span>
          </div>
        </td>
        <td className="py-2.5 pr-3 text-[12px] font-body text-center">
          {page.status === 'error'
            ? <span className="text-[10px] font-body bg-red-100 text-red-600 px-2 py-0.5 rounded" title={page.error ?? ''}>error</span>
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
        <td className="py-2.5 pr-4 text-[12px] font-body font-semibold text-navy/70 text-center">
          {page.status !== 'error' && (sc?.total ?? 0)}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 border-b border-gray-100">
          <td colSpan={6} className="px-8 py-4">
            {loading ? (
              <div className="flex items-center gap-2 text-[12px] font-body text-navy/40 py-2">
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading violations…
              </div>
            ) : page.status === 'error' ? (
              <p className="text-[12px] font-body text-red-600 py-2">{page.error}</p>
            ) : violations !== null ? (
              <div className="space-y-3">
                <AuditIssueTabs violations={violations} />
                <a
                  href={`/ada-audit/${page.adaAuditId}`}
                  className="inline-block text-[12px] font-body font-semibold text-orange hover:text-orange-light transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  View full audit ↗
                </a>
              </div>
            ) : (
              <p className="text-[12px] font-body text-navy/40 py-2">Could not load violations.</p>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export default function SiteAuditResultsView({
  domain, clientName, createdAt, pagesTotal, pagesError, summary,
}: Props) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-start gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div className="w-8 h-8 rounded-lg bg-orange/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-[17px] text-navy">Site Audit — {domain}</h2>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              {clientName && <span className="text-[12px] font-body text-navy/40">{clientName}</span>}
              <span className="text-[12px] font-body text-navy/40">{new Date(createdAt).toLocaleString()}</span>
              <span className="text-[12px] font-body text-navy/40">
                {pagesTotal} pages
                {pagesError > 0 && ` · ${pagesError} error${pagesError !== 1 ? 's' : ''}`}
              </span>
            </div>
          </div>
        </div>
        <div className="p-6">
          <AuditScorecardComponent scorecard={summary.aggregate} />
        </div>
      </div>

      {/* Limitations notice */}
      <div className="flex gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-[12px] font-body text-amber-800 leading-relaxed">
        <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>
          <strong>Known limitations:</strong> Pages are audited from static HTML only. External stylesheets,
          client-rendered content, and lazy-loaded sections are not included. Treat results as a starting point.
        </span>
      </div>

      {/* Page table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div className="w-8 h-8 rounded-lg bg-orange/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h2 className="font-display font-bold text-[17px] text-navy">
            Pages <span className="text-navy/40 font-normal text-[14px]">sorted by violations</span>
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-4 py-2 text-[10px] font-body font-semibold uppercase tracking-wider text-navy/40">Page</th>
                <th className="text-center pr-3 py-2 text-[10px] font-body font-semibold uppercase tracking-wider text-red-400">Crit</th>
                <th className="text-center pr-3 py-2 text-[10px] font-body font-semibold uppercase tracking-wider text-orange-400">Ser</th>
                <th className="text-center pr-3 py-2 text-[10px] font-body font-semibold uppercase tracking-wider text-yellow-500">Mod</th>
                <th className="text-center pr-3 py-2 text-[10px] font-body font-semibold uppercase tracking-wider text-blue-400">Min</th>
                <th className="text-center pr-4 py-2 text-[10px] font-body font-semibold uppercase tracking-wider text-navy/40">Total</th>
              </tr>
            </thead>
            <tbody>
              {summary.pages.map((page) => (
                <PageRow key={page.adaAuditId} page={page} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
