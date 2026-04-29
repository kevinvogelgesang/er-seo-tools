import Link from 'next/link';
import { prisma } from '@/lib/db';

interface PillarAnalysisCardProps {
  sessionId: string;
}

export default async function PillarAnalysisCard({ sessionId }: PillarAnalysisCardProps) {
  const pa = await prisma.pillarAnalysis.findFirst({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
  });

  if (!pa) {
    return (
      <div className="bg-white dark:bg-navy-card rounded-lg shadow-sm border border-gray-100 dark:border-navy-border p-4">
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
      <div className="bg-white dark:bg-navy-card rounded-lg shadow-sm border border-gray-100 dark:border-navy-border p-4">
        <div className="text-xs font-semibold text-gray-500 dark:text-white/60 uppercase tracking-wide mb-1">
          Pillar Analysis
        </div>
        <div className="text-sm text-gray-700 dark:text-white/80">
          Running… refresh this page to check status.
        </div>
      </div>
    );
  }

  if (pa.status === 'error') {
    return (
      <div className="bg-red-50 dark:bg-red-950/40 rounded-lg border-l-4 border-red-500 dark:border-red-400 p-4">
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
    const hub = JSON.parse(pa.hubRecommendation || 'null') as { primary?: string } | null;
    if (hub?.primary) hubLabel = hub.primary.replace(/-/g, ' ');
  } catch {
    /* ignore malformed JSON */
  }
  const completenessPct = Math.round((pa.dataCompleteness ?? 0) * 100);

  return (
    <div className="bg-white dark:bg-navy-card rounded-lg shadow-sm border border-gray-100 dark:border-navy-border p-4 flex items-center justify-between gap-4">
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
      <Link
        href={`/pillar-analysis/${pa.id}`}
        className="rounded-lg bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400 text-white px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors"
      >
        Open dashboard →
      </Link>
    </div>
  );
}
