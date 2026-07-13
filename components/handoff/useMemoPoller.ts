'use client';

// components/handoff/useMemoPoller.ts
//
// D1 PR3 Task 12 — the memo-poller wiring, once. This hook is a byte-for-byte
// extraction of the ~100 lines that were quadruplicated (and hand-patched 4x
// during A5 PR4) across:
//   - components/seo-parser/SeoRoadmapCard.tsx
//   - components/keyword-research/KeywordMemoCard.tsx
//   - app/(app)/pillar-analysis/[id]/components/MemoPoller.tsx
//   - components/clients/KeywordStrategyCard.tsx
//
// The hook NEVER bypasses lib/memo-poller-machine.ts — it only owns the
// timers, the visibilitychange listener, the SSE subscription, and the
// auto-start/restart glue that all four components repeated verbatim.
//
// Shape unification notes (see the four components for the ground truth):
//   - "unanchored" auto-start (pillar's MemoPoller) and "anchored" auto-start
//     (the three others, keyed off a token mint time) are the SAME code path
//     here: when `autoStart.mintedAt` is null, there is nothing to compare
//     against LIFETIME_MS, so the cycle starts unconditionally anchored to
//     `now` — exactly reproducing the pillar shape without a separate flag.
//   - `syncBaselineWhenIdle` is optional because KeywordStrategyCard manages
//     baselineRef itself (its onChange fetches the full session and stamps
//     baselineRef.current directly) — the other three sync it from a prop.
//   - `subscribePollerTrigger` is optional because KeywordStrategyCard has no
//     "Copy Claude Prompt" button waking a shared poller; its own Generate
//     button calls `restart({ baselineNull: true })` directly instead.
//   - `topicId: ''` intentionally subscribes to nothing — KeywordStrategyCard
//     has no session (and thus no topic) until the first mint.
//   - `onChange` / `fetchLatestUpdatedAt` are read through refs updated every
//     render (the `routerRef` pattern from SeoRoadmapCard:85-88), so the
//     lazily-created machine and the interval effect (mounted exactly once)
//     always invoke the LATEST callback without tearing down timers when a
//     wrapper passes new inline callback identities on every render.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPollingMachine, type PollingMachine } from '@/lib/memo-poller-machine';
import { onMemoPollerTrigger } from '@/lib/memo-poller-events';
import { subscribeTopic, subscribeHealth } from '@/lib/events/client';
import { memoTopic } from '@/lib/events/topics';

export const POLL_INTERVAL_MS = 3000;
export const LIFETIME_MS = 15 * 60 * 1000;
// A5 Task 24: original 3s cadence kept until SSE is confirmed healthy, then
// demoted to a 20s memo-safety cadence (re-armed fast on drop).
export const SAFETY_POLL_MEMO_MS = 20_000;

export interface UseMemoPollerOpts {
  /** SSE topic key (memoTopic(topicId)); '' subscribes to nothing. */
  topicId: string;
  /** Fired when the machine detects a change (or an SSE invalidate resolves). */
  onChange: () => void;
  /**
   * Fetches the current latest updatedAt for the tick loop's comparison.
   * `undefined` means the fetch failed — the tick is skipped entirely (the
   * caller owns the poll URL and its own try/catch; see KeywordStrategyCard's
   * fetchLatestSession, which returns undefined on network/HTTP failure).
   */
  fetchLatestUpdatedAt: () => Promise<string | null | undefined>;
  /** Baseline value at mount (e.g. initialRoadmapUpdatedAt / memoUpdatedAt). */
  initialBaseline: string | null;
  /**
   * When provided, resyncs baselineRef from this value whenever the machine
   * is idle (never mid-cycle) — mirrors the three card components' effect
   * over their initial*UpdatedAt prop. Omit when the caller manages
   * baselineRef itself (KeywordStrategyCard).
   */
  syncBaselineWhenIdle?: string | null;
  /**
   * Auto-starts a cycle on mount (once) when `active` is true. `mintedAt`
   * anchors the poll window to token-mint time; a stale mint (older than
   * lifetimeMs) flips to expired WITHOUT starting. `mintedAt: null` skips the
   * expiry check entirely and anchors to `now` (the pillar shape).
   */
  autoStart?: { active: boolean; mintedAt: string | null };
  /** Subscribes to onMemoPollerTrigger (e.g. a "Generate" button) — starts a cycle from the current baseline. */
  subscribePollerTrigger?: boolean;
  /** Cumulative active-polling lifetime cap in ms. Defaults to LIFETIME_MS. */
  lifetimeMs?: number;
}

export interface UseMemoPollerResult {
  expired: boolean;
  /** No-arg = retry from the current baseline (the expired-banner button). `{ baselineNull: true }` = regenerate (KeywordStrategyCard). */
  restart: (opts?: { baselineNull?: boolean }) => void;
}

