'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import React from 'react';
import dynamic from 'next/dynamic';
import { AggregatedResult } from '@/lib/types';
import { FileProcessingPanel } from './FileProcessingPanel';
import { MetricsBar } from './MetricsBar';
import { IssueTabs } from './IssueTabs';
import { RecommendationList } from './RecommendationList';
import { RecommendationsPanel } from './RecommendationsPanel';
import { ExportButtons } from './ExportButtons';
import { CopyToClipboard } from './CopyToClipboard';
import { PageDetailModal } from './PageDetailModal';
import { ShareModal } from './ShareModal';
import { NeedsScreamingFrog, SeoSourceBadge } from '@/components/seo/SeoSourceBadge';
import { DuplicateContentSection } from './DuplicateContentSection';
import { KeywordSignalsPanel } from './KeywordSignalsPanel';
import { SuggestedPriorities } from './SuggestedPriorities';
import { AuditCompletenessBanner } from './AuditCompletenessBanner';
import { ArchivedSessionBanner } from './ArchivedSessionBanner';
import { computeCompleteness } from '@/lib/services/completeness';
import { PagesTable } from './PagesTable';
import { ScoreExplanation } from '@/components/scoring/ScoreExplanation';
import { ScoreRing } from '@/components/ui/ScoreRing';

const StatusCodeBarChart = dynamic(() => import('./charts/StatusCodeBarChart').then(m => ({ default: m.StatusCodeBarChart })), { ssr: false });
const CrawlDepthChart = dynamic(() => import('./charts/CrawlDepthChart').then(m => ({ default: m.CrawlDepthChart })), { ssr: false });

interface ResultsViewProps {
  result: AggregatedResult;
  /** Session-keyed source (SF-upload path). */
  sessionId?: string;
  /** Run-keyed source (live-scan path). Provide one of sessionId or runId. */
  runId?: string;
  pillarButton?: React.ReactNode;
  roadmap?: React.ReactNode;
  /** C8: persisted health score + breakdown for the score explanation panel. */
  healthScore?: number | null;
  scoreBreakdown?: string | null;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-navy-card rounded-lg shadow-sm border border-gray-100 dark:border-navy-border p-6">
      <h3 className="text-sm font-semibold text-navy dark:text-white uppercase tracking-wide mb-4">{title}</h3>
      {children}
    </div>
  );
}

