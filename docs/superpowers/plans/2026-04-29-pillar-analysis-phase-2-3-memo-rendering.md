# Pillar Analysis Phase 2.3 — Strategic Memo Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the AI-generated `aiNarrative` markdown memo on the `/pillar-analysis/[id]` dashboard with action-triggered, time-bounded auto-refresh polling, a contextual regenerate-button label, a "Last updated N ago" relative timestamp, and a sticky page-section nav. UI-only.

**Architecture:** Five new client/server React components co-located under `app/pillar-analysis/[id]/components/`, plus two pure-logic modules in `lib/` that hold the polling state machine and relative-time formatters (so they can be unit-tested in the existing vitest `node` environment without adding a DOM testing toolkit). Components communicate via a tiny module-level event emitter so the regenerate button can trigger the poller without prop-drilling. One additive backend change adds two fields to an existing public endpoint.

**Tech Stack:** Next.js 15 App Router (App Router server components + RSC `router.refresh()`), React 19, TypeScript, Tailwind, Vitest 2.1 (node env, `.test.ts` only), `react-markdown` (new dep — no `rehype-raw`, no `remark-gfm`).

**Spec:** `docs/superpowers/specs/2026-04-29-pillar-analysis-phase-2-3-memo-rendering-design.md`

**Branch:** `feature/pillar-analysis-phase-1` (continue the running PR; Phase 2.3 work merges with Phase 1, 2.1, 2.2).

---

## File structure

**Create (new):**
- `lib/relative-time.ts` — pure `formatRelativeTime(date, now)` and `formatAbsoluteTime(date)` formatters
- `lib/relative-time.test.ts`
- `lib/memo-poller-machine.ts` — pure polling state machine: `createPollingMachine(opts)` returning `{ start, stop, tick, setVisibility, status }`
- `lib/memo-poller-machine.test.ts`
- `lib/memo-poller-events.ts` — module-level event emitter (`onTrigger`, `emitTrigger`) so the button can wake the poller without prop drilling
- `lib/memo-poller-events.test.ts`
- `app/pillar-analysis/[id]/components/MemoMarkdown.tsx` — react-markdown wrapper with custom component map
- `app/pillar-analysis/[id]/components/MemoMarkdown.test.ts` — `renderToStaticMarkup` assertions
- `app/pillar-analysis/[id]/components/RelativeTime.tsx` — first-paint-null timestamp wrapper
- `app/pillar-analysis/[id]/components/MemoPoller.tsx` — thin React wrapper around `memo-poller-machine`
- `app/pillar-analysis/[id]/components/StrategicMemoCard.tsx` — top-level card (server component); branches on `aiNarrative` presence
- `app/pillar-analysis/[id]/components/StrategicMemoCard.test.ts` — `renderToStaticMarkup` assertions for both states
- `app/pillar-analysis/[id]/components/SectionNav.tsx` — sticky nav bar, plain anchor links
- `app/api/pillar-analysis/by-session/[sessionId]/route.test.ts` — extends payload shape coverage with the new fields

**Modify:**
- `app/api/pillar-analysis/by-session/[sessionId]/route.ts` — add `aiNarrative` and `narrativeUpdatedAt` to response
- `app/pillar-analysis/[id]/page.tsx` — pass new props, mount `SectionNav` + `StrategicMemoCard`, add section `id`s and `scroll-margin-top`
- `app/pillar-analysis/[id]/components/CopyClaudePromptButton.tsx` — add `hasMemo: boolean` prop, contextual label, emit trigger event on successful copy
- `package.json` — add `react-markdown` dependency

---

## Why pure logic modules under `lib/`?

The existing test infra (`vitest.config.ts`) sets `environment: 'node'` and `include: ['**/*.test.ts']` — there is no jsdom-based component test setup, no `@testing-library/react`, and no `.test.tsx` matching. The repo's testing posture is: pure logic in `lib/` is unit-tested; components are smoke-checked manually.

To stay inside this posture without lowering coverage of the new logic-heavy bits:
- The polling state machine lives in `lib/memo-poller-machine.ts` as a plain JS state machine with `start()`, `stop()`, `tick()`, `setVisibility()`. Tests drive it with synthetic time and visibility events.
- The relative-time formatters live in `lib/relative-time.ts` as pure functions `formatRelativeTime(value, now)` and `formatAbsoluteTime(value)`. Tests assert exact strings.
- The React components (`MemoPoller`, `RelativeTime`) become thin wrappers that just plumb React state + `setInterval` + `visibilitychange` listeners into the pure module. The component shells themselves do not need DOM-level testing because every interesting behavior lives in a pure module that does.

For markdown rendering and card structure, we do test the actual React output — but via `react-dom/server.renderToStaticMarkup`, which works in the existing node environment. No new test dependencies. Test files use `.test.ts` extension (no JSX in test files; use `React.createElement` where needed).

---

## Pre-flight

1. Confirm working directory: `pwd` should print `/Users/kevin/enrollment-resources/Claude/er-seo-tools`.
2. Confirm branch: `git branch --show-current` should print `feature/pillar-analysis-phase-1`.
3. Run baseline tests: `npm test 2>&1 | tail -3`. Expected: ~922 passing.
4. Run baseline types: `npx tsc --noEmit`. Expected: clean.

If any of the above fails, stop and resolve before proceeding.

---

## Task 1: Install `react-markdown`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install react-markdown**

Run:
```bash
npm install react-markdown
```

Expected: package added to `dependencies` in `package.json` at version `^9.x` or current latest.

- [ ] **Step 2: Verify the install**

Run:
```bash
npm ls react-markdown
```

Expected: prints a single `react-markdown@<version>` line under the project root with no `(empty)` or `UNMET` markers.

- [ ] **Step 3: Verify TypeScript still clean**

Run:
```bash
npx tsc --noEmit
```

Expected: exit code 0, no output.

- [ ] **Step 4: Verify tests still pass**

Run:
```bash
npm test 2>&1 | tail -3
```

Expected: same passing count as pre-flight (no regressions).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(pillar): add react-markdown for memo rendering

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `lib/relative-time.ts` — pure timestamp formatters (TDD)

**Files:**
- Create: `lib/relative-time.ts`
- Create: `lib/relative-time.test.ts`

These are pure functions consumed by `RelativeTime.tsx`. Testing them in isolation lets us cover all the time-bucketing branches without rendering React.

- [ ] **Step 1: Write the failing tests**

Create `lib/relative-time.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatRelativeTime, formatAbsoluteTime } from './relative-time';

const NOW = new Date('2026-04-29T12:00:00Z');

describe('formatRelativeTime', () => {
  it('returns null for null input', () => {
    expect(formatRelativeTime(null, NOW)).toBeNull();
  });

  it('returns "just now" for under 60 seconds', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 30_000), NOW)).toBe('just now');
  });

  it('returns "N minutes ago" for 1–59 minutes', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe('5 minutes ago');
    expect(formatRelativeTime(new Date(NOW.getTime() - 1 * 60_000), NOW)).toBe('1 minute ago');
  });

  it('returns "N hours ago" for 1–23 hours', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 3 * 3600_000), NOW)).toBe('3 hours ago');
    expect(formatRelativeTime(new Date(NOW.getTime() - 1 * 3600_000), NOW)).toBe('1 hour ago');
  });

  it('returns "N days ago" for 1–6 days', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 2 * 86_400_000), NOW)).toBe('2 days ago');
    expect(formatRelativeTime(new Date(NOW.getTime() - 1 * 86_400_000), NOW)).toBe('1 day ago');
  });

  it('returns absolute date for > 6 days', () => {
    // 10 days ago = 2026-04-19
    const old = new Date('2026-04-19T12:00:00Z');
    const result = formatRelativeTime(old, NOW);
    // Don't assert exact locale formatting; just assert it includes the year.
    expect(result).toMatch(/2026/);
  });

  it('handles future dates by returning "just now"', () => {
    // Future timestamps shouldn't crash; treat as "just now" (clock skew).
    expect(formatRelativeTime(new Date(NOW.getTime() + 30_000), NOW)).toBe('just now');
  });
});

describe('formatAbsoluteTime', () => {
  it('returns null for null input', () => {
    expect(formatAbsoluteTime(null)).toBeNull();
  });

  it('returns a non-empty localized string for a date', () => {
    const result = formatAbsoluteTime(new Date('2026-04-29T14:30:00Z'));
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    // Should contain the year for any reasonable locale.
    expect(result).toMatch(/2026/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/relative-time.test.ts 2>&1 | tail -15
```

