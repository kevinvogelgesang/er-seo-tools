'use client';

// components/keyword-research/KeywordMemoCard.tsx
//
// Renders the Keyword Strategy Memo card on the keyword-research results page.
// D1 PR3 Task 13: thin wrapper over the shared MemoHandoffCard — the poller
// wiring (useMemoPoller, Task 12) and the card markup/classes (Task 13) now
// live there. This file only supplies the parts that differ from
// SeoRoadmapCard: title, empty-state copy, markdown renderer, header button,
// poll URL + extractor, section id, and expired CTA text.

import { MemoHandoffCard } from '@/components/handoff/MemoHandoffCard';
import { GenerateKeywordMemoButton } from './GenerateKeywordMemoButton';
import { KeywordMemoMarkdown } from './KeywordMemoMarkdown';

interface Props {
  sessionId: string;
  initialStatus: string;
  initialMemoMarkdown: string | null;
  initialMemoUpdatedAt: string | null;
  /** ISO time the current token was minted; anchors the poll window to mint
   * time so a stale 'processing' row doesn't restart a 15-min cycle on reload. */
  initialTokenMintedAt: string | null;
}

export function KeywordMemoCard({
  sessionId,
  initialStatus,
  initialMemoMarkdown,
  initialMemoUpdatedAt,
  initialTokenMintedAt,
}: Props) {
  const hasMemo = initialMemoMarkdown != null && initialMemoMarkdown.length > 0;

  return (
    <MemoHandoffCard
      sessionId={sessionId}
      pollUrl={`/api/keyword-memo/by-session/${sessionId}`}
      extractUpdatedAt={(body) => (body as { keywordResearch?: { memoUpdatedAt?: string | null } })?.keywordResearch?.memoUpdatedAt ?? null}
      title="Keyword Strategy Memo"
      headerButton={<GenerateKeywordMemoButton sessionId={sessionId} hasMemo={hasMemo} />}
      renderMemo={(markdown) => <KeywordMemoMarkdown source={markdown} />}
      emptyState={
        <p className="mt-2 text-gray-700 dark:text-white/80 leading-relaxed">
          No keyword memo yet — click <strong className="font-semibold text-[#1c2d4a] dark:text-white">Generate Keyword Memo</strong> to create one via Claude.
        </p>
      }
      sectionId="keyword-memo"
      expiredCta="Check for memo"
      initialStatus={initialStatus}
      initialMarkdown={initialMemoMarkdown}
      initialUpdatedAt={initialMemoUpdatedAt}
      initialTokenMintedAt={initialTokenMintedAt}
    />
  );
}
