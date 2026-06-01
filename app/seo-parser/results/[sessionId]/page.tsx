import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { ResultsView } from '@/components/seo-parser/ResultsView';
import { SeoRoadmapCard } from '@/components/seo-parser/SeoRoadmapCard';
import PillarAnalysisButton from './components/PillarAnalysisButton';
import { parseStoredResult } from './result-json';
import type { Metadata } from 'next';

type Props = { params: Promise<{ sessionId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sessionId } = await params;
  return { title: `SEO Audit — ${sessionId.slice(0, 8)}` };
}

function ResultErrorState() {
  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep flex items-center justify-center px-6">
      <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-10 text-center max-w-md">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="font-display font-bold text-xl text-[#1c2d4a] dark:text-white mb-2">Results Unavailable</h2>
        <p className="text-gray-600 dark:text-white/60 text-sm mb-6">
          This completed session has a stored result that could not be read.
        </p>
        <a
          href="/seo-parser"
          className="inline-block px-6 py-3 bg-[#1c2d4a] text-white font-display font-bold text-sm rounded-lg hover:bg-[#0f1d30] transition-colors"
        >
          Back to Upload
        </a>
      </div>
    </div>
  );
}

export default async function ResultsPage({ params }: Props) {
  const { sessionId } = await params;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(sessionId)) {
    notFound();
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });

  if (!session) {
    notFound();
  }

  // Parsing not yet complete — show a waiting screen
  if (session.status !== 'complete' || !session.result) {
    return (
      <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep flex items-center justify-center px-6">
        <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-10 text-center max-w-md">
          {session.status === 'error' ? (
            <>
              <div className="text-4xl mb-4">⚠️</div>
              <h2 className="font-display font-bold text-xl text-[#1c2d4a] dark:text-white mb-2">Parsing Failed</h2>
              <p className="text-gray-600 dark:text-white/60 text-sm mb-6">{session.error || 'An unexpected error occurred.'}</p>
              <a
                href="/seo-parser"
                className="inline-block px-6 py-3 bg-[#f5a623] text-[#1c2d4a] font-display font-bold text-sm rounded-lg hover:bg-[#e8971a] transition-colors"
              >
                Try Again
              </a>
            </>
          ) : (
            <>
              <div className="text-4xl mb-4">⏳</div>
              <h2 className="font-display font-bold text-xl text-[#1c2d4a] dark:text-white mb-2">
                {session.status === 'parsing' ? 'Parsing in Progress…' : 'Not Yet Analyzed'}
              </h2>
              <p className="text-gray-600 dark:text-white/60 text-sm mb-6">
                {session.status === 'parsing'
                  ? 'The files are being analyzed. Refresh in a moment.'
                  : 'Upload files and click Analyze to generate results.'}
              </p>
              <a
                href="/seo-parser"
                className="inline-block px-6 py-3 bg-[#1c2d4a] text-white font-display font-bold text-sm rounded-lg hover:bg-[#0f1d30] transition-colors"
              >
                Back to Upload
              </a>
            </>
          )}
        </div>
      </div>
    );
  }

  const result = parseStoredResult(session.result);
  if (!result) {
    return <ResultErrorState />;
  }

  const rm = await prisma.seoRoadmap.findUnique({ where: { sessionId } });

  return (
    <ResultsView
      result={result}
      sessionId={sessionId}
      pillarButton={<PillarAnalysisButton sessionId={sessionId} />}
      roadmap={
        <SeoRoadmapCard
          sessionId={sessionId}
          initialStatus={rm?.status ?? 'none'}
          initialRoadmapMarkdown={rm?.roadmapMarkdown ?? null}
          initialRoadmapUpdatedAt={rm?.roadmapUpdatedAt ? rm.roadmapUpdatedAt.toISOString() : null}
        />
      }
    />
  );
}
