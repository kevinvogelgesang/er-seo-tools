# C11 PR 2b — SEO-phase visibility + fine-grained progress

**Status:** spec (active)
**Date:** 2026-07-07
**Roadmap item:** C11 (Screaming-Frog retirement), PR 2b — the two items PR 2a deferred: (d) SEO-phase visibility, (e) fine-grained SEO-phase progress bar.
**Depends on:** C11 PR 1 (`seoOnly` scan mode, `liveScanRunId` on the API), PR 2a (intent toggles/labels, `SeoScanForm`) — both shipped to `main`.
**Branch:** `feat/c11-pr2b-seo-phase-visibility` (off `origin/main` @ 0d1d481).

---

## 1. Problem

The `broken-link-verify` job is the **single live-scan run builder**: it runs *after* a site audit reaches terminal `complete`, harvests are already persisted, and it builds the live-scan `CrawlRun` (broken links + on-page SEO + similarity + coverage). Prod: median 36 s, p90 55 s, 15-min hard cap. It is **completely invisible** to the operator:

1. **Normal ADA site audits** render at `/ada-audit/site/[id]` — a **static server component** (one render, no polling). It reads the live-scan `CrawlRun` directly (`crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } } })`). While the verifier is still running the run is **null**, so `BrokenLinksSection` / `OnPageSeoSection` / `TechnicalSeoSection` / `DiscoveryCoverageSection` / `ReachabilitySection` / `ContentSimilaritySection` all render a flat **"not verified / not analyzed"** — indistinguishable from *running*, *failed*, or *done-but-empty*. The audit reads `complete` while SEO analysis is still in flight.

2. **`seoOnly` scans** redirect away from the ADA page (`seoOnlyRedirectTarget` → `redirect('/seo-parser')`, dropping the id). On `/seo-parser`, `SeoScanForm` already polls `GET /api/site-audit/[id]` every 2 s and distinguishes `running` → `building` (audit `complete` but `liveScanRunId` still null == verifier running) → `ready` (`liveScanRunId` present). So `seoOnly` has *coarse* visibility already, but two gaps remain: **(i)** no progress detail — "Building SEO report…" is a static pill; **(ii)** it **spins forever** if the verify job errors or was never enqueued (no run + no job) — a real bug, not just a cosmetic miss.

**Readiness truth:** `liveScanRunId` present (a live-scan `CrawlRun` exists) means the SEO phase is **done**, regardless of any `Job` row. This is authoritative and already on the API.

**Retention interplay:** terminal `Job` rows prune (complete 7 d / error 30 d, `lib/jobs/retention.ts`). So state resolution must be: `liveScanRunId` present → **done**; else the latest `broken-link-verify` job in group `site-audit:<id>` decides **running / queued / failed**; else (no run **and** no job) → **unavailable/stalled**, never "running".

---

## 2. Scope (v1)

Routed through Codex (turn 33). Decisions:

- **Q1 surfaces → (a) + (b); defer (c).** Fix the ADA site page (normal audits) and the `seoOnly` `SeoScanForm`. **Defer the history chip** — it spreads readiness semantics into more list queries for marginal value; easy fast-follow.
- **Q2 ADA mechanism → server-probe + refresh hint** (no client poller, no new endpoint on that page). Matches the page's existing one-shot server-component model; a poller on every completed-audit view is not worth it for a 36 s-median phase.
- **Q3 depth → progress bar + counts** on the actively-waiting `SeoScanForm` (via its existing 2 s poll); **static "checked X/Y" snapshot** on the ADA page. Coarse-chip-only is too weak once `Job.progress` exists.

**In scope:**
1. Generic `Job.progress` (`Int?`, 0–100) + `Job.progressMessage` (`String?`), written on the attempt-fenced heartbeat. Benefits `/admin/ops` for every job type.
2. Thread handler `ctx` into `broken-link-verify` (currently dropped) + a generic `ctx.reportProgress(progress, message)` seam.
3. Shared server-side `getSeoPhase(siteAuditId)` classifier → `{ state, progress, message }`.
4. `GET /api/site-audit/[id]` returns a `seoPhase` object (for `SeoScanForm`).
5. ADA site page: render a single `SeoPhaseBanner` when the live-scan run is null (in place of the six null-state sections), driven by `getSeoPhase`.
6. `SeoScanForm`: consume `seoPhase` — progress bar + counts while building, and terminal **failed** / **unavailable** states (kills the infinite spin).