Expected: FAIL with "Cannot find module './relative-time'" or similar.

- [ ] **Step 3: Implement the formatters**

Create `lib/relative-time.ts`:

```ts
// lib/relative-time.ts
// Pure date formatters used by the RelativeTime component. Kept as a
// separate module so its branching logic can be unit-tested without
// rendering React.

export function formatRelativeTime(value: Date | null, now: Date): string | null {
  if (value == null) return null;
  const deltaMs = now.getTime() - value.getTime();
  // Future timestamps (clock skew, etc.) — treat as "just now".
  if (deltaMs < 0) return 'just now';

  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? '1 day ago' : `${days} days ago`;

  // Older than a week — fall back to absolute date.
  return formatAbsoluteTime(value)!;
}

export function formatAbsoluteTime(value: Date | null): string | null {
  if (value == null) return null;
  return value.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run lib/relative-time.test.ts 2>&1 | tail -10
```

Expected: all 9 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/relative-time.ts lib/relative-time.test.ts
git commit -m "feat(pillar): pure relative-time formatters for memo timestamp

Used by the RelativeTime React component (next commit). Extracted to a
pure module so its time-bucketing branches can be tested in vitest's
node environment without rendering React.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `lib/memo-poller-events.ts` — module-level trigger emitter (TDD)

**Files:**
- Create: `lib/memo-poller-events.ts`
- Create: `lib/memo-poller-events.test.ts`

A tiny pub/sub used so the regenerate button can wake the poller without prop drilling through `page.tsx`. Module-level state (Set of subscribers) is fine because there is exactly one poller mounted per page; mount/unmount cleanly subscribe and unsubscribe.

- [ ] **Step 1: Write the failing tests**

Create `lib/memo-poller-events.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onMemoPollerTrigger, emitMemoPollerTrigger, _resetMemoPollerSubscribers } from './memo-poller-events';

describe('memo-poller-events', () => {
  beforeEach(() => {
    _resetMemoPollerSubscribers();
  });

  it('calls subscribers when emit is fired', () => {
    const fn = vi.fn();
    onMemoPollerTrigger(fn);
    emitMemoPollerTrigger();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns an unsubscribe function', () => {
    const fn = vi.fn();
    const unsub = onMemoPollerTrigger(fn);
    unsub();
    emitMemoPollerTrigger();
    expect(fn).not.toHaveBeenCalled();
  });

  it('supports multiple subscribers', () => {
    const a = vi.fn();
    const b = vi.fn();
    onMemoPollerTrigger(a);
    onMemoPollerTrigger(b);
    emitMemoPollerTrigger();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('emit with no subscribers is a no-op', () => {
    expect(() => emitMemoPollerTrigger()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/memo-poller-events.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the emitter**

Create `lib/memo-poller-events.ts`:

```ts
// lib/memo-poller-events.ts
// Tiny module-level pub/sub used so the "Copy Claude Prompt" /
// "Regenerate via Claude" button can wake the MemoPoller without
// prop-drilling through page.tsx. Exactly one poller is mounted per
// pillar-analysis dashboard page, so the global Set of subscribers is fine.

type Listener = () => void;
const listeners = new Set<Listener>();

