import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { ResultsView } from '@/components/seo-parser/ResultsView';
import { loadRunSeoResult } from '@/lib/findings/seo-findings-fallback';
import type { Metadata } from 'next';

type Props = { params: Promise<{ runId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { runId } = await params;
  return { title: `Live SEO Scan — ${runId.slice(0, 8)}` };
}

export default async function RunResultsPage({ params }: Props) {
  const { runId } = await params;

  const result = await loadRunSeoResult(runId);
  if (!result) {
    notFound();
  }

  // C8: persisted score + breakdown for the score explanation panel.
  const run = await prisma.crawlRun.findUnique({ where: { id: runId }, select: { score: true, scoreBreakdown: true } });

  // SF-only controls (export / share / diff / roadmap-memo) are suppressed by
  // ResultsView when sessionId is absent — a plain "needs Screaming Frog data"
  // note renders in their place. A richer SeoSourceBadge lands in Task 8.
  return (
    <ResultsView
      result={result}
      runId={runId}
      healthScore={run?.score ?? null}
      scoreBreakdown={run?.scoreBreakdown ?? null}
    />
  );
}
