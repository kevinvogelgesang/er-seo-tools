import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { ScoreCard } from './components/ScoreCard';
import { SubscoreBreakdown } from './components/SubscoreBreakdown';
import { HubRecommendationCard } from './components/HubRecommendationCard';
import { PillarTopicList } from './components/PillarTopicList';
import { UrlVerdictTable } from './components/UrlVerdictTable';
import { DataCompletenessBanner } from './components/DataCompletenessBanner';
import type {
  HubRecommendation, PillarTopic, SubscoreBreakdown as SB, UrlRecord,
} from '@/lib/services/pillarAnalysis/types';

export default async function PillarAnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pa = await prisma.pillarAnalysis.findUnique({ where: { id } });
  if (!pa) notFound();
  if (pa.status !== 'complete') {
    return (
      <div className="p-8 text-gray-700 dark:text-white/80">
        Analysis status: <span className="font-mono">{pa.status}</span>
        {pa.error && <pre className="mt-4 text-red-500">{pa.error}</pre>}
      </div>
    );
  }

  const subscores = JSON.parse(pa.subscores!) as SB;
  const hub = JSON.parse(pa.hubRecommendation!) as HubRecommendation;
  const topics = JSON.parse(pa.pillarTopics!) as PillarTopic[];
  const verdicts = JSON.parse(pa.urlVerdicts!) as UrlRecord[];

  return (
    <main className="p-8 max-w-7xl mx-auto space-y-6">
      <header className="border-b pb-4 dark:border-navy-border">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Pillar Analysis
        </h1>
        <p className="text-gray-600 dark:text-white/60 text-sm mt-1">
          Internal — analyst-only. Generated {pa.createdAt.toISOString()}
        </p>
      </header>

      {pa.dataCompleteness != null && pa.dataCompleteness < 0.5 && (
        <DataCompletenessBanner completeness={pa.dataCompleteness} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ScoreCard score={pa.score!} dataCompleteness={pa.dataCompleteness ?? 0} />
        <div className="lg:col-span-2">
          <SubscoreBreakdown subscores={subscores} />
        </div>
      </div>

      <HubRecommendationCard hub={hub} />

      <PillarTopicList topics={topics} verdicts={verdicts} />

      <UrlVerdictTable verdicts={verdicts} />
    </main>
  );
}
