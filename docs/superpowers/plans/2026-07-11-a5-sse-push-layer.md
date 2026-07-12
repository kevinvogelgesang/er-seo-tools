# A5 — SSE Push Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace aggressive 1–8 s client polling with server-pushed *invalidation* broadcasts (SSE), keeping the DB as the single source of truth and a coarse safety poll as the correctness backstop.

**Architecture:** One process-global in-memory bus (`lib/events/bus.ts`) receives post-commit `publishInvalidation(topic)` calls from write seams and broadcasts `{topic}` frames to all connected SSE subscribers on a single cookie-gated `/api/events` stream. One shared `EventSource` per browser tab (`lib/events/client.ts`) fans events out to topic-subscribed hooks, which refetch from the DB; a per-hook coarse safety poll guarantees eventual consistency if any event is dropped or the stream is buffered. SSE never carries state.

**Tech Stack:** Next.js 15 App Router (nodejs runtime, `ReadableStream`), TypeScript, Prisma/SQLite, Vitest (per-worker DBs, parallel), existing `withRoute` kit, `useSyncExternalStore`.

**Spec:** `docs/superpowers/specs/2026-07-11-a5-sse-push-layer-design.md` (Codex/Sol accept-with-10-fixes; all applied).

## Global Constraints

- **SSE is invalidation-only** — a frame means "refetch topic X from the DB now." Correctness NEVER depends on delivery. Every subscribed hook keeps a coarse safety poll (60 s ordinary; 15–30 s active memo flows).
- **Array-form `$transaction([...])` only** — never interactive. `publishInvalidation` is called AFTER the awaited mutation/tx resolves (outside the tx), gated on the write taking effect (`count === 1`). Emit can NEVER fail the write (synchronous, never throws).
- **No `Class.name`/identifier-name runtime deps** — topic strings are literals via `lib/events/topics.ts`.
- **URLs use `NEXT_PUBLIC_APP_URL`**, never request origin. (`EventSource('/api/events')` is same-origin relative — fine.)
- **New/gated route** needs a `middleware.test.ts` case. `/api/events` is cookie-gated (matcher already covers `/api/:path*`); NOT in `isPublicPath`.
- **Gates before every merge:** `npm run lint` (tsc) + `npm test` (vitest) + `npm run build`, all green. PRs touching auth/SF-upload/ADA-pipeline also run `npm run smoke`.
- **Bound constants:** `MAX_CONNECTIONS=100`, `MAX_PENDING_TOPICS=256`, `MAX_CONSECUTIVE_DROPS=20`, `COALESCE_MS=150`, `HEARTBEAT_MS=15_000` (reuse `lib/jobs/config.ts`), `CONNECTION_LIFETIME_MS=30*60_000`, `WATCHDOG_MS=45_000`, `SAFETY_POLL_MS=60_000` (memo `SAFETY_POLL_MEMO_MS=20_000`).
- **Node test env:** DB-backed tests self-provision per-worker SQLite (A7 PR2). Component tests: `// @vitest-environment jsdom` + `afterEach(cleanup)`, no jest-dom.
- **Commit messages via Bash:** no backticks in `-m` strings. End with the repo's Co-Authored-By + Claude-Session trailers.

---

## File Structure

**PR1 — infra + queue canary (the prod-verify gate):**
- Create `lib/events/topics.ts` — literal topic builders (`queueTopic()`, `siteAuditTopic(id)`, …).
- Create `lib/events/bus.ts` — process-global bus: `publishInvalidation`, `subscribe`/`unsubscribe`, heartbeat timer, backpressure, `shutdownBus`, `getBusStats`.
- Create `app/api/events/route.ts` — cookie-gated SSE stream (`withRoute`, nodejs, MAX_CONNECTIONS reject, finite lifetime).
- Create `lib/events/client.ts` — shared per-tab `EventSource` manager: `subscribeTopic`, watchdog, generation-token reconnect, visibility.
- Create `middleware.test.ts` case (append) — 401 on `/api/events` without cookie.
- Modify `instrumentation.ts` — `shutdownBus()` in `shutdown()` before `closeBrowser()`.
- Modify `lib/jobs/handlers/site-audit-page.ts` — emit `queue`/`site-audit:<id>`/`recents` after the settle tx flips.
- Modify `lib/ada-audit/queue-manager.ts` — emit `queue` at `enqueueAudit` + `failSiteAudit`.
- Modify `lib/ada-audit/site-audit-finalizer.ts` — emit `queue`/`site-audit:<id>` on transition (readiness-gated for seoOnly).
- Modify `lib/widgets/queue-poll.ts` — SSE-aware: subscribe `queue`, drop fast interval to safety cadence.
- Modify `components/ada-audit/AuditIndexTabs.tsx` — replace inline queue poll with `useQueueStatus()`.

**PR2 — audit progress:** Modify `lib/jobs/worker.ts` (groupKey→topic emit, heartbeat delta, chained-flush guard), `lib/jobs/types.ts` (`ClaimedJob.groupKey`), `lib/jobs/handlers/ada-audit.ts`, the broken-link-verify builder, `components/ada-audit/useAuditPoller.ts`, `useRecentsLivePoll.ts`, and their consumers.

**PR3 — reports/prospects/content-audit/batch/client-summary:** Modify the `seo-report-render`/`report-render` handlers + report routes, prospect settle, content-audit ingest route, `ClientsAuditSummary.tsx`, `QueueActiveView.tsx`, `SiteAuditExportBar.tsx`, `ContentAuditCard.tsx`, `GenerateReportForm.tsx`, `ReportLibrary.tsx`, `ProspectDashboard.tsx`.