**Explicitly out of scope (v1):**
- History chips (SEO `HistoryList`, ADA `RecentsTable`). Fast-follow.
- A client poller on the ADA site page.
- Structured `checked`/`total` columns — counts ride inside `progressMessage`.
- Any change to *where SEO findings render* (that's PR 3 / separate).
- `/admin/ops` UI changes — the columns land generically; surfacing them there is not required for this PR (may be a trivial add if free).

---

## 3. Design

### 3.1 Schema — generic job progress

Add two **nullable, additive** columns to `Job` (`prisma/schema.prisma`):

```prisma
model Job {
  ...
  progress        Int?     // 0-100, generic per-job progress; written on the fenced heartbeat
  progressMessage String?  // human-readable status, e.g. "Checked 420/1900 links"
  ...
}
```

Hand-authored migration (SQLite additive nullable — safe; auto-applies on deploy via `prisma migrate deploy`):

```
-- prisma/migrations/<timestamp>_job_progress/migration.sql
ALTER TABLE "Job" ADD COLUMN "progress" INTEGER;
ALTER TABLE "Job" ADD COLUMN "progressMessage" TEXT;
```

Apply + regenerate locally:
```
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && \
DATABASE_URL="file:./local-dev.db" npx prisma generate
```

**Call out in the PR:** this migration auto-applies on deploy. No required-in-prod env var → no Kevin pre-deploy step.

### 3.2 Worker — the progress seam (generic)

The worker (`lib/jobs/worker.ts`) already runs a fenced heartbeat interval:
```ts
const fence = { id: job.id, status: 'running', attempts: job.attempts }
const heartbeat = setInterval(() => {
  void prisma.job.updateMany({ where: fence, data: { heartbeatAt: new Date() } }).catch(() => {})
}, HEARTBEAT_MS)
```

**Change:** a per-execution mutable progress cell that the heartbeat flushes with the *same fence*. Handlers push into it synchronously via a new `ctx.reportProgress`; the heartbeat is the only writer to the DB, so there is **no extra write and no per-handler throttling** — progress is persisted at the existing heartbeat cadence.

```ts
let progressCell: { progress: number | null; message: string | null } = { progress: null, message: null }
const abort = new AbortController()
const heartbeat = setInterval(() => {
  void prisma.job.updateMany({
    where: fence,
    data: { heartbeatAt: new Date(), progress: progressCell.progress, progressMessage: progressCell.message },
  }).catch(() => {})
}, HEARTBEAT_MS)

const ctx: JobHandlerContext = {
  jobId: job.id,
  attempt: job.attempts,
  signal: abort.signal,
  reportProgress: (progress, message) => {
    progressCell = {
      progress: progress == null ? null : Math.max(0, Math.min(100, Math.round(progress))),
      message: message ?? null,
    }
  },
}
```

`JobHandlerContext` (`lib/jobs/types.ts`) gains:
```ts
reportProgress: (progress: number | null, message: string | null) => void
```
Existing handlers ignore it (no behavior change). This is the generic seam that benefits `/admin/ops` for every job type.

**Progress lifecycle across claim/settle (Codex fix #2).** Progress must be cleared/finalized at every state transition so no stale value survives into `/admin/ops` or a re-claim:
- **Claim** (`claimNext`): reset so attempt 2 doesn't show attempt 1's numbers — add `progress: null, progressMessage: null` to the claim `updateMany` data:
  ```ts
  data: { status: 'running', attempts: { increment: 1 }, startedAt: new Date(), heartbeatAt: new Date(),
          progress: null, progressMessage: null },
  ```
- **Successful settle:** `{ status: 'complete', completedAt, progress: 100, progressMessage: null }` (a completed job reads 100% in `/admin/ops`).
- **Retry re-queue:** `{ status: 'queued', …, progress: null, progressMessage: null }` (a waiting-to-retry row shows no progress).
- **Final error:** `{ status: 'error', lastError, …, progress: null, progressMessage: null }` (clear — the failure lives in `lastError`, not a frozen bar).

All three settle writes are already fenced with the same `fence`; add the columns to their existing `data`.

### 3.3 `broken-link-verify` — receive ctx + report progress

**Registration currently drops ctx** (`handler: (payload) => runBrokenLinkVerify(payload)`). Change to forward it:
```ts
handler: (payload, ctx) => runBrokenLinkVerify(payload, undefined, ctx),
```
Signature becomes `runBrokenLinkVerify(payload, deps = productionDeps, ctx?: JobHandlerContext)`. `ctx` optional so the existing tests (which call `runBrokenLinkVerify(payload, stubDeps)`) keep compiling; when absent, `report` is a no-op.

**Live counter (Codex fix #3).** The existing `checked` variable is derived in a post-`Promise.all` loop over `toCheck` — it is **not** live during resolution and cannot drive progress. Add a shared `let resolvedCount = 0` incremented **inside `cacheWorker`** after each target resolves or degrades (single-threaded JS makes the shared increment safe between awaits), and report from `resolvedCount`. `allToResolve` is the denominator — it includes validation-only canonical/hreflang targets alongside link/image targets, so the copy is "Checked X/Y links" as a deliberate loose label (validation targets counted as part of the resolution set); the number is honest even if "links" is slightly generous.

**Phase model (avoids "bar stuck at 100% while still writing" — Codex fix).** The job's dominant cost is network resolution; the build+write phase is fast but non-trivial. Map progress so it never reaches 100 *inside the handler* — **done is signalled by the run appearing (`liveScanRunId`), not by handler `progress`**. (The worker sets `progress:100` only at successful settle, per §3.2, i.e. after the run is already written.) Concretely:
- Internal/validation resolution loop: `progress = floor(resolvedCount / allToResolve.length * 90)`, `message = "Checked ${resolvedCount}/${allToResolve.length} links"`. `report` is called inside `cacheWorker`; the heartbeat is the only DB writer so there is no per-target write.
- External-link pass: `message = "Checking external links…"`, progress held ~90.
- Finalizing (findings build + `CrawlRun` write + transient delete): `report(95, "Building SEO report…")`.
- The job then completes and the run exists → every reader flips to **done** via `liveScanRunId`. The bar visibly fills to ~95 % then resolves to the results link — it never sits pegged at 100 while work continues.

Reporting is best-effort and must never throw into the resolution loop.

### 3.4 Shared state classifier — `lib/ada-audit/seo-phase.ts`

One source of truth used by **both** the ADA page (server component) and the API route.

```ts
export type SeoPhaseState = 'done' | 'running' | 'queued' | 'failed' | 'unavailable'
export interface SeoPhase {
  state: SeoPhaseState
  progress: number | null   // 0-100 when running, else null
  message: string | null    // progressMessage when running, else null
}

// Pure classifier (unit-testable, no DB):
export function classifySeoPhase(input: {
  liveScanRunId: string | null
  job: { status: string; progress: number | null; progressMessage: string | null } | null
}): SeoPhase
```

Rules (precedence top-down):
1. `liveScanRunId` present → `{ state: 'done' }`. (Authoritative; wins over any Job row.)
2. else `job` is the **latest** `broken-link-verify` row in group `site-audit:<id>` (`orderBy createdAt desc, take 1`):
   - `running` → `{ state: 'running', progress: job.progress, message: job.progressMessage }`
   - `queued` → `{ state: 'queued' }`
   - `error` → `{ state: 'failed' }`
   - `complete` (but no run — anomaly: builder should always write a run, even empty-harvest) → `{ state: 'unavailable' }`
   - `cancelled` → `{ state: 'unavailable' }`
3. else (no run **and** no job — never enqueued, or error job pruned after 30 d) → `{ state: 'unavailable' }`.

**Avoid a duplicate run query (Codex fix #1).** Both callers already have the live-scan run id in hand (the API loads `crawlRuns` for `liveScanRunId`; the ADA page loads `liveScanRun`). So the classifier stays **pure** and the DB layer only adds the *job* lookup — never a second run query:
```ts
// job-only DB helper (the run id is already known by both callers):
export async function getLatestSeoVerifyJob(siteAuditId: string):
  Promise<{ status: string; progress: number | null; progressMessage: string | null } | null>
// = job.findFirst({ where: { type: 'broken-link-verify', groupKey: `site-audit:${siteAuditId}` },
//     orderBy: { createdAt: 'desc' }, select: { status, progress, progressMessage } })
```
`[groupKey,status]` and `[type,status]` are both indexed. A convenience `getSeoPhase(siteAuditId)` (does its own run lookup + job lookup + classify) exists for callers without a preloaded run id, but the API and ADA page use the split form (their known `liveScanRunId` + `getLatestSeoVerifyJob` + `classifySeoPhase`).

### 3.5 `GET /api/site-audit/[id]` — expose `seoPhase`

The route already loads `crawlRuns` (→ `liveScanRunId`). Add **only** the job lookup:
```ts
const seoPhase = classifySeoPhase({
  liveScanRunId: audit.crawlRuns[0]?.id ?? null,
  job: await getLatestSeoVerifyJob(audit.id),
})
```
Return `seoPhase` in the JSON and add it to the route's **inline** `satisfies SiteAuditDetail & {...}` extension — NOT to the shared `SiteAuditDetail` interface (other routes return it; a required new field would break them — Codex plan-review fix). `SeoScanForm` reads `d.seoPhase` off the parsed JSON, no shared-type dependency. `liveScanRunId` stays (what `SeoScanForm` reads for the results link, and the readiness source of truth). One extra indexed query per poll — acceptable (`SeoScanForm` polls at 2 s only while a scan is pending, and self-terminates on `ready`/`error`). Note: when `liveScanRunId` is present the classifier returns `done` **without** consulting the job, so the job lookup can be skipped in that branch (short-circuit before the `await`).

### 3.6 ADA site page — server-probe banner

In `app/(app)/ada-audit/site/[id]/page.tsx`, after loading `liveScanRun`, compute the phase from the already-known run id (split form, no duplicate query):
```ts
const seoPhase = classifySeoPhase({
  liveScanRunId: liveScanRun ? audit.id /* run exists */ : null,
  job: liveScanRun ? null : await getLatestSeoVerifyJob(audit.id),
})
```
(Since the page loads the run *object* not its id, "run exists" is the done signal — pass a non-null marker or refactor the select to include `id`.) Then:
- **`liveScanRun` present (state `done`, incl. empty-harvest):** render the SEO sections exactly as today. No change.
- **`liveScanRun` null:** render a single `<SeoPhaseBanner phase={seoPhase} />` **in place of the entire SEO section cluster** — `BrokenLinksSection`, `OnPageSeoSection`, `TechnicalSeoSection`, `DiscoveryCoverageSection`, `ReachabilitySection`, `ContentSimilaritySection` (six sections, each rendered once — Codex flagged a possible `ContentSimilaritySection` duplication; verified on origin/main @ 0d1d481 that it renders exactly once at line 240, no duplicate exists). All six read the same null run, so gating them as one block with a single ternary (`{liveScanRun ? <>…six sections…</> : <SeoPhaseBanner phase={seoPhase} />}`) guarantees no stray null-state section leaks outside the gate. The banner shows:
  - `running` → "SEO analysis running — checked X/Y" (from `progress`/`message`) + a **"Refresh"** link/hint (this page doesn't poll).
  - `queued` → "SEO analysis queued…" + refresh hint.
  - `failed` → "SEO analysis failed" (amber/red), suggest re-running.
  - `unavailable` → "SEO analysis not available for this audit" (neutral — covers pre-C6 audits, pruned-job, never-enqueued).

`SeoPhaseBanner` is a new server-rendered component (`components/site-audit/SeoPhaseBanner.tsx`), no client JS, full dark-mode variants. The ADA export bar + diff panel + `SiteAuditResultsView` (ADA results) still render normally — only the SEO section cluster is gated.

### 3.7 `SeoScanForm` — progress + terminal failure/stall

`SeoScanForm` already polls `GET /api/site-audit/[id]`. Switch its post-terminal phase derivation to `seoPhase.state`:
- audit not yet `complete` → keep "SEO scan running…" (the scan itself).
- audit `complete` + `seoPhase.state`:
  - `running`/`queued` → "Building SEO report…" **plus** a progress bar (`seoPhase.progress`) + `seoPhase.message` ("Checked X/Y links"). (Was a static pill; **fixes gap (e)** on this surface.)
  - `done` (`liveScanRunId` present) → "View SEO results →" link. (unchanged)
  - `failed` → terminal error: "SEO analysis failed — please try again." Stop polling, clear stored id. (**Fixes the infinite spin.**)
  - `unavailable` → terminal: "SEO analysis is unavailable for this scan." Stop polling, clear stored id.

Progress bar is a small inline element (orange fill on a neutral track), dark-mode variants, `mounted`-safe (no hydration mismatch — it's inside a `'use client'` component that only renders after the first poll).

---

## 4. Files touched

| File | Change |
|------|--------|
| `prisma/schema.prisma` | + `Job.progress`, `Job.progressMessage` |
| `prisma/migrations/<ts>_job_progress/migration.sql` | new (hand-authored, additive) |
| `lib/jobs/types.ts` | `JobHandlerContext.reportProgress` |
| `lib/jobs/worker.ts` | progress cell + heartbeat flush; claim resets progress |
| `lib/jobs/handlers/broken-link-verify.ts` | forward ctx in registration; `runBrokenLinkVerify(payload, deps, ctx?)`; report progress in the resolution loop + finalizing |
| `lib/ada-audit/seo-phase.ts` | new — `classifySeoPhase` (pure) + `getSeoPhase` (DB) |
| `app/api/site-audit/[id]/route.ts` | + `seoPhase` in GET response, added to the route's **inline** `satisfies` extension (shared `SiteAuditDetail` unchanged) |
| `app/(app)/ada-audit/site/[id]/page.tsx` | compute `getSeoPhase`; gate SEO sections vs `SeoPhaseBanner` |
| `components/site-audit/SeoPhaseBanner.tsx` | new — server-rendered status banner |
| `components/seo-parser/SeoScanForm.tsx` | consume `seoPhase`; progress bar + failed/unavailable terminals |

No middleware change (no new route; `GET /api/site-audit/[id]` is already auth-gated and `SeoScanForm` is an authed surface).

---

## 5. Testing

- `classifySeoPhase` (pure): every branch — done wins over job; running carries progress/message; queued; error→failed; complete-no-run→unavailable; cancelled→unavailable; no-job→unavailable.
- `getSeoPhase` (DB-backed): run present → done; running job → running with progress; error job → failed; nothing → unavailable.
- `worker`: heartbeat flushes `progress`/`progressMessage` from the cell under the fence; a stale-attempt row is **not** overwritten (fence mismatch); claim resets progress to null.
- `broken-link-verify`: stub `ctx.reportProgress`, assert it's called with monotonic non-decreasing progress and a "Checked X/Y" message during resolution, and "Building SEO report…" at finalize; job with no ctx still runs (no-op report).
- `GET /api/site-audit/[id]`: response includes `seoPhase` with the right state for run-present / job-running / no-job fixtures.
- `SeoPhaseBanner`: renders each state, dark-mode classes present.
- `SeoScanForm`: `failed`/`unavailable` stop the poll + clear storage; `running` renders the bar with counts; `done` renders the results link. (Extend existing `SeoScanForm.test.tsx`.)
- **Ctx fixtures (Codex fix #5):** adding `reportProgress` to `JobHandlerContext` will break any test that constructs a *typed* ctx object literal. Sweep for those and add `reportProgress: vi.fn()` (or a no-op). Runtime is unaffected — the worker owns ctx creation and `runBrokenLinkVerify(payload, deps, ctx?)` keeps `ctx` optional so existing `runBrokenLinkVerify(payload, stubDeps)` call sites compile unchanged.

Gates: `npx tsc --noEmit` (run `npx prisma generate` first — fresh worktree client may be stale), `DATABASE_URL="file:./local-dev.db" npm test`, `npm run build`.

---

## 6. Prod verification (post-deploy)

Authed Playwright against a **client** domain already in the system (never a third-party site). Trigger a `seoOnly` scan via the SEO toggle; watch `SeoScanForm` render "Building SEO report… checked X/Y" with a moving bar while `broken-link-verify` runs; confirm it flips to "View SEO results →" when `liveScanRunId` appears. Separately, open a **normal** completed site audit at `/ada-audit/site/[id]` immediately after terminal and confirm the `SeoPhaseBanner` shows "SEO analysis running …" (then, on refresh after ~40 s, the six sections). Prod URL: https://seo.erstaging.site.

---

## 7. Risks / edge cases

- **Heartbeat cadence vs UI poll cadence:** `HEARTBEAT_MS` is **15,000 ms** (`lib/jobs/config.ts`), the SeoScanForm poll is 2 s. So progress persists — and the bar visibly advances — in **~15 s steps**. For a 36 s-median / 55 s-p90 verify job that is only ~2–4 visible increments. Acceptable for v1 (the bar proves the phase is alive and roughly how far along); do **not** shorten the generic heartbeat for this (it would add DB write load across every job type). A dedicated faster progress write is a possible fast-follow if the stepping feels too coarse in prod. **This means a very fast/empty-harvest scan may jump queued→done with 0–1 progress ticks** — the UI must handle "done with no intermediate progress" gracefully (it does: `done` is driven by `liveScanRunId`, not by the bar reaching any value).
- **Failed-state copy:** the `failed`/`SeoPhaseBanner` states show a **generic** message in v1, not `Job.lastError` (avoid leaking internal error text to the operator surface; `lastError` stays in logs / `/admin/ops`). Revisit if operators need the reason inline.
- **`complete`-but-no-run anomaly** classified as `unavailable` (not `done`) — correct-fails-safe; the builder is designed to always write a run (empty-harvest included), so this is a real anomaly worth surfacing as "unavailable" rather than pretending done.
- **Retention:** an audit whose verify errored >30 d ago (job pruned) shows `unavailable`, not `failed`. Acceptable — the distinction is only interesting while fresh.
- **Non-seoOnly audits still hit `broken-link-verify`** — the ADA banner covers them; the two surfaces share `getSeoPhase`.
- **Best-effort progress:** `reportProgress` must never throw into the handler; the heartbeat write is already `.catch(() => {})`.
