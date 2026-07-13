'use client';

// components/handoff/MemoHandoffCard.tsx
//
// D1 PR3 Task 13 — the shared card shell for the two structurally-identical
// server-props memo cards (SeoRoadmapCard, KeywordMemoCard). Wraps
// useMemoPoller (Task 12) and renders the markup/classes that were
// duplicated verbatim across both components, parameterized by the props
// that genuinely differ (title, empty state, markdown renderer, header
// button, poll URL + extractor, section id, expired CTA copy).

import { ReactNode, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMemoPoller } from './useMemoPoller';
import { formatRelativeTime, formatAbsoluteTime } from '@/lib/relative-time';

export interface MemoHandoffCardProps {
  sessionId: string;
  /** Poll endpoint, e.g. `/api/seo-roadmap/by-session/${sessionId}`. */
  pollUrl: string;
  /** Pulls the latest updatedAt out of the poll response body. */
  extractUpdatedAt: (body: unknown) => string | null;
  title: string;
  /** Header action button (GenerateRoadmapButton / GenerateKeywordMemoButton). */
  headerButton: ReactNode;
  /** Renders the memo markdown body when present. */
  renderMemo: (markdown: string) => ReactNode;
  /** Rendered in place of the memo when none exists yet. */
  emptyState: ReactNode;
  /** Section id / scroll anchor. */
  sectionId?: string;
  /** Label for the "stopped checking" restart button. */
  expiredCta: string;
  initialStatus: string;
  initialMarkdown: string | null;
  initialUpdatedAt: string | null;
  /** ISO time the current token was minted; anchors the poll window to mint
   * time so a stale 'processing' row doesn't restart a 15-min cycle on reload. */
  initialTokenMintedAt: string | null;
}

// Hydration-safe relative timestamp. Renders null on the first (server + initial
// client) render, then the localized string after mount, so there is nothing for
// the client to mismatch. Moved here verbatim from SeoRoadmapCard's
// RoadmapUpdatedAt / KeywordMemoCard's MemoUpdatedAt (identical in both).
function MemoUpdatedAt({ value, className }: { value: string | null; className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    setMounted(true);
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!mounted || value == null) return null;

  const date = new Date(value);
  const relative = formatRelativeTime(date, now);
  const absolute = formatAbsoluteTime(date);
  if (relative == null || absolute == null) return null;

  return (
    <span className={className} title={absolute}>
      {relative}
    </span>
  );
}

export function MemoHandoffCard({
  sessionId,
  pollUrl,
  extractUpdatedAt,
  title,
  headerButton,
  renderMemo,
  emptyState,
  sectionId,
  expiredCta,
  initialStatus,
  initialMarkdown,
  initialUpdatedAt,
  initialTokenMintedAt,
}: MemoHandoffCardProps) {
  const router = useRouter();
  const hasMemo = initialMarkdown != null && initialMarkdown.length > 0;

  // Capture router via ref so the poller's onChange closure (created once)
  // always reads the current router instance.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });

  const { expired, restart } = useMemoPoller({
    topicId: sessionId,
    onChange: () => routerRef.current.refresh(),
    fetchLatestUpdatedAt: async () => {
      try {
        const res = await fetch(pollUrl);
        if (!res.ok) return undefined;
        return extractUpdatedAt(await res.json());
      } catch {
        return undefined;
      }
    },
    initialBaseline: initialUpdatedAt,
    syncBaselineWhenIdle: initialUpdatedAt,
    autoStart: { active: initialStatus === 'processing', mintedAt: initialTokenMintedAt },
    subscribePollerTrigger: true,
  });

  return (
    <section
      id={sectionId}
      className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6 scroll-mt-28"
    >
      <header className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <div className="flex flex-col gap-1">
          <h2 className="font-display font-bold text-lg text-[#1c2d4a] dark:text-white">{title}</h2>
          {hasMemo && (
            <MemoUpdatedAt value={initialUpdatedAt} className="text-sm text-gray-500 dark:text-white/50" />
          )}
        </div>
        {headerButton}
      </header>

      {hasMemo ? <div className="mt-2">{renderMemo(initialMarkdown!)}</div> : emptyState}

      {expired && (
        <div className="mt-4 text-sm text-gray-500 dark:text-white/50">
          Stopped checking after 15 minutes.{' '}
          <button
            type="button"
            onClick={() => restart()}
            className="underline hover:text-[#1c2d4a] dark:hover:text-white"
          >
            {expiredCta}
          </button>
        </div>
      )}
    </section>
  );
}