**PR4 — memos:** Modify `lib/memo-poller-machine.ts` + the 4 memo cards + `PillarAnalysisButtonClient.tsx`, emit at memo/pillar-analysis write-backs.

---

# PR1 — Infrastructure + queue canary

## Task 1: Topic builders

**Files:**
- Create: `lib/events/topics.ts`
- Test: `lib/events/topics.test.ts`

**Interfaces:**
- Produces: `queueTopic(): string`, `recentsTopic(): string`, `clientSummaryTopic(): string`, `siteAuditTopic(id: string|number): string`, `adaAuditTopic(id: string|number): string`, `reportTopic(id): string`, `reportListTopic(): string`, `prospectListTopic(): string`, `contentAuditTopic(id): string`, `memoTopic(sessionId): string`, `pillarAnalysisTopic(sessionId): string`, `auditBatchTopic(id): string`.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest'
import { queueTopic, siteAuditTopic, adaAuditTopic } from './topics'

describe('topics', () => {
  it('are stable literal strings not derived from identifier names', () => {
    expect(queueTopic()).toBe('queue')
    expect(siteAuditTopic(42)).toBe('site-audit:42')
    expect(adaAuditTopic('7')).toBe('ada-audit:7')
  })
})
```

- [ ] **Step 2: Run test, verify it fails**
Run: `npx vitest run lib/events/topics.test.ts`
Expected: FAIL — cannot find module `./topics`.

- [ ] **Step 3: Implement**
```ts
// lib/events/topics.ts — literal topic strings (no Class.name/minification risk)
export const queueTopic = () => 'queue'
export const recentsTopic = () => 'recents'
export const clientSummaryTopic = () => 'client-audit-summary'
export const reportListTopic = () => 'report-list'
export const prospectListTopic = () => 'prospect-list'
export const siteAuditTopic = (id: string | number) => `site-audit:${id}`
export const adaAuditTopic = (id: string | number) => `ada-audit:${id}`
export const reportTopic = (id: string | number) => `report:${id}`
export const contentAuditTopic = (id: string | number) => `content-audit:${id}`
export const memoTopic = (sessionId: string | number) => `memo:${sessionId}`
export const pillarAnalysisTopic = (sessionId: string | number) => `pillar-analysis:${sessionId}`
export const auditBatchTopic = (id: string | number) => `audit-batch:${id}`
```

- [ ] **Step 4: Run test, verify it passes**
Run: `npx vitest run lib/events/topics.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/events/topics.ts lib/events/topics.test.ts
git commit -m "feat(a5): SSE topic string builders"  # + trailers
```

## Task 2: The bus core (subscribe/publish/coalesce, no backpressure yet)

**Files:**
- Create: `lib/events/bus.ts`
- Test: `lib/events/bus.test.ts`

**Interfaces:**
- Consumes: `queueTopic`, `siteAuditTopic` (Task 1).
- Produces:
  - `type Subscriber = { write(frame: string): void; close(): void }`
  - `subscribeBus(sub: Subscriber): () => void` — returns idempotent disposer; enforces `MAX_CONNECTIONS`, throws `BusFullError` when over cap.
  - `publishInvalidation(topic: string): void` — synchronous, never throws; coalesces.
  - `getBusStats(): { subscribers: number; pendingTopics: number }`
  - `__resetBusForTest(): void`
  - `class BusFullError extends Error`

- [ ] **Step 1: Write the failing test**
```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { subscribeBus, publishInvalidation, getBusStats, __resetBusForTest, BusFullError } from './bus'

const mkSub = () => { const frames: string[] = []; return { frames, sub: { write: (f: string) => frames.push(f), close: () => {} } } }

