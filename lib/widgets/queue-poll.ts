'use client'
// Module-level, ref-counted shared poller for /api/site-audit/queue so that
// multiple homepage widgets share ONE 5s interval + one in-flight fetch
// (spec §9 — don't multiply queue-poll load). Cadence matches AuditIndexTabs.
// Exposed via useSyncExternalStore — the React-correct external-store contract
// (Codex fix 1). An inFlight guard drops ticks while a fetch is still pending.
import { useSyncExternalStore } from 'react'
import type { QueueStatusWithBatch } from '@/lib/ada-audit/types'

const POLL_MS = 5000

type Snapshot = { data: QueueStatusWithBatch | null; error: boolean; loading: boolean }

let current: Snapshot = { data: null, error: false, loading: true }
let timer: ReturnType<typeof setInterval> | null = null
let refCount = 0
let inFlight = false
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

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  refCount++
  if (refCount === 1 && !timer) {
    void tick()
    timer = setInterval(() => void tick(), POLL_MS)
  }
  return () => {
    listeners.delete(listener)
    refCount--
    if (refCount === 0 && timer) { clearInterval(timer); timer = null }
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
