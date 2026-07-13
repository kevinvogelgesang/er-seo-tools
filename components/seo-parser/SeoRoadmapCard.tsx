'use client';

// components/seo-parser/SeoRoadmapCard.tsx
//
// Renders the Technical SEO Roadmap card on the SEO parser results page.
// D1 PR3 Task 13: thin wrapper over the shared MemoHandoffCard — the poller
// wiring (useMemoPoller, Task 12) and the card markup/classes (Task 13) now
// live there. This file only supplies the parts that differ from
// KeywordMemoCard: title, empty-state copy, markdown renderer, header
// button, poll URL + extractor, section id, and expired CTA text.

import { MemoHandoffCard } from '@/components/handoff/MemoHandoffCard';
import { GenerateRoadmapButton } from './GenerateRoadmapButton';
import { RoadmapMarkdown } from './RoadmapMarkdown';

interface Props {
  sessionId: string;
  initialStatus: string;
  initialRoadmapMarkdown: string | null;
  initialRoadmapUpdatedAt: string | null;
  /** ISO time the current token was minted; anchors the poll window to mint
   * time so a stale 'processing' row doesn't restart a 15-min cycle on reload. */
  initialTokenMintedAt: string | null;
}

export function SeoRoadmapCard({
  sessionId,
  initialStatus,
  initialRoadmapMarkdown,
  initialRoadmapUpdatedAt,
  initialTokenMintedAt,
}: Props) {
  const hasRoadmap = initialRoadmapMarkdown != null && initialRoadmapMarkdown.length > 0;

  return (
    <MemoHandoffCard
      sessionId={sessionId}
      pollUrl={`/api/seo-roadmap/by-session/${sessionId}`}
      extractUpdatedAt={(body) => (body as { seoRoadmap?: { roadmapUpdatedAt?: string | null } })?.seoRoadmap?.roadmapUpdatedAt ?? null}
      title="Technical SEO Roadmap"
      headerButton={<GenerateRoadmapButton sessionId={sessionId} hasRoadmap={hasRoadmap} />}
      renderMemo={(markdown) => <RoadmapMarkdown source={markdown} />}
      emptyState={
        <p className="mt-2 text-gray-700 dark:text-white/80 leading-relaxed">
          No roadmap yet — click <strong className="font-semibold text-[#1c2d4a] dark:text-white">Generate Roadmap</strong> to create one via Claude.
        </p>
      }
      sectionId="seo-roadmap"
      expiredCta="Check for roadmap"
      initialStatus={initialStatus}
      initialMarkdown={initialRoadmapMarkdown}
      initialUpdatedAt={initialRoadmapUpdatedAt}
      initialTokenMintedAt={initialTokenMintedAt}
    />
  );
}
