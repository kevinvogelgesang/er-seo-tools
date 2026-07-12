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
  /**
   * External signal (e.g. an SSE push) that the underlying data changed,
   * bypassing the poll interval. While the tab is visible and the machine
   * is 'polling' or 'idle', this fires `onChange` immediately (same effect
   * as `tick()` observing a baseline change) and returns to idle. While
   * hidden, it only records `dirty = true` — no fetch, no effect on the
   * active-time budget — until the next visibility-resume, which then
   * fires `onChange` immediately and clears `dirty`. While 'expired', this
   * is a no-op; the caller must restart explicitly via `start()`.
   */
  invalidate(): void;
}

export function createPollingMachine(opts: PollingMachineOptions): PollingMachine {
  let status: PollingStatus = 'idle';
  let baseline: string | null = null;
  /** Wall-clock time of the most recent transition into 'polling'. */
  let lastResumedAt = 0;
  /** Total active-polling time accumulated over this cycle. */
  let activeAccumulatedMs = 0;
  /**
   * The `now` value of the most recent tick, regardless of state. Used to
   * rebase `lastResumedAt` when resuming from pause — so paused time between
   * the last tick and setVisible(true) is excluded from the active budget.
   */
  let lastTickNow = 0;
  /**
   * Tracks the tab's visibility independent of `status`, so `invalidate()`
   * can decide immediate-vs-dirty even when idle/expired (states where
   * `setVisible` otherwise no-ops on `status` itself).
   */
  let tabVisible = true;
  /**
   * Set when `invalidate()` arrives while hidden; consumed (and cleared)
   * on the next visibility-resume, which fires `onChange` immediately.
   */
  let dirty = false;

  function reset() {
    status = 'idle';
    baseline = null;
    lastResumedAt = 0;
    activeAccumulatedMs = 0;
    lastTickNow = 0;
    dirty = false;
  }

  function accumulateActiveTime(now: number) {
    if (status === 'polling') {
      activeAccumulatedMs += now - lastResumedAt;
      lastResumedAt = now;
    }
  }

  /** Shared by invalidate()'s immediate path and the dirty-resume path. */
  function fireChangeAndReset() {
    opts.onChange();
    reset();
  }

  return {
    status: () => status,

    start({ baseline: newBaseline, now }) {
      // Fresh cycle: reset budget and baseline regardless of prior state.
      status = 'polling';
      baseline = newBaseline;
      lastResumedAt = now;
      activeAccumulatedMs = 0;
      lastTickNow = now;
      dirty = false;
    },

    stop() {
      reset();
    },

    setVisible(visible) {
      tabVisible = visible;
      if (visible) {
        // An expired machine stays dead: never fire onChange from expired.
        // The caller must restart explicitly via start() (which also clears
        // any dirty flag set while hidden).
        if (status === 'expired') return;
        if (dirty) {
          // An invalidate() arrived while hidden — refetch immediately and
          // clear dirty. This runs regardless of prior status ('paused' OR
          // 'idle'): a dirty flag set while hidden-and-idle would otherwise
          // be silently dropped on resume.
          fireChangeAndReset();
          return;
        }
        if (status === 'paused') {
          status = 'polling';
          // Resume: set the active-window start to the last known tick time
          // (the most recent tick that fired while we were paused, or before).
          // This way, the gap from that tick to the first active tick counts
          // toward the lifetime budget, but the time between setVisible(false)
          // and that last paused tick is also excluded.
          lastResumedAt = -1; // sentinel: "rebase on next tick using lastTickNow"
        }
        return;
      }
      if (status === 'polling') {
        // Banking what's elapsed so far is handled lazily in tick(). Since we
        // don't have `now` here, we accept up to one tick interval of rounding
        // loss (~3s on a 15-min budget = ~0.3% drift, acceptable).
        status = 'paused';
      }
    },

    tick({ latestUpdatedAt, now }) {
      if (status !== 'polling') {
        // Even while paused, record the tick time so that resume can rebase
        // from the last known tick (excluding the gap to setVisible(true)).
        lastTickNow = now;
        return;
      }

      // If we just resumed from pause, rebase the active-window start to the
      // last known tick time (set during the most recent paused tick) so that
      // paused wall-clock time is excluded from the active budget.
      if (lastResumedAt < 0) {
        lastResumedAt = lastTickNow;
      }

      // Update lastTickNow for the active tick.
      lastTickNow = now;

      // Bank elapsed active time up to this tick.
      accumulateActiveTime(now);

      // Change detection FIRST. A confirmed write-back must always win over a
      // lifetime timeout, even when both land on the same tick — otherwise a
      // short poll window (e.g. one anchored to mint time) can expire on the
      // exact tick the result arrives and silently drop the refresh.
      if (latestUpdatedAt !== baseline) {
        opts.onChange();
        reset();
        return;
      }

      // Lifetime cap: stop polling once cumulative active time exceeds the
      // budget and nothing changed.
      if (activeAccumulatedMs >= opts.lifetimeMs) {
        status = 'expired';
        return;
      }
    },

    invalidate() {
      if (!tabVisible) {
        // Hidden: record the pending change only. No fetch, and no effect
        // on activeAccumulatedMs/lastResumedAt — hidden time stays excluded.
        dirty = true;
        return;
      }
      if (status === 'polling' || status === 'idle') {
        fireChangeAndReset();
      }
      // 'expired' while visible: no-op by design — the caller must restart
      // explicitly via start() rather than have invalidate() silently
      // resurrect an expired cycle.
    },
  };
}
