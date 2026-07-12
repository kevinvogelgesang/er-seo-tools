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
- `publishInvalidation(topic: string): void` — **synchronous, never throws.** Adds
  `topic` to a single bounded `pendingTopics: Set<string>` (cap `MAX_PENDING_TOPICS`,
  ~256; over-cap → drop the *new* topic and log once — the safety poll still covers
  it) and arms **one** shared coalescing timer (~150 ms), NOT a timer per topic. On
  flush, each pending topic is written to every subscriber. A dead/backpressured
  controller must never surface into the caller (it runs at post-commit write seams —
  see §3.3).
- **Mechanical backpressure (Codex/Sol fix 5).** `Subscriber` wraps the route's
  `ReadableStreamDefaultController`. `write(frame)` inspects `controller.desiredSize`:
  if `<= 0`, **drop the frame** (don't buffer) and increment a per-subscriber
  `consecutiveDrops` counter; if `desiredSize > 0`, enqueue and reset the counter.
  When `consecutiveDrops` exceeds `MAX_CONSECUTIVE_DROPS` (~20), close and remove
  that subscriber — **and run its idempotent route cleanup** (§3.2) so it can't leak.
  Backpressure is never an error to the publisher; correctness is held by the
  client's refetch-on-reconnect + safety poll.
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

- **Wrapped in `withRoute`** (repo invariant — the returned streaming `Response`
  passes through `withRoute` untouched; `withRoute` only catches *setup* errors
  before streaming begins). Same-origin `EventSource` automatically carries the auth
  cookie, and the current middleware `matcher` already covers `/api/:path*`
  (Codex/Sol verified — resolves §8 open item 3), so the route **is** cookie-gated
  and NOT added to `isPublicPath`. Add a `middleware.test.ts` case asserting 401
  without the auth cookie.
- **`MAX_CONNECTIONS` rejection is checked BEFORE returning the stream** — over cap →
  503 (plain JSON, no stream opened), never a half-open subscriber.
- **Finite connection lifetime (~30 min)** — a server-side timer closes the stream
  so the client's native reconnect re-runs middleware auth after cookie
  expiry/logout (an SSE stream otherwise outlives its auth cookie indefinitely).
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
**gated on the write actually taking effect** (e.g. `flipped.count === 1`). A crash
between commit and publish is acceptable **by design** — the safety poll catches it.
Emit helpers must never be able to fail the completed write.

**Ordering rule for readiness-gated topics (Codex/Sol fix 1).** Some readers poll
*past* a status flip: `SiteAuditPoller` keeps polling a **seoOnly** audit past parent
`complete` until the live-scan `CrawlRun` exists (`deriveSeoOnlyStatus`). Emitting
`site-audit:<id>` right after the status flip would make the poller observe
`complete + no run + no verify job` → classify *unavailable* and stop. So:
- Publish `queue` **independently** after the parent status transition.
- For seoOnly audits, **await + catch** `enqueueBrokenLinkVerify` before publishing
  `site-audit:<id>` (so a verify job exists when the client refetches), and
- Publish `site-audit:<id>` **again** only after `writeFindingsRun` commits the
  live-scan run (readiness is real). The same "emit after the run exists" rule
  applies to `prospect-list` (a prospect audit is reportable only once its live-scan
  `CrawlRun` exists) and to ADA `client-audit-summary`/`recents` (see below).

**Worker heartbeat emission, precisely (Codex/Sol fix 4).** The worker heartbeat
fires an unawaited fenced `updateMany`. Emit in **that promise's success
continuation, only when `count === 1`**, and update `lastEmittedProgress` **only
after** the write succeeds. A **chained-flush guard** (one in-flight write at a time
per job, next chained) prevents overlapping heartbeat writes from publishing stale
progress out of order. Emit only when `progress`/`progressMessage` changed vs
`lastEmittedProgress`. Always emit on claim, retry/backoff, cancel, and terminal
settle. The claimed-job shape must include `groupKey`; map **only allowlisted group
prefixes** (`site-audit:` / `ada-audit:` / `report:` / `seo-report:`) to topics —
unknown groups emit nothing.

### Emit-seam inventory (complete)

| Seam (file/function) | Topics |
|---|---|
| Worker claim / terminal settle / retry / cancel + heartbeat delta (`lib/jobs/worker.ts`) | mapped from `groupKey` prefix → `site-audit:<id>` / `ada-audit:<id>` / `report:<id>` / `seo-report:<id>` |
| `enqueueAudit` incl. batch reassignment (`queue-manager.ts`) | `queue` |
| Discover claim/persist parent→`running` (`site-audit-discover`) | `queue`, `site-audit:<id>` |
| `settlePage` after counter/child tx flip (`site-audit-page.ts:167`) | `site-audit:<id>`, `recents`, `queue` |
| `finalizeSiteAudit` transient/terminal changes (`site-audit-finalizer.ts`) | `site-audit:<id>` (readiness-gated per rule above), `queue`, `recents` |
| Live-scan `CrawlRun` create in the broken-link-verify builder | `site-audit:<id>`, `prospect-list` (if `prospectId`), `recents` |
| `failSiteAudit` + cancel route (`cancelJobsByGroup` lives in `lib/jobs/queue.ts`, NOT the worker) | `site-audit:<id>`, `queue`, `recents` |
| `ensureOpenBatch` / `closeBatchIfDrained` on change | `queue`, `audit-batch:<id>` |
| Standalone ADA progress + terminal (`ada-audit.ts:71/98/133`) | `ada-audit:<id>`, `recents` |
| ADA **`writeFindingsRun`** success (after CrawlRun score exists — the finalizer emits *before* this fire-and-forget write) | `client-audit-summary`, `recents` |
| `seo-report-render` child status + batch rollup; report create/delete/regenerate routes | `report:<id>`, `report-list` |
| Report-render PDF file/stamp ready (`report-render` handler) | `report:<id>`, `report-list` |
| Prospect scan settle (parent complete) | `prospect-list` |
| Content-audit ingest PATCH | `content-audit:<id>` |
| `PillarAnalysis` pending/running/complete/error writes (for `PillarAnalysisButtonClient` — memo PATCH does NOT cover this) | `pillar-analysis:<sessionId>` |
| Memo write-backs (pillar/roadmap/keyword/keyword-strategy PATCH) | `memo:<sessionId>` |
| Recovery / stale-reset terminal writes (`recovery.ts`, `resetStaleAudits`) — subscribers may already exist | `site-audit:<id>`, `ada-audit:<id>`, `queue`, `recents` |

### 3.4 Client — `lib/events/client.ts` (one EventSource per tab)

- A single shared `EventSource('/api/events')` per browser tab, lazily created on
  first subscription, torn down when the last subscriber leaves.
- `subscribe(topic, cb): () => void` — topic→callback registry with **refcounts**.
  Callbacks are **async-capable** (`cb` may return a Promise). The returned disposer
  carries a **`disposed` flag and is idempotent** — a double React cleanup (StrictMode /
  fast refresh) must NOT underflow the connection refcount (Codex/Sol fix 7).
  Multiple hooks on the same topic share one registration.
- **Per-subscription health, not global (Codex/Sol fix 7).** There is no global
  "stand down fast polling" flag — after a reconnect, one topic's refetch may succeed
  while another fails. Each hook disables its **own** fast fallback only after its
  **own** refetch succeeds; a failed refetch keeps that hook polling.
- **Heartbeat watchdog + explicit reconnect (Codex/Sol fix 6).** If no frame
  (`connected`/`heartbeat`/`invalidate`) arrives for ~40–45 s, native `EventSource`
  will NOT recover a silently half-open connection on its own. So on watchdog expiry:
  **explicitly `close()` the current source**, mark transport unhealthy, enable fast
  fallback on all subscribed hooks, then create a **new** `EventSource` after the
  retry delay. A **generation token** guards the swap so a stale source's
  `onopen`/`onerror` can't mutate the new connection's state.
- **On `connected` / reconnect:** each subscribed hook refetches its own topic from
  the DB; each stands down its own fast fallback only after its own refetch succeeds.
  Always keep the coarse safety interval.
- **Visibility semantics (Codex/Sol fix 8).** On returning to a **visible** tab
  (timers were throttled while hidden), **reset the watchdog baseline** and **force a
  DB refetch before declaring SSE healthy** (a hidden tab can't trust the stream). For
  **memo** flows specifically: hidden time stays **excluded** from the memo machine's
  existing 15-min active cap; an `invalidate` received while hidden marks the memo
  **dirty** (does NOT fetch or advance the machine); on visibility resume it refetches
  immediately.
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
  `app/api/events/route.ts` (+ middleware test), `lib/events/client.ts`, and convert
  **only** the highest-fanout poller: the `AuditIndexTabs` queue poll (via the
  existing `lib/widgets/queue-poll.ts` store). **PR1 MUST include the
  worker-originated `queue` emissions** (`settlePage`, finalizer, `enqueueAudit`),
  not just the enqueue/finalizer ones — so the prod-verify exercises the riskier
  fenced-worker/heartbeat emit path, not only route-handler emits (Codex/Sol fix 9).
  Prod-verify (§5) MUST observe a `queue` `invalidate` frame **caused by a real job
  claim or `settlePage`**, not merely a synthetic ping. Existing polling elsewhere
  unchanged. **Prod-verify = the make-or-break step.** If the edge buffers SSE and it
  can't be fixed, STOP: the layer is inert (safety poll covers correctness) and PR2–4
  are deferred pending a proxy fix.
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
  single coalescing timer drains `pendingTopics`; `MAX_PENDING_TOPICS` over-cap drops
  the new topic; **backpressure**: `desiredSize <= 0` drops the frame, and
  `MAX_CONSECUTIVE_DROPS` closes + cleans up a persistently slow subscriber.
- **Route:** 401 without cookie (middleware); `withRoute` passthrough of the stream;
  correct headers; `connected` frame first; `MAX_CONNECTIONS` over-cap → 503 with no
  stream opened; finite-lifetime timer closes the stream; cleanup fires on abort AND
  on cancel; double-cleanup is a no-op.
- **Client:** watchdog trips on heartbeat gap → `close()` + new source under a
  generation token (stale handlers can't mutate new state) → resumes polling;
  **per-subscription** stand-down (one topic's refetch failing keeps that hook
  polling while others stand down); disposer `disposed` flag prevents refcount
  underflow on double cleanup; visibility-resume forces refetch before healthy;
  memo dirty-while-hidden (no fetch/advance while hidden); shared-store single
  refetch per event.
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
2. Exact heartbeat-watchdog timeout (40 vs 45 s), safety-poll intervals per hook,
   and the bound constants (`MAX_CONNECTIONS` ~100, `MAX_PENDING_TOPICS` ~256,
   `MAX_CONSECUTIVE_DROPS` ~20, connection lifetime ~30 min) — pin in the plan.
3. ~~Middleware matcher coverage~~ **RESOLVED** (Codex/Sol): the matcher already
   covers `/api/:path*`, so `/api/events` is cookie-gated; `EventSource` carries the
   cookie same-origin. Still add the `middleware.test.ts` 401 case.
