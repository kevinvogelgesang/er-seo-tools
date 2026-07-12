// lib/events/bus.ts — process-global SSE invalidation bus (single fork process).
import { HEARTBEAT_MS } from '@/lib/jobs/config'

export type Subscriber = { write(frame: string): void; close(): void }

const MAX_CONNECTIONS = 100
const MAX_PENDING_TOPICS = 256
const COALESCE_MS = 150

export class BusFullError extends Error { constructor() { super('bus_full'); this.name = 'BusFullError' } }

type BusState = {
  subscribers: Set<Subscriber>
  pending: Set<string>
  coalesceTimer: ReturnType<typeof setTimeout> | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
}
const g = globalThis as unknown as { __erSseBus?: BusState }
const state: BusState = (g.__erSseBus ??= { subscribers: new Set(), pending: new Set(), coalesceTimer: null, heartbeatTimer: null })

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function writeToAll(f: string): void {
  for (const sub of state.subscribers) {
    try { sub.write(f) } catch { safeDrop(sub) }
  }
}

function safeDrop(sub: Subscriber): void {
  state.subscribers.delete(sub)
  try { sub.close() } catch { /* ignore */ }
}

function startHeartbeat(): void {
  if (state.heartbeatTimer) return
  state.heartbeatTimer = setInterval(() => {
    if (state.subscribers.size === 0) { stopHeartbeat(); return }
    writeToAll(frame('heartbeat', {}))
  }, HEARTBEAT_MS)
}
function stopHeartbeat(): void {
  if (state.heartbeatTimer) { clearInterval(state.heartbeatTimer); state.heartbeatTimer = null }
}

function flush(): void {
  state.coalesceTimer = null
  const topics = [...state.pending]; state.pending.clear()
  for (const topic of topics) writeToAll(frame('invalidate', { topic }))
}

export function publishInvalidation(topic: string): void {
  try {
    if (state.pending.size >= MAX_PENDING_TOPICS) return // safety poll still covers it
    state.pending.add(topic)
    if (!state.coalesceTimer) state.coalesceTimer = setTimeout(flush, COALESCE_MS)
  } catch { /* never surface into a write seam */ }
}

export function subscribeBus(sub: Subscriber): () => void {
  if (state.subscribers.size >= MAX_CONNECTIONS) throw new BusFullError()
  state.subscribers.add(sub)
  startHeartbeat()
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    state.subscribers.delete(sub)
    if (state.subscribers.size === 0) stopHeartbeat()
  }
}

export function getBusStats() { return { subscribers: state.subscribers.size, pendingTopics: state.pending.size } }

export function shutdownBus(): void {
  try { writeToAll(frame('server-restart', {})) } catch { /* ignore */ }
  for (const sub of [...state.subscribers]) safeDrop(sub)
  if (state.coalesceTimer) { clearTimeout(state.coalesceTimer); state.coalesceTimer = null }
  state.pending.clear()
  stopHeartbeat()
}

export function __resetBusForTest(): void {
  shutdownBus()
  state.subscribers.clear()
}
