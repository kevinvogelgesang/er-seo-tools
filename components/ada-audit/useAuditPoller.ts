'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/** Returned by onTerminal to make the hook navigate instead of refresh.
 *  Void → the historical behavior (one router.refresh()). Exactly one of
 *  replace/refresh ever fires per instance (C17 single navigation owner). */
export type TerminalOutcome = { redirect: string } | void

export interface UseAuditPollerArgs<T> {
  /** Endpoint to poll. */
  url: string
  /** Poll cadence in ms (1000 single / 3000 site). */
  intervalMs: number
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
 * on [url, intervalMs, enabled, initialStatus, router].
 *
 * Behavior-preserving (C9-B): no inFlight overlap guard (matches the naive
 * setInterval the two pollers used). Guarantees: stale in-flight work after
 * unmount is ignored; router.refresh() fires exactly once per instance.
 */
export function useAuditPoller<T>({
  url,
  intervalMs,
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
    const timer = setInterval(async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) return
        const data: T = await res.json()
        if (cancelled) return
        onDataRef.current(data)
        if (isTerminalRef.current(getStatusRef.current(data))) {
          clearInterval(timer)
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
    }, intervalMs)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [url, intervalMs, enabled, initialStatus, router])
}
