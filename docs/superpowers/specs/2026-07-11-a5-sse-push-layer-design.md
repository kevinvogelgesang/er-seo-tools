# A5 — SSE Push Layer (shared status hook → server-sent invalidations)

**Status:** spec · **Date:** 2026-07-11 · **Roadmap item:** A5 (Track A infra)
**Owner:** Kevin · **Pipeline:** brainstorm → spec → Codex(Sol) → plan → Codex(Sol) → TDD build

## 1. Problem & goal

Every live surface in the app discovers state changes by **polling** an API route
on an interval (1–8 s). There is no event bus — progress is only found by re-reading
rows. A5's roadmap intent (`nyi/improvement-roadmaps/06-platform.md §5`): *"status
hook first, SSE second… an event means 'refetch now,' and reconnect always falls
back to fetching state from the DB. SSE never carries authoritative state."*

The shared-hook half is **already built** (`useAuditPoller`, `lib/memo-poller-machine.ts`,
`useRecentsLivePoll`). A5's remaining work is the **SSE notification layer** plus
consolidating the ~9 remaining hand-rolled pollers onto a shared SSE-aware client.

**Goal:** replace aggressive 1–8 s polling with server-pushed *invalidation*
broadcasts, while keeping the DB as the single source of truth and a coarse safety
poll as the correctness backstop. Net effect: delete the per-second polling load
without making liveness load-bearing.

**Non-goals:** SSE never carries state (only `{topic}` invalidations). No durable
event log / `Last-Event-ID` replay in v1. No WebSockets. No multi-process fan-out
(single PM2 fork process — same premise the browser pool + job worker already assume).

## 2. Core contract (the one invariant everything else serves)

> **SSE is a cache-invalidation broadcast, never a state channel.** An event means
> exactly "refetch topic X from the DB now." Correctness NEVER depends on any event
> being delivered.

Corollary (the correction that shaped this design — Codex/Sol): **a missed emit on
an otherwise-healthy SSE stream is invisible** (no `error` fires), so it cannot
auto-degrade to polling. Therefore every subscribed client keeps a **coarse safety
poll** running (60 s ordinary; 15–30 s for active memo-generation flows). SSE
*replaces the aggressive cadence*; the safety poll *guarantees eventual consistency*
if an emit is dropped, the stream is silently buffered by a proxy, or SSE never
connects at all (e.g. dev-without-proxy).

This means the feature is **safe to ship even if SSE never streams in prod** — it
degrades to (slower) polling, never to incorrectness.

## 3. Architecture

### 3.1 Server bus — `lib/events/bus.ts`

One **process-global** singleton (module-scope, like the browser pool / job worker):

- `subscribers: Set<Subscriber>` where `Subscriber = { write(frame: string): void }` —
  one entry per open SSE connection. **Not** an `EventEmitter`-per-entity (Codex/Sol):
  one broadcast set is simpler and safer for a single-trust-level app with modest
  event volume; the client filters by topic.
- `publishInvalidation(topic: string): void` — **synchronous, never throws.** Wraps
  every `subscriber.write` in try/catch and drops a subscriber whose write throws.
  A dead/backpressured controller must never surface into the caller (it runs at
  post-commit write seams — see §3.3). Coalesces bursts **per topic** over a short
  window (~150 ms) so a 2000-page audit doesn't emit 2000 immediate frames.
- `subscribe(sub) / unsubscribe(sub)` — idempotent; enforces `MAX_CONNECTIONS` (~100).
- One **global heartbeat timer** (`HEARTBEAT_MS` = 15 s, reused from `lib/jobs/config.ts`)
  that exists only while `subscribers.size > 0`; on each tick writes a `heartbeat`
  event to every subscriber. Stops when the set empties.
- `shutdownBus(): void` — best-effort: optionally emit a `server-restart` event,
  close all controllers, clear the heartbeat timer, empty the set. Wired into the
  existing `instrumentation.ts` SIGTERM `shutdown()` **before** `closeBrowser()`
  (instrumentation.ts:147) and `process.exit()` (:153).

Topic strings are plain (`site-audit:<id>`, `ada-audit:<id>`, `queue`, `recents`,
`report:<id>`, `report-list`, `prospect-list`, `content-audit:<id>`,
`memo:<sessionId>` per kind, `audit-batch:<id>`, `client-audit-summary`). No
`Class.name` / minification-fragile identifiers (repo invariant) — all literals.

### 3.2 SSE route — `app/api/events/route.ts`

```ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0
```

