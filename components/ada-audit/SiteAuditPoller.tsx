'use client'

import { useState } from 'react'
import { Spinner } from '@/components/Spinner'
import type { LiveAuditChild } from '@/lib/ada-audit/types'
import type { SeoPhase } from '@/lib/ada-audit/seo-phase'
import { SeoPhaseBanner } from '@/components/site-audit/SeoPhaseBanner'
import LiveAuditTable from './LiveAuditTable'
import { useAuditPoller } from './useAuditPoller'
import { deriveSeoOnlyStatus, isSeoOnlyTerminal } from './seo-poll-status'

interface PollData {
  status: string
  pagesTotal: number
  pagesComplete: number
  pagesError: number
  pdfsTotal?: number
  pdfsComplete?: number
  pdfsError?: number
  pdfsSkipped?: number
  lighthouseTotal?: number
  lighthouseComplete?: number
  lighthouseError?: number
  queuePosition: number | null
  activeAudit: {
    id: string
    domain: string
    pagesTotal: number
    pagesComplete: number
    pagesError: number
  } | null
  liveChildren?: LiveAuditChild[]
  seoOnly?: boolean
  liveScanRunId?: string | null
  seoPhase?: SeoPhase
}

interface Props {
  id: string
  initialStatus: string
  initialPagesTotal: number
  initialPagesComplete: number
  initialPagesError: number
  seoOnly?: boolean
  initialLiveScanRunId?: string | null
  initialSeoPhase?: SeoPhase | null
}

