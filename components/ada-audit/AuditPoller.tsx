'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import type { AuditDetail } from '@/lib/ada-audit/types'
import { useAuditPoller } from './useAuditPoller'

interface Props {
  id: string
  url: string
  createdAt: string        // ISO — used to compute elapsed time
  initialStatus: string
  initialProgress: number
  initialProgressMessage: string
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export default function AuditPoller({
  id,
  url,
  createdAt,
  initialStatus,
  initialProgress,
  initialProgressMessage,
}: Props) {
  const [progress, setProgress] = useState(initialProgress)
  const [message, setMessage] = useState(initialProgressMessage || 'Starting…')
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(new Date(createdAt).getTime())
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isTerminal = (s: string) =>
    s === 'complete' || s === 'error' || s === 'redirected'

  // Live elapsed counter — ticks every second (unchanged)
  useEffect(() => {
    const updateElapsed = () => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }
    updateElapsed()
    tickRef.current = setInterval(updateElapsed, 1000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [])

  useAuditPoller<AuditDetail>({
    url: `/api/ada-audit/${id}`,
    intervalMs: 1000,
    initialStatus,
    getStatus: (d) => d.status,
    isTerminal,
    onData: (d) => {
      setProgress(d.progress ?? 0)
      setMessage(d.progressMessage || 'Running…')
    },
    onTerminal: () => { if (tickRef.current) clearInterval(tickRef.current) },
  })

  // Estimated seconds remaining — reliable once progress > 15%
  const estimatedRemaining = useMemo(() => {
    if (progress < 15 || elapsed < 3) return null
    const rate = progress / elapsed          // % per second
    const remaining = (100 - progress) / rate
    return Math.max(1, Math.round(remaining))
  }, [progress, elapsed])

  const displayUrl = url.replace(/^https?:\/\//, '')

  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-orange/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <svg className="w-5 h-5 text-orange animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-[17px] text-navy dark:text-white">Auditing page…</p>
          <p className="text-[12px] font-body text-navy/50 dark:text-white/50 mt-0.5 truncate">{displayUrl}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <span className="font-display font-bold text-[22px] text-orange">{progress}%</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-6 pb-2">
        <div className="w-full bg-gray-100 dark:bg-navy-light rounded-full h-2.5 overflow-hidden">
          <div
            className="bg-orange h-2.5 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${Math.max(3, progress)}%` }}
          />
        </div>
      </div>

      {/* Step message + timer */}
      <div className="px-6 pb-6 pt-2 flex items-center justify-between gap-4">
        <p className="text-[13px] font-body text-navy/60 dark:text-white/60 truncate">{message}</p>
        <div className="flex items-center gap-3 flex-shrink-0 text-[12px] font-body text-navy/40 dark:text-white/40 whitespace-nowrap">
          <span>{formatSeconds(elapsed)} elapsed</span>
          {estimatedRemaining !== null && (
            <>
              <span className="text-navy/20 dark:text-white/20">·</span>
              <span>~{formatSeconds(estimatedRemaining)} remaining</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
