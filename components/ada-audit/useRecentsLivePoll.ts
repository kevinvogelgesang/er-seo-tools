'use client'

import { useEffect, useRef } from 'react'
import type { RecentItem } from '@/lib/ada-audit/recents-query'
import { RECENTS_STATUS_MAX_IDS, type RecentStatusItem } from '@/lib/ada-audit/recents-status-shared'
import { subscribeTopic, subscribeHealth } from '@/lib/events/client'
import { recentsTopic } from '@/lib/events/topics'

const SAFETY_INTERVAL_MS = 60_000

export interface UseRecentsLivePollArgs {
  items: RecentItem[]
  intervalMs?: number
  onUpdate: (updates: RecentStatusItem[]) => void
  onSettled: () => void
}

/**
 * C17 live in-flight rows for the unified recents table. Polls the COMPACT
 * status endpoint for the visible in-flight ids only (spec Codex fix #9 — the
 * merged 5-source history query is expensive and is re-run only via
 * onSettled). No in-flight rows → no timer. The polled key set is deduped,
 * sorted, and capped at the endpoint's max (plan Codex fix #3), and each
 * settled key notifies exactly once per effect run (plan Codex fix #4).
 *
 * SSE-aware (A5 PR2): subscribes to the `recents` invalidate topic (lib/
 * events/client.ts) for immediate refetches, and health-gates the interval
 * cadence the same way lib/widgets/queue-poll.ts and useAuditPoller.ts do —
 * `intervalMs` (8s fast) while SSE is absent/unhealthy, demoting to
 * `SAFETY_INTERVAL_MS` (60s) once healthy, re-arming fast on any health drop.
 * The invalidate/health handlers reuse the SAME `notified` set as the timer
 * loop, so a settled key notifies exactly once no matter which path (timer
 * tick or SSE-triggered refetch) observes the transition first.
 */
export function useRecentsLivePoll({
  items,
  intervalMs = 8000,
  onUpdate,
  onSettled,
}: UseRecentsLivePollArgs): void {
  const onUpdateRef = useRef(onUpdate)
  const onSettledRef = useRef(onSettled)
  onUpdateRef.current = onUpdate
  onSettledRef.current = onSettled

  const inFlightKey = Array.from(
    new Set(items.filter((i) => i.inFlight).map((i) => `${i.type}:${i.id}`)),
  )
    .sort()
    .slice(0, RECENTS_STATUS_MAX_IDS)
    .join(',')

  useEffect(() => {
    if (!inFlightKey) return
    const polled = inFlightKey.split(',')
    const notified = new Set<string>()
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const poll = async () => {
      try {
        const res = await fetch(`/api/ada-audit/recents/status?ids=${encodeURIComponent(inFlightKey)}`)
        if (!res.ok) return
        const json = (await res.json()) as { items: RecentStatusItem[] }
        if (cancelled) return
        onUpdateRef.current(json.items)
        const stillInFlight = new Set(json.items.filter((i) => i.inFlight).map((i) => `${i.type}:${i.id}`))
        // Settled = left in-flight state OR missing (row deleted).
        const settledNow = polled.filter((key) => !stillInFlight.has(key) && !notified.has(key))
        if (settledNow.length) {
          settledNow.forEach((key) => notified.add(key))
          onSettledRef.current()
        }
      } catch {
        // network blip — keep polling
      }
    }

    const restartTimer = (healthy: boolean) => {
      if (timer) clearInterval(timer)
      const cadence = healthy ? SAFETY_INTERVAL_MS : intervalMs
      timer = setInterval(() => void poll(), cadence)
    }

    restartTimer(false)

    const unsubTopic = subscribeTopic(recentsTopic(), () => {
      if (cancelled) return
      void poll()
    })
    const unsubHealth = subscribeHealth((h) => {
      if (cancelled) return
      restartTimer(h)
      if (h) void poll()
    })

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      unsubTopic()
      unsubHealth()
    }
  }, [inFlightKey, intervalMs])
}