export function ResultsView({ result, sessionId, runId, pillarButton, roadmap, healthScore, scoreBreakdown }: ResultsViewProps) {
  const router = useRouter();
  const siteName = result.metadata?.site_name || 'Site';
  const isLiveScan = !!runId && !sessionId;

  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const hasStatusData = [
    result.crawl_summary.ok_responses,
    result.crawl_summary.redirects,
    result.crawl_summary.client_errors,
    result.crawl_summary.server_errors,
  ].some((v) => typeof v === 'number');

  const issueTypeOptions = Array.from(
    new Set(
      [
        ...result.issues.critical,
        ...result.issues.warnings,
        ...result.issues.notices,
      ].map((i) => i.type),
    ),
  );

  return (
    <div className="py-12 px-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-bold text-2xl text-navy dark:text-white">{siteName} — SEO Audit</h1>
            {isLiveScan ? (
              <p className="mt-1"><SeoSourceBadge source="live-scan" /></p>
            ) : result.archived ? (
              <p className="text-gray-500 dark:text-white/50 text-sm mt-1">Archived — rebuilt from findings data</p>
            ) : (
              <FileProcessingPanel
                reports={result.metadata.file_reports}
                archived={result.archived}
                legacy={{
                  filesProcessed: result.metadata.files_processed.length,
                  parsersUsed: result.metadata.parsers_used.length,
                  totalParsers: result.metadata.total_parsers_available,
                }}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <CopyToClipboard result={result} />
            {sessionId ? (
              <>
                <ExportButtons sessionId={sessionId} />
                <button
                  onClick={() => setShareOpen(true)}
                  className="px-4 py-2 border border-navy dark:border-navy-border rounded-lg text-sm text-navy dark:text-white font-medium hover:bg-navy hover:text-white transition-colors"
                >
                  Share Report
                </button>
              </>
            ) : (
              <NeedsScreamingFrog feature="Export & sharing" />
            )}
            {pillarButton}
            <button
              onClick={() => router.push('/seo-audits')}
              className="px-4 py-2 border border-gray-200 dark:border-navy-border rounded-lg text-sm text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-navy-light transition-colors"
            >
              New Analysis
            </button>
          </div>
        </div>

        {/* Completeness guard — recompute if absent so pre-feature sessions are covered too.
            NEVER recompute on an archived fallback (findings-only data would misclassify as
            missing inputs); the archived banner replaces it. A live-scan run is
            findings-only by construction (no page_index/file uploads) — the
            completeness verdict doesn't apply, so it's suppressed entirely. */}
        {isLiveScan ? null : result.archived ? (
          <ArchivedSessionBanner />
        ) : (
          <AuditCompletenessBanner completeness={result.completeness ?? computeCompleteness(result)} />
        )}

        {/* Score explanation (C8) — reads only the persisted breakdown, never recomputes */}
        {healthScore != null && (
          <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-4">
            <div className="flex flex-col sm:flex-row items-start gap-4">
              <ScoreRing score={healthScore} size={80} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-navy dark:text-white">
                  SEO health score
                </p>
                <ScoreExplanation breakdown={scoreBreakdown ?? null} />
              </div>
            </div>
          </div>
        )}

        {/* Metrics bar */}
        <MetricsBar
          totalUrls={result.crawl_summary.total_urls}
          criticalCount={result.issues.critical.length}
          warningsCount={result.issues.warnings.length}
          noticesCount={result.issues.notices.length}
          indexableUrls={result.crawl_summary.indexable_urls}
        />

        {/* Suggested priorities */}
        <SuggestedPriorities issues={result.issues} />

        {/* Technical SEO roadmap */}
        {roadmap}

        {/* Full-width issues */}
        <IssueTabs issues={result.issues} onUrlClick={(url) => setSelectedUrl(url)} />

        {/* Recommendations */}
        {result.structured_recommendations && result.structured_recommendations.length > 0 ? (
          <RecommendationsPanel recommendations={result.structured_recommendations} />
        ) : (
          <RecommendationList recommendations={result.recommendations} />
        )}

        {/* Charts row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {hasStatusData && (
            <ChartCard title="Response Code Distribution">
              <StatusCodeBarChart summary={result.crawl_summary} />
            </ChartCard>
          )}
          {result.site_structure?.crawl_depth_distribution && (
            <ChartCard title="Crawl Depth Distribution">
              <CrawlDepthChart distribution={result.site_structure.crawl_depth_distribution} />
            </ChartCard>
          )}
        </div>

        {/* Duplicate content section */}
        {result.duplicate_content && (
          <DuplicateContentSection data={result.duplicate_content} />
        )}

        {/* Keyword signals section */}
        {result.keyword_signals && (
          <KeywordSignalsPanel data={result.keyword_signals} />
        )}

        {/* Crawled pages drill-down */}
        <details className="bg-white dark:bg-navy-card rounded-lg shadow-sm border border-gray-100 dark:border-navy-border overflow-hidden group">
          <summary className="px-6 py-4 flex items-center gap-3 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-navy-light transition-colors">
            <span className="text-sm font-semibold text-navy dark:text-white uppercase tracking-wide">
              Crawled Pages
            </span>
            <span className="text-gray-400 dark:text-white/40 text-base leading-none ml-auto group-open:rotate-90 transition-transform">
              ▶
            </span>
          </summary>
          <div className="px-6 pb-6 border-t border-gray-100 dark:border-navy-border pt-4">
            <PagesTable
              sessionId={sessionId}
              runId={runId}
              issueTypeOptions={issueTypeOptions}
              onUrlClick={(url) => setSelectedUrl(url)}
            />
          </div>
        </details>

      </div>

      {/* Per-page drill-down modal */}
      {selectedUrl !== null && (
        <PageDetailModal
          url={selectedUrl}
          result={result}
          onClose={() => setSelectedUrl(null)}
        />
      )}

      {/* Share report modal — only available for session-keyed (SF-upload) results */}
      {shareOpen && sessionId && (
        <ShareModal
          sessionId={sessionId}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
