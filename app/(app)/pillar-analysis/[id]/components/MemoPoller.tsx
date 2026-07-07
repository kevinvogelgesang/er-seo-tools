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
  /**
   * Analysis ID (always available from the /pillar-analysis/[id] route).
   * Used as the poll key when sessionId is null (live-scan analyses).
   */
  analysisId: string;
  /**
   * Session ID — present for SF-upload analyses, null for live-scan ones.
   * When non-null the poller uses the by-session endpoint; otherwise it
   * falls back to the by-analysis endpoint keyed by analysisId.
   */
  sessionId: string | null;
  initialNarrativeUpdatedAt: string | null;
  /** True if there's no memo yet — the poller auto-starts a cycle on mount. */
  autoStartOnMount: boolean;
}

export function MemoPoller({ analysisId, sessionId, initialNarrativeUpdatedAt, autoStartOnMount }: Props) {
  const router = useRouter();
  const [expired, setExpired] = useState(false);

  // Capture router via ref so the machine's onChange closure (created once)
  // always reads the current router instance, robust to any future stability
  // changes in useRouter().
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });

  const machineRef = useRef<ReturnType<typeof createPollingMachine> | null>(null);
  if (machineRef.current === null) {
    machineRef.current = createPollingMachine({
      onChange: () => routerRef.current.refresh(),
      lifetimeMs: LIFETIME_MS,
    });
  }
  const machine = machineRef.current;

  // Latest baseline / mounted-state tracking via ref so closures see fresh values.
  const baselineRef = useRef<string | null>(initialNarrativeUpdatedAt);

  // Sync baselineRef from the prop after router.refresh() updates it.
  // Only update while idle — if a cycle is active, the cycle owns the baseline
  // it was started with, and overwriting would cause a missed change.
  useEffect(() => {
    if (machine.status() === 'idle') {
      baselineRef.current = initialNarrativeUpdatedAt;
    }
  }, [initialNarrativeUpdatedAt, machine]);

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

  const hasAutoStartedRef = useRef(false);

  // Auto-start on mount when there's no memo
  useEffect(() => {
    if (autoStartOnMount && !hasAutoStartedRef.current) {
      hasAutoStartedRef.current = true;
      machine.start({ baseline: initialNarrativeUpdatedAt, now: Date.now() });
      setExpired(false);
    }
  }, [autoStartOnMount, initialNarrativeUpdatedAt, machine]);

  // Polling loop
  useEffect(() => {
    // Use by-analysis when sessionId is absent (live-scan analyses), else by-session.
    const pollUrl = sessionId
      ? `/api/pillar-analysis/by-session/${sessionId}`
      : `/api/pillar-analysis/by-analysis/${analysisId}`;
    const interval = setInterval(async () => {
      if (machine.status() !== 'polling') return;
      try {
        const res = await fetch(pollUrl);
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
  }, [analysisId, sessionId, machine]);

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
