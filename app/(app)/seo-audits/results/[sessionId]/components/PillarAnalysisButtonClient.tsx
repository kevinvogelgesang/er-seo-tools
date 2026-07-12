'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { subscribeTopic, subscribeHealth } from '@/lib/events/client';
import { pillarAnalysisTopic } from '@/lib/events/topics';

export type ButtonInitialState = { id: string; status: string; error: string | null } | null;

interface Props {
  sessionId: string;
  initial: ButtonInitialState;
}

const POLL_INTERVAL_MS = 1500;
// A5 Task 24: original 1.5s cadence kept until SSE is confirmed healthy, then
// demoted to a 20s safety cadence (re-armed fast on drop) — same contract as
// the memo cards' SAFETY_POLL_MEMO_MS.
const SAFETY_MS = 20_000;

function samePa(a: ButtonInitialState, b: ButtonInitialState): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.id === b.id && a.status === b.status && a.error === b.error;
}

export function PillarAnalysisButtonClient({ sessionId, initial }: Props) {
  const [pa, setPa] = useState<ButtonInitialState>(initial);

  // Mirrors `pa` for tick()/the SSE handler to read without needing `pa` in
  // their dependency arrays — also lets tick() skip a no-op setPa when the
  // polled content hasn't actually changed (avoids retriggering the bounded
  // effect below on every identical 'running' response, which — since `pa`
  // is one of its deps — would otherwise re-invoke tick() immediately on
  // every poll instead of waiting out the interval).
  const paRef = useRef(pa);
  useEffect(() => {
    paRef.current = pa;
  }, [pa]);

  const cancelledRef = useRef(false);
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const tick = useCallback(async () => {
    try {
      const res = await fetch(`/api/pillar-analysis/by-session/${sessionId}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const json = await res.json();
      if (cancelledRef.current) return;
      const next = json.pillarAnalysis;
      const nextPa: ButtonInitialState = next ? { id: next.id, status: next.status, error: next.error ?? null } : null;
      if (!samePa(paRef.current, nextPa)) setPa(nextPa);
    } catch {
      // network error — ignore, keep polling
    }
  }, [sessionId]);

  // A5 Task 24: mount-scoped, unconditional subscription (mirrors
  // ContentAuditCard's precedent) — a regenerate can transition status again
  // after 'complete', so this stays active for the component's lifetime
  // rather than tearing down once the bounded poll below stops.
  useEffect(() => {
    return subscribeTopic(pillarAnalysisTopic(sessionId), () => void tick());
  }, [sessionId, tick]);

  // Bounded poll: only runs while status isn't yet terminal. Cadence is
  // health-gated: the original 1.5s cadence while SSE is absent/unhealthy,
  // demoting to the 20s safety cadence once healthy, re-arming fast on drop.
  useEffect(() => {
    if (pa && (pa.status === 'complete' || pa.status === 'error')) return;

    void tick();
    let timer: ReturnType<typeof setInterval> | null = null;
    const restartTimer = (healthy: boolean) => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => void tick(), healthy ? SAFETY_MS : POLL_INTERVAL_MS);
    };
    restartTimer(false);
    const unsubHealth = subscribeHealth((h) => {
      restartTimer(h);
      if (h) void tick();
    });
    return () => {
      if (timer) clearInterval(timer);
      unsubHealth();
    };
  }, [pa, tick]);

  // No pillar analysis record yet
  if (!pa) {
    return (
      <button
        disabled
        title="Pillar analysis pending — auto-triggers on parse completion"
        className="px-4 py-2 border border-gray-200 dark:border-navy-border rounded-lg text-sm text-gray-400 dark:text-white/40 cursor-wait"
      >
        Pillar: Pending…
      </button>
    );
  }

  if (pa.status === 'pending' || pa.status === 'running') {
    return (
      <button
        disabled
        title="Pillar analysis in progress; refresh in a moment"
        className="px-4 py-2 border border-gray-200 dark:border-navy-border rounded-lg text-sm text-gray-400 dark:text-white/40 cursor-wait"
      >
        Pillar: Running…
      </button>
    );
  }

  if (pa.status === 'error') {
    return (
      <button
        disabled
        title={pa.error || 'Pillar analysis failed'}
        className="px-4 py-2 border border-red-300 dark:border-red-700 rounded-lg text-sm text-red-700 dark:text-red-400 cursor-not-allowed"
      >
        Pillar: Failed
      </button>
    );
  }

  // status === 'complete'
  return (
    <Link
      href={`/pillar-analysis/${pa.id}`}
      className="px-4 py-2 border border-[#1c2d4a] dark:border-navy-border rounded-lg text-sm text-[#1c2d4a] dark:text-white font-medium hover:bg-[#1c2d4a] hover:text-white transition-colors"
    >
      Pillar Analysis →
    </Link>
  );
}
