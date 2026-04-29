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
import { CopyPromptHashHandler } from './components/CopyPromptHashHandler';
import type {
  HubRecommendation, PillarTopic, SubscoreBreakdown as SB, SubscorePresence, UrlRecord,
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
  // Older PillarAnalysis records (pre-migration) have no subscorePresence —
  // pass null and let SubscoreBreakdown treat all subscores as present.
  const subscorePresence = pa.subscorePresence
    ? (JSON.parse(pa.subscorePresence) as SubscorePresence)
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

  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <main className="max-w-7xl mx-auto px-6 py-12 space-y-6">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Link
              href={`/seo-parser/results/${pa.session.id}`}
              className="text-sm text-gray-500 dark:text-white/50 hover:text-[#1c2d4a] dark:hover:text-white inline-flex items-center mb-3"
            >
              ← Back to SEO Audit
            </Link>
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
          />
        </header>
        <CopyPromptHashHandler />

        {pa.dataCompleteness != null && pa.dataCompleteness < 0.5 && (
          <DataCompletenessBanner completeness={pa.dataCompleteness} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <ScoreCard score={pa.score!} dataCompleteness={pa.dataCompleteness ?? 0} />
          <div className="lg:col-span-2">
            <SubscoreBreakdown subscores={subscores} subscorePresence={subscorePresence} />
          </div>
        </div>

        <HubRecommendationCard hub={hub} />

        <PillarTopicList topics={topics} verdicts={verdicts} />

        <UrlVerdictTable verdicts={verdicts} />
      </main>
    </div>
  );
}