export function onMemoPollerTrigger(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitMemoPollerTrigger(): void {
  for (const fn of listeners) fn();
}

// Test-only helper. Exported with an underscore to discourage non-test use.
export function _resetMemoPollerSubscribers(): void {
  listeners.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run lib/memo-poller-events.test.ts 2>&1 | tail -10
```

Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/memo-poller-events.ts lib/memo-poller-events.test.ts
git commit -m "feat(pillar): module-level pub/sub for memo poller triggers

Lets CopyClaudePromptButton wake MemoPoller without prop-drilling
through page.tsx. One subscriber per dashboard page; mount/unmount
manage the Set lifecycle cleanly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `lib/memo-poller-machine.ts` — pure polling state machine (TDD)

**Files:**
- Create: `lib/memo-poller-machine.ts`
- Create: `lib/memo-poller-machine.test.ts`

The machine is the brain of `MemoPoller`. The React component will own the timers and visibility listeners; the machine owns the state transitions and decides whether to fire `onPoll` or `onChange` on each tick. Keeping state transitions in a pure module makes them deterministically testable.

The machine has these states: `idle | polling | paused | expired`. Triggers: `start(baseline)`, `tick({ visible, latestUpdatedAt })`, `setVisible(boolean)`, `expireCheck(now)`. It emits side-effect intentions via callbacks: `onPoll()` (caller should fetch), `onChange()` (caller should `router.refresh()`).

- [ ] **Step 1: Write the failing tests**

Create `lib/memo-poller-machine.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createPollingMachine } from './memo-poller-machine';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

describe('createPollingMachine', () => {
  function setup() {
    const onChange = vi.fn();
    const m = createPollingMachine({ onChange, lifetimeMs: FIFTEEN_MIN_MS });
    return { m, onChange };
  }

  it('starts in idle status', () => {
    const { m } = setup();
    expect(m.status()).toBe('idle');
  });

  it('start(baseline) transitions to polling', () => {
    const { m } = setup();
    m.start({ baseline: null, now: 0 });
    expect(m.status()).toBe('polling');
  });

  it('tick with unchanged baseline keeps polling and does not call onChange', () => {
    const { m, onChange } = setup();
    m.start({ baseline: null, now: 0 });
    m.tick({ latestUpdatedAt: null, now: 3000 });
    expect(m.status()).toBe('polling');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('tick with changed baseline (null → string) calls onChange and stops', () => {
    const { m, onChange } = setup();
    m.start({ baseline: null, now: 0 });
    m.tick({ latestUpdatedAt: '2026-04-29T12:00:00Z', now: 3000 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(m.status()).toBe('idle');
  });

  it('tick with changed baseline (old string → newer string) calls onChange and stops', () => {
    const { m, onChange } = setup();
    m.start({ baseline: '2026-04-29T11:00:00Z', now: 0 });
    m.tick({ latestUpdatedAt: '2026-04-29T12:00:00Z', now: 3000 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(m.status()).toBe('idle');
  });

  it('onChange fires exactly once even if tick sees the change again', () => {
    const { m, onChange } = setup();
    m.start({ baseline: null, now: 0 });
    m.tick({ latestUpdatedAt: 'x', now: 3000 });
    // Caller should not call tick after status is idle, but verify defensively.
    m.tick({ latestUpdatedAt: 'x', now: 6000 });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('setVisible(false) pauses; tick does nothing while paused', () => {
    const { m, onChange } = setup();
    m.start({ baseline: null, now: 0 });
    m.setVisible(false);
    expect(m.status()).toBe('paused');
    m.tick({ latestUpdatedAt: 'x', now: 3000 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('setVisible(true) resumes from paused', () => {
    const { m } = setup();
    m.start({ baseline: null, now: 0 });
    m.setVisible(false);
    m.setVisible(true);
    expect(m.status()).toBe('polling');
  });

  it('time spent paused does not count toward lifetime cap', () => {
    const { m, onChange } = setup();
    m.start({ baseline: null, now: 0 });
    // 5 min active polling
    m.tick({ latestUpdatedAt: null, now: 5 * 60 * 1000 });
    // Pause for 20 minutes (longer than the cap)
    m.setVisible(false);
    m.tick({ latestUpdatedAt: null, now: 25 * 60 * 1000 });
    // Resume — only 5 min of active time has elapsed
    m.setVisible(true);
    // Tick again 9 min later — still under the 15 min cap (5 + 9 = 14)
    m.tick({ latestUpdatedAt: null, now: (25 + 9) * 60 * 1000 });
    expect(m.status()).toBe('polling');
    // Tick once more, 2 more minutes — now 16 min active total → expired
    m.tick({ latestUpdatedAt: null, now: (25 + 11) * 60 * 1000 });
    expect(m.status()).toBe('expired');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('expires when cumulative active time exceeds lifetimeMs', () => {
    const { m } = setup();
    m.start({ baseline: null, now: 0 });
    // Tick once near the cap
    m.tick({ latestUpdatedAt: null, now: FIFTEEN_MIN_MS - 1000 });
    expect(m.status()).toBe('polling');
    // Next tick crosses the cap
    m.tick({ latestUpdatedAt: null, now: FIFTEEN_MIN_MS + 1000 });
    expect(m.status()).toBe('expired');
  });

  it('start() while polling resets the baseline and lifetime budget', () => {
    const { m, onChange } = setup();
    m.start({ baseline: null, now: 0 });
    m.tick({ latestUpdatedAt: null, now: 10 * 60 * 1000 });
    // Re-trigger with a new baseline
    m.start({ baseline: 'baseline-from-existing-memo', now: 10 * 60 * 1000 });
    expect(m.status()).toBe('polling');
    // With the budget reset, a tick 10 more minutes later is still allowed
    m.tick({ latestUpdatedAt: 'baseline-from-existing-memo', now: 20 * 60 * 1000 });
    expect(m.status()).toBe('polling');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('start() from expired re-enters polling', () => {
    const { m } = setup();
    m.start({ baseline: null, now: 0 });
    m.tick({ latestUpdatedAt: null, now: FIFTEEN_MIN_MS + 1000 });
    expect(m.status()).toBe('expired');
    m.start({ baseline: null, now: FIFTEEN_MIN_MS + 1000 });
    expect(m.status()).toBe('polling');
  });

  it('stop() transitions to idle', () => {
    const { m } = setup();
    m.start({ baseline: null, now: 0 });
    m.stop();
    expect(m.status()).toBe('idle');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/memo-poller-machine.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the machine**

Create `lib/memo-poller-machine.ts`:

```ts
// lib/memo-poller-machine.ts
// Pure state machine for the memo polling cycle. The React MemoPoller
// component owns timers and the visibilitychange listener; this module
// owns transitions and decides whether each tick triggers a refresh.
//
// States:
//   idle      — not polling
//   polling   — actively polling, visible
//   paused    — was polling, tab hidden
//   expired   — exceeded cumulative active-polling lifetime
//
// Lifetime accounting: only 'polling' time counts toward the cap.
// 'paused' time is excluded.

export type PollingStatus = 'idle' | 'polling' | 'paused' | 'expired';

export interface PollingMachineOptions {
  onChange: () => void;
  /** Cumulative active-polling lifetime cap in ms. */
  lifetimeMs: number;
}

export interface PollingMachine {
  status(): PollingStatus;
  start(args: { baseline: string | null; now: number }): void;
  stop(): void;
  setVisible(visible: boolean): void;
  /**
   * Caller invokes this after each fetch completes. The machine compares
   * `latestUpdatedAt` to the baseline recorded at start; on change, fires
   * `onChange` once and returns to idle. Also handles lifetime accounting.
   */
  tick(args: { latestUpdatedAt: string | null; now: number }): void;
}

export function createPollingMachine(opts: PollingMachineOptions): PollingMachine {
  let status: PollingStatus = 'idle';
  let baseline: string | null = null;
  /** Wall-clock time of the most recent transition into 'polling'. */
  let lastResumedAt = 0;
  /** Total active-polling time accumulated over this cycle. */
  let activeAccumulatedMs = 0;

  function reset() {
    status = 'idle';
    baseline = null;
    lastResumedAt = 0;
    activeAccumulatedMs = 0;
  }

  function accumulateActiveTime(now: number) {
    if (status === 'polling') {
      activeAccumulatedMs += now - lastResumedAt;
      lastResumedAt = now;
    }
  }

  return {
    status: () => status,

    start({ baseline: newBaseline, now }) {
      // Fresh cycle: reset budget and baseline regardless of prior state.
      status = 'polling';
      baseline = newBaseline;
      lastResumedAt = now;
      activeAccumulatedMs = 0;
    },

    stop() {
      reset();
    },

    setVisible(visible) {
      if (status === 'idle' || status === 'expired') return;
      if (visible && status === 'paused') {
        status = 'polling';
        // Reset the active-window start; do NOT touch the accumulator.
        // (Caller should pass `now` to tick — we don't have a clock here.)
        // The next tick will accumulate from this resume point.
        // To make this work without injecting `now`, we set lastResumedAt
        // lazily in tick(): if status flipped to polling without an updated
        // lastResumedAt, the first tick rebases it.
        lastResumedAt = -1; // sentinel: "rebase on next tick"
      } else if (!visible && status === 'polling') {
        // Don't accumulate here either — same lazy-rebase pattern in tick.
        // But to be safe, we DO need to bank what's elapsed up to "now"
        // before pausing. The caller must call setVisible from a
        // visibilitychange handler, which fires at a real wall-clock moment;
        // since we don't have `now` in setVisible, we accept a small
        // rounding loss bounded by one tick interval (~3s). For a 15-min
        // budget that's <= ~0.3% drift, acceptable.
        status = 'paused';
      }
    },

    tick({ latestUpdatedAt, now }) {
      if (status !== 'polling') return;

      // If we just resumed from pause, rebase the active-window start.
      if (lastResumedAt < 0) {
        lastResumedAt = now;
      }

      // Bank elapsed active time up to this tick.
      accumulateActiveTime(now);

      // Lifetime check first — even a successful change after expiry
      // shouldn't fire (caller stopped ticking after expiry).
      if (activeAccumulatedMs >= opts.lifetimeMs) {
        status = 'expired';
        return;
      }

      // Change detection.
      if (latestUpdatedAt !== baseline) {
        opts.onChange();
        reset();
        return;
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run lib/memo-poller-machine.test.ts 2>&1 | tail -15
```

Expected: 12 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/memo-poller-machine.ts lib/memo-poller-machine.test.ts
git commit -m "feat(pillar): pure polling state machine for memo auto-refresh

Action-triggered polling cycle with 15-min cumulative active-time cap.
Pause/resume on tab visibility excludes hidden time from the budget.
Change detection compares narrativeUpdatedAt against the baseline
recorded at start. Pure module — React wrapper in next commit owns
timers and visibility listeners.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Extend `by-session` route to expose narrative fields (TDD)

**Files:**
- Create: `app/api/pillar-analysis/by-session/[sessionId]/route.test.ts`
- Modify: `app/api/pillar-analysis/by-session/[sessionId]/route.ts`

This task is independent of Tasks 2/3/4 and can run in parallel with them.

- [ ] **Step 1: Write the failing tests**

Create `app/api/pillar-analysis/by-session/[sessionId]/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const findFirstMock = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    pillarAnalysis: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
  },
}));

import { GET } from './route';
import { NextRequest } from 'next/server';

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/pillar-analysis/by-session/sess_x');
}

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

describe('GET /api/pillar-analysis/by-session/[sessionId]', () => {
  beforeEach(() => {
    findFirstMock.mockReset();
  });

  it('returns null payload when no analysis exists', async () => {
    findFirstMock.mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams('sess_missing'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pillarAnalysis).toBeNull();
  });

  it('includes aiNarrative and narrativeUpdatedAt in the response (both null)', async () => {
    findFirstMock.mockResolvedValue({
      id: 'pa_1',
      sessionId: 'sess_x',
      status: 'complete',
      error: null,
      score: 8,
      dataCompleteness: 0.9,
      hubRecommendation: null,
      createdAt: new Date('2026-04-29T10:00:00Z'),
      updatedAt: new Date('2026-04-29T10:05:00Z'),
      aiNarrative: null,
      narrativeUpdatedAt: null,
    });
    const res = await GET(makeRequest(), makeParams('sess_x'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pillarAnalysis.aiNarrative).toBeNull();
    expect(body.pillarAnalysis.narrativeUpdatedAt).toBeNull();
  });

  it('includes aiNarrative and narrativeUpdatedAt when present', async () => {
    findFirstMock.mockResolvedValue({
      id: 'pa_2',
      sessionId: 'sess_y',
      status: 'complete',
      error: null,
      score: 8,
      dataCompleteness: 0.9,
      hubRecommendation: null,
      createdAt: new Date('2026-04-29T10:00:00Z'),
      updatedAt: new Date('2026-04-29T11:00:00Z'),
      aiNarrative: '## 1. Bottom line\n\nWorth it.\n',
      narrativeUpdatedAt: new Date('2026-04-29T11:00:00Z'),
    });
    const res = await GET(makeRequest(), makeParams('sess_y'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pillarAnalysis.aiNarrative).toBe('## 1. Bottom line\n\nWorth it.\n');
    expect(body.pillarAnalysis.narrativeUpdatedAt).toBe('2026-04-29T11:00:00.000Z');
  });

  it('parses hubRecommendation JSON when present', async () => {
    findFirstMock.mockResolvedValue({
      id: 'pa_3',
      sessionId: 'sess_z',
      status: 'complete',
      error: null,
      score: 8,
      dataCompleteness: 0.9,
      hubRecommendation: '{"primary":"nest-under-programs","reasoning":[],"alternates":[]}',
      createdAt: new Date('2026-04-29T10:00:00Z'),
      updatedAt: new Date('2026-04-29T10:05:00Z'),
      aiNarrative: null,
      narrativeUpdatedAt: null,
    });
    const res = await GET(makeRequest(), makeParams('sess_z'));
    const body = await res.json();
    expect(body.pillarAnalysis.hubRecommendation).toEqual({
      primary: 'nest-under-programs',
      reasoning: [],
      alternates: [],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run app/api/pillar-analysis/by-session/\[sessionId\]/route.test.ts 2>&1 | tail -15
```

Expected: 2 tests fail because `aiNarrative` and `narrativeUpdatedAt` are not in the response. The "null payload" and "hubRecommendation parsing" tests should already pass against the existing code.

- [ ] **Step 3: Modify the route**

Replace `app/api/pillar-analysis/by-session/[sessionId]/route.ts` with:

```ts
// app/api/pillar-analysis/by-session/[sessionId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const pa = await prisma.pillarAnalysis.findFirst({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
  });

  if (!pa) {
    return NextResponse.json({ pillarAnalysis: null });
  }

  let hubRecommendation: unknown = null;
  try {
    if (pa.hubRecommendation) hubRecommendation = JSON.parse(pa.hubRecommendation);
  } catch { /* ignore */ }

  return NextResponse.json({
    pillarAnalysis: {
      id: pa.id,
      sessionId: pa.sessionId,
      status: pa.status,
      error: pa.error,
      score: pa.score,
      dataCompleteness: pa.dataCompleteness,
      hubRecommendation, // parsed
      createdAt: pa.createdAt,
      updatedAt: pa.updatedAt,
      aiNarrative: pa.aiNarrative,
      narrativeUpdatedAt: pa.narrativeUpdatedAt,
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run app/api/pillar-analysis/by-session/\[sessionId\]/route.test.ts 2>&1 | tail -10
```

Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add app/api/pillar-analysis/by-session/\[sessionId\]/route.ts app/api/pillar-analysis/by-session/\[sessionId\]/route.test.ts
git commit -m "feat(pillar): expose aiNarrative + narrativeUpdatedAt on by-session endpoint

Additive change to the existing public endpoint used by the dashboard's
MemoPoller for change detection. No auth surface change. Tests cover
null and present states for both new fields.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `MemoMarkdown.tsx` — react-markdown wrapper with custom component map

**Files:**
- Create: `app/pillar-analysis/[id]/components/MemoMarkdown.tsx`
- Create: `app/pillar-analysis/[id]/components/MemoMarkdown.test.ts`

The component map is a plain object — values are functional components that use `React.createElement` (no JSX) so the test file can stay `.test.ts`.

- [ ] **Step 1: Write the failing tests**

Create `app/pillar-analysis/[id]/components/MemoMarkdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { MemoMarkdown } from './MemoMarkdown';

function render(source: string): string {
  return renderToStaticMarkup(createElement(MemoMarkdown, { source }));
}

describe('MemoMarkdown', () => {
  it('renders an h2 header with dashboard typography classes', () => {
    const html = render('## Section title');
    expect(html).toMatch(/<h2[^>]*class="[^"]*font-display[^"]*"[^>]*>Section title<\/h2>/);
  });

  it('renders an h3 header with dashboard typography classes', () => {
    const html = render('### Sub section');
    expect(html).toMatch(/<h3[^>]*class="[^"]*font-display[^"]*"[^>]*>Sub section<\/h3>/);
  });

  it('renders a paragraph with body classes', () => {
    const html = render('A paragraph of text.');
    expect(html).toMatch(/<p[^>]*class="[^"]*text-gray-700[^"]*"[^>]*>A paragraph of text\.<\/p>/);
  });

  it('renders an unordered list', () => {
    const html = render('- one\n- two');
    expect(html).toMatch(/<ul[^>]*class="[^"]*list-disc[^"]*"/);
    expect(html).toMatch(/<li[^>]*>one<\/li>/);
    expect(html).toMatch(/<li[^>]*>two<\/li>/);
  });

  it('renders an ordered list', () => {
    const html = render('1. first\n2. second');
    expect(html).toMatch(/<ol[^>]*class="[^"]*list-decimal[^"]*"/);
  });

  it('renders bold and italic inline marks', () => {
    const html = render('A **bold** and *italic* phrase.');
    expect(html).toMatch(/<strong[^>]*class="[^"]*font-semibold[^"]*"[^>]*>bold<\/strong>/);
    expect(html).toMatch(/<em[^>]*class="[^"]*italic[^"]*"[^>]*>italic<\/em>/);
  });

  it('escapes raw HTML rather than rendering it', () => {
    const html = render('A paragraph with <script>alert(1)</script> in it.');
    // react-markdown's default behavior is to render HTML as text (no rehype-raw).
    expect(html).not.toMatch(/<script>/);
    expect(html).toMatch(/&lt;script&gt;/);
  });

  it('renders a full memo skeleton with all six section headers', () => {
    const memo = [
      '## 1. Bottom line', 'Worth it.',
      '## 2. Score interpretation', 'Score 8/10.',
      '## 3. Hub recommendation', 'Nest under programs.',
      '## 4. Pillar topics', '### HVAC', '12 cluster pages.',
      '## 5. Migration sequencing', '1. Refresh posts.',
      '## 6. Caveats', '- Outdated content.',
    ].join('\n\n');
    const html = render(memo);
    expect(html).toMatch(/1\. Bottom line/);
    expect(html).toMatch(/2\. Score interpretation/);
    expect(html).toMatch(/3\. Hub recommendation/);
    expect(html).toMatch(/4\. Pillar topics/);
    expect(html).toMatch(/5\. Migration sequencing/);
    expect(html).toMatch(/6\. Caveats/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run app/pillar-analysis/\[id\]/components/MemoMarkdown.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `app/pillar-analysis/[id]/components/MemoMarkdown.tsx`:

```tsx
'use client';

// app/pillar-analysis/[id]/components/MemoMarkdown.tsx
//
// Renders the strategic memo (markdown) using react-markdown with custom
// component overrides that match the dashboard's typography. We deliberately
// do NOT enable rehype-raw — the memo is server-stored markdown that we
// trust as text, and disabling raw HTML keeps the rendering safe even if a
// future contributor changes the source path. Do not add `rehype-raw` here.

import ReactMarkdown, { type Components } from 'react-markdown';

const components: Components = {
  h2: ({ children }) => (
    <h2 className="font-display font-bold text-xl text-[#1c2d4a] dark:text-white mt-6 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="font-display font-semibold text-lg text-[#1c2d4a] dark:text-white mt-4">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="text-gray-700 dark:text-white/80 mt-2 leading-relaxed">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc ml-6 mt-2 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal ml-6 mt-2 space-y-1">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-gray-700 dark:text-white/80">{children}</li>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-[#1c2d4a] dark:text-white">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic">{children}</em>
  ),
};

export function MemoMarkdown({ source }: { source: string }) {
  return <ReactMarkdown components={components}>{source}</ReactMarkdown>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run app/pillar-analysis/\[id\]/components/MemoMarkdown.test.ts 2>&1 | tail -15
```

Expected: 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add app/pillar-analysis/\[id\]/components/MemoMarkdown.tsx app/pillar-analysis/\[id\]/components/MemoMarkdown.test.ts
git commit -m "feat(pillar): MemoMarkdown component with dashboard-matched typography

Wraps react-markdown with hand-rolled component overrides for h2/h3/p/
ul/ol/li/strong/em that match the existing dashboard's typography
(font-display headers, navy palette, dark-mode variants). Default
sanitization is preserved — rehype-raw is intentionally NOT enabled.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `RelativeTime.tsx` — first-paint-null timestamp

**Files:**
- Create: `app/pillar-analysis/[id]/components/RelativeTime.tsx`

No new test file — the formatters are tested in `lib/relative-time.test.ts` (Task 2). The component itself is a thin wrapper whose only behavior is "return null on server, render on client mount, re-tick every 60s". Manual verification on the dev server suffices.

- [ ] **Step 1: Implement the component**

Create `app/pillar-analysis/[id]/components/RelativeTime.tsx`:

```tsx
'use client';

// app/pillar-analysis/[id]/components/RelativeTime.tsx
//
// Renders a timestamp like "Updated 3 hours ago" with the absolute time
// available on hover via the `title` attribute.
//
// Hydration safety: returns `null` from the FIRST render (server and
// initial client render). After the component mounts, useEffect sets a
// state flag and the next render emits the formatted strings in the
// user's local timezone. Because the server never produces a localized
// string, there is no string for the client to mismatch against.

import { useEffect, useState } from 'react';
import { formatRelativeTime, formatAbsoluteTime } from '@/lib/relative-time';

interface Props {
  value: Date | string | null;
  className?: string;
}

export function RelativeTime({ value, className }: Props) {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    setMounted(true);
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!mounted) return null;
  if (value == null) return null;

  const date = typeof value === 'string' ? new Date(value) : value;
  const relative = formatRelativeTime(date, now);
  const absolute = formatAbsoluteTime(date);
  if (relative == null || absolute == null) return null;

  return (
    <span className={className} title={absolute}>
      {relative}
    </span>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Verify existing tests still pass**

```bash
npm test 2>&1 | tail -3
```

Expected: same passing count plus the formatter tests added in Task 2.

- [ ] **Step 4: Commit**

```bash
git add app/pillar-analysis/\[id\]/components/RelativeTime.tsx
git commit -m "feat(pillar): RelativeTime component (first-paint-null, hover-for-absolute)

Returns null on server/initial render to eliminate the timezone hydration
mismatch. After mount, renders relative time with absolute time on hover
via the title attribute, re-ticking every 60s. Backed by pure formatters
in lib/relative-time.ts (tested separately).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `MemoPoller.tsx` — React wrapper around the polling machine

**Files:**
- Create: `app/pillar-analysis/[id]/components/MemoPoller.tsx`

Thin wrapper. Owns: the `setInterval` that drives ticks (3s), the `visibilitychange` listener, the fetch call, the `router.refresh()` call on change, and the "Check for memo" affordance after expiry. Logic-heavy parts live in `lib/memo-poller-machine.ts` (tested in Task 4) and `lib/memo-poller-events.ts` (tested in Task 3).

- [ ] **Step 1: Implement the component**

Create `app/pillar-analysis/[id]/components/MemoPoller.tsx`:

```tsx
'use client';

// app/pillar-analysis/[id]/components/MemoPoller.tsx
//
// Action-triggered, time-bounded polling for memo arrival/regeneration.
// See docs/superpowers/specs/2026-04-29-pillar-analysis-phase-2-3-memo-rendering-design.md §4.4.
//
// Triggers: (1) page mount with no memo, (2) emitted event from the
// regenerate button. Stops on narrativeUpdatedAt change → router.refresh()
// → server re-renders the page. Hard 15-min cumulative-active cap.
// Pauses while the tab is hidden.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPollingMachine } from '@/lib/memo-poller-machine';
import { onMemoPollerTrigger } from '@/lib/memo-poller-events';

const POLL_INTERVAL_MS = 3000;
const LIFETIME_MS = 15 * 60 * 1000;

interface Props {
  sessionId: string;
  initialNarrativeUpdatedAt: string | null;
  /** True if there's no memo yet — the poller auto-starts a cycle on mount. */
  autoStartOnMount: boolean;
}

export function MemoPoller({ sessionId, initialNarrativeUpdatedAt, autoStartOnMount }: Props) {
  const router = useRouter();
  const [expired, setExpired] = useState(false);

  // Use a ref for the machine so re-renders don't recreate it.
  const machineRef = useRef<ReturnType<typeof createPollingMachine> | null>(null);
  if (machineRef.current === null) {
    machineRef.current = createPollingMachine({
      onChange: () => router.refresh(),
      lifetimeMs: LIFETIME_MS,
    });
  }
  const machine = machineRef.current;

  // Latest baseline / mounted-state tracking via ref so closures see fresh values.
  const baselineRef = useRef<string | null>(initialNarrativeUpdatedAt);

  // Visibility tracking
  useEffect(() => {
    const onVisibility = () => {
      machine.setVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [machine]);

  // Trigger event subscription (regenerate button)
  useEffect(() => {
    return onMemoPollerTrigger(() => {
      // Refresh the baseline from the latest known value, then start a new cycle.
      machine.start({ baseline: baselineRef.current, now: Date.now() });
      setExpired(false);
    });
  }, [machine]);

  // Auto-start on mount when there's no memo
  useEffect(() => {
    if (autoStartOnMount) {
      machine.start({ baseline: initialNarrativeUpdatedAt, now: Date.now() });
      setExpired(false);
    }
  }, [autoStartOnMount, initialNarrativeUpdatedAt, machine]);

  // Polling loop
  useEffect(() => {
    const interval = setInterval(async () => {
      if (machine.status() !== 'polling') return;
      try {
        const res = await fetch(`/api/pillar-analysis/by-session/${sessionId}`);
        if (!res.ok) return;
        const body = await res.json();
        const latest: string | null = body?.pillarAnalysis?.narrativeUpdatedAt ?? null;
        baselineRef.current = baselineRef.current ?? latest; // first response sets baseline if missing
        machine.tick({ latestUpdatedAt: latest, now: Date.now() });
        if (machine.status() === 'expired') setExpired(true);
      } catch {
        // Network errors are silent — next tick will retry.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sessionId, machine]);

  if (!expired) return null;

  return (
    <div className="mt-4 text-sm text-gray-500 dark:text-white/50">
      Stopped checking after 15 minutes.{' '}
      <button
        type="button"
        onClick={() => {
          machine.start({ baseline: baselineRef.current, now: Date.now() });
          setExpired(false);
        }}
        className="underline hover:text-[#1c2d4a] dark:hover:text-white"
      >
        Check for memo
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Verify tests still pass**

```bash
npm test 2>&1 | tail -3
```

Expected: same passing count.

- [ ] **Step 4: Commit**

```bash
git add app/pillar-analysis/\[id\]/components/MemoPoller.tsx
git commit -m "feat(pillar): MemoPoller — React wrapper for memo auto-refresh

Wraps lib/memo-poller-machine with a 3s setInterval, visibilitychange
listener, fetch against the by-session endpoint, and router.refresh()
on change. Subscribes to lib/memo-poller-events so the regenerate
button can wake it. Renders nothing until the cycle expires; on
expiry surfaces a 'Check for memo' affordance that starts a fresh cycle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `StrategicMemoCard.tsx` + test

**Files:**
- Create: `app/pillar-analysis/[id]/components/StrategicMemoCard.tsx`
- Create: `app/pillar-analysis/[id]/components/StrategicMemoCard.test.ts`

Top-level card. Server component (no `'use client'`). Branches on memo presence; always renders the `MemoPoller` so the regenerate button can wake it.

- [ ] **Step 1: Write the failing tests**

Create `app/pillar-analysis/[id]/components/StrategicMemoCard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { StrategicMemoCard } from './StrategicMemoCard';

function render(props: { aiNarrative: string | null; narrativeUpdatedAt: Date | null; sessionId: string }) {
  return renderToStaticMarkup(createElement(StrategicMemoCard, props));
}

describe('StrategicMemoCard', () => {
  it('null state renders the instructional hint', () => {
    const html = render({
      aiNarrative: null,
      narrativeUpdatedAt: null,
      sessionId: 'sess_x',
    });
    expect(html).toMatch(/Strategic Memo/);
    expect(html).toMatch(/Strategic memo not yet generated/);
    expect(html).toMatch(/Copy Claude Prompt/);
  });

  it('null state does not render markdown', () => {
    const html = render({
      aiNarrative: null,
      narrativeUpdatedAt: null,
      sessionId: 'sess_x',
    });
    expect(html).not.toMatch(/<h2/);
  });

  it('has-memo state renders the markdown', () => {
    const html = render({
      aiNarrative: '## 1. Bottom line\n\nWorth it.',
      narrativeUpdatedAt: new Date('2026-04-29T11:00:00Z'),
      sessionId: 'sess_x',
    });
    expect(html).toMatch(/<h2[^>]*>1\. Bottom line<\/h2>/);
    expect(html).toMatch(/Worth it\./);
  });

  it('has-memo state does not render the null-state hint', () => {
    const html = render({
      aiNarrative: '## 1. Bottom line\n\nWorth it.',
      narrativeUpdatedAt: new Date('2026-04-29T11:00:00Z'),
      sessionId: 'sess_x',
    });
    expect(html).not.toMatch(/Strategic memo not yet generated/);
  });

  it('renders the section anchor id="memo"', () => {
    const html = render({
      aiNarrative: null,
      narrativeUpdatedAt: null,
      sessionId: 'sess_x',
    });
    expect(html).toMatch(/id="memo"/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run app/pillar-analysis/\[id\]/components/StrategicMemoCard.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the card**

Create `app/pillar-analysis/[id]/components/StrategicMemoCard.tsx`:

```tsx
// app/pillar-analysis/[id]/components/StrategicMemoCard.tsx
// Server Component. Branches on memo presence and always mounts MemoPoller
// (idle until triggered) so the regenerate button can wake it.

import { MemoMarkdown } from './MemoMarkdown';
import { RelativeTime } from './RelativeTime';
import { MemoPoller } from './MemoPoller';

interface Props {
  aiNarrative: string | null;
  narrativeUpdatedAt: Date | null;
  sessionId: string;
}

export function StrategicMemoCard({ aiNarrative, narrativeUpdatedAt, sessionId }: Props) {
  const hasMemo = aiNarrative != null && aiNarrative.length > 0;
  const initialUpdatedAt = narrativeUpdatedAt ? narrativeUpdatedAt.toISOString() : null;

  return (
    <section
      id="memo"
      className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6 scroll-mt-16"
    >
      <header className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <h2 className="font-display font-bold text-lg text-[#1c2d4a] dark:text-white">
          Strategic Memo
        </h2>
        {hasMemo && narrativeUpdatedAt && (
          <RelativeTime
            value={narrativeUpdatedAt}
            className="text-sm text-gray-500 dark:text-white/50"
          />
        )}
      </header>

      {hasMemo ? (
        <div className="mt-2">
          <MemoMarkdown source={aiNarrative!} />
        </div>
      ) : (
        <p className="mt-2 text-gray-700 dark:text-white/80 leading-relaxed">
          Strategic memo not yet generated. Click <strong className="font-semibold text-[#1c2d4a] dark:text-white">Copy Claude Prompt</strong> above and paste it into Claude Desktop. The memo will appear here automatically.
        </p>
      )}

      <MemoPoller
        sessionId={sessionId}
        initialNarrativeUpdatedAt={initialUpdatedAt}
        autoStartOnMount={!hasMemo}
      />
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run app/pillar-analysis/\[id\]/components/StrategicMemoCard.test.ts 2>&1 | tail -10
```

Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add app/pillar-analysis/\[id\]/components/StrategicMemoCard.tsx app/pillar-analysis/\[id\]/components/StrategicMemoCard.test.ts
git commit -m "feat(pillar): StrategicMemoCard renders memo or null-state hint

Server component that branches on aiNarrative presence. Has-memo state
renders MemoMarkdown + RelativeTime; null state renders an instructional
hint pointing at the Copy Claude Prompt button. MemoPoller is mounted
in both states so the regenerate button can wake it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: `SectionNav.tsx` — sticky page-section nav

**Files:**
- Create: `app/pillar-analysis/[id]/components/SectionNav.tsx`

No tests — trivial component, manual verification.

- [ ] **Step 1: Implement the component**

Create `app/pillar-analysis/[id]/components/SectionNav.tsx`:

```tsx
'use client';

// app/pillar-analysis/[id]/components/SectionNav.tsx
// Sticky page-section nav. Plain anchor links; no JS scroll-handling.
// Active-section highlighting via IntersectionObserver is deferred to
// a future phase.

const LINKS = [
  { id: 'score', label: 'Score' },
  { id: 'memo', label: 'Memo' },
  { id: 'hub', label: 'Hub' },
  { id: 'pillars', label: 'Pillars' },
  { id: 'urls', label: 'URLs' },
];

export function SectionNav() {
  return (
    <nav
      className="sticky top-0 z-10 -mx-6 px-6 py-2 bg-[#f4f6f9]/90 dark:bg-navy-deep/90 backdrop-blur border-b border-gray-200 dark:border-navy-border"
      aria-label="Page sections"
    >
      <ul className="flex gap-4 text-sm">
        {LINKS.map(link => (
          <li key={link.id}>
            <a
              href={`#${link.id}`}
              className="text-gray-600 dark:text-white/60 hover:text-[#1c2d4a] dark:hover:text-white"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/pillar-analysis/\[id\]/components/SectionNav.tsx
git commit -m "feat(pillar): SectionNav sticky page-section nav for tall dashboard

Plain anchor links: Score / Memo / Hub / Pillars / URLs. Sticky to
top with backdrop-blur. Active-section highlighting via
IntersectionObserver deferred to a future phase.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Modify `CopyClaudePromptButton.tsx` — contextual label + emit on success

**Files:**
- Modify: `app/pillar-analysis/[id]/components/CopyClaudePromptButton.tsx`

Two changes: accept a `hasMemo: boolean` prop that switches the idle label between "Copy Claude Prompt" and "Regenerate via Claude"; and after a successful clipboard copy, emit `memo-poller-trigger` so the poller starts/restarts a cycle.

- [ ] **Step 1: Update the component**

Replace `app/pillar-analysis/[id]/components/CopyClaudePromptButton.tsx` with:

```tsx
'use client';

import { useState } from 'react';
import { composePayload } from '@/lib/pillar-prompt';
import { emitMemoPollerTrigger } from '@/lib/memo-poller-events';
import { ClipboardFallbackModal } from './ClipboardFallbackModal';

interface Props {
  analysisId: string;
  status: string; // 'pending' | 'running' | 'complete' | 'error'
  webappUrl: string;
  hasMemo: boolean;
}

type ButtonState = 'idle' | 'minting' | 'copied' | 'mint-failed' | 'service-error';

const STATE_CLASSES: Record<ButtonState, string> = {
  idle: 'bg-[#f5a623] text-[#1c2d4a] hover:bg-[#e8971a]',
  minting: 'bg-gray-300 text-gray-600 cursor-wait',
  copied: 'bg-green-500 text-white',
  'mint-failed': 'bg-red-500 text-white',
  'service-error': 'bg-red-700 text-white',
};

function idleLabel(hasMemo: boolean): string {
  return hasMemo ? 'Regenerate via Claude' : 'Copy Claude Prompt';
}

function stateLabel(state: ButtonState, hasMemo: boolean): string {
  switch (state) {
    case 'idle': return idleLabel(hasMemo);
    case 'minting': return 'Minting…';
    case 'copied': return 'Copied!';
    case 'mint-failed': return 'Mint failed — retry';
    case 'service-error': return 'Token service unavailable';
  }
}

export function CopyClaudePromptButton({ analysisId, status, webappUrl, hasMemo }: Props) {
  const [state, setState] = useState<ButtonState>('idle');
  const [fallbackPayload, setFallbackPayload] = useState<string | null>(null);

  const disabled = status !== 'complete' || state === 'minting';

  const onClick = async () => {
    if (disabled) return;
    setState('minting');
    try {
      const res = await fetch(`/api/pillar-analysis/${analysisId}/mint-token`, {
        method: 'POST',
      });
      if (res.status === 500) {
        setState('service-error');
        setTimeout(() => setState('idle'), 4000);
        return;
      }
      if (!res.ok) {
        setState('mint-failed');
        setTimeout(() => setState('idle'), 3000);
        return;
      }
      const { token } = (await res.json()) as { token: string };
      const payload = composePayload({ webappUrl, analysisId, token });

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(payload);
          setState('copied');
          emitMemoPollerTrigger();
          setTimeout(() => setState('idle'), 2000);
        } catch {
          setFallbackPayload(payload);
          emitMemoPollerTrigger();
          setState('idle');
        }
      } else {
        setFallbackPayload(payload);
        emitMemoPollerTrigger();
        setState('idle');
      }
    } catch {
      setState('mint-failed');
      setTimeout(() => setState('idle'), 3000);
    }
  };

  const tooltip = status !== 'complete'
    ? `Available once analysis completes (current status: ${status})`
    : '';

  return (
    <>
      <button
        id="copy-prompt"
        onClick={onClick}
        disabled={disabled}
        title={tooltip}
        className={`px-4 py-2 text-sm font-medium rounded transition-colors ${
          disabled ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : STATE_CLASSES[state]
        }`}
      >
        {disabled && state === 'idle' ? idleLabel(hasMemo) : stateLabel(state, hasMemo)}
      </button>
      {fallbackPayload && (
        <ClipboardFallbackModal
          payload={fallbackPayload}
          onClose={() => setFallbackPayload(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Verify existing tests still pass**

```bash
npm test 2>&1 | tail -3
```

Expected: same passing count (no test for this component exists; we did not break dependents).

- [ ] **Step 4: Commit**

```bash
git add app/pillar-analysis/\[id\]/components/CopyClaudePromptButton.tsx
git commit -m "feat(pillar): button label switches to 'Regenerate via Claude' when memo exists

Adds hasMemo prop and emits memo-poller-trigger after a successful copy
so MemoPoller starts a fresh polling cycle on regeneration. Same emit
on fallback-modal path so analysts using browsers without
navigator.clipboard.writeText also get the auto-refresh experience.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Wire up `page.tsx` — mount nav and memo card, add section ids

**Files:**
- Modify: `app/pillar-analysis/[id]/page.tsx`

- [ ] **Step 1: Update the page**

Replace `app/pillar-analysis/[id]/page.tsx` with:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { ScoreCard } from './components/ScoreCard';
import { SubscoreBreakdown } from './components/SubscoreBreakdown';
import { HubRecommendationCard } from './components/HubRecommendationCard';
import { PillarTopicList } from './components/PillarTopicList';
import { UrlVerdictTable } from './components/UrlVerdictTable';
import { DataCompletenessBanner } from './components/DataCompletenessBanner';
import { CopyClaudePromptButton } from './components/CopyClaudePromptButton';
import { StrategicMemoCard } from './components/StrategicMemoCard';
import { SectionNav } from './components/SectionNav';
import type {
  HubRecommendation, PillarTopic, SubscoreBreakdown as SB, SubscorePresence, SubscoreContext, UrlRecord,
} from '@/lib/services/pillarAnalysis/types';

export default async function PillarAnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pa = await prisma.pillarAnalysis.findUnique({
    where: { id },
    include: { session: true },
  });
  if (!pa) notFound();
  if (pa.status !== 'complete') {
    return (
      <div className="p-8 text-gray-700 dark:text-white/80">
        Analysis status: <span className="font-mono">{pa.status}</span>
        {pa.error && <pre className="mt-4 text-red-500">{pa.error}</pre>}
      </div>
    );
  }

  const webappUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const subscores = JSON.parse(pa.subscores!) as SB;
  const subscorePresence = pa.subscorePresence
    ? (JSON.parse(pa.subscorePresence) as SubscorePresence)
    : null;
  const subscoreContext = pa.subscoreContext
    ? (JSON.parse(pa.subscoreContext) as SubscoreContext)
    : null;
  const hub = JSON.parse(pa.hubRecommendation!) as HubRecommendation;
  const topics = JSON.parse(pa.pillarTopics!) as PillarTopic[];
  const verdicts = JSON.parse(pa.urlVerdicts!) as UrlRecord[];

  const siteName = pa.session?.siteName || 'Site';
  const numPillars = topics.length;
  const totalUrls = verdicts.length;
  const completenessPct = Math.round((pa.dataCompleteness ?? 0) * 100);
  const generatedAt = pa.createdAt.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const hasMemo = pa.aiNarrative != null && pa.aiNarrative.length > 0;

  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <main className="max-w-7xl mx-auto px-6 py-12 space-y-6">
        <SectionNav />

        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Link
              href={`/seo-parser/results/${pa.session.id}`}
              className="text-sm text-gray-500 dark:text-white/50 hover:text-[#1c2d4a] dark:hover:text-white inline-flex items-center mb-3"
            >
              ← Back to SEO Audit
            </Link>
            <h1 className="font-display font-bold text-2xl text-[#1c2d4a] dark:text-white">
              {siteName} — Pillar Analysis
            </h1>
            <p className="text-gray-500 dark:text-white/50 text-sm mt-1">
              Generated {generatedAt} · {totalUrls} URL{totalUrls === 1 ? '' : 's'} · {numPillars} pillar{numPillars === 1 ? '' : 's'} · {completenessPct}% data completeness
            </p>
          </div>
          <CopyClaudePromptButton
            analysisId={pa.id}
            status={pa.status}
            webappUrl={webappUrl}
            hasMemo={hasMemo}
          />
        </header>

        {pa.dataCompleteness != null && pa.dataCompleteness < 0.5 && (
          <DataCompletenessBanner completeness={pa.dataCompleteness} />
        )}

        <div id="score" className="grid grid-cols-1 lg:grid-cols-3 gap-6 scroll-mt-16">
          <ScoreCard score={pa.score!} dataCompleteness={pa.dataCompleteness ?? 0} />
          <div className="lg:col-span-2">
            <SubscoreBreakdown
              subscores={subscores}
              subscorePresence={subscorePresence}
              subscoreContext={subscoreContext}
            />
          </div>
        </div>

        <StrategicMemoCard
          aiNarrative={pa.aiNarrative}
          narrativeUpdatedAt={pa.narrativeUpdatedAt}
          sessionId={pa.session.id}
        />

        <div id="hub" className="scroll-mt-16">
          <HubRecommendationCard hub={hub} />
        </div>

        <div id="pillars" className="scroll-mt-16">
          <PillarTopicList topics={topics} verdicts={verdicts} />
        </div>

        <div id="urls" className="scroll-mt-16">
          <UrlVerdictTable verdicts={verdicts} />
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Verify the build still works**

```bash
npm run build 2>&1 | tail -10
```

Expected: `✓ Compiled successfully` and the route `/pillar-analysis/[id]` is listed in the route table.

- [ ] **Step 4: Verify all tests pass**

```bash
npm test 2>&1 | tail -3
```

Expected: passing count = baseline (922) + new tests (9 + 4 + 12 + 4 + 8 + 5 = 42), so ~964 passing. Adjust to actual count.

- [ ] **Step 5: Commit**

```bash
git add app/pillar-analysis/\[id\]/page.tsx
git commit -m "feat(pillar): wire StrategicMemoCard, SectionNav, contextual button label into page

Mounts SectionNav at top of <main>, inserts StrategicMemoCard between
Score grid and HubRecommendationCard, adds id+scroll-mt anchors on
each major section, and passes hasMemo to CopyClaudePromptButton so
its label switches to 'Regenerate via Claude' when a memo exists.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Manual verification on the dev server

**Files:** None (verification only)

This is the visual smoke check. Pure unit tests cover the logic; this confirms the pieces compose correctly in a browser.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Expected: server starts on `http://localhost:3000`, no compile errors.

- [ ] **Step 2: Open a pillar-analysis page with no memo**

Navigate to a `/pillar-analysis/[id]` page where `aiNarrative` is null in the DB. (You can pick one from a recent SF parse, or null out the column on a test row via `sqlite3 prisma/local-dev.db`.)

Verify:
- The Strategic Memo card appears between the Score grid and the Hub Recommendation card.
- The card body shows the instructional hint referencing "Copy Claude Prompt".
- The header button label reads "Copy Claude Prompt".
- The sticky nav appears at the top of the page with five links: Score · Memo · Hub · Pillars · URLs.
- Clicking each link jumps to the matching section (with a small offset from the sticky nav, not flush against it).
- No React hydration warnings in the browser console.
- Open the Network tab and confirm a `GET /api/pillar-analysis/by-session/...` request fires every 3 seconds.
- Switch tabs (or minimize) and verify the requests stop. Switch back and verify they resume.

- [ ] **Step 3: Simulate a memo arrival**

In a separate terminal, write a memo to the DB row directly:

```bash
sqlite3 prisma/local-dev.db "UPDATE PillarAnalysis SET aiNarrative='## 1. Bottom line\n\nWorth it.\n\n## 2. Score interpretation\n\nScore 8/10 is strong.', narrativeUpdatedAt=datetime('now') WHERE id='<your-id>';"
```

Verify:
- Within ~3 seconds, the dashboard refreshes and the memo appears.
- The memo renders with styled h2/h3 headers matching the dashboard.
- A "Updated just now" line appears in the card header.
- Hover over the timestamp — the absolute time shows in a tooltip.
- The header button label has switched to "Regenerate via Claude".

- [ ] **Step 4: Test the regenerate flow**

Click "Regenerate via Claude". The button should briefly show "Minting…" then "Copied!" — confirming the clipboard copy.

In a separate terminal, write an updated memo with a fresh `narrativeUpdatedAt`:

```bash
sqlite3 prisma/local-dev.db "UPDATE PillarAnalysis SET aiNarrative='## 1. Bottom line\n\nUpdated take.\n', narrativeUpdatedAt=datetime('now', '+1 second') WHERE id='<your-id>';"
```

Verify:
- Within ~3 seconds, the page refreshes and shows the updated memo.

- [ ] **Step 5: Test the 15-min cap**

(Optional smoke — only if you want to verify the cap manually. Not required for ship.) Open browser devtools, throttle the system clock or set the lifetime constant temporarily to a small value (e.g. 30 seconds), reload, leave the tab visible without changing the DB, and verify the "Stopped checking after 15 minutes. Check for memo" affordance appears after the cap. Click "Check for memo" and verify polling resumes.

If you change `LIFETIME_MS` for this test, **revert before committing.**

- [ ] **Step 6: Stop the dev server**

Ctrl+C in the dev-server terminal.

- [ ] **Step 7: Final pre-merge gate**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -3 && npm run build 2>&1 | tail -5
```

All three must pass cleanly.

No commit for this task — it's verification only.

---

## Self-review checklist (run before declaring done)

- [ ] Spec coverage: every numbered goal in §2 of the spec maps to at least one task here.
  - Goal 1 (display memo): Tasks 6, 9, 12.
  - Goal 2 (null state hint): Task 9.
  - Goal 3 (relative timestamp): Tasks 2, 7.
  - Goal 4 (auto-refresh on first arrival): Tasks 3, 4, 8.
  - Goal 5 (regenerate button label): Task 11.
  - Goal 6 (sticky section nav): Tasks 10, 12.
- [ ] Acceptance criteria from spec §10 each have a verification step in Task 13 or a unit test.
- [ ] No new dependencies beyond `react-markdown`. (Verify by grepping commits for `package.json` changes.)
- [ ] All new test files use `.test.ts` (not `.test.tsx`) to match `vitest.config.ts` include pattern.
- [ ] No `'use client'` on `StrategicMemoCard.tsx` (it's a server component).
- [ ] `'use client'` IS present on `MemoMarkdown.tsx`, `RelativeTime.tsx`, `MemoPoller.tsx`, `SectionNav.tsx`, `CopyClaudePromptButton.tsx`.

---

## Parallelization map (for subagent-driven execution)

After Task 1 (install dep) completes, these can run in parallel:
- Task 2 (relative-time)
- Task 3 (events)
- Task 5 (route)
- Task 6 (MemoMarkdown — depends only on Task 1)
- Task 10 (SectionNav — independent)

Then in parallel:
- Task 4 (poller machine — independent of above except install)
- Task 7 (RelativeTime — depends on Task 2)

Then:
- Task 8 (MemoPoller — depends on Tasks 3 + 4)

Then:
- Task 9 (StrategicMemoCard — depends on Tasks 6, 7, 8)
- Task 11 (CopyClaudePromptButton — depends on Task 3)

Finally sequentially:
- Task 12 (page.tsx — depends on Tasks 9, 10, 11)
- Task 13 (manual verification)
