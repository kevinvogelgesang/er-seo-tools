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
