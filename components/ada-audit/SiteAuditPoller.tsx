'use client'

import { useState, useEffect, useRef } from 'react'
import { Spinner } from '@/components/Spinner'
import { useRouter } from 'next/navigation'
import type { SiteAuditDetail } from '@/lib/ada-audit/types'

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
  const [status, setStatus] = useState(initialStatus)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (status === 'complete' || status === 'error') return

    timerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/site-audit/${id}`)
        if (!res.ok) return
        const data: SiteAuditDetail = await res.json()

        setPagesTotal(data.pagesTotal)
        setPagesComplete(data.pagesComplete)
        setPagesError(data.pagesError)
        setStatus(data.status)

        if (data.status === 'complete' || data.status === 'error') {
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

  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-8 space-y-5">
      <div className="flex items-center gap-3">
        <Spinner className="w-5 h-5 text-orange flex-shrink-0" />
        <div>
          <p className="font-display font-bold text-[17px] text-navy dark:text-white">
            {discovering ? 'Discovering pages…' : 'Scanning pages…'}
          </p>
          <p className="text-[12px] font-body text-navy/50 dark:text-white/50 mt-0.5">
            {discovering
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

      <p className="text-[12px] font-body text-navy/40 dark:text-white/40">
        Pages are audited one at a time. Large sites may take several minutes.
      </p>
    </div>
  )
}
