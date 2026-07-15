# C17 — Scan-Progress Maturation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make seoOnly scan progress live end-to-end (crawl → verifier sub-phase → auto-navigate to results with zero clicks) and give the unified recents table live in-flight rows via a compact status endpoint — never re-fetching the whole merged history on a poll tick.

**Codex review (2026-07-08): accept with named fixes ×6, all applied in place:**
1. Finalizer flip→enqueue race fixed with a backend grace window in `classifySeoPhase` (self-healing-via-refresh was NOT guaranteed — terminal-on-mount and refresh-still-sees-no-job both strand the UI) → Task 3, threaded through Tasks 7–8.
2. Mini progress display in recents rows (phase label + bounded numeric progress in the compact contract, small bar when numeric progress exists) → Tasks 8, 10.
3. Client polled-key set deduped/sorted/capped at `RECENTS_STATUS_MAX_IDS` before building the key (ids beyond the endpoint cap would read as "deleted" → refetch loop) → Task 9.
4. `onSettled` fires once per settled key (notified-set inside the effect; a settle-refetch returning the same in-flight set must not re-notify every 8 s) → Task 9.
5. Stable mocked router object in poller tests (a fresh `{refresh}` per `useRouter()` call restarts the hook's effect on every render) + `act()` around manually resolved fetches → Tasks 1, 5.
6. `vi.useRealTimers()` in the RecentsTable suite `afterEach` (per-test cleanup leaks fake timers on assertion failure) + `waitFor` over fixed microtask counts → Task 10.

**Architecture:** Five seams. (1) `useAuditPoller` grows an explicit terminal *outcome*: `onTerminal` may return `{ redirect }`, which makes the hook `router.replace()` instead of its unconditional `router.refresh()` — a single navigation owner, never both. (2) `classifySeoPhase` gains an enqueue grace window: `complete` + no run + no job within `SEO_PHASE_ENQUEUE_GRACE_MS` of `completedAt` classifies as `queued`, not `unavailable` — covering both the finalizer's fire-and-forget enqueue gap and the ≤10-min crash-recovery re-enqueue. (3) `SiteAuditPoller` becomes seoOnly-aware via a pure synthetic-status derivation (`deriveSeoOnlyStatus`): parent `complete` maps to non-terminal `seo-verifying` while the verifier runs, and to terminal `seo-ready`/`seo-failed`/`seo-unavailable` otherwise; on `seo-ready` it returns the redirect outcome pointing at `/seo-audits/results/run/[id]`; the seoOnly complete branch of `/ada-audit/site/[id]` renders this live poller instead of the static `SeoPhaseBanner`. (4) `RecentItem` grows a server-computed `inFlight` flag; (5) a compact batch endpoint `GET /api/ada-audit/recents/status?ids=type:id,…` returns status/score/href/progress for ≤50 requested rows with **zero blob parses**, and a `useRecentsLivePoll` hook in `RecentsTable` polls it every 8 s for the visible in-flight rows only, refetching the merged list once when something settles.

**Tech Stack:** Next.js 15 App Router, React 18 client components, Prisma + SQLite, vitest (+ @testing-library/react jsdom for hooks/components, mocked-prisma harness for query libs).

**Spec:** `docs/superpowers/specs/2026-07-08-audit-consolidation-batch-design.md` §P2 (Codex-reviewed ×12; decisions settled — do not re-litigate).

## Global Constraints

- **No schema changes.** C17 is read/UI-layer only — no migration, no new env vars, no deploy-time Kevin steps.
- **Single navigation owner (spec Codex fix #8):** on a terminal poll exactly ONE of `router.refresh()` or `router.replace(href)` fires — never both, never racing.
- **seoOnly terminal semantics (spec Codex fix #8):** parent `status==='complete'` is NON-terminal while `seoPhase` is queued/running; polling stops only on run-ready (`liveScanRunId` present), failed, or unavailable. `unavailable` is only assigned server-side AFTER the enqueue grace window (plan Codex fix #1). Non-seoOnly poller behavior is byte-for-byte unchanged.
- **Recents polling (spec Codex fix #9):** the compact endpoint must not parse any legacy blob (`AdaAudit.result`, `SiteAudit.summary`, `Session.result`) — score comes from `CrawlRun.score` or is null. The full merged recents query (`fetchAllRecents`) is treated as expensive and is re-run only when an in-flight row settles. Polling stops when nothing visible is in flight.
- **Single-page audits untouched:** `AuditPoller.tsx` behavior unchanged (already granular at 1 s).
- The new API route is cookie-gated by default — NO `middleware.ts` `isPublicPath` entry (it is not public or token-authed).
- Client bundles must not import server modules: `lib/ada-audit/seo-phase.ts`, `recents-query.ts`, and `recents-status.ts` import prisma — client files may `import type` from them but any VALUE import must come from the client-safe `recents-status-shared.ts` (Task 8) or `components/ada-audit/seo-poll-status.ts` (Task 2).
- UI: Tailwind `dark:` variants on every element; no hydration-mismatch patterns; new classes reachable by content globs.
- Poll cadences: site-audit page 3000 ms (existing), recents live rows 8000 ms (matches the retired `SiteAuditHistory` smart-poll).
- Test harnesses: hooks/components use `// @vitest-environment jsdom` + `@testing-library/react` + fake timers (pattern: `components/ada-audit/useAuditPoller.test.ts`); query-lib tests use the mocked-prisma pattern (`lib/ada-audit/recents-query.test.ts`). No jest-dom matchers. Mocked routers are a SINGLE stable object (plan Codex fix #5).
- Branch: `feat/c17-scan-progress`. Commit per task. Never `git add -A` at repo root.

---

### Task 1: `useAuditPoller` — explicit redirect terminal outcome

**Files:**
- Modify: `components/ada-audit/useAuditPoller.ts`
- Test: `components/ada-audit/useAuditPoller.test.ts`

**Interfaces:**
- Produces: `type TerminalOutcome = { redirect: string } | void` and `onTerminal?: (data: T) => TerminalOutcome`. When `onTerminal` returns `{ redirect }`, the hook calls `router.replace(redirect)` and does NOT call `router.refresh()`. Void return (all existing callers) keeps the exact current behavior: `onTerminal` then one `refresh()`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

In `components/ada-audit/useAuditPoller.test.ts`, replace the router mock with a STABLE object exposing both methods (plan Codex fix #5 — a fresh object per `useRouter()` call would churn the hook's `router` effect dep):

```ts
const refresh = vi.fn()
const replace = vi.fn()
const router = { refresh, replace }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
```

(also add `replace.mockClear()` next to `refresh.mockClear()` in `beforeEach`), then add two tests:

```ts
  it('onTerminal returning {redirect} calls router.replace once and suppresses refresh', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    const onTerminal = vi.fn(() => ({ redirect: '/seo-audits/results/run/r1' }))
    renderHook(() => useAuditPoller(args({ onTerminal })))
    await vi.advanceTimersByTimeAsync(1000)
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await flushAsync()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/seo-audits/results/run/r1')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('overlapping terminal responses with redirect navigate once', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    const onTerminal = vi.fn(() => ({ redirect: '/seo-audits/results/run/r1' }))
    renderHook(() => useAuditPoller(args({ onTerminal })))
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await flushAsync()
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await flushAsync()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run components/ada-audit/useAuditPoller.test.ts`
Expected: the two new tests FAIL (`replace` never called — the hook always refreshes); the seven existing tests PASS.

- [ ] **Step 3: Implement the outcome**

In `components/ada-audit/useAuditPoller.ts`:

```ts
/** Returned by onTerminal to make the hook navigate instead of refresh.
 *  Void → the historical behavior (one router.refresh()). Exactly one of
 *  replace/refresh ever fires per instance (C17 single navigation owner). */
export type TerminalOutcome = { redirect: string } | void
```

Change the arg type:

```ts
  /** Called once, on the terminal poll. Return { redirect } to router.replace()
   *  there INSTEAD of the default router.refresh(). */
  onTerminal?: (data: T) => TerminalOutcome
```

And the terminal block inside the interval callback becomes:

```ts
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
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run components/ada-audit/useAuditPoller.test.ts`
Expected: all 9 PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/useAuditPoller.ts components/ada-audit/useAuditPoller.test.ts
git commit -m "feat(poller): useAuditPoller onTerminal may return a redirect outcome (C17)"
```

---

### Task 2: `deriveSeoOnlyStatus` — pure synthetic-status derivation

**Files:**
- Create: `components/ada-audit/seo-poll-status.ts`
- Test: `components/ada-audit/seo-poll-status.test.ts`

**Interfaces:**
- Produces:
  - `deriveSeoOnlyStatus(status: string, liveScanRunId: string | null, seoPhaseState: SeoPhaseState | null | undefined): string` — non-`complete` statuses pass through verbatim; `complete` maps to `'seo-ready'` (run present), `'seo-failed'`, `'seo-unavailable'`, or `'seo-verifying'` (queued/running/undefined phase).
  - `isSeoOnlyTerminal(s: string): boolean` — true for `'seo-ready' | 'seo-failed' | 'seo-unavailable' | 'error' | 'cancelled'`.
- Consumes: `import type { SeoPhaseState } from '@/lib/ada-audit/seo-phase'` — **type-only import** (that module imports prisma; a value import would drag server code into the client bundle; precedent: `SeoPhaseBanner.tsx`).

- [ ] **Step 1: Write the failing tests**

`components/ada-audit/seo-poll-status.test.ts` (node env — pure function, no jsdom pragma needed):

```ts
import { describe, it, expect } from 'vitest'
import { deriveSeoOnlyStatus, isSeoOnlyTerminal } from './seo-poll-status'

describe('deriveSeoOnlyStatus', () => {
  it('passes non-complete statuses through verbatim', () => {
    for (const s of ['queued', 'pending', 'running', 'error', 'cancelled']) {
      expect(deriveSeoOnlyStatus(s, null, null)).toBe(s)
    }
  })

  it('complete + run present → seo-ready (run wins over any phase)', () => {
    expect(deriveSeoOnlyStatus('complete', 'run1', 'failed')).toBe('seo-ready')
    expect(deriveSeoOnlyStatus('complete', 'run1', null)).toBe('seo-ready')
  })

  it('complete + no run maps the verifier phase', () => {
    expect(deriveSeoOnlyStatus('complete', null, 'queued')).toBe('seo-verifying')
    expect(deriveSeoOnlyStatus('complete', null, 'running')).toBe('seo-verifying')
    expect(deriveSeoOnlyStatus('complete', null, 'failed')).toBe('seo-failed')
    expect(deriveSeoOnlyStatus('complete', null, 'unavailable')).toBe('seo-unavailable')
  })

  it('complete + no run + unknown phase (first poll not landed) → seo-verifying', () => {
    expect(deriveSeoOnlyStatus('complete', null, null)).toBe('seo-verifying')
    expect(deriveSeoOnlyStatus('complete', null, undefined)).toBe('seo-verifying')
  })
})

describe('isSeoOnlyTerminal', () => {
  it('terminal set is seo-ready/seo-failed/seo-unavailable/error/cancelled', () => {
    for (const s of ['seo-ready', 'seo-failed', 'seo-unavailable', 'error', 'cancelled']) {
      expect(isSeoOnlyTerminal(s)).toBe(true)
    }
    for (const s of ['complete', 'seo-verifying', 'running', 'queued', 'pending']) {
      expect(isSeoOnlyTerminal(s)).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/ada-audit/seo-poll-status.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`components/ada-audit/seo-poll-status.ts`:

```ts
// C17: client-safe synthetic status for seoOnly audits. The parent SiteAudit
// flips to 'complete' exactly when the verifier phase BEGINS (spec Codex fix
// #8) — so for polling purposes 'complete' is remapped by run-readiness and
// verifier phase. The finalizer's flip→enqueue race is handled SERVER-side:
// classifySeoPhase only reports 'unavailable' after the enqueue grace window
// (plan Codex fix #1) — this mapping trusts the state it is given.
// Type-only import: lib/ada-audit/seo-phase imports prisma.
import type { SeoPhaseState } from '@/lib/ada-audit/seo-phase'

export function deriveSeoOnlyStatus(
  status: string,
  liveScanRunId: string | null,
  seoPhaseState: SeoPhaseState | null | undefined,
): string {
  if (status !== 'complete') return status
  if (liveScanRunId) return 'seo-ready'
  switch (seoPhaseState) {
    case 'failed':
      return 'seo-failed'
    case 'unavailable':
      return 'seo-unavailable'
    default:
      return 'seo-verifying' // queued | running | unknown-yet
  }
}

export function isSeoOnlyTerminal(s: string): boolean {
  return (
    s === 'seo-ready' ||
    s === 'seo-failed' ||
    s === 'seo-unavailable' ||
    s === 'error' ||
    s === 'cancelled'
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/ada-audit/seo-poll-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/seo-poll-status.ts components/ada-audit/seo-poll-status.test.ts
git commit -m "feat(poller): pure seoOnly synthetic-status derivation (C17)"
```

---

### Task 3: `classifySeoPhase` enqueue grace window (plan Codex fix #1)

**Files:**
- Modify: `lib/ada-audit/seo-phase.ts`
- Modify: `app/api/site-audit/[id]/route.ts:106`
- Modify: `app/(app)/ada-audit/site/[id]/page.tsx:143,226` (pass `completedAt` at both `classifySeoPhase` call sites)
- Test: `lib/ada-audit/seo-phase.test.ts`

**Interfaces:**
- Produces: `export const SEO_PHASE_ENQUEUE_GRACE_MS = 12 * 60_000` and an extended pure signature:
  `classifySeoPhase(input: { liveScanRunId: string | null; job: VerifyJob | null; completedAt?: Date | null; now?: Date }): SeoPhase`.
  New rule: no run + **no job** + `completedAt` within the grace window → `{ state: 'queued' }` (verifier not enqueued YET, or awaiting crash recovery); outside the window (or no `completedAt`) → `unavailable` as today. All job-present branches unchanged. `getSeoPhase(siteAuditId, completedAt?)` forwards the new field.
- Consumes: nothing new. Tasks 7–8 reuse `SEO_PHASE_ENQUEUE_GRACE_MS` for recents `inFlight`.

**Why 12 minutes:** the finalizer enqueues the verifier fire-and-forget AFTER flipping `complete`; a crashed enqueue is re-created by `recoverBrokenLinkVerifies()` on boot and by the 10-minute `stale-audit-reset` tick. 12 min covers one full recovery cycle, so "no job yet" within it means "wait", not "dead". A genuinely dead audit (job row pruned, pre-C6, etc.) has an old `completedAt` and classifies `unavailable` immediately.

- [ ] **Step 1: Write the failing tests**

Add to `lib/ada-audit/seo-phase.test.ts` (pure `classifySeoPhase` cases — match the file's existing style):

```ts
  it('no job within the enqueue grace window classifies as queued', () => {
    const completedAt = new Date('2026-07-08T10:00:00Z')
    const now = new Date(completedAt.getTime() + 60_000) // 1 min later
    expect(classifySeoPhase({ liveScanRunId: null, job: null, completedAt, now }))
      .toEqual({ state: 'queued', progress: null, message: null })
  })

  it('no job past the grace window classifies as unavailable', () => {
    const completedAt = new Date('2026-07-08T10:00:00Z')
    const now = new Date(completedAt.getTime() + SEO_PHASE_ENQUEUE_GRACE_MS + 1)
    expect(classifySeoPhase({ liveScanRunId: null, job: null, completedAt, now }).state)
      .toBe('unavailable')
  })

  it('no job with no completedAt stays unavailable (legacy rows)', () => {
    expect(classifySeoPhase({ liveScanRunId: null, job: null }).state).toBe('unavailable')
    expect(classifySeoPhase({ liveScanRunId: null, job: null, completedAt: null }).state).toBe('unavailable')
  })

  it('a run or a job wins over the grace window', () => {
    const completedAt = new Date()
    expect(classifySeoPhase({ liveScanRunId: 'r1', job: null, completedAt }).state).toBe('done')
    expect(
      classifySeoPhase({
        liveScanRunId: null,
        job: { status: 'error', progress: null, progressMessage: null },
        completedAt,
      }).state,
    ).toBe('failed')
  })
```

(import `SEO_PHASE_ENQUEUE_GRACE_MS` alongside `classifySeoPhase` at the top of the test file.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run lib/ada-audit/seo-phase.test.ts`
Expected: grace tests FAIL (`queued` expected, `unavailable` returned; constant not exported).

- [ ] **Step 3: Implement**

In `lib/ada-audit/seo-phase.ts`:

```ts
// C17 (plan Codex fix #1): the finalizer enqueues broken-link-verify
// fire-and-forget AFTER the complete flip, and a crashed enqueue is
// re-created by recoverBrokenLinkVerifies (boot + the 10-min
// stale-audit-reset tick). Within this window a missing job means
// "not enqueued yet", not "never ran" — classify queued, keep pollers alive.
export const SEO_PHASE_ENQUEUE_GRACE_MS = 12 * 60_000

/** Pure. liveScanRunId present == SEO phase done, regardless of any Job row. */
export function classifySeoPhase(input: {
  liveScanRunId: string | null
  job: VerifyJob | null
  completedAt?: Date | null
  now?: Date
}): SeoPhase {
  if (input.liveScanRunId) return { state: 'done', progress: null, message: null }
  const job = input.job
  if (!job) {
    const completedAt = input.completedAt ?? null
    const now = input.now ?? new Date()
    if (completedAt && now.getTime() - completedAt.getTime() < SEO_PHASE_ENQUEUE_GRACE_MS) {
      return { state: 'queued', progress: null, message: null }
    }
    return { state: 'unavailable', progress: null, message: null }
  }
  switch (job.status) {
    // …existing branches unchanged…
  }
}
```

`getSeoPhase` forwards it:

```ts
export async function getSeoPhase(siteAuditId: string, completedAt?: Date | null): Promise<SeoPhase> {
  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
    select: { id: true },
  })
  if (run) return { state: 'done', progress: null, message: null }
  return classifySeoPhase({ liveScanRunId: null, job: await getLatestSeoVerifyJob(siteAuditId), completedAt })
}
```

Caller updates (mechanical — add the field):
- `app/api/site-audit/[id]/route.ts:106`: `classifySeoPhase({ liveScanRunId: null, job: await getLatestSeoVerifyJob(audit.id), completedAt: audit.completedAt })`
- `app/(app)/ada-audit/site/[id]/page.tsx:143` (seoOnly branch) and `:226` (full-audit complete branch): add `completedAt: audit.completedAt` the same way.

- [ ] **Step 4: Run tests + type-check**

Run: `npx vitest run lib/ada-audit/seo-phase.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo-phase.ts lib/ada-audit/seo-phase.test.ts app/api/site-audit/[id]/route.ts "app/(app)/ada-audit/site/[id]/page.tsx"
git commit -m "feat(site-audit): verifier enqueue grace window in classifySeoPhase (C17, Codex fix 1)"
```

---

### Task 4: `SeoPhaseBanner` live variant

**Files:**
- Modify: `components/site-audit/SeoPhaseBanner.tsx`
- Test: `components/site-audit/SeoPhaseBanner.test.tsx` (new)

**Interfaces:**
- Produces: `SeoPhaseBanner({ phase, live }: { phase: SeoPhase; live?: boolean })`. `live` (default false) swaps the active-state hint line "This runs after the audit completes. Refresh this page to see the latest status." for "This updates automatically — results will open when they're ready." All existing call sites (server-rendered, static) pass no `live` and are unchanged.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

`components/site-audit/SeoPhaseBanner.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { SeoPhaseBanner } from './SeoPhaseBanner'

afterEach(cleanup)

describe('SeoPhaseBanner', () => {
  it('static (default) active state keeps the refresh hint', () => {
    render(<SeoPhaseBanner phase={{ state: 'running', progress: 40, message: 'Checking links…' }} />)
    expect(screen.getByText(/Refresh this page/i)).toBeTruthy()
  })

  it('live active state says it updates automatically', () => {
    render(<SeoPhaseBanner phase={{ state: 'running', progress: 40, message: 'Checking links…' }} live />)
    expect(screen.getByText(/updates automatically/i)).toBeTruthy()
    expect(screen.queryByText(/Refresh this page/i)).toBeNull()
  })

  it('done renders nothing in both modes', () => {
    const { container } = render(<SeoPhaseBanner phase={{ state: 'done', progress: null, message: null }} live />)
    expect(container.innerHTML).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/site-audit/SeoPhaseBanner.test.tsx`
Expected: the `live` test FAILS (prop ignored, refresh hint rendered).

- [ ] **Step 3: Implement**

In `SeoPhaseBanner.tsx`, change the signature and the hint block:

```tsx
export function SeoPhaseBanner({ phase, live = false }: { phase: SeoPhase; live?: boolean }) {
```

```tsx
      {isActive && (
        <p className="mt-3 text-[12px] font-body text-navy/40 dark:text-white/40">
          {live
            ? 'This updates automatically — results will open when they’re ready.'
            : 'This runs after the audit completes. Refresh this page to see the latest status.'}
        </p>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/site-audit/SeoPhaseBanner.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/site-audit/SeoPhaseBanner.tsx components/site-audit/SeoPhaseBanner.test.tsx
git commit -m "feat(site-audit): SeoPhaseBanner live variant copy (C17)"
```

---

### Task 5: `SiteAuditPoller` — seoOnly verifier phase + auto-navigation

**Files:**
- Modify: `components/ada-audit/SiteAuditPoller.tsx`
- Test: `components/ada-audit/SiteAuditPoller.test.tsx` (new)

**Interfaces:**
- Consumes: Task 1's `TerminalOutcome`, Task 2's `deriveSeoOnlyStatus`/`isSeoOnlyTerminal`, Task 4's `SeoPhaseBanner live`.
- Produces: new optional props on `SiteAuditPoller`:
  ```ts
  seoOnly?: boolean                       // default false — non-seoOnly path unchanged
  initialLiveScanRunId?: string | null    // banner-branch mount: null
  initialSeoPhase?: SeoPhase | null       // banner-branch mount: server-computed phase
  ```
  `PollData` grows `seoOnly?: boolean; liveScanRunId?: string | null; seoPhase?: SeoPhase` (all already returned by `GET /api/site-audit/[id]`). Task 6 (the page) relies on exactly these prop names.

- [ ] **Step 1: Write the failing tests**

`components/ada-audit/SiteAuditPoller.test.tsx` — reuse the manual-resolution fetch mock and fake-timer pattern from `useAuditPoller.test.ts`; stable router object + `act()` around manual resolution (plan Codex fix #5):

```tsx
// @vitest-environment jsdom
import { render, screen, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import SiteAuditPoller from './SiteAuditPoller'

const refresh = vi.fn()
const replace = vi.fn()
const router = { refresh, replace }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

function makeFetch() {
  const pending: Array<{ resolve: (v: { ok: boolean; body?: unknown }) => void }> = []
  const fn = vi.fn(
    () =>
      new Promise((resolve) => {
        pending.push({ resolve: (v) => resolve({ ok: v.ok, json: async () => v.body } as Response) })
      }),
  )
  return {
    fn,
    async resolveNext(v: { ok: boolean; body?: unknown }) {
      const p = pending.shift()
      if (!p) throw new Error('no pending fetch')
      await act(async () => {
        p.resolve(v)
        await flushAsync()
      })
    },
  }
}

// Minimal poll payload — counters zero (seoOnly audits have no pdf/LH work).
const poll = (over: Record<string, unknown> = {}) => ({
  status: 'running',
  pagesTotal: 4, pagesComplete: 1, pagesError: 0,
  queuePosition: null, activeAudit: null,
  ...over,
})

beforeEach(() => {
  vi.useFakeTimers()
  refresh.mockClear()
  replace.mockClear()
})
afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SiteAuditPoller seoOnly', () => {
  it('renders the verifier phase when parent completes without a run (no dead gap, no navigation)', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    render(
      <SiteAuditPoller id="s1" seoOnly initialStatus="running"
        initialPagesTotal={4} initialPagesComplete={1} initialPagesError={0} />,
    )
    await vi.advanceTimersByTimeAsync(3000)
    await f.resolveNext({ ok: true, body: poll({
      status: 'complete', pagesComplete: 4, seoOnly: true, liveScanRunId: null,
      seoPhase: { state: 'running', progress: 40, message: 'Checking links…' },
    }) })
    expect(screen.getByText('SEO analysis running')).toBeTruthy()
    expect(screen.getByText('Checking links…')).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('navigates to the run page exactly once when the run lands, without refresh', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    render(
      <SiteAuditPoller id="s1" seoOnly initialStatus="complete"
        initialLiveScanRunId={null}
        initialSeoPhase={{ state: 'running', progress: 80, message: 'Building results…' }}
        initialPagesTotal={4} initialPagesComplete={4} initialPagesError={0} />,
    )
    await vi.advanceTimersByTimeAsync(3000)
    await f.resolveNext({ ok: true, body: poll({
      status: 'complete', pagesComplete: 4, seoOnly: true, liveScanRunId: 'run9',
      seoPhase: { state: 'done', progress: null, message: null },
    }) })
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/seo-audits/results/run/run9')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('mounted with a failed phase is inert (no fetch) and shows the failed banner', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    render(
      <SiteAuditPoller id="s1" seoOnly initialStatus="complete"
        initialLiveScanRunId={null}
        initialSeoPhase={{ state: 'failed', progress: null, message: null }}
        initialPagesTotal={4} initialPagesComplete={4} initialPagesError={0} />,
    )
    await vi.advanceTimersByTimeAsync(6000)
    expect(f.fn).not.toHaveBeenCalled()
    expect(screen.getByText('SEO analysis failed')).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('failed phase reached VIA polling refreshes once (server re-renders the static failed banner)', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    render(
      <SiteAuditPoller id="s1" seoOnly initialStatus="complete"
        initialLiveScanRunId={null}
        initialSeoPhase={{ state: 'queued', progress: null, message: null }}
        initialPagesTotal={4} initialPagesComplete={4} initialPagesError={0} />,
    )
    await vi.advanceTimersByTimeAsync(3000)
    await f.resolveNext({ ok: true, body: poll({
      status: 'complete', pagesComplete: 4, seoOnly: true, liveScanRunId: null,
      seoPhase: { state: 'failed', progress: null, message: null },
    }) })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('SiteAuditPoller non-seoOnly (regression)', () => {
  it('complete is terminal → one refresh, no replace', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    render(
      <SiteAuditPoller id="s2" initialStatus="running"
        initialPagesTotal={4} initialPagesComplete={3} initialPagesError={0} />,
    )
    await vi.advanceTimersByTimeAsync(3000)
    await f.resolveNext({ ok: true, body: poll({ status: 'complete', pagesComplete: 4 }) })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/ada-audit/SiteAuditPoller.test.tsx`
Expected: seoOnly tests FAIL (unknown props are ignored; `complete` is terminal today so the first test refreshes instead of rendering the verifier phase). The non-seoOnly regression test PASSES already.

- [ ] **Step 3: Implement**

In `components/ada-audit/SiteAuditPoller.tsx`:

Imports:

```tsx
import type { SeoPhase } from '@/lib/ada-audit/seo-phase'
import { SeoPhaseBanner } from '@/components/site-audit/SeoPhaseBanner'
import { deriveSeoOnlyStatus, isSeoOnlyTerminal } from './seo-poll-status'
```

`PollData` additions:

```ts
  seoOnly?: boolean
  liveScanRunId?: string | null
  seoPhase?: SeoPhase
```

`Props` additions:

```ts
  seoOnly?: boolean
  initialLiveScanRunId?: string | null
  initialSeoPhase?: SeoPhase | null
```

Component body — new state + hook wiring (only the changed parts shown; everything else stays):

```tsx
export default function SiteAuditPoller({
  id,
  initialStatus,
  initialPagesTotal,
  initialPagesComplete,
  initialPagesError,
  seoOnly = false,
  initialLiveScanRunId = null,
  initialSeoPhase = null,
}: Props) {
  // …existing state…
  const [liveScanRunId, setLiveScanRunId] = useState<string | null>(initialLiveScanRunId)
  const [seoPhase, setSeoPhase] = useState<SeoPhase | null>(initialSeoPhase)

  // C17: seoOnly audits keep polling through parent 'complete' — the verifier
  // sub-phase runs after the crawl (spec Codex fix #8). The synthetic status
  // makes 'complete' non-terminal until run-ready/failed/unavailable.
  const initialSynthetic = seoOnly
    ? deriveSeoOnlyStatus(initialStatus, initialLiveScanRunId, initialSeoPhase?.state ?? null)
    : initialStatus

  useAuditPoller<PollData>({
    url: `/api/site-audit/${id}`,
    intervalMs: 3000,
    initialStatus: initialSynthetic,
    getStatus: (d) =>
      seoOnly ? deriveSeoOnlyStatus(d.status, d.liveScanRunId ?? null, d.seoPhase?.state ?? null) : d.status,
    isTerminal: (s) =>
      seoOnly ? isSeoOnlyTerminal(s) : s === 'complete' || s === 'error' || s === 'cancelled',
    onData: (data) => {
      // …existing setters unchanged…
      setLiveScanRunId(data.liveScanRunId ?? null)
      setSeoPhase(data.seoPhase ?? null)
    },
    onTerminal: (data) => {
      // Single navigation owner: run-ready redirects (replace), every other
      // terminal falls through to the hook's refresh (server re-renders the
      // static failed/unavailable banner or the error/cancelled card).
      if (seoOnly && data.liveScanRunId) {
        return { redirect: `/seo-audits/results/run/${data.liveScanRunId}` }
      }
    },
  })
```

Rendering — insert BEFORE the existing `isQueued` block, using the render-time synthetic:

```tsx
  const synthetic = seoOnly
    ? deriveSeoOnlyStatus(status, liveScanRunId, seoPhase?.state ?? null)
    : status

  // C17: seoOnly post-crawl states own the whole card. 'seo-ready' shows a
  // brief opening notice while router.replace() lands.
  if (seoOnly && synthetic.startsWith('seo-')) {
    if (synthetic === 'seo-ready') {
      return (
        <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-8 flex items-center gap-3">
          <Spinner className="w-5 h-5 text-orange flex-shrink-0" />
          <p className="font-display font-bold text-[17px] text-navy dark:text-white">Opening SEO results…</p>
        </div>
      )
    }
    return (
      <SeoPhaseBanner
        phase={seoPhase ?? { state: 'queued', progress: null, message: null }}
        live={synthetic === 'seo-verifying'}
      />
    )
  }
```

(`synthetic` for a seoOnly audit in crawl phase is the raw transient status, so the existing queued/running cards keep rendering untouched; the `liveChildren` table below also keeps its current condition.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/ada-audit/SiteAuditPoller.test.tsx components/ada-audit/useAuditPoller.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/SiteAuditPoller.tsx components/ada-audit/SiteAuditPoller.test.tsx
git commit -m "feat(site-audit): SiteAuditPoller surfaces seoOnly verifier phase + auto-navigates on run-ready (C17)"
```

---

### Task 6: `/ada-audit/site/[id]` page wiring — live banner branch

**Files:**
- Modify: `app/(app)/ada-audit/site/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 5's `SiteAuditPoller` props (`seoOnly`, `initialLiveScanRunId`, `initialSeoPhase`); Task 3 already added `completedAt` to this page's `classifySeoPhase` calls.
- Produces: no new exports. `resolveSeoOnlyView` and branch ORDER are untouched (seoOnly branch stays BEFORE the ADA summary resolution — C16 Codex fix #4 invariant).

- [ ] **Step 1: Wire the transient branch**

In the queued/pending/running/pdfs-running/lighthouse-running branch, pass the flag through:

```tsx
        <SiteAuditPoller
          id={id}
          initialStatus={audit.status}
          initialPagesTotal={audit.pagesTotal}
          initialPagesComplete={audit.pagesComplete}
          initialPagesError={audit.pagesError}
          seoOnly={audit.seoOnly}
        />
```

- [ ] **Step 2: Make the seoOnly complete (banner) branch live**

Replace the static `<SeoPhaseBanner phase={seoPhase} />` render with the poller (which renders the same banner, live, and auto-navigates), and drop the now-false "Reload to check progress." copy:

```tsx
  if (audit.seoOnly) {
    const liveRun = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId: audit.id, tool: 'seo-parser' } },
      select: { id: true },
    })
    const view = resolveSeoOnlyView(audit, liveRun?.id ?? null)
    if (view.kind === 'redirect') redirect(view.href)
    const seoPhase = classifySeoPhase({
      liveScanRunId: null,
      job: await getLatestSeoVerifyJob(audit.id),
      completedAt: audit.completedAt,
    })
    // C17: the poller renders the live phase banner and auto-navigates to the
    // run page when the verifier lands; with a failed/unavailable initial
    // phase it mounts inert and renders the static banner.
    const building = seoPhase.state === 'queued' || seoPhase.state === 'running'
    return (
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        {breadcrumb}
        <div>
          <h1 className="font-display font-bold text-[24px] text-navy dark:text-white">{audit.domain}</h1>
          <p className="text-[13px] font-body text-navy/60 dark:text-white/60 mt-1">
            {building ? 'SEO scan complete — verifying links and building results.' : 'SEO scan'}
          </p>
        </div>
        <SiteAuditPoller
          id={id}
          initialStatus={audit.status}
          initialPagesTotal={audit.pagesTotal}
          initialPagesComplete={audit.pagesComplete}
          initialPagesError={audit.pagesError}
          seoOnly
          initialLiveScanRunId={null}
          initialSeoPhase={seoPhase}
        />
      </main>
    )
  }
```

Keep the `SeoPhaseBanner` import — the full-audit complete branch further down still renders it statically.

- [ ] **Step 3: Type-check and run the page's sibling tests**

Run: `npx tsc --noEmit && npx vitest run app/\(app\)/ada-audit components/ada-audit/SiteAuditPoller.test.tsx`
Expected: tsc clean; seo-only-view tests and poller tests PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/ada-audit/site/[id]/page.tsx"
git commit -m "feat(site-audit): seoOnly complete branch renders the live poller instead of the static banner (C17)"
```

---

### Task 7: `RecentItem.inFlight` — server-computed liveness flag

**Files:**
- Modify: `lib/ada-audit/recents-query.ts`
- Test: `lib/ada-audit/recents-query.test.ts`

**Interfaces:**
- Produces:
  - `RecentItem` grows `inFlight: boolean`.
  - `export const TRANSIENT_SITE_STATUSES = ['queued', 'pending', 'running', 'pdfs-running', 'lighthouse-running'] as const` and `export function seoSiteHref(id: string, status: string, runId: string | null | undefined): string` (extracted from the inline seoSites href rule — Task 8's compact endpoint reuses both).
  - In-flight rules: `page` → status `pending|running`; `site-ada` → status in `TRANSIENT_SITE_STATUSES`; `site-seo` (SiteAudit-origin) → transient status OR (`complete` + no live-scan run + (latest `broken-link-verify` job in `site-audit:<id>` group is queued/running OR within the Task 3 grace window of `completedAt`)); `sf-upload` and orphan runs → always `false`.
- Consumes: `BROKEN_LINK_VERIFY_JOB_TYPE` from `@/lib/jobs/handlers/broken-link-verify` (precedent: `lib/ada-audit/seo-phase.ts`); `SEO_PHASE_ENQUEUE_GRACE_MS` from Task 3.

- [ ] **Step 1: Write the failing tests**

In `lib/ada-audit/recents-query.test.ts`: the mocked-prisma harness needs a `job.findMany` mock — add to the `vi.mock('@/lib/db', …)` factory:

```ts
const findManyJob = vi.fn()
// inside the prisma mock object:
    job: { findMany: (...a: unknown[]) => findManyJob(...a) },
// and in beforeEach:
  findManyJob.mockReset().mockResolvedValue([])
```

New tests:

```ts
  it('marks transient rows inFlight and terminal rows not', async () => {
    findManyAda.mockResolvedValue([{
      id: 'a1', createdAt: new Date('2026-07-08T00:00:00Z'), url: 'https://x.com',
      status: 'running', wcagLevel: 'wcag21aa', result: null,
      startedAt: null, completedAt: null, client: null, requestedBy: null,
    }])
    findManySite.mockImplementation((q: { where: { AND: Array<Record<string, unknown>> } }) => {
      const seoOnly = q.where.AND.some((c) => (c as { seoOnly?: boolean }).seoOnly === true)
      return seoOnly ? [] : [{
        id: 's1', createdAt: new Date('2026-07-08T00:00:01Z'), domain: 'a.com',
        status: 'lighthouse-running', wcagLevel: 'wcag21aa', summary: null,
        startedAt: null, completedAt: null, client: null, requestedBy: null, crawlRuns: [],
      }, {
        id: 's2', createdAt: new Date('2026-07-08T00:00:02Z'), domain: 'b.com',
        status: 'complete', wcagLevel: 'wcag21aa', summary: null,
        startedAt: null, completedAt: null, client: null, requestedBy: null, crawlRuns: [],
      }]
    })
    const { items } = await fetchAllRecents({ limit: 10 })
    const byId = Object.fromEntries(items.map((i) => [i.id, i]))
    expect(byId.a1.inFlight).toBe(true)
    expect(byId.s1.inFlight).toBe(true)
    expect(byId.s2.inFlight).toBe(false)
  })

  it('site-seo complete without a run is inFlight while a verify job is queued/running', async () => {
    const staleCompleted = new Date(Date.now() - 60 * 60_000) // 1h ago — outside grace
    findManySite.mockImplementation((q: { where: { AND: Array<Record<string, unknown>> } }) => {
      const seoOnly = q.where.AND.some((c) => (c as { seoOnly?: boolean }).seoOnly === true)
      return seoOnly ? [{
        id: 'seo1', createdAt: new Date('2026-07-08T00:00:00Z'), domain: 'c.com',
        status: 'complete', startedAt: null, completedAt: staleCompleted,
        client: null, requestedBy: null, crawlRuns: [],
      }, {
        id: 'seo2', createdAt: new Date('2026-07-08T00:00:01Z'), domain: 'd.com',
        status: 'complete', startedAt: null, completedAt: staleCompleted,
        client: null, requestedBy: null, crawlRuns: [],
      }] : []
    })
    findManyJob.mockResolvedValue([{ groupKey: 'site-audit:seo1' }])
    const { items } = await fetchAllRecents({ limit: 10 })
    const byId = Object.fromEntries(items.map((i) => [i.id, i]))
    expect(byId.seo1.inFlight).toBe(true)    // verifier alive → live row
    expect(byId.seo2.inFlight).toBe(false)   // dead verifier, past grace → settled
    expect(findManyJob).toHaveBeenCalledTimes(1)  // one batched lookup
  })

  it('site-seo complete without a run or job stays inFlight within the enqueue grace window', async () => {
    findManySite.mockImplementation((q: { where: { AND: Array<Record<string, unknown>> } }) => {
      const seoOnly = q.where.AND.some((c) => (c as { seoOnly?: boolean }).seoOnly === true)
      return seoOnly ? [{
        id: 'seo3', createdAt: new Date(), domain: 'e.com',
        status: 'complete', startedAt: null, completedAt: new Date(), // just now — inside grace
        client: null, requestedBy: null, crawlRuns: [],
      }] : []
    })
    const { items } = await fetchAllRecents({ limit: 10 })
    expect(items[0].inFlight).toBe(true)
  })

  it('site-seo complete WITH a run is not inFlight and links the run page', async () => {
    findManySite.mockImplementation((q: { where: { AND: Array<Record<string, unknown>> } }) => {
      const seoOnly = q.where.AND.some((c) => (c as { seoOnly?: boolean }).seoOnly === true)
      return seoOnly ? [{
        id: 'seo4', createdAt: new Date('2026-07-08T00:00:00Z'), domain: 'f.com',
        status: 'complete', startedAt: null, completedAt: new Date(),
        client: null, requestedBy: null, crawlRuns: [{ id: 'run3', score: 88 }],
      }] : []
    })
    const { items } = await fetchAllRecents({ limit: 10 })
    expect(items[0].inFlight).toBe(false)
    expect(items[0].href).toBe('/seo-audits/results/run/run3')
    expect(findManyJob).not.toHaveBeenCalled()  // no candidates → no job query
  })

  it('sessions and orphan runs are never inFlight', async () => {
    findManySession.mockResolvedValue([{
      id: 'sess1', createdAt: new Date('2026-07-08T00:00:00Z'), status: 'pending',
      siteName: 'x', files: '[]', requestedBy: null, client: null, crawlRun: null,
    }])
    findManyRun.mockResolvedValue([{
      id: 'orph1', createdAt: new Date('2026-07-08T00:00:01Z'), status: 'complete',
      domain: 'g.com', score: null, client: null,
    }])
    const { items } = await fetchAllRecents({ limit: 10 })
    expect(items.every((i) => i.inFlight === false)).toBe(true)
  })
```

> Note: existing tests construct rows via prisma mocks, not the `RecentItem` type, so adding a field breaks nothing there; `RecentsTable.test.tsx`'s `item()` factory gets `inFlight: false` added when tsc flags it (Step 4).

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run lib/ada-audit/recents-query.test.ts`
Expected: new tests FAIL (`inFlight` undefined). Existing tests PASS.

- [ ] **Step 3: Implement**

In `lib/ada-audit/recents-query.ts`:

```ts
import { BROKEN_LINK_VERIFY_JOB_TYPE } from '@/lib/jobs/handlers/broken-link-verify'
import { SEO_PHASE_ENQUEUE_GRACE_MS } from './seo-phase'

// C17: statuses during which a SiteAudit row is worth live-polling.
export const TRANSIENT_SITE_STATUSES = ['queued', 'pending', 'running', 'pdfs-running', 'lighthouse-running'] as const
const transientSite = (s: string) => (TRANSIENT_SITE_STATUSES as readonly string[]).includes(s)

// C16 href rule for seoOnly rows, shared with the C17 compact status endpoint:
// run-ready rows link straight to the run page; everything else lands on the
// site page, which owns seoOnly routing.
export function seoSiteHref(id: string, status: string, runId: string | null | undefined): string {
  return status === 'complete' && runId ? `/seo-audits/results/run/${runId}` : `/ada-audit/site/${id}`
}
```

Add `inFlight: boolean` to `RecentItem`.

In `fetchAllRecents`, after the 5-source `Promise.all`, compute the verifier-alive set for the ONLY ambiguous case (seoOnly complete without a run) with one batched query, plus the Task 3 grace fallback (Codex fix #1 — the recents row must not miss the not-yet-enqueued job either):

```ts
  // C17: a seoOnly parent flips 'complete' when the verifier STARTS — those
  // rows stay live while the verify job is queued/running, or (no job yet)
  // within the enqueue grace window. One batched lookup over the candidates.
  const now = Date.now()
  const withinGrace = (completedAt: Date | null) =>
    completedAt != null && now - completedAt.getTime() < SEO_PHASE_ENQUEUE_GRACE_MS
  const seoPending = seoSites.filter((s) => s.status === 'complete' && !s.crawlRuns[0]?.id)
  const aliveVerifyGroups = seoPending.length
    ? new Set(
        (await prisma.job.findMany({
          where: {
            type: BROKEN_LINK_VERIFY_JOB_TYPE,
            groupKey: { in: seoPending.map((s) => `site-audit:${s.id}`) },
            status: { in: ['queued', 'running'] },
          },
          select: { groupKey: true },
        })).map((j) => j.groupKey),
      )
    : new Set<string | null>()
```

Then in the mappers:
- pages: `inFlight: p.status === 'pending' || p.status === 'running'`
- sessions: `inFlight: false`
- adaSites: `inFlight: transientSite(s.status)`
- seoSites: replace the inline href ternary with `href: seoSiteHref(s.id, s.status, s.crawlRuns[0]?.id)` and add
  ```ts
  inFlight:
    transientSite(s.status) ||
    (s.status === 'complete' &&
      !s.crawlRuns[0]?.id &&
      (aliveVerifyGroups.has(`site-audit:${s.id}`) || withinGrace(s.completedAt))),
  ```
- orphans: `inFlight: false`

- [ ] **Step 4: Run tests + type-check to verify all pass**

Run: `npx vitest run lib/ada-audit/recents-query.test.ts && npx tsc --noEmit`
Expected: tests PASS; tsc surfaces any `RecentItem` construction sites missing `inFlight` — fix them (expected: `RecentsTable.test.tsx` factory — add `inFlight: false`).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/recents-query.ts lib/ada-audit/recents-query.test.ts components/ada-audit/RecentsTable.test.tsx
git commit -m "feat(recents): server-computed inFlight flag on RecentItem (C17)"
```

---

### Task 8: Compact batch status endpoint (+ client-safe shared module)

**Files:**
- Create: `lib/ada-audit/recents-status-shared.ts` (client-safe — NO prisma import; the hook needs the cap CONSTANT, plan Codex fix #3)
- Create: `lib/ada-audit/recents-status.ts` (server)
- Create: `app/api/ada-audit/recents/status/route.ts`
- Test: `lib/ada-audit/recents-status.test.ts`

**Interfaces:**
- Produces (shared module):
  ```ts
  export interface RecentStatusRef { type: RecentType; id: string }
  export interface RecentStatusItem {
    type: RecentType; id: string; status: string; score: number | null
    href: string; startedAt: string | null; completedAt: string | null
    inFlight: boolean
    // plan Codex fix #2 — bounded progress for the recents mini display:
    pagesDone: number | null      // site types: pagesComplete + pagesError
    pagesTotal: number | null     // site types: pagesTotal (null when 0)
    progressPct: number | null    // page: AdaAudit.progress; site-seo verifying: Job.progress
    phaseLabel: string | null     // page: progressMessage; site-seo verifying: job progressMessage ?? 'Verifying links…'
  }
  export const RECENTS_STATUS_MAX_IDS = 50
  export function parseStatusRefs(raw: string | null): RecentStatusRef[]  // 'type:id,…' → refs; malformed + sf-upload dropped; capped at MAX_IDS
  ```
- Produces (server module): `export async function fetchRecentsStatus(refs: RecentStatusRef[]): Promise<RecentStatusItem[]>`. Deleted rows are simply omitted (the client treats a missing id as settled). **Zero blob parses:** score is `CrawlRun.score ?? null` for every type — a just-completed row without a dual-written run shows "—" until the settle-triggered full refetch fills it via the blob fallback.
- Consumes: Task 7's `TRANSIENT_SITE_STATUSES`, `seoSiteHref`, `RecentType` (type-only in shared); `BROKEN_LINK_VERIFY_JOB_TYPE`; Task 3's `SEO_PHASE_ENQUEUE_GRACE_MS`.

- [ ] **Step 1: Write the failing tests**

`lib/ada-audit/recents-status.test.ts` (mocked-prisma pattern, mirroring `recents-query.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findManyAda = vi.fn()
const findManySite = vi.fn()
const findManyJob = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    adaAudit: { findMany: (...a: unknown[]) => findManyAda(...a) },
    siteAudit: { findMany: (...a: unknown[]) => findManySite(...a) },
    job: { findMany: (...a: unknown[]) => findManyJob(...a) },
  },
}))

const { fetchRecentsStatus } = await import('./recents-status')
const { parseStatusRefs, RECENTS_STATUS_MAX_IDS } = await import('./recents-status-shared')

beforeEach(() => {
  findManyAda.mockReset().mockResolvedValue([])
  findManySite.mockReset().mockResolvedValue([])
  findManyJob.mockReset().mockResolvedValue([])
})

describe('parseStatusRefs', () => {
  it('parses type:id pairs, dropping malformed and sf-upload entries', () => {
    expect(parseStatusRefs('page:a1,site-ada:s1,site-seo:s2,sf-upload:x,garbage,:,page:')).toEqual([
      { type: 'page', id: 'a1' },
      { type: 'site-ada', id: 's1' },
      { type: 'site-seo', id: 's2' },
    ])
  })

  it('caps at RECENTS_STATUS_MAX_IDS and handles null', () => {
    const raw = Array.from({ length: 60 }, (_, i) => `page:a${i}`).join(',')
    expect(parseStatusRefs(raw)).toHaveLength(RECENTS_STATUS_MAX_IDS)
    expect(parseStatusRefs(null)).toEqual([])
  })
})

describe('fetchRecentsStatus', () => {
  it('returns compact items per type with run-based scores, progress fields, and no blob selects', async () => {
    findManyAda.mockResolvedValue([{
      id: 'a1', status: 'running', progress: 42, progressMessage: 'Running axe…',
      startedAt: new Date('2026-07-08T00:00:00Z'), completedAt: null, crawlRun: null,
    }])
    findManySite.mockResolvedValue([{
      id: 's1', seoOnly: false, status: 'running',
      pagesComplete: 3, pagesError: 1, pagesTotal: 40,
      startedAt: new Date('2026-07-08T00:00:00Z'), completedAt: null,
      crawlRuns: [],
    }])
    const items = await fetchRecentsStatus([
      { type: 'page', id: 'a1' }, { type: 'site-ada', id: 's1' },
    ])
    const byId = Object.fromEntries(items.map((i) => [i.id, i]))
    expect(byId.a1).toMatchObject({
      type: 'page', status: 'running', score: null, href: '/ada-audit/a1',
      inFlight: true, progressPct: 42, phaseLabel: 'Running axe…',
    })
    expect(byId.s1).toMatchObject({
      type: 'site-ada', status: 'running', href: '/ada-audit/site/s1',
      inFlight: true, pagesDone: 4, pagesTotal: 40,
    })
    // selects must not include the legacy blobs:
    expect(JSON.stringify(findManyAda.mock.calls[0][0])).not.toContain('result')
    expect(JSON.stringify(findManySite.mock.calls[0][0])).not.toContain('summary')
  })

  it('site-seo href flips to the run page when the run lands, and settles', async () => {
    findManySite.mockResolvedValue([{
      id: 'seo1', seoOnly: true, status: 'complete',
      pagesComplete: 4, pagesError: 0, pagesTotal: 4,
      startedAt: null, completedAt: new Date(),
      crawlRuns: [{ id: 'run9', score: 77, tool: 'seo-parser' }],
    }])
    const items = await fetchRecentsStatus([{ type: 'site-seo', id: 'seo1' }])
    expect(items[0]).toMatchObject({
      href: '/seo-audits/results/run/run9', score: 77, inFlight: false,
    })
    expect(findManyJob).not.toHaveBeenCalled()
  })

  it('site-seo complete without a run reports the live verifier phase', async () => {
    const staleCompleted = new Date(Date.now() - 60 * 60_000) // outside grace — job decides
    findManySite.mockResolvedValue([{
      id: 'seo2', seoOnly: true, status: 'complete',
      pagesComplete: 4, pagesError: 0, pagesTotal: 4,
      startedAt: null, completedAt: staleCompleted, crawlRuns: [],
    }])
    findManyJob.mockResolvedValue([{ groupKey: 'site-audit:seo2', progress: 60, progressMessage: 'Checking links…' }])
    const items = await fetchRecentsStatus([{ type: 'site-seo', id: 'seo2' }])
    expect(items[0]).toMatchObject({
      href: '/ada-audit/site/seo2', inFlight: true,
      progressPct: 60, phaseLabel: 'Checking links…',
    })
  })

  it('site-seo complete with neither run nor job stays inFlight inside the grace window, settles after', async () => {
    findManySite.mockResolvedValue([{
      id: 'seo3', seoOnly: true, status: 'complete',
      pagesComplete: 4, pagesError: 0, pagesTotal: 4,
      startedAt: null, completedAt: new Date(), crawlRuns: [],
    }])
    const inGrace = await fetchRecentsStatus([{ type: 'site-seo', id: 'seo3' }])
    expect(inGrace[0]).toMatchObject({ inFlight: true, phaseLabel: 'Verifying links…' })

    findManySite.mockResolvedValue([{
      id: 'seo3', seoOnly: true, status: 'complete',
      pagesComplete: 4, pagesError: 0, pagesTotal: 4,
      startedAt: null, completedAt: new Date(Date.now() - 60 * 60_000), crawlRuns: [],
    }])
    const pastGrace = await fetchRecentsStatus([{ type: 'site-seo', id: 'seo3' }])
    expect(pastGrace[0].inFlight).toBe(false)
  })

  it('omits deleted rows and returns [] for no refs without querying', async () => {
    const items = await fetchRecentsStatus([{ type: 'page', id: 'gone' }])
    expect(items).toEqual([])
    expect(await fetchRecentsStatus([])).toEqual([])
    expect(findManyAda).toHaveBeenCalledTimes(1) // only the first call queried
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/ada-audit/recents-status.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the shared module**

`lib/ada-audit/recents-status-shared.ts`:

```ts
// C17: client-safe contract for the compact recents status endpoint.
// NO prisma import — RecentsTable/useRecentsLivePoll import VALUES from here
// (recents-status.ts and recents-query.ts are server-only).
import type { RecentType } from './recents-query'

export interface RecentStatusRef { type: RecentType; id: string }

export interface RecentStatusItem {
  type: RecentType
  id: string
  status: string
  score: number | null
  href: string
  startedAt: string | null
  completedAt: string | null
  inFlight: boolean
  pagesDone: number | null
  pagesTotal: number | null
  progressPct: number | null
  phaseLabel: string | null
}

export const RECENTS_STATUS_MAX_IDS = 50

const POLLABLE = ['page', 'site-ada', 'site-seo'] as const

export function parseStatusRefs(raw: string | null): RecentStatusRef[] {
  if (!raw) return []
  const refs: RecentStatusRef[] = []
  for (const pair of raw.split(',')) {
    const sep = pair.indexOf(':')
    if (sep <= 0) continue
    const type = pair.slice(0, sep) as RecentType
    const id = pair.slice(sep + 1)
    if (!id || !(POLLABLE as readonly string[]).includes(type)) continue
    refs.push({ type, id })
    if (refs.length >= RECENTS_STATUS_MAX_IDS) break
  }
  return refs
}
```

- [ ] **Step 4: Implement the server module**

`lib/ada-audit/recents-status.ts`:

```ts
import { prisma } from '@/lib/db'
import { BROKEN_LINK_VERIFY_JOB_TYPE } from '@/lib/jobs/handlers/broken-link-verify'
import { SEO_PHASE_ENQUEUE_GRACE_MS } from './seo-phase'
import { TRANSIENT_SITE_STATUSES, seoSiteHref } from './recents-query'
import type { RecentStatusItem, RecentStatusRef } from './recents-status-shared'

// C17 compact live-status lookup for the unified recents table. Deliberately
// cheap: id-batched selects, CrawlRun.score only (NEVER a legacy blob parse —
// the settle-triggered full refetch owns score fallbacks), one optional job
// query. sf-upload rows are never in-flight and are rejected at parse time.
const transientSite = (s: string) => (TRANSIENT_SITE_STATUSES as readonly string[]).includes(s)

export async function fetchRecentsStatus(refs: RecentStatusRef[]): Promise<RecentStatusItem[]> {
  const pageIds = refs.filter((r) => r.type === 'page').map((r) => r.id)
  const siteIds = refs.filter((r) => r.type === 'site-ada' || r.type === 'site-seo').map((r) => r.id)

  const [pages, sites] = await Promise.all([
    pageIds.length
      ? prisma.adaAudit.findMany({
          where: { id: { in: pageIds }, siteAuditId: null },
          select: {
            id: true, status: true, progress: true, progressMessage: true,
            startedAt: true, completedAt: true,
            crawlRun: { select: { score: true } },
          },
        })
      : Promise.resolve([]),
    siteIds.length
      ? prisma.siteAudit.findMany({
          where: { id: { in: siteIds } },
          select: {
            id: true, seoOnly: true, status: true,
            pagesComplete: true, pagesError: true, pagesTotal: true,
            startedAt: true, completedAt: true,
            crawlRuns: { select: { id: true, score: true, tool: true } },
          },
        })
      : Promise.resolve([]),
  ])

  // seoOnly complete-without-run rows: live while the verify job runs, or (no
  // job yet) within the enqueue grace window (Task 3 / plan Codex fix #1).
  const now = Date.now()
  const withinGrace = (completedAt: Date | null) =>
    completedAt != null && now - completedAt.getTime() < SEO_PHASE_ENQUEUE_GRACE_MS
  const seoPending = sites.filter(
    (s) => s.seoOnly && s.status === 'complete' && !s.crawlRuns.some((r) => r.tool === 'seo-parser'),
  )
  const verifyJobs = seoPending.length
    ? await prisma.job.findMany({
        where: {
          type: BROKEN_LINK_VERIFY_JOB_TYPE,
          groupKey: { in: seoPending.map((s) => `site-audit:${s.id}`) },
          status: { in: ['queued', 'running'] },
        },
        select: { groupKey: true, progress: true, progressMessage: true },
      })
    : []
  const aliveVerify = new Map(verifyJobs.map((j) => [j.groupKey, j]))

  const items: RecentStatusItem[] = []
  for (const p of pages) {
    items.push({
      type: 'page', id: p.id, status: p.status,
      score: p.crawlRun?.score ?? null, href: `/ada-audit/${p.id}`,
      startedAt: p.startedAt?.toISOString() ?? null,
      completedAt: p.completedAt?.toISOString() ?? null,
      inFlight: p.status === 'pending' || p.status === 'running',
      pagesDone: null, pagesTotal: null,
      progressPct: p.progress ?? null,
      phaseLabel: p.progressMessage ?? null,
    })
  }
  for (const s of sites) {
    const pagesDone = s.pagesTotal > 0 ? s.pagesComplete + s.pagesError : null
    const pagesTotal = s.pagesTotal > 0 ? s.pagesTotal : null
    if (s.seoOnly) {
      const run = s.crawlRuns.find((r) => r.tool === 'seo-parser')
      const job = aliveVerify.get(`site-audit:${s.id}`)
      const verifying = s.status === 'complete' && !run && (job != null || withinGrace(s.completedAt))
      items.push({
        type: 'site-seo', id: s.id, status: s.status,
        score: run?.score ?? null, href: seoSiteHref(s.id, s.status, run?.id),
        startedAt: s.startedAt?.toISOString() ?? null,
        completedAt: s.completedAt?.toISOString() ?? null,
        inFlight: transientSite(s.status) || verifying,
        pagesDone: transientSite(s.status) ? pagesDone : null,
        pagesTotal: transientSite(s.status) ? pagesTotal : null,
        progressPct: verifying ? job?.progress ?? null : null,
        phaseLabel: verifying ? job?.progressMessage ?? 'Verifying links…' : null,
      })
    } else {
      const run = s.crawlRuns.find((r) => r.tool === 'ada-audit')
      items.push({
        type: 'site-ada', id: s.id, status: s.status,
        score: run?.score ?? null, href: `/ada-audit/site/${s.id}`,
        startedAt: s.startedAt?.toISOString() ?? null,
        completedAt: s.completedAt?.toISOString() ?? null,
        inFlight: transientSite(s.status),
        pagesDone: transientSite(s.status) ? pagesDone : null,
        pagesTotal: transientSite(s.status) ? pagesTotal : null,
        progressPct: null, phaseLabel: null,
      })
    }
  }
  return items
}
```

- [ ] **Step 5: Add the route**

`app/api/ada-audit/recents/status/route.ts` (cookie-gated by default; no middleware change):

```ts
import { NextResponse } from 'next/server'
import { fetchRecentsStatus } from '@/lib/ada-audit/recents-status'
import { parseStatusRefs } from '@/lib/ada-audit/recents-status-shared'

export const dynamic = 'force-dynamic'

// C17: compact live-status poll for visible in-flight recents rows — never
// re-runs the expensive 5-source merged history query.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const refs = parseStatusRefs(url.searchParams.get('ids'))
  if (refs.length === 0) return NextResponse.json({ items: [] })
  return NextResponse.json({ items: await fetchRecentsStatus(refs) })
}
```

- [ ] **Step 6: Run tests + type-check, commit**

Run: `npx vitest run lib/ada-audit/recents-status.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

```bash
git add lib/ada-audit/recents-status-shared.ts lib/ada-audit/recents-status.ts lib/ada-audit/recents-status.test.ts app/api/ada-audit/recents/status/route.ts
git commit -m "feat(recents): compact batch status endpoint with bounded progress fields (C17)"
```

---

### Task 9: `useRecentsLivePoll` hook

**Files:**
- Create: `components/ada-audit/useRecentsLivePoll.ts`
- Test: `components/ada-audit/useRecentsLivePoll.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface UseRecentsLivePollArgs {
    items: RecentItem[]                              // the VISIBLE rows
    intervalMs?: number                              // default 8000
    onUpdate: (updates: RecentStatusItem[]) => void  // merge into row state
    onSettled: () => void                            // newly settled key(s) → refetch merged list
  }
  export function useRecentsLivePoll(args: UseRecentsLivePollArgs): void
  ```
  Behavior: no in-flight visible items → no timer, no fetch. Otherwise every `intervalMs` it GETs `/api/ada-audit/recents/status?ids=<type:id,…>` for the in-flight subset — **deduped, sorted, and capped at `RECENTS_STATUS_MAX_IDS`** (plan Codex fix #3: ids beyond the endpoint cap would be omitted from the response and misread as deleted). Every OK response fires `onUpdate(items)`. A polled key that comes back `inFlight: false` OR is missing from the response (deleted row) fires `onSettled()` — **once per key** (plan Codex fix #4: a notified-set inside the effect prevents an unchanged in-flight set from re-notifying every tick; the set resets naturally when `inFlightKey` changes). Callbacks live in refs; the effect keys on the joined sorted key string; unmount/stale responses are dropped via a `cancelled` flag.
- Consumes: Task 7's `RecentItem` (`inFlight`), Task 8's `RecentStatusItem` + `RECENTS_STATUS_MAX_IDS` (from the client-safe shared module) + endpoint URL shape.

- [ ] **Step 1: Write the failing tests**

`components/ada-audit/useRecentsLivePoll.test.ts`:

```ts
// @vitest-environment jsdom
import { renderHook, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useRecentsLivePoll } from './useRecentsLivePoll'
import { RECENTS_STATUS_MAX_IDS } from '@/lib/ada-audit/recents-status-shared'
import type { RecentItem } from '@/lib/ada-audit/recents-query'

const item = (over: Partial<RecentItem> = {}): RecentItem => ({
  type: 'site-ada', id: 's1', createdAt: '2026-07-08T10:00:00.000Z', label: 'a.com',
  href: '/ada-audit/site/s1', status: 'running', score: null, startedAt: null, completedAt: null,
  clientName: null, requestedBy: null, deletable: false, inFlight: true, ...over,
})

const statusItem = (over: Record<string, unknown> = {}) => ({
  type: 'site-ada', id: 's1', status: 'running', score: null, href: '/ada-audit/site/s1',
  startedAt: null, completedAt: null, inFlight: true,
  pagesDone: 3, pagesTotal: 40, progressPct: null, phaseLabel: null, ...over,
})

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useRecentsLivePoll', () => {
  it('does not fetch when nothing is in flight', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    renderHook(() =>
      useRecentsLivePoll({ items: [item({ inFlight: false, status: 'complete' })], onUpdate: vi.fn(), onSettled: vi.fn() }),
    )
    await vi.advanceTimersByTimeAsync(20000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('polls only the in-flight ids and merges updates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [statusItem()] })))
    global.fetch = fetchMock as unknown as typeof fetch
    const onUpdate = vi.fn()
    const onSettled = vi.fn()
    renderHook(() =>
      useRecentsLivePoll({
        items: [item(), item({ id: 's2', inFlight: false, status: 'complete' })],
        onUpdate, onSettled,
      }),
    )
    await vi.advanceTimersByTimeAsync(8000)
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('ids=site-ada%3As1')
    expect(url).not.toContain('s2')
    expect(onUpdate).toHaveBeenCalledWith([statusItem()])
    expect(onSettled).not.toHaveBeenCalled()
  })

  it('caps the polled key set at RECENTS_STATUS_MAX_IDS without misreading the overflow as settled', async () => {
    const many = Array.from({ length: 60 }, (_, i) => item({ id: `s${i}` }))
    const returned = many.slice(0, RECENTS_STATUS_MAX_IDS)
      .map((i) => statusItem({ id: i.id }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: returned })))
    global.fetch = fetchMock as unknown as typeof fetch
    const onSettled = vi.fn()
    renderHook(() => useRecentsLivePoll({ items: many, onUpdate: vi.fn(), onSettled }))
    await vi.advanceTimersByTimeAsync(8000)
    await flushAsync()
    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]))
    expect(url.split(',').length).toBe(RECENTS_STATUS_MAX_IDS)
    expect(onSettled).not.toHaveBeenCalled()  // uncapped ids are NOT treated as deleted
  })

  it('fires onSettled once when a polled row leaves in-flight state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [statusItem({ status: 'complete', score: 90, inFlight: false })] })),
    )
    global.fetch = fetchMock as unknown as typeof fetch
    const onSettled = vi.fn()
    renderHook(() => useRecentsLivePoll({ items: [item()], onUpdate: vi.fn(), onSettled }))
    await vi.advanceTimersByTimeAsync(8000)
    await flushAsync()
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('does not re-notify for the same settled key on subsequent ticks (unchanged items prop)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [statusItem({ status: 'complete', inFlight: false })] })),
    )
    global.fetch = fetchMock as unknown as typeof fetch
    const onSettled = vi.fn()
    renderHook(() => useRecentsLivePoll({ items: [item()], onUpdate: vi.fn(), onSettled }))
    await vi.advanceTimersByTimeAsync(8000)
    await flushAsync()
    await vi.advanceTimersByTimeAsync(8000)
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onSettled).toHaveBeenCalledTimes(1)  // plan Codex fix #4
  })

  it('fires onSettled when a polled row is missing from the response (deleted)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] })))
    global.fetch = fetchMock as unknown as typeof fetch
    const onSettled = vi.fn()
    renderHook(() => useRecentsLivePoll({ items: [item()], onUpdate: vi.fn(), onSettled }))
    await vi.advanceTimersByTimeAsync(8000)
    await flushAsync()
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('stops polling when the items prop no longer has in-flight rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] })))
    global.fetch = fetchMock as unknown as typeof fetch
    const { rerender } = renderHook(
      ({ items }) => useRecentsLivePoll({ items, onUpdate: vi.fn(), onSettled: vi.fn() }),
      { initialProps: { items: [item()] } },
    )
    rerender({ items: [item({ inFlight: false, status: 'complete' })] })
    await vi.advanceTimersByTimeAsync(20000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('network errors keep polling silently', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'))
    global.fetch = fetchMock as unknown as typeof fetch
    const onSettled = vi.fn()
    renderHook(() => useRecentsLivePoll({ items: [item()], onUpdate: vi.fn(), onSettled }))
    await vi.advanceTimersByTimeAsync(16000)
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onSettled).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/ada-audit/useRecentsLivePoll.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`components/ada-audit/useRecentsLivePoll.ts`:

```ts
'use client'

import { useEffect, useRef } from 'react'
import type { RecentItem } from '@/lib/ada-audit/recents-query'
import { RECENTS_STATUS_MAX_IDS, type RecentStatusItem } from '@/lib/ada-audit/recents-status-shared'

export interface UseRecentsLivePollArgs {
  items: RecentItem[]
  intervalMs?: number
  onUpdate: (updates: RecentStatusItem[]) => void
  onSettled: () => void
}

/**
 * C17 live in-flight rows for the unified recents table. Polls the COMPACT
 * status endpoint for the visible in-flight ids only (spec Codex fix #9 — the
 * merged 5-source history query is expensive and is re-run only via
 * onSettled). No in-flight rows → no timer. The polled key set is deduped,
 * sorted, and capped at the endpoint's max (plan Codex fix #3), and each
 * settled key notifies exactly once per effect run (plan Codex fix #4).
 */
export function useRecentsLivePoll({
  items,
  intervalMs = 8000,
  onUpdate,
  onSettled,
}: UseRecentsLivePollArgs): void {
  const onUpdateRef = useRef(onUpdate)
  const onSettledRef = useRef(onSettled)
  onUpdateRef.current = onUpdate
  onSettledRef.current = onSettled

  const inFlightKey = Array.from(
    new Set(items.filter((i) => i.inFlight).map((i) => `${i.type}:${i.id}`)),
  )
    .sort()
    .slice(0, RECENTS_STATUS_MAX_IDS)
    .join(',')

  useEffect(() => {
    if (!inFlightKey) return
    const polled = inFlightKey.split(',')
    const notified = new Set<string>()
    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/ada-audit/recents/status?ids=${encodeURIComponent(inFlightKey)}`)
        if (!res.ok) return
        const json = (await res.json()) as { items: RecentStatusItem[] }
        if (cancelled) return
        onUpdateRef.current(json.items)
        const stillInFlight = new Set(json.items.filter((i) => i.inFlight).map((i) => `${i.type}:${i.id}`))
        // Settled = left in-flight state OR missing (row deleted).
        const settledNow = polled.filter((key) => !stillInFlight.has(key) && !notified.has(key))
        if (settledNow.length) {
          settledNow.forEach((key) => notified.add(key))
          onSettledRef.current()
        }
      } catch {
        // network blip — keep polling
      }
    }, intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [inFlightKey, intervalMs])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/ada-audit/useRecentsLivePoll.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/useRecentsLivePoll.ts components/ada-audit/useRecentsLivePoll.test.ts
git commit -m "feat(recents): useRecentsLivePoll hook — capped compact polling, once-per-key settle (C17)"
```

---

### Task 10: `RecentsTable` integration

**Files:**
- Modify: `components/ada-audit/RecentsTable.tsx`
- Test: `components/ada-audit/RecentsTable.test.tsx`

**Interfaces:**
- Consumes: Task 9's `useRecentsLivePoll`, Task 7's `inFlight` on `RecentItem`, Task 8's `RecentStatusItem` (type-only from the shared module).
- Produces: no interface change — same props. Behavior: in-flight VISIBLE rows (post `variant==='home'` slice) live-update status/score/href/duration every 8 s; a settle triggers one `refetch(scope)`; the status cell shows a pulse dot while in flight plus a mini progress display (plan Codex fix #2): a small bar + label when numeric progress exists (`progressPct` or `pagesDone/pagesTotal`), a phase label otherwise.

- [ ] **Step 1: Write the failing tests**

Add to `components/ada-audit/RecentsTable.test.tsx`. First, harden the suite hooks (plan Codex fix #6): add `vi.useRealTimers()` to the suite-level `afterEach` (safe when real timers are already active), and import `waitFor` from `@testing-library/react`:

```ts
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })
```

Then the new tests:

```tsx
  it('polls the compact status endpoint for in-flight rows, merges updates, shows mini progress', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/ada-audit/recents/status')) {
        return new Response(JSON.stringify({ items: [{
          type: 'site-ada', id: 'a1', status: 'running', score: null,
          href: '/ada-audit/site/a1', startedAt: null, completedAt: null, inFlight: true,
          pagesDone: 12, pagesTotal: 40, progressPct: null, phaseLabel: null,
        }] }))
      }
      return new Response(JSON.stringify([]))
    })
    render(<RecentsTable initialItems={[item({ status: 'queued', inFlight: true, score: null })]}
      initialNextCursor={null} initialScope="all" operator={null} variant="full" />)
    await vi.advanceTimersByTimeAsync(8000)
    await waitFor(() => {
      expect(screen.getByText('running')).toBeTruthy()
      expect(screen.getByText('12/40 pages')).toBeTruthy()
    })
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/ada-audit/recents/status'))).toBe(true)
  })

  it('refetches the merged list once when an in-flight row settles', async () => {
    vi.useFakeTimers()
    let recentsFetches = 0
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/ada-audit/recents/status')) {
        return new Response(JSON.stringify({ items: [{
          type: 'site-ada', id: 'a1', status: 'complete', score: 88,
          href: '/ada-audit/site/a1', startedAt: null, completedAt: null, inFlight: false,
          pagesDone: null, pagesTotal: null, progressPct: null, phaseLabel: null,
        }] }))
      }
      if (url.includes('/api/ada-audit/recents?')) {
        recentsFetches++
        return new Response(JSON.stringify({ items: [item({ status: 'complete', score: 88 })], nextCursor: null }))
      }
      return new Response(JSON.stringify([]))
    })
    render(<RecentsTable initialItems={[item({ status: 'running', inFlight: true, score: null })]}
      initialNextCursor={null} initialScope="all" operator={null} variant="full" />)
    await vi.advanceTimersByTimeAsync(8000)
    await waitFor(() => expect(recentsFetches).toBe(1))
  })

  it('does not hit the status endpoint when nothing is in flight', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([])))
    render(<RecentsTable initialItems={[item()]} initialNextCursor={null} initialScope="all" operator={null} variant="full" />)
    await vi.advanceTimersByTimeAsync(30000)
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes('/recents/status'))).toBe(true)
  })
```

> The suite-level `beforeEach` already spies on fetch; `vi.spyOn` inside a test replaces that mock for its duration and `afterEach`'s `vi.restoreAllMocks()` cleans up.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run components/ada-audit/RecentsTable.test.tsx`
Expected: new tests FAIL (no status polling exists); existing tests PASS.

- [ ] **Step 3: Implement**

In `components/ada-audit/RecentsTable.tsx`:

```tsx
import { useRecentsLivePoll } from './useRecentsLivePoll'
import type { RecentStatusItem } from '@/lib/ada-audit/recents-status-shared'
```

Move the `const rows = …` / `const mineDisabled = …` lines ABOVE the hook call (hooks must be unconditional and `rows` feeds the hook), add live-meta state next to the other state hooks, then wire the poll — visible rows only, per spec:

```tsx
  // C17 (plan Codex fix #2): per-row live progress detail from the compact
  // endpoint, keyed `type:id`. Kept OUTSIDE RecentItem — the merged query
  // stays cheap; this map only ever holds currently-polled rows.
  const [liveMeta, setLiveMeta] = useState<Record<string, RecentStatusItem>>({})

  const rows = variant === 'home' ? items.slice(0, HOME_LIMIT) : items
  const mineDisabled = !operator

  // C17: live-update the visible in-flight rows via the compact status
  // endpoint; refetch the merged list once when one settles. Stops when
  // nothing visible is in flight.
  useRecentsLivePoll({
    items: rows,
    onUpdate: (updates) => {
      setLiveMeta((prev) => {
        const next = { ...prev }
        for (const u of updates) next[`${u.type}:${u.id}`] = u
        return next
      })
      setItems((prev) =>
        prev.map((it) => {
          const u = updates.find((x) => x.type === it.type && x.id === it.id)
          return u
            ? { ...it, status: u.status, score: u.score, href: u.href, startedAt: u.startedAt, completedAt: u.completedAt, inFlight: u.inFlight }
            : it
        }),
      )
    },
    onSettled: () => void refetch(scope),
  })
```

Status cell — pulse dot + mini progress (bar when numeric progress exists, phase label otherwise; dark-mode variants included):

```tsx
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">
                    {(() => {
                      const meta = it.inFlight ? liveMeta[`${it.type}:${it.id}`] : undefined
                      const pct = meta
                        ? meta.progressPct ?? (meta.pagesTotal ? Math.round(((meta.pagesDone ?? 0) / meta.pagesTotal) * 100) : null)
                        : null
                      const label = meta
                        ? meta.pagesTotal ? `${meta.pagesDone ?? 0}/${meta.pagesTotal} pages` : meta.phaseLabel
                        : null
                      return (
                        <>
                          <span className="inline-flex items-center gap-1.5">
                            {it.inFlight && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse" aria-hidden />}
                            {it.status}
                          </span>
                          {label && <span className="block text-[10px] text-navy/40 dark:text-white/40 mt-0.5 truncate max-w-[160px]">{label}</span>}
                          {pct != null && (
                            <span className="block w-24 h-1 mt-1 rounded-full bg-gray-100 dark:bg-navy-light overflow-hidden">
                              <span className="block h-1 rounded-full bg-blue-500 dark:bg-blue-400 transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                            </span>
                          )}
                        </>
                      )
                    })()}
                  </td>
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run components/ada-audit/RecentsTable.test.tsx && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/RecentsTable.tsx components/ada-audit/RecentsTable.test.tsx
git commit -m "feat(recents): live in-flight rows — 8s compact poll, mini progress, settle triggers one merged refetch (C17)"
```

---

### Task 11: Gates, browser verification, PR

**Files:** none new.

- [ ] **Step 1: Full gates**

```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```

Expected: tsc clean; full vitest suite green (~3800+ tests); build succeeds.

- [ ] **Step 2: Browser verification (dev)**

Start `npm run dev` and verify with Playwright (dev-test scans ONLY against a client domain already in the system or an `*.erstaging.site` domain — hard gate 3):

1. Run a **seoOnly** site audit (Scan Type = SEO) on a small client domain. On `/ada-audit/site/[id]`: crawl progress renders → on crawl completion the card flips to "SEO analysis running/queued" (live banner, "updates automatically" copy, NO dead gap, NO manual reload) → when the verifier lands, the browser auto-navigates to `/seo-audits/results/run/[id]` with zero clicks.
2. While the scan runs, open `/ada-audit/recents`: the row shows the pulse dot + live status + mini progress (`x/y pages`, then "Verifying links…"); when the scan settles, the row flips to the run-page href and a score appears (one merged refetch). Network tab: only `/api/ada-audit/recents/status?ids=…` requests every 8 s while in flight; polling stops after settle.
3. Run a full (ADA) site audit far enough to confirm the transient page still behaves (progress bar, live table) and — if time allows on a tiny site — that completion flips to results with zero clicks (refresh outcome).
4. Dark mode pass on the new pulse dot, mini bar, and banner states.

- [ ] **Step 3: PR**

```bash
git push -u origin feat/c17-scan-progress
gh pr create --title "feat(c17): scan-progress maturation — live seoOnly verifier phase, auto-navigation, live recents rows" --body "…(summary of the four spec §P2 items + the 6 plan-level Codex fixes, gate results, verification notes)…"
```

Then (rule 1): re-run gates on the branch, merge when green, deploy `ssh $PROD_SSH "~/deploy.sh"` (code-only — no migration, no env vars), post-deploy verify (health + a small prod seoOnly scan on a client domain + recents live rows).

- [ ] **Step 4: Docs ritual (same commit)**

Tracker: tick C17 + dated status-log line. Rewrite `docs/superpowers/todos/HANDOFF-improvement-roadmap.md` (next item: C18). `git mv` this plan to `docs/superpowers/archive/plans/`. Commit together; end the chat reply with the handoff paste-in prompt.

---

## Self-Review Notes

- **Spec coverage:** §P2 item 1 (verifier phase surfaced) → Tasks 2–6; item 2 (terminal semantics, spec Codex #8) → Tasks 2, 3, 5; item 3 (single-owner auto-navigation) → Tasks 1+5 (+full-audit regression test in Task 5); item 4 (live history rows, spec Codex #9) → Tasks 7–10; "single-page audits untouched" → no `AuditPoller.tsx` change anywhere. Batch-level test list (poller phase-rendering, auto-navigation, history smart-poll gating) → Tasks 5, 5, 9/10 respectively.
- **Race handling (plan Codex fix #1):** the ONLY source of `unavailable` is server-side `classifySeoPhase`, which now grace-windows the finalizer's flip→enqueue gap AND the ≤10-min crash-recovery re-enqueue. Both stranding cases Codex identified (terminal-on-mount during the race; refresh that still sees no job) are closed because the server classifies `queued` throughout the window; recents `inFlight` (Tasks 7–8) applies the same rule so rows can't settle prematurely either.
- **Type consistency check:** `TerminalOutcome` (T1) ⇢ T5; `deriveSeoOnlyStatus`/`isSeoOnlyTerminal` (T2) ⇢ T5; `SEO_PHASE_ENQUEUE_GRACE_MS` (T3) ⇢ T7/T8; `live` prop (T4) ⇢ T5; `seoOnly`/`initialLiveScanRunId`/`initialSeoPhase` (T5) ⇢ T6; `inFlight`/`TRANSIENT_SITE_STATUSES`/`seoSiteHref` (T7) ⇢ T8; `RecentStatusItem`/`RECENTS_STATUS_MAX_IDS`/`parseStatusRefs` (T8 shared) ⇢ T9/T10; `fetchRecentsStatus` (T8 server) ⇢ route — names match.
- **No blob reads** in the compact path (asserted in T8 tests); the full refetch (existing `fetchAllRecents`) owns score fallbacks.
- `sf-upload` rows are excluded from live polling by design (Codex concurred): session parsing runs inside the initiating HTTP request; a pending upload doesn't advance without user action. Rejected in `parseStatusRefs`, `inFlight: false` server-side.
