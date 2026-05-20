'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import QueueMemberRow from './QueueMemberRow'
import type { AuditBatchDetail, QueueStatusWithBatch } from '@/lib/ada-audit/types'

const POLL_MS = 5_000

const STATUS_RANK: Record<string, number> = {
  running: 0,
  'pdfs-running': 1,
  'lighthouse-running': 1,
  queued: 2,
  pending: 2,
  complete: 3,
  error: 4,
  cancelled: 5,
}

export default function QueueActiveView() {
  const [batchId, setBatchId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AuditBatchDetail | null>(null)
  const [closedToast, setClosedToast] = useState<string | null>(null)
  const lastSeenBatchId = useRef<string | null>(null)
  // Refs for cancellation on unmount: setTimeout for the freeze-frame, plus
  // a flag the close-edge fetch checks before setState.
  const closedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (closedTimerRef.current) {
        clearTimeout(closedTimerRef.current)
        closedTimerRef.current = null
      }
    }
  }, [])

  // Poll /api/site-audit/queue — the open batch field is the trigger.
  const tick = useCallback(async () => {
    try {
      const res = await fetch('/api/site-audit/queue')
      if (!res.ok) return
      const status = await res.json() as QueueStatusWithBatch
      const incomingId = status.batch?.id ?? null

      if (lastSeenBatchId.current && !incomingId) {
        // Edge: open → null. Batch just closed.
        if (!isMountedRef.current) return
        setClosedToast(`Batch complete`)
        // Briefly freeze the final state so the operator can see it, then
        // transition to the empty state. Tracked in a ref so unmount cancels.
        if (closedTimerRef.current) clearTimeout(closedTimerRef.current)
        closedTimerRef.current = setTimeout(() => {
          if (!isMountedRef.current) return
          setClosedToast(null)
          setDetail(null)
          closedTimerRef.current = null
        }, 5000)
        // Fetch one last detail (now closed) so the freeze frame is accurate.
        const closedBatchId = lastSeenBatchId.current
        const finalRes = await fetch(`/api/audit-batches/${closedBatchId}`)
        if (finalRes.ok) {
          const finalJson = await finalRes.json() as AuditBatchDetail
          // Re-check mount after the JSON parse — an unmount during the
          // parse would otherwise still call setDetail.
          if (isMountedRef.current) setDetail(finalJson)
        }
        if (isMountedRef.current) setBatchId(null)
      } else if (incomingId) {
        if (isMountedRef.current) setBatchId(incomingId)
      } else {
        if (isMountedRef.current) {
          setBatchId(null)
          setDetail(null)
        }
      }
      lastSeenBatchId.current = incomingId
    } catch { /* silent — polling is best-effort */ }
  }, [])

  useEffect(() => { void tick() }, [tick])
  useEffect(() => {
    const id = setInterval(() => void tick(), POLL_MS)
    return () => clearInterval(id)
  }, [tick])

  // Fetch batch detail whenever the open batch id is set
  useEffect(() => {
    if (!batchId) return
    let cancelled = false
    const fetchDetail = async () => {
      try {
        const res = await fetch(`/api/audit-batches/${batchId}`)
        if (!res.ok) return
        const json = await res.json() as AuditBatchDetail
        if (!cancelled) setDetail(json)
      } catch { /* ignore */ }
    }
    void fetchDetail()
    const id = setInterval(fetchDetail, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [batchId])

  if (!batchId && !detail) {
    return (
      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl p-6 text-center font-body text-[13px] text-navy/60 dark:text-white/60">
        No audits in flight. Queue some from <a href="/ada-audit" className="text-orange hover:underline">/ada-audit</a>.
      </div>
    )
  }

  const sortedMembers = (detail?.members ?? []).slice().sort((a, b) => {
    const ra = STATUS_RANK[a.status] ?? 99
    const rb = STATUS_RANK[b.status] ?? 99
    if (ra !== rb) return ra - rb
    return a.createdAt.localeCompare(b.createdAt)
  })

  const counts = (detail?.members ?? []).reduce(
    (acc, m) => {
      if (m.status === 'queued' || m.status === 'pending') acc.queued++
      else if (m.status === 'running' || m.status === 'pdfs-running' || m.status === 'lighthouse-running') acc.running++
      else if (m.status === 'complete') acc.complete++
      else if (m.status === 'error') acc.errored++
      else if (m.status === 'cancelled') acc.cancelled++
      return acc
    },
    { queued: 0, running: 0, complete: 0, errored: 0, cancelled: 0 },
  )

  return (
    <div className="space-y-3">
      {closedToast && (
        <div className="bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 text-[12px] font-body px-4 py-2 rounded-md">
          {closedToast}
        </div>
      )}
      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
          <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">
            {detail?.label ?? 'Current batch'}
          </h2>
          <p className="text-[12px] font-body text-navy/50 dark:text-white/50 mt-1">
            {counts.queued} queued · {counts.running} running · {counts.complete} complete · {counts.errored} errored
            {counts.cancelled > 0 ? ` · ${counts.cancelled} cancelled` : ''}
          </p>
        </div>
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-navy-deep">
            <tr className="border-b border-gray-100 dark:border-navy-border">
              <th className="text-left px-6 py-2 text-[11px] uppercase tracking-wider font-body font-semibold text-navy/50 dark:text-white/50">Domain</th>
              <th className="text-left px-6 py-2 text-[11px] uppercase tracking-wider font-body font-semibold text-navy/50 dark:text-white/50">Client</th>
              <th className="text-left px-6 py-2 text-[11px] uppercase tracking-wider font-body font-semibold text-navy/50 dark:text-white/50">Status</th>
              <th className="text-left px-6 py-2 text-[11px] uppercase tracking-wider font-body font-semibold text-navy/50 dark:text-white/50">Pages</th>
              <th className="text-left px-6 py-2 text-[11px] uppercase tracking-wider font-body font-semibold text-navy/50 dark:text-white/50">Score</th>
              <th className="text-right px-6 py-2 text-[11px] uppercase tracking-wider font-body font-semibold text-navy/50 dark:text-white/50">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedMembers.map((m) => (
              <QueueMemberRow key={m.id} member={m} onCancelled={() => void tick()} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
