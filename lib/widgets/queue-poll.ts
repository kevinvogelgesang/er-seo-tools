'use client'
// Module-level, ref-counted shared poller for /api/site-audit/queue so that
// multiple homepage widgets share ONE interval + one in-flight fetch (spec
// §9 — don't multiply queue-poll load). Exposed via useSyncExternalStore —
// the React-correct external-store contract (Codex fix 1). An inFlight guard
// drops ticks while a fetch is still pending.
//
// SSE-aware (A5): subscribes to the `queue` invalidate topic for immediate
// refetches, and health-gates the safety-poll cadence via subscribeHealth —
// FAST_MS (5s) while SSE is not confirmed healthy, SAFETY_MS (60s) once it
// is. No visibilitychange listener here — the client manager (lib/events/
// client.ts) owns visibility and forces its own refetch-on-visible.
import { useSyncExternalStore } from 'react'
import type { QueueStatusWithBatch } from '@/lib/ada-audit/types'
import { subscribeTopic, subscribeHealth } from '@/lib/events/client'
import { queueTopic } from '@/lib/events/topics'

const FAST_MS = 5000
const SAFETY_MS = 60_000

type Snapshot = { data: QueueStatusWithBatch | null; error: boolean; loading: boolean }

let current: Snapshot = { data: null, error: false, loading: true }
let timer: ReturnType<typeof setInterval> | null = null
let refCount = 0
let inFlight = false
let healthy = false
let unsubTopic: (() => void) | null = null
let unsubHealth: (() => void) | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

async function tick() {
  if (inFlight) return // don't stack requests on a slow endpoint (Codex fix 1)
  inFlight = true
  try {
    const res = await fetch('/api/site-audit/queue')
    if (!res.ok) throw new Error(`status ${res.status}`)
    const data = (await res.json()) as QueueStatusWithBatch
    current = { data, error: false, loading: false }
  } catch {
    // Keep the last good data; flag error for a degraded badge.
    current = { data: current.data, error: true, loading: false }
  } finally {
    inFlight = false
  }
  emit()
}

function restartTimer() {
  if (timer) { clearInterval(timer); timer = null }
  timer = setInterval(() => void tick(), healthy ? SAFETY_MS : FAST_MS)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  refCount++
  if (refCount === 1) {
    void tick()
    restartTimer()
    unsubTopic = subscribeTopic(queueTopic(), () => void tick())
    unsubHealth = subscribeHealth((h) => {
      healthy = h
      restartTimer()
      if (h) void tick()
    })
  }
  return () => {
    listeners.delete(listener)
    refCount--
    if (refCount === 0) {
      if (timer) { clearInterval(timer); timer = null }
      if (unsubTopic) { unsubTopic(); unsubTopic = null }
      if (unsubHealth) { unsubHealth(); unsubHealth = null }
      healthy = false
    }
  }
}

function getSnapshot(): Snapshot {
  return current
}

export function useQueueStatus(): Snapshot {
  // Server snapshot === client snapshot (same module-level `current`), so no
  // hydration mismatch: both render the stable loading state first.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
