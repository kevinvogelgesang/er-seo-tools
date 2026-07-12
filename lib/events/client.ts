'use client'
// lib/events/client.ts — one shared EventSource per tab; topic fan-out with tokens.
const WATCHDOG_MS = 45_000

type Handler = () => void | Promise<void>
type Token = { topic: string; handler: Handler }        // distinct per subscribe call

let es: EventSource | null = null
let generation = 0
let watchdog: ReturnType<typeof setTimeout> | null = null
let healthy = false
const tokens = new Set<Token>()                          // NOT Set<Handler> — no collapse
const healthListeners = new Set<(h: boolean) => void>()
let visInstalled = false
let esFactory: (url: string) => EventSource = (url) => new EventSource(url)
let factoryInjected = false

export function __setEventSourceFactory(fn: (url: string) => EventSource) { esFactory = fn; factoryInjected = true }

function setHealth(h: boolean) { if (h !== healthy) { healthy = h; for (const l of healthListeners) l(h) } }
function armWatchdog() { if (watchdog) clearTimeout(watchdog); watchdog = setTimeout(reconnect, WATCHDOG_MS) }
function onFrame() { armWatchdog() }                     // any frame proves liveness
async function runHandler(h: Handler) { try { await h() } catch { /* hook owns its retry */ } }
function refetchAll() { for (const t of tokens) void runHandler(t.handler) }
function fireTopic(topic: string) { for (const t of tokens) if (t.topic === topic) void runHandler(t.handler) }

// Generic guard: only the current generation's handlers may mutate state, and
// they receive the real event args (Codex plan-fix 7 — `() => void` won't type
// the invalidate listener that gets an Event).
function guard<A extends unknown[]>(gen: number, fn: (...a: A) => void) {
  return (...a: A) => { if (gen === generation && es) fn(...a) }
}

function connect() {
  // Lazy support check: no native EventSource AND no injected test factory → SSR /
  // unsupported, so health stays permanently false and hooks keep polling. An
  // explicitly-injected factory (jsdom tests) counts as supported.
  if (typeof EventSource === 'undefined' && !factoryInjected) { setHealth(false); return }
  const gen = ++generation
  const source = esFactory('/api/events')
  es = source
  source.addEventListener('connected', guard(gen, () => { onFrame(); refetchAll(); setHealth(true) }))
  source.addEventListener('heartbeat', guard(gen, onFrame))
  source.addEventListener('invalidate', guard(gen, (e: MessageEvent) => {
    onFrame()
    let topic: string | undefined
    try { topic = JSON.parse(e.data).topic } catch { return }
    if (topic) fireTopic(topic)
  }) as EventListener)
  source.addEventListener('server-restart', guard(gen, reconnect))
  source.onerror = guard(gen, () => { setHealth(false) }) // native retries; watchdog covers silent half-open
  armWatchdog()
}

function reconnect() {
  setHealth(false)
  if (watchdog) { clearTimeout(watchdog); watchdog = null }
  // Bump generation FIRST so late frames from the closing source can't re-arm
  // the watchdog or flip health (Codex plan-fix 7).
  generation++
  if (es) { try { es.close() } catch { /* ignore */ } es = null }
  if (tokens.size > 0) connect()
}

function onVisible() {
  if (document.visibilityState !== 'visible') return
  if (!es) reconnect(); else { armWatchdog(); refetchAll() } // force refetch before trusting stream
}
function ensureVisibility() {
  if (visInstalled || typeof document === 'undefined') return
  document.addEventListener('visibilitychange', onVisible); visInstalled = true
}
function teardownVisibility() {
  if (!visInstalled || typeof document === 'undefined') return
  document.removeEventListener('visibilitychange', onVisible); visInstalled = false
}

export function subscribeTopic(topic: string, onInvalidate: Handler): () => void {
  const token: Token = { topic, handler: onInvalidate }
  tokens.add(token)
  ensureVisibility()
  if (!es) connect()
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    tokens.delete(token)
    if (tokens.size === 0) {
      generation++                                        // invalidate any in-flight source
      if (es) { try { es.close() } catch { /* ignore */ } es = null }
      if (watchdog) { clearTimeout(watchdog); watchdog = null }
      teardownVisibility(); setHealth(false)
    }
  }
}

export function subscribeHealth(cb: (h: boolean) => void): () => void {
  healthListeners.add(cb); cb(healthy)
  return () => { healthListeners.delete(cb) }
}

export function __resetClientForTest() {
  generation++
  if (es) { try { es.close() } catch { /* ignore */ } es = null }
  if (watchdog) { clearTimeout(watchdog); watchdog = null }
  tokens.clear(); healthListeners.clear(); teardownVisibility(); healthy = false
  factoryInjected = false
}
