import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { ScoreCard } from './components/ScoreCard';
import { SubscoreBreakdown } from './components/SubscoreBreakdown';
import { HubRecommendationCard } from './components/HubRecommendationCard';
import { PillarTopicList } from './components/PillarTopicList';
import { UrlVerdictTable } from './components/UrlVerdictTable';
import { DataCompletenessBanner } from './components/DataCompletenessBanner';
import { CopyClaudePromptButton } from './components/CopyClaudePromptButton';
import { StrategicMemoCard } from './components/StrategicMemoCard';
import { SectionNav } from './components/SectionNav';
import type {
  HubRecommendation, PillarTopic, SubscoreBreakdown as SB, SubscorePresence, SubscoreContext, UrlRecord,
} from '@/lib/services/pillarAnalysis/types';

export default async function PillarAnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pa = await prisma.pillarAnalysis.findUnique({
    where: { id },
    include: { session: true },
  });
  if (!pa) notFound();
  if (pa.status !== 'complete') {
    return (
      <div className="p-8 text-gray-700 dark:text-white/80">
        Analysis status: <span className="font-mono">{pa.status}</span>
        {pa.error && <pre className="mt-4 text-red-500">{pa.error}</pre>}
      </div>
    );
  }

  const webappUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const subscores = JSON.parse(pa.subscores!) as SB;
  const subscorePresence = pa.subscorePresence
    ? (JSON.parse(pa.subscorePresence) as SubscorePresence)
    : null;
  const subscoreContext = pa.subscoreContext
    ? (JSON.parse(pa.subscoreContext) as SubscoreContext)
    : null;
  const hub = JSON.parse(pa.hubRecommendation!) as HubRecommendation;
  const topics = JSON.parse(pa.pillarTopics!) as PillarTopic[];
  const verdicts = JSON.parse(pa.urlVerdicts!) as UrlRecord[];

  const siteName = pa.session?.siteName || 'Site';
  const numPillars = topics.length;
  const totalUrls = verdicts.length;
  const completenessPct = Math.round((pa.dataCompleteness ?? 0) * 100);
  const generatedAt = pa.createdAt.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const hasMemo = pa.aiNarrative != null && pa.aiNarrative.length > 0;

  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <main className="max-w-7xl mx-auto px-6 py-12 space-y-6">
        <SectionNav />

        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            {pa.session && (
            <Link
              href={`/seo-parser/results/${pa.session.id}`}
              className="text-sm text-gray-500 dark:text-white/50 hover:text-[#1c2d4a] dark:hover:text-white inline-flex items-center mb-3"
            >
              ← Back to SEO Audit
            </Link>
          )}
            <h1 className="font-display font-bold text-2xl text-[#1c2d4a] dark:text-white">
              {siteName} — Pillar Analysis
            </h1>
            <p className="text-gray-500 dark:text-white/50 text-sm mt-1">
              Generated {generatedAt} · {totalUrls} URL{totalUrls === 1 ? '' : 's'} · {numPillars} pillar{numPillars === 1 ? '' : 's'} · {completenessPct}% data completeness
            </p>
          </div>
          <CopyClaudePromptButton
            analysisId={pa.id}
            status={pa.status}
            webappUrl={webappUrl}
            hasMemo={hasMemo}
          />
        </header>

        {pa.dataCompleteness != null && pa.dataCompleteness < 0.5 && (
          <DataCompletenessBanner completeness={pa.dataCompleteness} />
        )}

        <div id="score" className="grid grid-cols-1 lg:grid-cols-3 gap-6 scroll-mt-28">
          <ScoreCard score={pa.score!} dataCompleteness={pa.dataCompleteness ?? 0} />
          <div className="lg:col-span-2">
            <SubscoreBreakdown
              subscores={subscores}
              subscorePresence={subscorePresence}
              subscoreContext={subscoreContext}
            />
          </div>
        </div>

        <StrategicMemoCard
          aiNarrative={pa.aiNarrative}
          narrativeUpdatedAt={pa.narrativeUpdatedAt}
          sessionId={pa.session?.id ?? null}
        />

        <div id="hub" className="scroll-mt-28">
          <HubRecommendationCard hub={hub} />
        </div>

        <div id="pillars" className="scroll-mt-28">
          <PillarTopicList topics={topics} verdicts={verdicts} />
        </div>

        <div id="urls" className="scroll-mt-28">
          <UrlVerdictTable verdicts={verdicts} />
        </div>
      </main>
    </div>
  );
}
