'use client'

import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import ShareAuditButton from './ShareAuditButton'

interface Props {
  siteAuditId: string
  hasPrevious: boolean
  /** ISO stamp — non-null only when the page verified the file exists server-side. */
  initialReportGeneratedAt: string | null
}

type ReportState = 'none' | 'queueing' | 'rendering' | 'ready' | 'error'

// Toolbar idiom — mirrors ShareAuditButton's colorClass.idle.
const CONTROL_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-body font-semibold border rounded-lg transition-colors'
const CONTROL_IDLE =
  'bg-white dark:bg-navy-card border-gray-300 dark:border-navy-border text-navy dark:text-white hover:border-orange hover:text-orange'
const CONTROL_BUSY =
  'bg-white dark:bg-navy-card border-gray-200 dark:border-navy-border text-navy/50 dark:text-white/50 cursor-not-allowed'
const CONTROL_ERROR =
  'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/30 text-red-700 dark:text-red-400'

export default function SiteAuditExportBar({ siteAuditId, hasPrevious, initialReportGeneratedAt }: Props) {
  const [reportState, setReportState] = useState<ReportState>(initialReportGeneratedAt ? 'ready' : 'none')
  const [generatedAt, setGeneratedAt] = useState<string | null>(initialReportGeneratedAt)

  // Mirror generatedAt so the error-revert timeout never reads a stale closure.
  const generatedAtRef = useRef<string | null>(initialReportGeneratedAt)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const revertRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearPoll() {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      clearPoll()
      if (revertRef.current !== null) clearTimeout(revertRef.current)
    }
  }, [])

  function fail() {
    clearPoll()
    setReportState('error')
    if (revertRef.current !== null) clearTimeout(revertRef.current)
    revertRef.current = setTimeout(() => {
      // Revert to a clickable state: 'ready' if a previous report still exists.
      setReportState(generatedAtRef.current ? 'ready' : 'none')
    }, 3000)
  }

  async function pollStatus() {
    try {
      const res = await fetch(`/api/site-audit/${siteAuditId}/report/status`)
      if (!res.ok) return // transient — keep polling
      const data = (await res.json()) as { state?: string; generatedAt?: string | null }
      if (data.state === 'ready') {
        clearPoll()
        generatedAtRef.current = data.generatedAt ?? null
        setGeneratedAt(data.generatedAt ?? null)
        setReportState('ready')
      } else if (data.state === 'none') {
        // We were rendering and the queue drained without a file: render failed.
        fail()
      }
      // 'rendering' → keep polling.
    } catch {
      // transient network error — keep polling
    }
  }

  async function requestReport() {
    if (reportState === 'queueing' || reportState === 'rendering') return
    setReportState('queueing')
    try {
      const res = await fetch(`/api/site-audit/${siteAuditId}/report`, { method: 'POST' })
      if (!res.ok) {
        fail()
        return
      }
      setReportState('rendering')
      clearPoll()
      pollRef.current = setInterval(() => { void pollStatus() }, 2000)
    } catch {
      fail()
    }
  }

  const pdfIcon = (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    </svg>
  )

  let reportControls: React.ReactNode
  if (reportState === 'queueing' || reportState === 'rendering') {
    reportControls = (
      <button type="button" disabled className={`${CONTROL_BASE} ${CONTROL_BUSY} disabled:cursor-not-allowed`}>
        <Spinner className="w-3 h-3" />
        {reportState === 'queueing' ? 'Requesting…' : 'Rendering report…'}
      </button>
    )
  } else if (reportState === 'error') {
    reportControls = (
      <button type="button" onClick={requestReport} className={`${CONTROL_BASE} ${CONTROL_ERROR}`}>
        Report failed — retry
      </button>
    )
  } else if (reportState === 'ready') {
    reportControls = (
      <>
        <a
          href={`/api/site-audit/${siteAuditId}/report`}
          title={generatedAt ? `Generated ${generatedAt}` : undefined}
          className={`${CONTROL_BASE} ${CONTROL_IDLE}`}
        >
          {pdfIcon}
          Download report
        </a>
        <button type="button" onClick={requestReport} className={`${CONTROL_BASE} ${CONTROL_IDLE}`}>
          Regenerate
        </button>
      </>
    )
  } else {
    reportControls = (
      <button type="button" onClick={requestReport} className={`${CONTROL_BASE} ${CONTROL_IDLE}`}>
        {pdfIcon}
        PDF report
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ShareAuditButton auditId={siteAuditId} endpoint={`/api/site-audit/${siteAuditId}`} />
      <a href={`/api/site-audit/${siteAuditId}/csv`} className={`${CONTROL_BASE} ${CONTROL_IDLE}`}>
        Violations CSV
      </a>
      {hasPrevious && (
        <a href={`/api/site-audit/${siteAuditId}/csv?sheet=changes`} className={`${CONTROL_BASE} ${CONTROL_IDLE}`}>
          Changes CSV
        </a>
      )}
      <a href={`/api/site-audit/${siteAuditId}/vpat`} className={`${CONTROL_BASE} ${CONTROL_IDLE}`}>
        VPAT scaffold
      </a>
      {reportControls}
    </div>
  )
}
