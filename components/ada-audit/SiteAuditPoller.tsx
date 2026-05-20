'use client'

import { useState, useEffect, useRef } from 'react'
import { Spinner } from '@/components/Spinner'
import { useRouter } from 'next/navigation'
import type { LiveAuditChild } from '@/lib/ada-audit/types'
import LiveAuditTable from './LiveAuditTable'

interface PollData {
  status: string
  pagesTotal: number
  pagesComplete: number
  pagesError: number
  pdfsTotal?: number
  pdfsComplete?: number
  pdfsError?: number
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
}

interface Props {
  id: string
  initialStatus: string
  initialPagesTotal: number
  initialPagesComplete: number
  initialPagesError: number
}

export default function SiteAuditPoller({
  id,
  initialStatus,
  initialPagesTotal,
  initialPagesComplete,
  initialPagesError,
}: Props) {
  const router = useRouter()
  const [pagesTotal, setPagesTotal] = useState(initialPagesTotal)
  const [pagesComplete, setPagesComplete] = useState(initialPagesComplete)
  const [pagesError, setPagesError] = useState(initialPagesError)
  const [pdfsTotal, setPdfsTotal] = useState(0)
  const [pdfsComplete, setPdfsComplete] = useState(0)
  const [pdfsError, setPdfsError] = useState(0)
  const [lighthouseTotal, setLighthouseTotal] = useState(0)
  const [lighthouseComplete, setLighthouseComplete] = useState(0)
  const [lighthouseError, setLighthouseError] = useState(0)
  const [status, setStatus] = useState(initialStatus)
  const [queuePosition, setQueuePosition] = useState<number | null>(null)
  const [activeAudit, setActiveAudit] = useState<PollData['activeAudit']>(null)
  const [liveChildren, setLiveChildren] = useState<LiveAuditChild[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (status === 'complete' || status === 'error' || status === 'cancelled') return

    timerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/site-audit/${id}`)
        if (!res.ok) return
        const data: PollData = await res.json()

        setPagesTotal(data.pagesTotal)
        setPagesComplete(data.pagesComplete)
        setPagesError(data.pagesError)
        setPdfsTotal(data.pdfsTotal ?? 0)
        setPdfsComplete(data.pdfsComplete ?? 0)
        setPdfsError(data.pdfsError ?? 0)
        setLighthouseTotal(data.lighthouseTotal ?? 0)
        setLighthouseComplete(data.lighthouseComplete ?? 0)
        setLighthouseError(data.lighthouseError ?? 0)
        setStatus(data.status)
        setQueuePosition(data.queuePosition)
        setActiveAudit(data.activeAudit)
        setLiveChildren(data.liveChildren ?? [])

        if (data.status === 'complete' || data.status === 'error' || data.status === 'cancelled') {
          if (timerRef.current) clearInterval(timerRef.current)
          router.refresh()
        }
      } catch {
        // Network blip — keep polling
      }
    }, 3000)

    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [id, status, router])

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
                  ? `${pdfsComplete + pdfsError} of ${pdfsTotal > 0 ? pdfsTotal : '?'} PDFs scanned${pdfsError > 0 ? ` · ${pdfsError} error${pdfsError !== 1 ? 's' : ''}` : ''}`
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
              Scanning PDFs ({pdfsComplete + pdfsError}/{pdfsTotal})
            </div>
          )}

          {isLighthouseRunning && lighthouseTotal > 0 && (
            <div className="text-[12px] font-body text-navy/40 dark:text-white/40">
              Running Lighthouse ({lighthouseComplete + lighthouseError}/{lighthouseTotal})
            </div>
          )}

          <p className="text-[12px] font-body text-navy/40 dark:text-white/40">
            Pages are audited one at a time. Large sites may take several minutes.
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