export function useMemoPoller(opts: UseMemoPollerOpts): UseMemoPollerResult {
  const {
    topicId,
    initialBaseline,
    syncBaselineWhenIdle,
    subscribePollerTrigger,
  } = opts;
  const lifetimeMs = opts.lifetimeMs ?? LIFETIME_MS;
  const autoStartActive = opts.autoStart?.active ?? false;
  const autoStartMintedAt = opts.autoStart?.mintedAt ?? null;
  const hasAutoStart = opts.autoStart !== undefined;

  const [expired, setExpired] = useState(false);

  // Callback freshness (Codex fix 5): the machine and the interval effect are
  // each created/mounted exactly once, so they must read these through refs
  // rather than closing over `opts.onChange`/`opts.fetchLatestUpdatedAt`
  // directly — a wrapper passing new inline callbacks every render must never
  // restart timers or invoke a stale closure.
  const onChangeRef = useRef(opts.onChange);
  useEffect(() => {
    onChangeRef.current = opts.onChange;
  });
  const fetchLatestUpdatedAtRef = useRef(opts.fetchLatestUpdatedAt);
  useEffect(() => {
    fetchLatestUpdatedAtRef.current = opts.fetchLatestUpdatedAt;
  });

  const machineRef = useRef<PollingMachine | null>(null);
  if (machineRef.current === null) {
    machineRef.current = createPollingMachine({
      onChange: () => onChangeRef.current(),
      lifetimeMs,
    });
  }
  const machine = machineRef.current;

  // Latest baseline tracking via ref so closures (tick loop, trigger
  // subscription, restart) see fresh values without re-subscribing.
  const baselineRef = useRef<string | null>(initialBaseline);

  // Sync baselineRef from the prop after onChange updates it, but only while
  // idle — an active cycle owns the baseline it started with. Opt-in: the
  // KeywordStrategyCard shape manages baselineRef itself.
  useEffect(() => {
    if (syncBaselineWhenIdle === undefined) return;
    if (machine.status() === 'idle') {
      baselineRef.current = syncBaselineWhenIdle;
    }
  }, [syncBaselineWhenIdle, machine]);

  // Visibility tracking — always on.
  useEffect(() => {
    const onVisibility = () => {
      machine.setVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [machine]);

  // Trigger event subscription (e.g. GenerateRoadmapButton emits after a mint).
  useEffect(() => {
    if (!subscribePollerTrigger) return;
    return onMemoPollerTrigger(() => {
      machine.start({ baseline: baselineRef.current, now: Date.now() });
      setExpired(false);
    });
  }, [subscribePollerTrigger, machine]);

  // A5 Task 24: SSE push on memo:<topicId> routes through machine.invalidate()
  // — never bypassed — so the 15-min cap + visibility/dirty semantics stay
  // exactly as the machine defines them. An empty topicId subscribes to
  // nothing (KeywordStrategyCard before its first mint).
  useEffect(() => {
    if (!topicId) return;
    return subscribeTopic(memoTopic(topicId), () => machine.invalidate());
  }, [topicId, machine]);

  const hasAutoStartedRef = useRef(false);

  // Auto-start on mount (once). Anchor the poll window to mint time, not
  // page-load time: a stale mint (token window already elapsed) must NOT
  // restart a fresh lifetime cycle on reload — show expired instead. When
  // mintedAt is null there is nothing to anchor/expire against, so the cycle
  // starts unconditionally anchored to `now` (the pillar shape).
  useEffect(() => {
    if (!hasAutoStart || !autoStartActive || hasAutoStartedRef.current) return;
    hasAutoStartedRef.current = true;
    const mintedMs = autoStartMintedAt ? new Date(autoStartMintedAt).getTime() : null;
    if (mintedMs != null && Date.now() - mintedMs >= lifetimeMs) {
      setExpired(true);
    } else {
      machine.start({ baseline: baselineRef.current, now: mintedMs ?? Date.now() });
      setExpired(false);
    }
  }, [hasAutoStart, autoStartActive, autoStartMintedAt, lifetimeMs, machine]);

  // Polling loop. Cadence is health-gated: the original 3s cadence while SSE
  // is absent/unhealthy, demoting to the 20s safety cadence once healthy,
  // re-arming fast on drop (same pattern as ReportLibrary/queue-poll.ts).
  // Deps are just [machine] (created once, stable) so this effect mounts
  // exactly once — it never tears down/restarts when a wrapper passes new
  // inline onChange/fetchLatestUpdatedAt identities on re-render.
  useEffect(() => {
    const doTick = async () => {
      if (machine.status() !== 'polling') return;
      try {
        const latest = await fetchLatestUpdatedAtRef.current();
        if (latest === undefined) return; // fetch failed — next tick retries
        baselineRef.current = baselineRef.current ?? latest; // first response sets baseline if missing
        machine.tick({ latestUpdatedAt: latest, now: Date.now() });
        if (machine.status() === 'expired') setExpired(true);
      } catch {
        // Errors are silent — next tick will retry.
      }
    };
    let timer: ReturnType<typeof setInterval> | null = null;
    const restartTimer = (healthy: boolean) => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => void doTick(), healthy ? SAFETY_POLL_MEMO_MS : POLL_INTERVAL_MS);
    };
    restartTimer(false);
    const unsubHealth = subscribeHealth((h) => {
      restartTimer(h);
      if (h) void doTick();
    });
    return () => {
      if (timer) clearInterval(timer);
      unsubHealth();
    };
  }, [machine]);

  const restart = useCallback(
    (restartOpts?: { baselineNull?: boolean }) => {
      if (restartOpts?.baselineNull) {
        baselineRef.current = null;
      }
      machine.start({ baseline: baselineRef.current, now: Date.now() });
      setExpired(false);
    },
    [machine],
  );

  return { expired, restart };
}
