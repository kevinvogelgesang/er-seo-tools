'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { subscribeTopic, subscribeHealth } from '@/lib/events/client'

/** Returned by onTerminal to make the hook navigate instead of refresh.
 *  Void → the historical behavior (one router.refresh()). Exactly one of
 *  replace/refresh ever fires per instance (C17 single navigation owner). */
export type TerminalOutcome = { redirect: string } | void

export interface UseAuditPollerArgs<T> {
  /** Endpoint to poll. */
  url: string
  /** Poll cadence in ms (1000 single / 3000 site). Used as-is whenever SSE is
   *  absent or not yet confirmed healthy — never slower than pre-A5. */
  intervalMs: number
  /** SSE topic for this audit (`adaAuditTopic(id)` / `siteAuditTopic(id)`,
   *  from `lib/events/topics.ts`). Omit to keep the hook exactly as it was
   *  pre-A5 (fixed `intervalMs` cadence, no subscription). */
  topic?: string
  /** Cadence to demote to ONCE SSE is confirmed healthy (single audit 30_000,
   *  site audit 60_000). Ignored unless `topic` is also supplied. */
  safetyIntervalMs?: number
  /** SSR status; if already terminal the hook is inert (no fetch, no refresh). */
  initialStatus: string
  /** Defaults true; false → hook is inert. */
  enabled?: boolean
  getStatus: (data: T) => string
  isTerminal: (status: string) => boolean
  onData: (data: T) => void
  /** Called once, on the terminal poll. Return { redirect } to router.replace()
   *  there INSTEAD of the default router.refresh(). */
  onTerminal?: (data: T) => TerminalOutcome
}

/**
 * Generic interval-poll loop for audit progress. Callback-only: it drives the
 * loop and does not own poller-specific UI state. Callbacks are stored in refs
 * so inline caller closures don't restart the interval; the effect depends only
 * on [url, intervalMs, topic, safetyIntervalMs, enabled, initialStatus, router].
 *
 * Behavior-preserving (C9-B): no inFlight overlap guard (matches the naive
 * setInterval the two pollers used). Guarantees: stale in-flight work after
 * unmount is ignored; router.refresh() fires exactly once per instance.
 *
 * SSE-aware (A5 PR2): when `topic` is supplied, subscribes via the shared
 * client (lib/events/client.ts) for immediate invalidate-triggered refetches,
 * and health-gates the interval cadence the same way lib/widgets/queue-poll.ts
 * does — `intervalMs` (fast) while SSE is absent/unhealthy, demoting to
 * `safetyIntervalMs` once healthy, re-arming fast on any health drop
 * (transport error/watchdog). Both the invalidate handler and the health
 * handler are guarded by `refreshedRef` so a late/stale SSE frame can never
 * re-poll or restart the timer after the terminal poll has already fired.
 */
export function useAuditPoller<T>({
  url,
  intervalMs,
  topic,
  safetyIntervalMs,
  initialStatus,
  enabled = true,
  getStatus,
  isTerminal,
  onData,
  onTerminal,
}: UseAuditPollerArgs<T>): void {
  const router = useRouter()

  const getStatusRef = useRef(getStatus)
  const isTerminalRef = useRef(isTerminal)
  const onDataRef = useRef(onData)
  const onTerminalRef = useRef(onTerminal)
  getStatusRef.current = getStatus
  isTerminalRef.current = isTerminal
  onDataRef.current = onData
  onTerminalRef.current = onTerminal

  const refreshedRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    if (isTerminalRef.current(initialStatus)) return

    // A new polling run (new url/interval, or a remount) starts un-refreshed.
    // Old effect work is neutralized by its own `cancelled` guard, so this
    // never lets a stale run double-refresh.
    refreshedRef.current = false
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const poll = async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) return
        const data: T = await res.json()
        if (cancelled) return
        onDataRef.current(data)
        if (isTerminalRef.current(getStatusRef.current(data))) {
          if (timer) clearInterval(timer)
          if (!refreshedRef.current) {
            refreshedRef.current = true
            const outcome = onTerminalRef.current?.(data)
            if (outcome && typeof outcome === 'object' && 'redirect' in outcome) {
              router.replace(outcome.redirect)
            } else {
              router.refresh()
            }
          }
        }
      } catch {
        // network blip — keep polling
      }
    }

    const restartTimer = (healthy: boolean) => {
      if (timer) clearInterval(timer)
      const cadence = healthy && safetyIntervalMs ? safetyIntervalMs : intervalMs
      timer = setInterval(() => void poll(), cadence)
    }

    restartTimer(false)

    let unsubTopic: (() => void) | null = null
    let unsubHealth: (() => void) | null = null
    if (topic) {
      unsubTopic = subscribeTopic(topic, () => {
        if (cancelled || refreshedRef.current) return
        void poll()
      })
      unsubHealth = subscribeHealth((h) => {
        if (cancelled || refreshedRef.current) return
        restartTimer(h)
        if (h) void poll()
      })
    }

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      unsubTopic?.()
      unsubHealth?.()
    }
  }, [url, intervalMs, topic, safetyIntervalMs, enabled, initialStatus, router])
}
