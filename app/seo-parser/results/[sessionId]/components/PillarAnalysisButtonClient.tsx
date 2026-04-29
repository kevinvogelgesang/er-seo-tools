'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export type ButtonInitialState = { id: string; status: string; error: string | null } | null;

interface Props {
  sessionId: string;
  initial: ButtonInitialState;
}

const POLL_INTERVAL_MS = 1500;

export function PillarAnalysisButtonClient({ sessionId, initial }: Props) {
  const [pa, setPa] = useState<ButtonInitialState>(initial);

  useEffect(() => {
    if (pa && (pa.status === 'complete' || pa.status === 'error')) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/pillar-analysis/by-session/${sessionId}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) {
          const next = json.pillarAnalysis;
          setPa(next ? { id: next.id, status: next.status, error: next.error ?? null } : null);
        }
      } catch {
        // network error — ignore, keep polling
      }
    };
    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId, pa]);

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
