'use client'

import { useEffect, useRef } from 'react'
import type { RecentItem } from '@/lib/ada-audit/recents-query'
import { RECENTS_STATUS_MAX_IDS, type RecentStatusItem } from '@/lib/ada-audit/recents-status-shared'

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
    const timer = setInterval(async () => {
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
    }, intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [inFlightKey, intervalMs])
}