describe('bus', () => {
  beforeEach(() => { __resetBusForTest(); vi.useFakeTimers() })

  it('broadcasts a coalesced invalidate frame to all subscribers', async () => {
    const a = mkSub(); const b = mkSub()
    subscribeBus(a.sub); subscribeBus(b.sub)
    publishInvalidation('queue'); publishInvalidation('queue') // coalesced
    await vi.advanceTimersByTimeAsync(200)
    expect(a.frames.join('')).toContain('event: invalidate')
    expect(a.frames.join('')).toContain('data: {"topic":"queue"}')
    expect(a.frames.filter(f => f.includes('"topic":"queue"')).length).toBe(1)
    expect(b.frames.length).toBe(a.frames.length)
  })

  it('publishInvalidation never throws even if a subscriber write throws', () => {
    subscribeBus({ write: () => { throw new Error('boom') }, close: () => {} })
    expect(() => { publishInvalidation('queue'); vi.advanceTimersByTime(200) }).not.toThrow()
  })

  it('enforces MAX_CONNECTIONS', () => {
    for (let i = 0; i < 100; i++) subscribeBus(mkSub().sub)
    expect(() => subscribeBus(mkSub().sub)).toThrow(BusFullError)
  })

  it('disposer is idempotent and returns subscriber count to zero', () => {
    const d = subscribeBus(mkSub().sub)
    expect(getBusStats().subscribers).toBe(1)
    d(); d()
    expect(getBusStats().subscribers).toBe(0)
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run lib/events/bus.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**
```ts
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
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run lib/events/bus.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/events/bus.ts lib/events/bus.test.ts
git commit -m "feat(a5): process-global SSE invalidation bus"  # + trailers
```

## Task 3: Backpressure on the Subscriber

**Files:**
- Modify: `lib/events/bus.ts` (extend `Subscriber` + `writeToAll`)
- Test: `lib/events/bus.test.ts` (append)

**Interfaces:**
- Produces: `Subscriber` gains optional `desiredSize?: () => number | null`. A subscriber whose `desiredSize()` is `<= 0` on write gets the frame **dropped** (not buffered); after `MAX_CONSECUTIVE_DROPS` consecutive drops it is closed + removed.

- [ ] **Step 1: Write the failing test**
```ts
it('drops frames under backpressure and evicts a persistently slow subscriber', async () => {
  __resetBusForTest(); vi.useFakeTimers()
  const frames: string[] = []
  let slow = true
  const closed = { v: false }
  subscribeBus({ write: (f) => frames.push(f), close: () => { closed.v = true }, desiredSize: () => (slow ? 0 : 10) })
  for (let i = 0; i < 21; i++) { publishInvalidation('t' + i); await vi.advanceTimersByTimeAsync(200) }
  expect(frames.length).toBe(0)     // all dropped
  expect(closed.v).toBe(true)       // evicted after MAX_CONSECUTIVE_DROPS
  expect(getBusStats().subscribers).toBe(0)
})
```

- [ ] **Step 2: Run, verify fail** — new assertion fails (frames written, not dropped).

- [ ] **Step 3: Implement** — add a per-subscriber drop counter map and gate writes:
```ts
// add near state:
const drops = new WeakMap<Subscriber, number>()
const MAX_CONSECUTIVE_DROPS = 20
// replace writeToAll:
function writeToAll(f: string): void {
  for (const sub of [...state.subscribers]) {
    const ds = sub.desiredSize?.()
    if (ds != null && ds <= 0) {
      const n = (drops.get(sub) ?? 0) + 1
      if (n >= MAX_CONSECUTIVE_DROPS) safeDrop(sub); else drops.set(sub, n)
      continue
    }
    drops.set(sub, 0)
    try { sub.write(f) } catch { safeDrop(sub) }
  }
}
```
(Update the `Subscriber` type: `desiredSize?: () => number | null`.)

- [ ] **Step 4: Run, verify pass** — full `bus.test.ts` PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/events/bus.ts lib/events/bus.test.ts
git commit -m "feat(a5): bus backpressure via desiredSize with slow-subscriber eviction"  # + trailers
```

## Task 4: The `/api/events` SSE route

**Files:**
- Create: `app/api/events/route.ts`
- Test: `app/api/events/route.test.ts`

**Interfaces:**
- Consumes: `subscribeBus`, `getBusStats`, `BusFullError` (Tasks 2–3).
- Produces: `GET` handler returning a `text/event-stream` `Response`; 503 when over `MAX_CONNECTIONS`.

- [ ] **Step 1: Write the failing test**
```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { GET } from './route'
import { getBusStats, __resetBusForTest } from '@/lib/events/bus'

const req = () => new Request('http://localhost/api/events', { headers: {} })

describe('GET /api/events', () => {
  beforeEach(() => __resetBusForTest())

  it('returns an event-stream with no-transform caching and X-Accel-Buffering off', async () => {
    const res = await GET(req())
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('cache-control')).toContain('no-transform')
    expect(res.headers.get('x-accel-buffering')).toBe('no')
  })

  it('registers a subscriber and sends connected + retry first', async () => {
    const res = await GET(req())
    const reader = res.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('retry: 5000')
    expect(first).toContain('event: connected')
    expect(getBusStats().subscribers).toBe(1)
    await reader.cancel()
  })
})
```

- [ ] **Step 2: Run, verify fail** — module missing.

- [ ] **Step 3: Implement**
```ts
// app/api/events/route.ts
import { withRoute } from '@/lib/api/with-route'
import { subscribeBus, BusFullError, type Subscriber } from '@/lib/events/bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const CONNECTION_LIFETIME_MS = 30 * 60_000

export const GET = withRoute(async (request: Request): Promise<Response> => {
  const encoder = new TextEncoder()
  let dispose: (() => void) | null = null
  let lifetime: ReturnType<typeof setTimeout> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sub: Subscriber = {
        write: (f) => controller.enqueue(encoder.encode(f)),
        close: () => { try { controller.close() } catch { /* already closed */ } },
        desiredSize: () => controller.desiredSize,
      }
      try {
        dispose = subscribeBus(sub)
      } catch (e) {
        if (e instanceof BusFullError) { controller.close(); return }
        throw e
      }
      controller.enqueue(encoder.encode('retry: 5000\nevent: connected\ndata: {}\n\n'))
      lifetime = setTimeout(() => cleanup(), CONNECTION_LIFETIME_MS)
      request.signal.addEventListener('abort', cleanup)
    },
    cancel() { cleanup() },
  })

  function cleanup() {
    if (lifetime) { clearTimeout(lifetime); lifetime = null }
    if (dispose) { dispose(); dispose = null }
  }

  // Over-cap: BusFullError path closed the stream synchronously in start(); a
  // closed body still returns 200 with an immediate end, which the client treats
  // as a failed connect → falls back to polling. (Acceptable; see spec §3.2.)
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
})
```
> Note: `withRoute` returns the streaming `Response` untouched; it only catches synchronous setup throws before the stream is returned. `cleanup` is idempotent (guards on the nulled refs) so abort + cancel double-fire is a no-op — satisfies the spec's "both `abort` and `cancel`" requirement.

- [ ] **Step 4: Run, verify pass** — `npx vitest run app/api/events/route.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add app/api/events/route.ts app/api/events/route.test.ts
git commit -m "feat(a5): cookie-gated /api/events SSE route"  # + trailers
```

## Task 5: Middleware 401 coverage for `/api/events`

**Files:**
- Modify: `middleware.test.ts` (append a case)

- [ ] **Step 1: Write the failing test** — add, matching the file's existing helper style:
```ts
it('gates /api/events behind auth (401 without cookie)', async () => {
  const res = await runMiddleware('/api/events') // no auth cookie — use the file's existing harness
  expect(res.status).toBe(401)
})
```
(Use the same request-construction helper the other `middleware.test.ts` cases use; do NOT add `/api/events` to `isPublicPath`.)

- [ ] **Step 2: Run, verify fail or pass** — Run `npx vitest run middleware.test.ts`. If it already passes (matcher covers `/api/:path*` and the route isn't public), that CONFIRMS the gate; keep the test as a regression guard. If it fails, the matcher does not cover the path — STOP and reconcile with the spec (§3.2 assumes coverage).

- [ ] **Step 3: (only if needed)** No code change expected — the assertion documents the existing gate.

- [ ] **Step 4: Run, verify pass** — `npx vitest run middleware.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add middleware.test.ts
git commit -m "test(a5): assert /api/events requires auth"  # + trailers
```

## Task 6: Wire `shutdownBus` into SIGTERM

**Files:**
- Modify: `instrumentation.ts` (in `shutdown`, before `closeBrowser()`)

- [ ] **Step 1: Write the failing test** — `instrumentation.ts` has no unit harness; verify via a focused assertion that `shutdownBus` is imported and called. Add `lib/events/shutdown.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
it('instrumentation shutdown calls shutdownBus before closeBrowser', () => {
  const src = readFileSync('instrumentation.ts', 'utf8')
  const bus = src.indexOf('shutdownBus()')
  const browser = src.indexOf('closeBrowser()')
  expect(bus).toBeGreaterThan(-1)
  expect(bus).toBeLessThan(browser)
})
```

- [ ] **Step 2: Run, verify fail** — `shutdownBus()` absent.

- [ ] **Step 3: Implement** — in `instrumentation.ts` `shutdown()`, after `stopJobWorker()` and before `closeBrowser()`:
```ts
try {
  const { shutdownBus } = await import('@/lib/events/bus')
  shutdownBus()
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('[shutdown] Failed to close SSE bus:', err)
}
```

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit**
```bash
git add instrumentation.ts lib/events/shutdown.test.ts
git commit -m "feat(a5): close SSE bus on SIGTERM before browser"  # + trailers
```

## Task 7: The browser client manager

**Files:**
- Create: `lib/events/client.ts`
- Test: `lib/events/client.test.ts`

**Interfaces:**
- Produces: `subscribeTopic(topic: string, onInvalidate: () => void | Promise<void>): () => void`. Manages one shared `EventSource('/api/events')`; refcounts topics; watchdog + generation-token reconnect; visibility handling. Exposes `__resetClientForTest()` and injectable `__setEventSourceFactory(fn)` for tests.

- [ ] **Step 1: Write the failing test** (jsdom + a fake EventSource)
```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { subscribeTopic, __resetClientForTest, __setEventSourceFactory } from './client'

