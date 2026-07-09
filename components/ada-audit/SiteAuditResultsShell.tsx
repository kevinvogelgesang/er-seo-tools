'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ScoreRing } from '@/components/ui/ScoreRing'
import { ClientDate } from '@/components/ClientDate'

type ResultTab = 'accessibility' | 'seo'
function parseTab(v: string | null): ResultTab { return v === 'seo' ? 'seo' : 'accessibility' }

interface Props {
  domain: string
  clientName: string | null
  createdAt: string
  pagesTotal: number
  pagesError: number
  wcagLevel?: string
  adaScore: number | null
  seoScore: number | null
  exportBar?: React.ReactNode
  diffPanel?: React.ReactNode
  accessibility: React.ReactNode
  seo: React.ReactNode
  shareMode?: boolean
}

export default function SiteAuditResultsShell({
  domain, clientName, createdAt, pagesTotal, pagesError, wcagLevel,
  adaScore, seoScore, exportBar, diffPanel, accessibility, seo, shareMode = false,
}: Props) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [tab, setTab] = useState<ResultTab>(() => parseTab(searchParams.get('resultTab')))
  useEffect(() => { setTab(parseTab(searchParams.get('resultTab'))) }, [searchParams])

  const wcagLabel = wcagLevel === 'wcag22aa' ? 'WCAG 2.1 AA + Best Practices' : 'WCAG 2.1 AA'

  const selectTab = (next: ResultTab) => {
    setTab(next)
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'accessibility') params.delete('resultTab')
    else params.set('resultTab', next)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  const tabBtn = (value: ResultTab, label: string) => (
    <button
      key={value}
      role="tab"
      aria-selected={tab === value}
      onClick={() => selectTab(value)}
      className={`px-4 py-1.5 text-[13px] font-body font-semibold rounded-md transition-colors ${
        tab === value
          ? 'bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm'
          : 'text-navy/50 dark:text-white/50 hover:text-navy dark:hover:text-white'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-6">
      {/* Shared header */}
      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm px-6 py-4">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">Site Audit — {domain}</h2>
              <span className="text-[10px] font-body font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-navy/10 dark:bg-white/10 text-navy/50 dark:text-white/50">{wcagLabel}</span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              {clientName && <span className="text-[12px] font-body text-navy/40 dark:text-white/40">{clientName}</span>}
              <span className="text-[12px] font-body text-navy/40 dark:text-white/40"><ClientDate iso={createdAt} variant="dateTime" /></span>
              <span className="text-[12px] font-body text-navy/40 dark:text-white/40">
                {pagesTotal} pages{pagesError > 0 && ` · ${pagesError} error${pagesError !== 1 ? 's' : ''}`}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            <div className="flex flex-col items-center gap-1">
              <ScoreRing score={adaScore} size={40} />
              <span className="text-[10px] font-body font-semibold uppercase tracking-wider text-navy/40 dark:text-white/40">Accessibility</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <ScoreRing score={seoScore} size={40} />
              <span className="text-[10px] font-body font-semibold uppercase tracking-wider text-navy/40 dark:text-white/40">SEO</span>
            </div>
          </div>
        </div>
        {/* Codex #1: export/diff hit cookie-gated routes — NEVER render in shareMode. */}
        {!shareMode && (exportBar || diffPanel) && (
          <div className="mt-4 space-y-4">
            {exportBar}
            {diffPanel}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Results section" className="inline-flex gap-0.5 bg-gray-100 dark:bg-navy-light rounded-lg p-0.5">
        {tabBtn('accessibility', 'Accessibility')}
        {tabBtn('seo', 'SEO')}
      </div>

      {/* Panel — conditional render (matches AuditIndexTabs). The Accessibility
          tab's client state resets on tab switch; acceptable, same as that tab. */}
      <div role="tabpanel">{tab === 'accessibility' ? accessibility : seo}</div>
    </div>
  )
}