export default function SiteAuditPoller({
  id,
  initialStatus,
  initialPagesTotal,
  initialPagesComplete,
  initialPagesError,
  seoOnly = false,
  initialLiveScanRunId = null,
  initialSeoPhase = null,
}: Props) {
  const [pagesTotal, setPagesTotal] = useState(initialPagesTotal)
  const [pagesComplete, setPagesComplete] = useState(initialPagesComplete)
  const [pagesError, setPagesError] = useState(initialPagesError)
  const [pdfsTotal, setPdfsTotal] = useState(0)
  const [pdfsComplete, setPdfsComplete] = useState(0)
  const [pdfsError, setPdfsError] = useState(0)
  const [pdfsSkipped, setPdfsSkipped] = useState(0)
  const [lighthouseTotal, setLighthouseTotal] = useState(0)
  const [lighthouseComplete, setLighthouseComplete] = useState(0)
  const [lighthouseError, setLighthouseError] = useState(0)
  const [status, setStatus] = useState(initialStatus)
  const [queuePosition, setQueuePosition] = useState<number | null>(null)
  const [activeAudit, setActiveAudit] = useState<PollData['activeAudit']>(null)
  const [liveChildren, setLiveChildren] = useState<LiveAuditChild[]>([])
  const [liveScanRunId, setLiveScanRunId] = useState<string | null>(initialLiveScanRunId)
  const [seoPhase, setSeoPhase] = useState<SeoPhase | null>(initialSeoPhase)

  // C17: seoOnly audits keep polling through parent 'complete' — the verifier
  // sub-phase runs after the crawl (spec Codex fix #8). The synthetic status
  // makes 'complete' non-terminal until run-ready/failed/unavailable.
  const initialSynthetic = seoOnly
    ? deriveSeoOnlyStatus(initialStatus, initialLiveScanRunId, initialSeoPhase?.state ?? null)
    : initialStatus

  useAuditPoller<PollData>({
    url: `/api/site-audit/${id}`,
    intervalMs: 3000,
    initialStatus: initialSynthetic,
    getStatus: (d) =>
      seoOnly ? deriveSeoOnlyStatus(d.status, d.liveScanRunId ?? null, d.seoPhase?.state ?? null) : d.status,
    isTerminal: (s) =>
      seoOnly ? isSeoOnlyTerminal(s) : s === 'complete' || s === 'error' || s === 'cancelled',
    onTerminal: (data) => {
      // Single navigation owner: run-ready redirects (replace), every other
      // terminal falls through to the hook's refresh (server re-renders the
      // static failed/unavailable banner or the error/cancelled card).
      if (seoOnly && data.liveScanRunId) {
        return { redirect: `/seo-audits/results/run/${data.liveScanRunId}` }
      }
    },
    onData: (data) => {
      setLiveScanRunId(data.liveScanRunId ?? null)
      setSeoPhase(data.seoPhase ?? null)
      setPagesTotal(data.pagesTotal)
      setPagesComplete(data.pagesComplete)
      setPagesError(data.pagesError)
      setPdfsTotal(data.pdfsTotal ?? 0)
      setPdfsComplete(data.pdfsComplete ?? 0)
      setPdfsError(data.pdfsError ?? 0)
      setPdfsSkipped(data.pdfsSkipped ?? 0)
      setLighthouseTotal(data.lighthouseTotal ?? 0)
      setLighthouseComplete(data.lighthouseComplete ?? 0)
      setLighthouseError(data.lighthouseError ?? 0)
      setStatus(data.status)
      setQueuePosition(data.queuePosition)
      setActiveAudit(data.activeAudit)
      setLiveChildren(data.liveChildren ?? [])
    },
  })

  const synthetic = seoOnly
    ? deriveSeoOnlyStatus(status, liveScanRunId, seoPhase?.state ?? null)
    : status

  // C17: seoOnly post-crawl states own the whole card. 'seo-ready' shows a
  // brief opening notice while router.replace() lands.
  if (seoOnly && synthetic.startsWith('seo-')) {
    if (synthetic === 'seo-ready') {
      return (
        <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-8 flex items-center gap-3">
          <Spinner className="w-5 h-5 text-orange flex-shrink-0" />
          <p className="font-display font-bold text-[17px] text-navy dark:text-white">Opening SEO results…</p>
        </div>
      )
    }
    return (
      <SeoPhaseBanner
        phase={seoPhase ?? { state: 'queued', progress: null, message: null }}
        live={synthetic === 'seo-verifying'}
      />
    )
  }

  const scanned = pagesComplete + pagesError
  const progress = pagesTotal > 0 ? Math.round((scanned / pagesTotal) * 100) : 0
  const discovering = pagesTotal === 0 && status === 'running'
  const isQueued = status === 'queued'
  const isPdfsRunning = status === 'pdfs-running'
  const isLighthouseRunning = status === 'lighthouse-running'

  // Active audit progress (for queued state)
  const activeScanned = activeAudit ? activeAudit.pagesComplete + activeAudit.pagesError : 0
  const activeProgress = activeAudit && activeAudit.pagesTotal > 0
    ? Math.round((activeScanned / activeAudit.pagesTotal) * 100)
    : 0

  return (
    <div className="space-y-4">
      {/* Queued state */}
      {isQueued && (
        <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-8 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="font-display font-bold text-[17px] text-navy dark:text-white">
                Queued — position {queuePosition ?? '…'}
              </p>
              <p className="text-[12px] font-body text-navy/50 dark:text-white/50 mt-0.5">
                Your audit will start automatically when the current one finishes.
              </p>
            </div>
          </div>

          {/* Show active audit progress */}
          {activeAudit && (
            <div className="bg-gray-50 dark:bg-navy-deep border border-gray-100 dark:border-navy-border rounded-xl px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-body font-semibold text-navy/60 dark:text-white/60">
                  Currently scanning: {activeAudit.domain}
                </span>
                <span className="text-[11px] font-body text-navy/40 dark:text-white/40">
                  {activeAudit.pagesTotal > 0
                    ? `${activeScanned} of ${activeAudit.pagesTotal} pages`
                    : 'Discovering pages…'
                  }
                </span>
              </div>
              {activeAudit.pagesTotal > 0 && (
                <div className="w-full bg-gray-200 dark:bg-navy-light rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-blue-400 dark:bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${activeProgress}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Running / discovering state */}
      {!isQueued && (
        <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-8 space-y-5">
          <div className="flex items-center gap-3">
            <Spinner className="w-5 h-5 text-orange flex-shrink-0" />
            <div>
              <p className="font-display font-bold text-[17px] text-navy dark:text-white">
                {isPdfsRunning
                  ? 'Scanning PDFs…'
                  : isLighthouseRunning
                    ? 'Running Lighthouse…'
                    : discovering
                      ? 'Discovering pages…'
                      : 'Scanning pages…'
                }
              </p>
              <p className="text-[12px] font-body text-navy/50 dark:text-white/50 mt-0.5">
                {isPdfsRunning
                  ? `${pdfsComplete + pdfsError + pdfsSkipped} of ${pdfsTotal > 0 ? pdfsTotal : '?'} PDFs scanned${pdfsError > 0 ? ` · ${pdfsError} error${pdfsError !== 1 ? 's' : ''}` : ''}${pdfsSkipped > 0 ? ` · ${pdfsSkipped} skipped` : ''}`
                  : isLighthouseRunning
                    ? `${lighthouseComplete + lighthouseError} of ${lighthouseTotal > 0 ? lighthouseTotal : '?'} pages scored${lighthouseError > 0 ? ` · ${lighthouseError} error${lighthouseError !== 1 ? 's' : ''}` : ''}`
                    : discovering
                      ? 'Fetching sitemap.xml to find pages to audit'
                      : `${scanned} of ${pagesTotal} pages scanned${pagesError > 0 ? ` · ${pagesError} error${pagesError !== 1 ? 's' : ''}` : ''}`
                }
              </p>
            </div>
          </div>

          {!discovering && pagesTotal > 0 && (
            <div className="space-y-1.5">
              <div className="w-full bg-gray-100 dark:bg-navy-light rounded-full h-2 overflow-hidden">
                <div
                  className="bg-orange h-2 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] font-body text-navy/40 dark:text-white/40">
                <span>{progress}%</span>
                <span>{pagesTotal} pages total</span>
              </div>
            </div>
          )}

          {isPdfsRunning && pdfsTotal > 0 && (
            <div className="text-[12px] font-body text-navy/40 dark:text-white/40">
              Scanning PDFs ({pdfsComplete + pdfsError + pdfsSkipped}/{pdfsTotal})
            </div>
          )}

          {isLighthouseRunning && lighthouseTotal > 0 && (
            <div className="text-[12px] font-body text-navy/40 dark:text-white/40">
              Running Lighthouse ({lighthouseComplete + lighthouseError}/{lighthouseTotal})
            </div>
          )}

          <p className="text-[12px] font-body text-navy/40 dark:text-white/40">
            Each page is scanned individually for accessibility and SEO. Large sites can take several minutes.
          </p>
        </div>
      )}

      {/* Live pages-so-far table — populates once at least one child page
          finishes. Hidden during the queued state (operator has nothing to
          look at yet) and when the API hasn't returned liveChildren. */}
      {!isQueued && liveChildren.length > 0 && (
        <LiveAuditTable rows={liveChildren} />
      )}
    </div>
  )
}
