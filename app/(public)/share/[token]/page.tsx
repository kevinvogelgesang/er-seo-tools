import { prisma } from '@/lib/db';
import { AggregatedResult } from '@/lib/types';
import { MetricsBar } from '@/components/seo-parser/MetricsBar';
import { IssueTabs } from '@/components/seo-parser/IssueTabs';
import { RecommendationList } from '@/components/seo-parser/RecommendationList';
import { ArchivedSessionBanner } from '@/components/seo-parser/ArchivedSessionBanner';
import { loadArchivedSeoResult } from '@/lib/findings/seo-findings-fallback';
import type { Metadata } from 'next';

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  return { title: `Shared SEO Report — ${token.slice(0, 8)}` };
}

function SharedBanner({ expiresAt }: { expiresAt: Date }) {
  const formatted = expiresAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return (
    <div className="bg-[#1c2d4a] text-white text-sm px-6 py-3 flex items-center justify-between">
      <span className="font-medium">Shared SEO Report</span>
      <span className="text-white/70">Expires {formatted}</span>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep flex items-center justify-center px-6">
      <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-10 text-center max-w-md">
        <div className="text-4xl mb-4">🔗</div>
        <h2 className="font-display font-bold text-xl text-[#1c2d4a] dark:text-white mb-2">Link Unavailable</h2>
        <p className="text-gray-600 dark:text-white/60 text-sm">{message}</p>
      </div>
    </div>
  );
}

export default async function SharedReportPage({ params }: Props) {
  const { token } = await params;

  const shareLink = await prisma.shareLink.findUnique({
    where: { token },
    include: { session: true },
  });

  if (!shareLink) {
    return <ErrorState message="This share link does not exist or has been removed." />;
  }

  if (shareLink.expiresAt < new Date()) {
    return <ErrorState message="This share link has expired and is no longer accessible." />;
  }

  const { session } = shareLink;

  if (session.status !== 'complete') {
    return <ErrorState message="The session result for this link is not yet available." />;
  }

  let result: AggregatedResult | null = null;
  if (session.result) {
    try {
      result = JSON.parse(session.result) as AggregatedResult;
    } catch {
      return <ErrorState message="Could not parse the session result. Please contact the report owner." />;
    }
  } else {
    result = await loadArchivedSeoResult(session.id); // C5: blob pruned
  }
  if (!result) {
    return <ErrorState message="The session result for this link is not yet available." />;
  }

  // Increment access count (non-critical, fire-and-forget)
  void prisma.shareLink.update({
    where: { token },
    data: { accessCount: { increment: 1 } },
  });

  const siteName = result.metadata?.site_name ?? session.siteName ?? 'Site';

  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <SharedBanner expiresAt={shareLink.expiresAt} />

      <div className="py-12 px-6">
        <div className="max-w-6xl mx-auto space-y-6">

          {/* Header */}
          <div>
            <h1 className="font-display font-extrabold text-2xl text-[#1c2d4a] dark:text-white">
              {siteName} — SEO Audit
            </h1>
            {!result.archived && (
              <p className="text-gray-500 dark:text-white/50 text-sm mt-1">
                {result.metadata.files_processed.length} file
                {result.metadata.files_processed.length !== 1 ? 's' : ''} processed
              </p>
            )}
          </div>

          {result.archived && <ArchivedSessionBanner />}

          {/* Metrics bar */}
          <MetricsBar
            totalUrls={result.crawl_summary.total_urls}
            criticalCount={result.issues.critical.length}
            warningsCount={result.issues.warnings.length}
            noticesCount={result.issues.notices.length}
            indexableUrls={result.crawl_summary.indexable_urls}
          />

          {/* Issues + recommendations */}
          {/* IssueTabs is a client component; no onUrlClick = read-only */}
          <IssueTabs issues={result.issues} />
          <RecommendationList recommendations={result.recommendations} />

          {/* Metadata footer */}
          {result.metadata.parsers_used.length > 0 && (
            <div className="text-xs text-gray-400 dark:text-white/40 pb-4">
              Parsers used: {result.metadata.parsers_used.join(', ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
