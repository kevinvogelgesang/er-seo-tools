// app/pillar-analysis/[id]/components/StrategicMemoCard.tsx
// Server Component. Branches on memo presence and always mounts MemoPoller
// (idle until triggered) so the regenerate button can wake it.

import React from 'react';
import { MemoMarkdown } from './MemoMarkdown';
import { RelativeTime } from './RelativeTime';
import { MemoPoller } from './MemoPoller';

interface Props {
  /** The PillarAnalysis id — always available; used as the poll key for live-scan analyses. */
  analysisId: string;
  aiNarrative: string | null;
  narrativeUpdatedAt: Date | null;
  /** Null for live-scan (run-keyed) analyses; non-null for SF-upload analyses. */
  sessionId: string | null;
}

export function StrategicMemoCard({ analysisId, aiNarrative, narrativeUpdatedAt, sessionId }: Props) {
  const hasMemo = aiNarrative != null && aiNarrative.length > 0;
  const initialUpdatedAt = narrativeUpdatedAt ? narrativeUpdatedAt.toISOString() : null;

  return (
    <section
      id="memo"
      className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6 scroll-mt-28"
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

      {/* Always mount MemoPoller — it polls by analysisId when sessionId is null */}
      <MemoPoller
        analysisId={analysisId}
        sessionId={sessionId}
        initialNarrativeUpdatedAt={initialUpdatedAt}
        autoStartOnMount={!hasMemo}
      />
    </section>
  );
}
