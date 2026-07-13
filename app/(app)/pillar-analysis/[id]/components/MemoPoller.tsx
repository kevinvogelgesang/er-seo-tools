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
//
// D1 PR3 Task 14: the poller wiring itself now lives in
// components/handoff/useMemoPoller.ts (Task 12) — this component only
// supplies the by-session/by-analysis poll URL + extractor and renders the
// expired banner. `autoStart.mintedAt: null` reproduces the pillar-specific
// "unanchored" auto-start (no expiry pre-check, anchored to `now`) exactly.

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useMemoPoller } from '@/components/handoff/useMemoPoller';

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

  // Capture router via ref so the hook's onChange closure (created once)
  // always reads the current router instance, robust to any future stability
  // changes in useRouter().
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });

  // Use by-analysis when sessionId is absent (live-scan analyses), else by-session.
  const pollUrl = sessionId
    ? `/api/pillar-analysis/by-session/${sessionId}`
    : `/api/pillar-analysis/by-analysis/${analysisId}`;

  const { expired, restart } = useMemoPoller({
    topicId: sessionId ?? analysisId,
    onChange: () => routerRef.current.refresh(),
    fetchLatestUpdatedAt: async () => {
      try {
        const res = await fetch(pollUrl);
        if (!res.ok) return undefined;
        const body = await res.json();
        return body?.pillarAnalysis?.narrativeUpdatedAt ?? null;
      } catch {
        return undefined;
      }
    },
    initialBaseline: initialNarrativeUpdatedAt,
    syncBaselineWhenIdle: initialNarrativeUpdatedAt,
    autoStart: { active: autoStartOnMount, mintedAt: null },
    subscribePollerTrigger: true,
  });

  if (!expired) return null;

  return (
    <div className="mt-4 text-sm text-gray-500 dark:text-white/50">
      Stopped checking after 15 minutes.{' '}
      <button
        type="button"
        onClick={() => restart()}
        className="underline hover:text-[#1c2d4a] dark:hover:text-white"
      >
        Check for memo
      </button>
    </div>
  );
}