class FakeES {
  url: string; onopen: (() => void) | null = null; onerror: (() => void) | null = null
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {}
  closed = false
  constructor(url: string) { this.url = url; FakeES.last = this }
  addEventListener(t: string, cb: (e: MessageEvent) => void) { (this.listeners[t] ??= []).push(cb) }
  close() { this.closed = true }
  fire(t: string, data: unknown) { for (const cb of this.listeners[t] ?? []) cb({ data: JSON.stringify(data) } as MessageEvent) }
  static last: FakeES | null = null
}

describe('client', () => {
  beforeEach(() => { __resetClientForTest(); __setEventSourceFactory((u: string) => new FakeES(u) as unknown as EventSource) })

  it('invokes the callback when an invalidate frame for its topic arrives', () => {
    const cb = vi.fn()
    subscribeTopic('queue', cb)
    FakeES.last!.fire('connected', {})
    FakeES.last!.fire('invalidate', { topic: 'queue' })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('ignores invalidate frames for other topics', () => {
    const cb = vi.fn(); subscribeTopic('queue', cb)
    FakeES.last!.fire('invalidate', { topic: 'recents' })
    expect(cb).not.toHaveBeenCalled()
  })

  it('closes the EventSource when the last topic subscriber leaves; disposer is idempotent', () => {
    const d = subscribeTopic('queue', () => {})
    const es = FakeES.last!
    d(); d()
    expect(es.closed).toBe(true)
  })
})
```

- [ ] **Step 2: Run, verify fail** — module missing.

- [ ] **Step 3: Implement** (watchdog + generation-token reconnect + refcount)
```ts
'use client'
// lib/events/client.ts — one shared EventSource per tab; topic fan-out with refcounts.
const WATCHDOG_MS = 45_000

type Handler = () => void | Promise<void>
type Entry = { handlers: Set<Handler> }

let es: EventSource | null = null
let generation = 0
let watchdog: ReturnType<typeof setTimeout> | null = null
const topics = new Map<string, Entry>()
let esFactory: (url: string) => EventSource =
  (url) => new EventSource(url)

export function __setEventSourceFactory(fn: (url: string) => EventSource) { esFactory = fn }

function armWatchdog() {
  if (watchdog) clearTimeout(watchdog)
  watchdog = setTimeout(() => reconnect(), WATCHDOG_MS)
}

function onFrame() { armWatchdog() } // any frame proves liveness

function connect() {
  const gen = ++generation
  const source = esFactory('/api/events')
  es = source
  const guard = (fn: () => void) => () => { if (gen === generation) fn() }
  source.addEventListener('connected', guard(() => { onFrame(); refetchAll() }))
  source.addEventListener('heartbeat', guard(onFrame))
  source.addEventListener('invalidate', guard((e: Event) => {
    onFrame()
    let topic: string | undefined
    try { topic = JSON.parse((e as MessageEvent).data).topic } catch { return }
    if (!topic) return
    const entry = topics.get(topic)
    if (entry) for (const h of entry.handlers) void h()
  }) as EventListener)
  source.addEventListener('server-restart', guard(() => reconnect()))
  source.onerror = guard(() => { /* native EventSource auto-retries; watchdog covers silent half-open */ })
  armWatchdog()
}

function reconnect() {
  if (watchdog) { clearTimeout(watchdog); watchdog = null }
  if (es) { try { es.close() } catch { /* ignore */ } es = null }
  if (topics.size > 0) connect()
}

function refetchAll() { for (const [, e] of topics) for (const h of e.handlers) void h() }

export function subscribeTopic(topic: string, onInvalidate: Handler): () => void {
  let entry = topics.get(topic)
  if (!entry) { entry = { handlers: new Set() }; topics.set(topic, entry) }
  entry.handlers.add(onInvalidate)
  if (!es) connect()
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    const e = topics.get(topic)
    if (!e) return
    e.handlers.delete(onInvalidate)
    if (e.handlers.size === 0) topics.delete(topic)
    if (topics.size === 0 && es) { try { es.close() } catch { /* ignore */ } es = null; if (watchdog) { clearTimeout(watchdog); watchdog = null } }
  }
}

export function __resetClientForTest() {
  if (es) { try { es.close() } catch { /* ignore */ } es = null }
  if (watchdog) { clearTimeout(watchdog); watchdog = null }
  topics.clear(); generation++
}
```
> Visibility handling (reset watchdog + force refetch on `visibilitychange` → visible) is added in Task 8 alongside the safety-poll integration so it's tested against a real consumer.

- [ ] **Step 4: Run, verify pass** — `npx vitest run lib/events/client.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/events/client.ts lib/events/client.test.ts
git commit -m "feat(a5): shared per-tab EventSource client with watchdog reconnect"  # + trailers
```

## Task 8: SSE-aware queue store (safety poll + visibility)

**Files:**
- Modify: `lib/widgets/queue-poll.ts`
- Test: `lib/widgets/queue-poll.test.ts` (extend)

**Interfaces:**
- Consumes: `subscribeTopic`, `queueTopic`.
- Produces: `useQueueStatus()` unchanged in signature; now refetches on a `queue` invalidate and on visibility-resume, with the interval demoted to `SAFETY_POLL_MS` (60 s).

- [ ] **Step 1: Write the failing test** — assert the store refetches when a `queue` invalidate fires and that the interval is the safety cadence, not 5 s. (Mock `subscribeTopic` to capture the handler; mock `fetch`; use fake timers.)
```ts
it('refetches on a queue invalidate and polls at the 60s safety cadence', async () => {
  // arrange: spy subscribeTopic to grab the onInvalidate; mock fetch to count calls
  // subscribe via useQueueStatus (renderHook), fire the captured handler, assert fetch called again
  // advance 60_000 and assert exactly one additional safety fetch (not 12 at 5s)
})
```
(Write it concretely against the existing `queue-poll.test.ts` harness — it already renders the hook and mocks `fetch`.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — in `lib/widgets/queue-poll.ts`:
  - `import { subscribeTopic } from '@/lib/events/client'` + `import { queueTopic } from '@/lib/events/topics'`
  - Change `POLL_MS` → `const POLL_MS = 60_000` (safety cadence; SSE handles fast updates).
  - In `subscribe`, when `refCount === 1`: also `unsub = subscribeTopic(queueTopic(), () => void tick())` and add a `visibilitychange` listener that on `document.visibilityState === 'visible'` calls `void tick()`. Tear both down when `refCount === 0`.
```ts
let unsubTopic: (() => void) | null = null
function onVisible() { if (document.visibilityState === 'visible') void tick() }
// in subscribe(), refCount===1 branch:
void tick()
timer = setInterval(() => void tick(), POLL_MS)
unsubTopic = subscribeTopic(queueTopic(), () => void tick())
document.addEventListener('visibilitychange', onVisible)
// in disposer, refCount===0 branch:
if (timer) { clearInterval(timer); timer = null }
if (unsubTopic) { unsubTopic(); unsubTopic = null }
document.removeEventListener('visibilitychange', onVisible)
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run lib/widgets/queue-poll.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/widgets/queue-poll.ts lib/widgets/queue-poll.test.ts
git commit -m "feat(a5): SSE-aware queue store with 60s safety poll"  # + trailers
```

## Task 9: Migrate AuditIndexTabs to the shared store

**Files:**
- Modify: `components/ada-audit/AuditIndexTabs.tsx` (remove inline poll lines ~50–65, use `useQueueStatus`)
- Test: existing `AuditIndexTabs` tests stay green (behavior-preserving).

**Interfaces:**
- Consumes: `useQueueStatus` (Task 8).

- [ ] **Step 1: Write/adjust the test** — assert `AuditIndexTabs` renders queue state from the store (mock `useQueueStatus`) and no longer creates its own `setInterval('/api/site-audit/queue')`. If an existing test asserts the inline fetch, update it to the store.

- [ ] **Step 2: Run, verify fail** (test expects the store, component still polls inline).

- [ ] **Step 3: Implement** — replace the `useState`/`useEffect` inline poll with:
```ts
import { useQueueStatus } from '@/lib/widgets/queue-poll'
// ...
const { data: queueStatus } = useQueueStatus()
```
Remove `QUEUE_POLL_INTERVAL_MS` and the inline effect. Downstream props (`DashboardQueueStatus`, `SiteAuditForm` banner) already accept `queueStatus` — unchanged.

- [ ] **Step 4: Run, verify pass** — `npx vitest run components/ada-audit/AuditIndexTabs.test.tsx` (or the relevant test) → PASS.

- [ ] **Step 5: Commit**
```bash
git add components/ada-audit/AuditIndexTabs.tsx
git commit -m "feat(a5): AuditIndexTabs consumes the SSE-aware queue store"  # + trailers
```

## Task 10: Queue emit seams (settlePage, finalizer, enqueue, fail)

**Files:**
- Modify: `lib/jobs/handlers/site-audit-page.ts` (after the settle tx flips)
- Modify: `lib/ada-audit/site-audit-finalizer.ts` (on status transition)
- Modify: `lib/ada-audit/queue-manager.ts` (`enqueueAudit`, `failSiteAudit`)
- Test: extend each seam's existing test to assert `publishInvalidation('queue')` fires after a successful write (mock `@/lib/events/bus`).

**Interfaces:**
- Consumes: `publishInvalidation`, `queueTopic`, `siteAuditTopic`, `recentsTopic`.

**The emit pattern (used by this task and PRs 2–4):** after the awaited write, gated on effect:
```ts
import { publishInvalidation } from '@/lib/events/bus'
import { queueTopic, siteAuditTopic, recentsTopic } from '@/lib/events/topics'
// ... after `const [ , flipped ] = await prisma.$transaction([...])`
if (flipped.count === 1) {
  publishInvalidation(siteAuditTopic(siteAuditId))
  publishInvalidation(recentsTopic())
  publishInvalidation(queueTopic())
}
```

- [ ] **Step 1: Write the failing tests** — for each seam, mock `publishInvalidation` and assert it's called with `'queue'` only when the underlying write took effect (and NOT when the fence loses, e.g. `count === 0`).
```ts
// site-audit-page settle test (illustrative)
vi.mock('@/lib/events/bus', () => ({ publishInvalidation: vi.fn() }))
// ... run a settle that flips count===1, assert publishInvalidation called with 'queue' and 'site-audit:<id>'
// ... run a settle whose fence loses (count===0), assert NOT called
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** each seam per the emit pattern:
  - `settlePage`: after the settle `$transaction` resolves with the counter/child flip, emit `site-audit:<id>`, `recents`, `queue` (gated on the child-flip count).
  - `finalizeSiteAudit`: on each transient/terminal transition write, emit `queue` + `site-audit:<id>`. **seoOnly readiness gate:** do NOT emit `site-audit:<id>` "ready" purely on the `complete` flip — emit `queue` there, and (deferred to PR2's builder task) emit `site-audit:<id>` again after `writeFindingsRun`. For PR1, emit `queue` at the finalizer and `site-audit:<id>` for non-seoOnly complete.
  - `enqueueAudit`: after the create, emit `queue`.
  - `failSiteAudit`: after the parent flip + `cancelJobsByGroup`, emit `queue`, `site-audit:<id>`, `recents`.

- [ ] **Step 4: Run, verify pass** — the three seam test files PASS; full `npx vitest run` for the touched dirs green.

- [ ] **Step 5: Commit**
```bash
git add lib/jobs/handlers/site-audit-page.ts lib/ada-audit/site-audit-finalizer.ts lib/ada-audit/queue-manager.ts lib/jobs/handlers/site-audit-page.test.ts lib/ada-audit/site-audit-finalizer.test.ts lib/ada-audit/queue-manager.test.ts
git commit -m "feat(a5): emit queue invalidations at enqueue/settle/finalize/fail seams"  # + trailers
```

## Task 11: PR1 gates + prod-verify (THE gate)

- [ ] **Step 1: Full local gates**
Run: `npx tsc --noEmit && npm test && NODE_OPTIONS='--max-old-space-size=3072' npx next build`
Expected: all green. (No auth/SF/ADA-pipeline behavior change → `npm run smoke` optional but recommended.)

- [ ] **Step 2: PR + merge** (gate-green, rule 1) — push branch, open PR with `gh`, merge once gates re-run green in the merging session.

- [ ] **Step 3: Deploy** — `ssh seo@144.126.213.242 "~/deploy.sh"`. No new required env var; plain deploy. Verify clean boot (`/api/health` 200, 0 restarts).

- [ ] **Step 4: PROD-VERIFY SSE STREAMS (make-or-break).** First confirm whether the real `NEXT_PUBLIC_APP_URL` host is Cloudflare-fronted. Then, with a valid auth cookie:
```bash
curl -N --no-buffer --max-time 40 -H 'Cookie: <auth-cookie>' https://<app-host>/api/events
```
Pass criteria (spec §5): `connected` immediately; `heartbeat` at ~15 s and ~30 s individually (NOT batched at 40 s); trigger a real site audit and observe a `queue` `invalidate` frame **caused by a real settlePage/finalize** (exercises the fenced-job emit path); closing the client removes the subscriber (`/admin/ops` or `getBusStats`); a PM2 reload ends the stream → client reconnects. Confirm no Cloudflare Cache Rule targets `/api/events` and NGINX doesn't `proxy_ignore_headers X-Accel-Buffering`.
- **If buffered and unfixable via headers:** STOP. The layer is inert (safety poll holds correctness). Flag the NGINX/Cloudflare change to Kevin (server config = his domain) and defer PR2–4.

- [ ] **Step 5: Tracker + handoff ritual** (hard gate 2) — tick A5-PR1 status, dated status-log line, rewrite `HANDOFF-improvement-roadmap.md`, same commit; end the chat with the paste-in prompt.

---

# PR2 — Audit progress topics

Reuses the Task-10 emit pattern and the Task-7/8 client+safety-poll pattern. Each task is failing-test-first, minimal impl, gate, commit (same 5-step rhythm as PR1).

## Task 12: `ClaimedJob.groupKey` + worker topic mapping helper
- **Files:** Modify `lib/jobs/types.ts` (add `groupKey: string | null` to the claimed-job shape), create `lib/jobs/job-topics.ts` (`topicForGroup(groupKey: string|null): string | null` — allowlist prefixes `site-audit:`→siteAuditTopic, `ada-audit:`→adaAuditTopic, `report:`→reportTopic, `seo-report:`→reportTopic; unknown → null), test `lib/jobs/job-topics.test.ts`.
- **Test first:** `topicForGroup('site-audit:9')` → `'site-audit:9'`; `topicForGroup('report:3')` → `'report:3'`; `topicForGroup('mystery:1')` → `null`; `topicForGroup(null)` → `null`.
- Commit: `feat(a5): job groupKey→topic mapping`.

## Task 13: Worker heartbeat delta emission + chained-flush guard
- **Files:** Modify `lib/jobs/worker.ts` (the `heartbeat` interval at ~119, the terminal settle at ~161, the claim at ~99), test `lib/jobs/worker.progress.test.ts` (extend).
- **Behavior:** track `lastEmitted = { progress, message }` per execution. In the heartbeat `updateMany().then(res => …)` success continuation, only when `res.count === 1` AND (`progress`/`message` changed vs `lastEmitted`): set `lastEmitted` then `const t = topicForGroup(job.groupKey); if (t) { publishInvalidation(t); publishInvalidation(recentsTopic()) }`. A chained-flush guard (a module `let flushing: Promise<void>`) serializes overlapping heartbeat writes so a slow write can't publish stale progress after a newer one. Always emit on claim (running), terminal complete/error, and requeue — gated on each `updateMany`'s `count === 1`.
- **Test first:** fake timers; drive two heartbeats with the same progress → exactly one emit; change progress → second emit; terminal → emit; lost fence (`count===0`) → no emit.
- Commit: `feat(a5): worker emits audit-progress invalidations on committed delta`.

## Task 14: seoOnly readiness re-emit in the live-scan builder
- **Files:** Modify the broken-link-verify builder (`lib/jobs/handlers/broken-link-verify.ts`) — after `writeFindingsRun` commits the live-scan `CrawlRun`, emit `siteAuditTopic(id)` again, plus `prospectListTopic()` when the parent `SiteAudit.prospectId` is set, plus `clientSummaryTopic()` + `recentsTopic()`. Also add the ADA `writeFindingsRun` success emit (`clientSummaryTopic`, `recentsTopic`) at the ADA dual-write hook.
- **Test first:** builder writes run → `publishInvalidation('site-audit:<id>')` fires post-commit; with `prospectId` → also `prospect-list`.
- Commit: `feat(a5): re-emit site-audit readiness after live-scan run commits`.

## Task 15: `useAuditPoller` SSE-aware
- **Files:** Modify `components/ada-audit/useAuditPoller.ts` — subscribe to the caller-supplied topic; demote `intervalMs` to a safety cadence (single audit 30 s, site 60 s) while SSE healthy; on invalidate → immediate fetch; keep the exact terminal/navigation semantics (single navigation owner). Callers (`AuditPoller`, `SiteAuditPoller`) pass their topic (`adaAuditTopic(id)` / `siteAuditTopic(id)`).
- **Test first:** extend `useAuditPoller.test.ts` — an invalidate triggers a fetch; terminal still fires exactly one `router.refresh()`/`replace`; SSE-absent path still polls at the safety cadence and converges.
- Commit: `feat(a5): useAuditPoller refetches on SSE invalidate with safety poll`.

## Task 16: `useRecentsLivePoll` SSE-aware
- **Files:** Modify `components/ada-audit/useRecentsLivePoll.ts` — subscribe `recents`; demote 8 s interval to 60 s safety; refetch on invalidate; keep the `onSettled`-once + max-ids semantics.
- **Test first:** invalidate → status refetch; settled key still notified once.
- Commit: `feat(a5): recents live-poll refetches on SSE invalidate`.

## Task 17: PR2 gates + deploy + prod-verify
- Gates (tsc/test/build) + `npm run smoke` (touches the ADA pipeline) → PR → merge → deploy → prod-verify a live single-page ADA audit + a site audit both update via SSE (network tab shows the stream, not 1 s polling) with the safety poll as fallback. Tracker + handoff ritual.

---

# PR3 — Reports, prospects, content-audit, batch, client-summary

Same rhythm. Each poller: (a) emit at its write seam, (b) migrate the poller to `subscribeTopic` + safety poll.

## Task 18: Report emit seams + pollers
- **Emit:** `seo-report-render.ts` child status + batch rollup → `reportTopic(id)` + `reportListTopic()`; `report-render` PDF file/stamp ready → `reportTopic(siteAuditId)` + `reportListTopic()`; report create/delete/regenerate routes → `reportListTopic()`.
- **Migrate:** `SiteAuditExportBar.tsx` (2 s → `report:<id>` + 30 s safety), `GenerateReportForm.tsx` (2 s/3 s → `report:<id>`/`report-list`), `ReportLibrary.tsx` (5 s → `report-list` + 60 s safety).
- **Test first** per seam + per component (invalidate → refetch; safety cadence).
- Commit(s): `feat(a5): report invalidations + SSE-aware report pollers`.

## Task 19: Prospect emit seam + dashboard
- **Emit:** prospect scan settle + live-scan run create (from Task 14's builder emit — `prospect-list`).
- **Migrate:** `ProspectDashboard.tsx` (8 s → `prospect-list` + 60 s safety).
- **Test first:** invalidate → prospect list refetch.
- Commit: `feat(a5): prospect-list invalidations + SSE-aware dashboard`.

## Task 20: Content-audit emit seam + card
- **Emit:** content-audit ingest PATCH route → `contentAuditTopic(siteAuditId)`.
- **Migrate:** `ContentAuditCard.tsx` (8 s → `content-audit:<id>` + 60 s safety; keep the mint→poll bounded semantics as the safety backstop).
- **Test first:** ingest → invalidate → card refetch.
- Commit: `feat(a5): content-audit invalidations + SSE-aware card`.

## Task 21: Batch + client-summary pollers
- **Migrate:** `QueueActiveView.tsx` (batch detail 5 s → `audit-batch:<id>` + queue store; emit `audit-batch:<id>` already added in Task 10's `ensureOpenBatch`/`closeBatchIfDrained`), `ClientsAuditSummary.tsx` (two 30 s polls → `client-audit-summary` + `queue`, keep 30 s safety). Client-summary emit already added in Task 14 (ADA `writeFindingsRun`).
- **Test first:** invalidate → refetch for each.
- Commit: `feat(a5): batch + client-summary SSE-aware pollers`.

## Task 22: PR3 gates + deploy + prod-verify
- Gates → PR → merge → deploy → prod-verify a report render + a prospect scan + a content-audit ingest each push-update. Tracker + handoff.

---

# PR4 — Memos

## Task 23: `memo-poller-machine` visibility+dirty semantics
- **Files:** Modify `lib/memo-poller-machine.ts` — add a `dirty` flag set by an external invalidate while hidden; on visibility-resume, refetch immediately and clear dirty; hidden time stays excluded from the existing 15-min active cap (unchanged). Test `lib/memo-poller-machine.test.ts` (extend): invalidate-while-hidden sets dirty without advancing; visible → one fetch.
- Commit: `feat(a5): memo machine handles SSE invalidate + dirty-while-hidden`.

## Task 24: Memo cards + pillar-analysis emit + button
- **Emit:** memo write-back PATCH routes (roadmap/keyword/keyword-strategy/pillar) → `memoTopic(sessionId)`; `PillarAnalysis` pending/running/complete/error writes → `pillarAnalysisTopic(sessionId)`.
- **Migrate:** `SeoRoadmapCard.tsx`, `KeywordMemoCard.tsx`, `KeywordStrategyCard.tsx`, `MemoPoller.tsx` (all → `memo:<sessionId>` + 20 s memo-safety cadence, keep 15-min cap + visibility pause); `PillarAnalysisButtonClient.tsx` (1.5 s → `pillar-analysis:<sessionId>` + 20 s safety).
- **Test first** per card + the button (invalidate → refetch; cap preserved).
- Commit: `feat(a5): SSE-aware memo pollers + pillar-analysis button`.

## Task 25: PR4 gates + deploy + prod-verify + A5 CLOSE
- Gates → PR → merge → deploy → prod-verify a memo generation (run an er-handoff-memo skill write-back) pushes to the card via SSE. **A5 COMPLETE:** tracker `[x]`, dated status-log, rewrite handoff, move spec+plan to `docs/superpowers/archive/`. Final reply ends with the paste-in prompt.

---

## Self-Review

**Spec coverage:** §3.1 bus → Tasks 2,3,6; §3.2 route → Tasks 4,5; §3.3 emit seams → Tasks 10,13,14,18,19,20,24; §3.4 client → Tasks 7,8,15,16,23; §3.5 hook integration → Tasks 8,9,15,16,21,24; §4 PRs → the PR structure; §5 prod-verify → Task 11; §6 testing → each task's failing-test-first step; §7 invariants → Global Constraints + the emit pattern. All covered.

**Placeholder scan:** Task 8's Step-1 test body and Task 10/13/14/18–24 test bodies are described-not-fully-coded where they must be written against an existing test harness whose exact helpers vary — the implementer writes the concrete assertion using that file's established pattern (noted inline each time). Every novel/greenfield unit (bus, route, client, topics) has complete code. No `TBD`/`add error handling`/`similar to Task N` for distinct logic.

**Type consistency:** `Subscriber` (`write`/`close`/`desiredSize?`), `subscribeBus`→disposer, `publishInvalidation(topic)`, `subscribeTopic(topic, handler)→disposer`, `topicForGroup`, topic builders — names consistent across tasks. `useQueueStatus()` signature preserved. `ClaimedJob.groupKey` introduced in Task 12 before its use in Task 13.
