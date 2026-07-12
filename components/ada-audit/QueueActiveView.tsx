'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import QueueMemberRow from './QueueMemberRow'
import type { AuditBatchDetail } from '@/lib/ada-audit/types'
import { useQueueStatus } from '@/lib/widgets/queue-poll'
import { subscribeTopic, subscribeHealth } from '@/lib/events/client'
import { auditBatchTopic } from '@/lib/events/topics'

// A5 Task 21: "which batch is open" no longer runs its own inline poll of
// /api/site-audit/queue — it reads the shared queue store (lib/widgets/
// queue-poll.ts), which is already SSE-aware (queue topic + health). The
// batch-DETAIL fetch keeps its original 5s cadence whenever SSE is absent/
// unhealthy, demoting to a 60s safety cadence once healthy (re-arming fast on
// a health drop), plus an immediate refetch on `audit-batch:<id>` invalidate
// — same idiom as the report/prospect/content-audit migrations.
const FAST_MS = 5_000
const SAFETY_MS = 60_000

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
  const { data: queueData } = useQueueStatus()
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

  const fetchDetail = useCallback(async (id: string): Promise<AuditBatchDetail | null> => {
    try {
      const res = await fetch(`/api/audit-batches/${id}`)
      if (!res.ok) return null
      return await res.json() as AuditBatchDetail
    } catch {
      return null
    }
  }, [])

  // The shared queue store (SSE-aware) is the trigger for "which batch is
  // open" — no inline polling of /api/site-audit/queue here anymore.
  useEffect(() => {
    const incomingId = queueData?.batch?.id ?? null

    if (lastSeenBatchId.current && !incomingId) {
      // Edge: open → null. Batch just closed.
      const closedBatchId = lastSeenBatchId.current
      setClosedToast('Batch complete')
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
      void fetchDetail(closedBatchId).then((json) => {
        if (json && isMountedRef.current) setDetail(json)
      })
      setBatchId(null)
    } else if (incomingId) {
      setBatchId(incomingId)
    } else {
      setBatchId(null)
      setDetail(null)
    }
    lastSeenBatchId.current = incomingId
  }, [queueData, fetchDetail])

  // Batch detail: SSE-aware poll, bounded to while a batch is open. Original
  // 5s cadence while SSE is absent/unhealthy, demoting to the 60s safety
  // cadence once healthy; re-arms fast on a health drop; immediate refetch
  // on `audit-batch:<id>` invalidate.
  useEffect(() => {
    if (!batchId) return
    let cancelled = false
    const doFetch = async () => {
      const json = await fetchDetail(batchId)
      if (json && !cancelled) setDetail(json)
    }
    void doFetch()
    let timer: ReturnType<typeof setInterval> | null = null
    const restartTimer = (healthy: boolean) => {
      if (timer) clearInterval(timer)
      timer = setInterval(() => void doFetch(), healthy ? SAFETY_MS : FAST_MS)
    }
    restartTimer(false)
    const unsubTopic = subscribeTopic(auditBatchTopic(batchId), () => void doFetch())
    const unsubHealth = subscribeHealth((h) => {
      restartTimer(h)
      if (h) void doFetch()
    })
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      unsubTopic()
      unsubHealth()
    }
  }, [batchId, fetchDetail])

  // Manual refresh after a cancel action — the detail table should not wait
  // for the next scheduled poll to reflect a just-cancelled member.
  const handleCancelled = useCallback(() => {
    if (!batchId) return
    void fetchDetail(batchId).then((json) => {
      if (json) setDetail(json)
    })
  }, [batchId, fetchDetail])

  if (!batchId && !detail) {
    return (
      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl p-6 text-center font-body text-[13px] text-navy/60 dark:text-white/60">
        No audits in flight. Queue some from <Link href="/ada-audit" className="text-orange hover:underline">/ada-audit</Link>.
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
              <QueueMemberRow key={m.id} member={m} onCancelled={handleCancelled} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
