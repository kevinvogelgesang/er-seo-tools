'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export interface PillarAnalysisCardData {
  id: string;
  status: string;
  error: string | null;
  score: number | null;
  dataCompleteness: number | null;
  hubRecommendation: unknown;
}

interface Props {
  sessionId: string;
  initialPa: PillarAnalysisCardData | null;
}

const POLL_INTERVAL_MS = 1500;

export function PillarAnalysisCardClient({ sessionId, initialPa }: Props) {
  const [pa, setPa] = useState<PillarAnalysisCardData | null>(initialPa);

  useEffect(() => {
    // Stop polling once we have a terminal status.
    if (pa && (pa.status === 'complete' || pa.status === 'error')) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/pillar-analysis/by-session/${sessionId}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setPa(json.pillarAnalysis);
      } catch {
        // network error — keep polling, don't update state
      }
    };

    // Fire one immediately to catch the case where initialPa was null
    // (analysis hadn't been triggered yet) but it kicks in seconds later.
    tick();

    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId, pa]);

  // ----- Render states -----

  if (!pa) {
    return (
      <div className="bg-white dark:bg-navy-card rounded-lg shadow-sm border-l-4 border-l-blue-500 dark:border-l-blue-400 border-y border-r border-gray-100 dark:border-navy-border p-4">
        <div className="text-xs font-semibold text-gray-500 dark:text-white/60 uppercase tracking-wide mb-1">
          Pillar Analysis
        </div>
        <div className="text-sm text-gray-700 dark:text-white/80">
          Not started — should auto-trigger on parse completion. If this persists, check the dev console for{' '}
          <code className="font-mono text-xs bg-gray-100 dark:bg-navy-deep px-1 py-0.5 rounded">[pillar-analysis] trigger failed</code>.
        </div>
      </div>
    );
  }

  if (pa.status === 'pending' || pa.status === 'running') {
    return (
      <div className="bg-white dark:bg-navy-card rounded-lg shadow-sm border-l-4 border-l-blue-500 dark:border-l-blue-400 border-y border-r border-gray-100 dark:border-navy-border p-4">
        <div className="text-xs font-semibold text-gray-500 dark:text-white/60 uppercase tracking-wide mb-1">
          Pillar Analysis
        </div>
        <div className="text-sm text-gray-700 dark:text-white/80 flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse" />
          Running…
        </div>
      </div>
    );
  }

  if (pa.status === 'error') {
    return (
      <div className="bg-red-50 dark:bg-red-950/40 rounded-lg border-l-4 border-l-blue-500 dark:border-l-blue-400 border-y border-r border-red-200 dark:border-red-900 p-4">
        <div className="font-semibold text-red-800 dark:text-red-300">
          Pillar analysis failed
        </div>
        <div className="text-sm text-red-700 dark:text-red-200/80 mt-1 font-mono">
          {pa.error || 'unknown error'}
        </div>
        <div className="text-xs text-red-700/80 dark:text-red-200/60 mt-2">
          The analyst can re-run from the API.
        </div>
      </div>
    );
  }

  // status === 'complete'
  let hubLabel = '—';
  try {
    const hub = pa.hubRecommendation as { primary?: string } | null;
    if (hub?.primary) hubLabel = hub.primary.replace(/-/g, ' ');
  } catch {
    /* ignore */
  }
  const completenessPct = Math.round((pa.dataCompleteness ?? 0) * 100);

  return (
    <div className="bg-white dark:bg-navy-card rounded-lg shadow-sm border-l-4 border-l-blue-500 dark:border-l-blue-400 border-y border-r border-gray-100 dark:border-navy-border p-4 flex items-center justify-between gap-4">
      <div>
        <div className="text-xs font-semibold text-gray-500 dark:text-white/60 uppercase tracking-wide mb-1">
          Pillar Analysis
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-3xl font-bold text-[#1c2d4a] dark:text-white">{pa.score ?? '—'}</span>
          <span className="text-sm text-gray-500 dark:text-white/60">/ 10</span>
          <span className="text-sm text-gray-500 dark:text-white/60">— {completenessPct}% data</span>
        </div>
        <div className="text-sm text-gray-700 dark:text-white/80 mt-1">
          Hub recommendation: <span className="font-medium capitalize">{hubLabel}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Link
          href={`/pillar-analysis/${pa.id}`}
          className="rounded-lg bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400 text-white px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors"
        >
          Open dashboard →
        </Link>
        <Link
          href={`/pillar-analysis/${pa.id}#copy-prompt`}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
        >
          Generate Claude prompt →
        </Link>
      </div>
    </div>
  );
}
