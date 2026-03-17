'use client';

import { useRouter } from 'next/navigation';
import { AggregatedResult } from '@/lib/types';
import { SummaryCard } from './SummaryCard';
import { IssueTabs } from './IssueTabs';
import { RecommendationList } from './RecommendationList';
import { ExportButtons } from './ExportButtons';
import { CopyToClipboard } from './CopyToClipboard';
import { IssuesPieChart } from './charts/IssuesPieChart';
import { StatusCodeBarChart } from './charts/StatusCodeBarChart';
import { CrawlDepthChart } from './charts/CrawlDepthChart';

interface ResultsViewProps {
  result: AggregatedResult;
  sessionId: string;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
      <h3 className="text-sm font-semibold text-[#1c2d4a] uppercase tracking-wide mb-4">{title}</h3>
      {children}
    </div>
  );
}

export function ResultsView({ result, sessionId }: ResultsViewProps) {
  const router = useRouter();
  const siteName = result.metadata?.site_name || 'Site';

  return (
    <div className="min-h-screen bg-[#f4f6f9] py-12 px-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display font-extrabold text-2xl text-[#1c2d4a]">{siteName} — SEO Audit</h1>
            <p className="text-gray-500 text-sm mt-1">
              {result.metadata.files_processed.length} file{result.metadata.files_processed.length !== 1 ? 's' : ''} processed
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <CopyToClipboard result={result} />
            <ExportButtons sessionId={sessionId} />
            <button
              onClick={() => router.push('/seo-parser')}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              New Analysis
            </button>
          </div>
        </div>

        {/* Main 3-col layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: summary + pie */}
          <div className="space-y-6">
            <SummaryCard summary={result.crawl_summary} />
            <ChartCard title="Issue Breakdown">
              <IssuesPieChart issues={result.issues} />
            </ChartCard>
          </div>

          {/* Center: issues + recommendations */}
          <div className="lg:col-span-2 space-y-6">
            <IssueTabs issues={result.issues} />
            <RecommendationList recommendations={result.recommendations} />
          </div>
        </div>

        {/* Bottom charts row */}
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

        {/* Metadata footer */}
        <div className="text-xs text-gray-400 pb-4">
          Parsers used: {result.metadata.parsers_used.join(', ')}
        </div>
      </div>
    </div>
  );
}
