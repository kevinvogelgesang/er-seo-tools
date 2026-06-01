'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import React from 'react';
import dynamic from 'next/dynamic';
import { AggregatedResult } from '@/lib/types';
import { MetricsBar } from './MetricsBar';
import { IssueTabs } from './IssueTabs';
import { RecommendationList } from './RecommendationList';
import { ExportButtons } from './ExportButtons';
import { CopyToClipboard } from './CopyToClipboard';
import { PageDetailModal } from './PageDetailModal';
import { ShareModal } from './ShareModal';
import { DuplicateContentSection } from './DuplicateContentSection';
import { KeywordSignalsPanel } from './KeywordSignalsPanel';

const StatusCodeBarChart = dynamic(() => import('./charts/StatusCodeBarChart').then(m => ({ default: m.StatusCodeBarChart })), { ssr: false });
const CrawlDepthChart = dynamic(() => import('./charts/CrawlDepthChart').then(m => ({ default: m.CrawlDepthChart })), { ssr: false });

interface ResultsViewProps {
  result: AggregatedResult;
  sessionId: string;
  pillarButton?: React.ReactNode;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-navy-card rounded-lg shadow-sm border border-gray-100 dark:border-navy-border p-6">
      <h3 className="text-sm font-semibold text-[#1c2d4a] dark:text-white uppercase tracking-wide mb-4">{title}</h3>
      {children}
    </div>
  );
}

export function ResultsView({ result, sessionId, pillarButton }: ResultsViewProps) {
  const router = useRouter();
  const siteName = result.metadata?.site_name || 'Site';

  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep py-12 px-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-bold text-2xl text-[#1c2d4a] dark:text-white">{siteName} — SEO Audit</h1>
            <p className="text-gray-500 dark:text-white/50 text-sm mt-1">
              {result.metadata.files_processed.length} file{result.metadata.files_processed.length !== 1 ? 's' : ''} processed
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <CopyToClipboard result={result} />
            <ExportButtons sessionId={sessionId} />
            <button
              onClick={() => setShareOpen(true)}
              className="px-4 py-2 border border-[#1c2d4a] dark:border-navy-border rounded-lg text-sm text-[#1c2d4a] dark:text-white font-medium hover:bg-[#1c2d4a] hover:text-white transition-colors"
            >
              Share Report
            </button>
            {pillarButton}
            <button
              onClick={() => router.push('/seo-parser')}
              className="px-4 py-2 border border-gray-200 dark:border-navy-border rounded-lg text-sm text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-navy-light transition-colors"
            >
              New Analysis
            </button>
          </div>
        </div>

        {/* Metrics bar */}
        <MetricsBar
          totalUrls={result.crawl_summary.total_urls}
          criticalCount={result.issues.critical.length}
          warningsCount={result.issues.warnings.length}
          noticesCount={result.issues.notices.length}
          indexableUrls={result.crawl_summary.indexable_urls}
        />

        {/* Full-width issues */}
        <IssueTabs issues={result.issues} onUrlClick={(url) => setSelectedUrl(url)} />

        {/* Recommendations */}
        <RecommendationList recommendations={result.recommendations} />

        {/* Charts row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ChartCard title="Response Code Distribution">
            <StatusCodeBarChart summary={result.crawl_summary} />
          </ChartCard>
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

        {/* Debug footer */}
        <details className="text-xs text-gray-400 dark:text-white/40 pb-4">
          <summary className="cursor-pointer hover:text-gray-600 dark:hover:text-white/60 select-none">Debug info</summary>
          <p className="mt-1">Parsers used: {result.metadata.parsers_used.join(', ')}</p>
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

      {/* Share report modal */}
      {shareOpen && (
        <ShareModal
          sessionId={sessionId}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