- **Cookie-gated** by the existing auth middleware. `/api/events` is NOT added to
  `isPublicPath` (it must require auth). **Verify the middleware `matcher` actually
  covers `/api/events`** so the gate runs; add a `middleware.test.ts` case asserting
  401 without the auth cookie (the repo's recurring "new route 401s / or worse,
  isn't gated" trap — from the opposite direction).
- Returns `new Response(stream, { headers })` with:
  - `Content-Type: text/event-stream; charset=utf-8`
  - `Cache-Control: no-cache, no-store, no-transform`
  - `X-Accel-Buffering: no`
  - Do NOT set `Content-Length` / `Transfer-Encoding` / `Connection` (transport concerns).
- On open: immediately enqueue `retry: 5000\n` + a `connected` event so headers and
  the first body chunk flush out of Next.js at once. Register the subscriber.
- **Idempotent cleanup on BOTH** `request.signal`'s `abort` listener AND the
  `ReadableStream`'s `cancel()` — unsubscribe + release. A double-fire must be a no-op.
- Drop/coalesce on backpressure (never buffer unboundedly per connection); the
  client's safety poll + refetch-on-reconnect preserve correctness.

### 3.3 Emit seams (hybrid C — post-commit, flip-gated)

`publishInvalidation` is called **after** the awaited mutation/transaction resolves
(outside the tx — array-form `$transaction` only; emit reflects committed state),
**gated on the write actually taking effect** (e.g. `flipped.count === 1`):

| Seam (file) | Topics emitted |
|---|---|
| Job worker (`lib/jobs/worker.ts`): claim, terminal settle, retry/backoff, cancel; heartbeat **only on `progress`/`progressMessage` delta** vs last-flushed | derive from the job's group/domain (`site-audit:<id>`, `ada-audit:<id>`, `report:<id>`) + `queue` on lifecycle transitions |
| `settlePage` (`lib/jobs/handlers/site-audit-page.ts:167`) after the counter/child tx flips | `site-audit:<id>`, `recents`, `queue` |
| Standalone ADA progress + terminal (`lib/jobs/handlers/ada-audit.ts:71/98/133`) | `ada-audit:<id>`, `recents` |
| Site finalize / fail (`site-audit-finalizer.ts`, `queue-manager.ts`) + live-scan `CrawlRun` create (broken-link-verify builder) | `site-audit:<id>`, `queue`, `recents` |
| Report render start + file/stamp ready (`report-render` handler) | `report:<id>`, `report-list` |
| Prospect scan settle | `prospect-list` |
| Content-audit ingest PATCH | `content-audit:<id>` |
| Memo write-backs (pillar/roadmap/keyword/keyword-strategy PATCH) | `memo:<sessionId>` |

A crash between commit and publish is acceptable **by design** — the safety poll
catches it. Emit helpers must never be able to fail the completed write.

### 3.4 Client — `lib/events/client.ts` (one EventSource per tab)

- A single shared `EventSource('/api/events')` per browser tab, lazily created on
  first subscription, torn down when the last subscriber leaves.
- `subscribe(topic, cb): () => void` — topic→callback registry with **refcounts**;
  the returned disposer decrements and removes at zero. Multiple hooks subscribing
  to the same topic share one registration.
- **Heartbeat watchdog:** if no frame (`connected`/`heartbeat`/`invalidate`) arrives
  for ~40–45 s → treat the stream as silently buffered/dead → mark stale, resume
  fast polling on affected hooks, and let `EventSource` reconnect (native 5 s
  `retry` is sufficient; no custom backoff in v1).
- **On `connected` / reconnect:** immediately refetch all currently-subscribed
  topics from the DB, and only *after* that fetch succeeds stand down fast polling.
  Always keep the coarse safety interval.
- `invalidate` event → look up topic callbacks → each hook refetches its own
  endpoint. Shared endpoint stores (e.g. `lib/widgets/queue-poll.ts`) refetch ONCE
  per event even though three consumers read them — avoid triple-refetch.

### 3.5 Hook integration

Each existing poller gains: (a) an SSE subscription to its topic(s) that triggers
its existing fetch, and (b) its fast interval replaced by the coarse safety interval
(active only while SSE is not confirmed-healthy, plus the low-freq backstop). The
public API of `useAuditPoller` / `memo-poller-machine` / `useRecentsLivePoll` stays
behavior-compatible; callers are largely untouched. The memo machine KEEPS its
15-min lifetime cap + tab-visibility pause (they become safety-poll bounds).

## 4. Rollout — sequential PRs (each gate-green + independently shippable)

Follows Codex/Sol's incremental gate: prove SSE streams through the **real prod
edge** before migrating everything.

- **PR1 — Infra + queue canary + prod-verify (the gate).** `lib/events/bus.ts`,
  `app/api/events/route.ts` (+ middleware coverage + test), `lib/events/client.ts`,
  and convert **only** the highest-fanout poller: the `AuditIndexTabs` queue poll
  (via the existing `lib/widgets/queue-poll.ts` store) + emit `queue` at its seams.
  Existing polling elsewhere unchanged. **Prod-verify = the make-or-break step**
  (§5). If the edge buffers SSE and it can't be fixed, STOP: the layer is inert
  (safety poll covers correctness) and PR2–4 are deferred pending a proxy fix.
- **PR2 — Audit progress.** `useAuditPoller` (single + site) + `useRecentsLivePoll`;
  emit `site-audit:<id>` / `ada-audit:<id>` / `recents`.
- **PR3 — Reports + prospects + content-audit + batch + client-summary.** The
  hand-rolled Group C pollers.
- **PR4 — Memos.** The 4 memo pollers via `memo-poller-machine`; preserve the
  lifetime cap + visibility pause.

## 5. Production verification (PR1 gate)

Real prod-divergence risk: SSE works in dev but is silently buffered by the
**Cloudflare → RunCloud/NGINX** proxy chain in prod (classic dev/prod split this
repo keeps getting bitten by). Header-only (`X-Accel-Buffering: no`) usually
suffices without a server config change, but must be PROVEN end-to-end.

**First, confirm the edge:** determine whether the real `NEXT_PUBLIC_APP_URL`
hostname is Cloudflare-fronted (not visible from the repo — `.env` is a placeholder).
Run the streaming test against that hostname, not just the origin.

```bash
curl -N --no-buffer --max-time 40 -H 'Cookie: <auth-cookie>' https://<app-host>/api/events
```

Pass criteria:
- `connected` arrives immediately (not batched at the end).
- `heartbeat` events arrive individually near 15 s and 30 s (proves un-buffered).
- A real audit transition produces an `invalidate` frame → client refetches.
- Closing the tab removes the server subscriber promptly (FD/heap flat over repeated
  connect/disconnect cycles — check via `/admin/ops` or a loop).
- A PM2 reload terminates the stream → client starts fallback polling, reconnects,
  refetches current state.
- No Cloudflare Cache Rule targets `/api/events`; NGINX does not set
  `proxy_ignore_headers X-Accel-Buffering`. (If buffering is found, the fix is a
  server-side proxy directive — **Kevin's domain**, flagged as a pre-req, not a
  code change.)

## 6. Testing

- **Bus:** publish reaches all subscribers, filters correctly; `publishInvalidation`
  never throws even with a dead controller; **listener/subscriber count returns to
  zero** after disconnect + reconnect (leak guard); `MAX_CONNECTIONS` enforced;
  per-topic burst coalescing.
- **Route:** 401 without cookie (middleware); correct headers; `connected` frame
  first; cleanup fires on abort AND on cancel; double-cleanup is a no-op.
- **Client:** watchdog trips on heartbeat gap → resumes polling; `connected`/reconnect
  → refetch-then-stand-down; refcount teardown; shared-store single refetch per event.
- **Emit seams:** each seam calls `publishInvalidation` with the right topic only
  after the flip; emit failure can't fail the write (inject a throwing bus, assert
  the domain write still succeeds).
- **Behavior-preserving:** every migrated poller's existing tests stay green;
  SSE-disabled path (no EventSource / never connects) still converges via safety poll.

## 7. Invariants honored

- Array-form `$transaction` only; emit is **outside** the tx, post-commit, flip-gated.
- No `Class.name`/identifier-name runtime deps (topics are literals).
- Any URL uses `NEXT_PUBLIC_APP_URL`, never request origin.
- SIGTERM: `shutdownBus()` before `closeBrowser()` / `process.exit()`.
- New route gated + `middleware.test.ts` case (401 without auth).
- Single-process premise unchanged (in-memory bus; PM2 reload → reconnect+refetch).
- Coarse safety poll is mandatory — correctness never depends on SSE delivery.

## 8. Open items (resolve in plan / PR1)

1. Confirm Cloudflare fronts the real prod host; target prod-verify accordingly.
2. Exact heartbeat-watchdog timeout (40 vs 45 s) and safety-poll intervals per hook —
   pin in the plan.
3. Whether the middleware `matcher` currently matches `/api/events` (if `/api/*` is
   excluded, the route would be unauthenticated — must gate it).
