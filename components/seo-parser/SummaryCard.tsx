import { CrawlSummary } from '@/lib/types';

interface StatItemProps {
  label: string;
  value: number | string | undefined;
  color?: string;
}

function StatItem({ label, value, color }: StatItemProps) {
  if (value === undefined) return null;
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
      <span className="text-gray-600 text-sm">{label}</span>
      <span className={`font-semibold text-sm ${color || 'text-gray-900'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
    </div>
  );
}

interface HealthBadgeProps {
  score: number;
}

function HealthBadge({ score }: HealthBadgeProps) {
  let bgColor: string;
  let textColor: string;
  let label: string;

  if (score >= 70) {
    bgColor = 'bg-green-100';
    textColor = 'text-green-700';
    label = 'Good';
  } else if (score >= 40) {
    bgColor = 'bg-orange-100';
    textColor = 'text-orange-700';
    label = 'Fair';
  } else {
    bgColor = 'bg-red-100';
    textColor = 'text-red-700';
    label = 'Poor';
  }

  return (
    <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-gray-50 border border-gray-100">
      <div
        className={`w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 ${bgColor}`}
      >
        <span className={`font-display font-extrabold text-xl leading-none ${textColor}`}>
          {score}
        </span>
      </div>
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Health Score</p>
        <p className={`text-sm font-semibold ${textColor}`}>{label}</p>
      </div>
    </div>
  );
}

interface SummaryCardProps {
  summary: CrawlSummary;
  healthScore?: number;
}

export function SummaryCard({ summary, healthScore }: SummaryCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
      <h2 className="text-base font-semibold text-[#1c2d4a] mb-4">Crawl Summary</h2>
      {healthScore !== undefined && <HealthBadge score={healthScore} />}
      <div className="space-y-0">
        <StatItem label="Total URLs" value={summary.total_urls} />
        <StatItem label="Indexable" value={summary.indexable_urls} color="text-green-600" />
        <StatItem label="Non-Indexable" value={summary.non_indexable_urls} color="text-yellow-600" />
        {summary.ok_responses !== undefined && (
          <>
            <div className="h-2" />
            <StatItem label="OK (2xx)" value={summary.ok_responses} color="text-green-600" />
            <StatItem label="Redirects (3xx)" value={summary.redirects} color="text-blue-600" />
            <StatItem label="Client Errors (4xx)" value={summary.client_errors} color="text-orange-500" />
            <StatItem label="Server Errors (5xx)" value={summary.server_errors} color="text-red-600" />
          </>
        )}
        {summary.avg_word_count !== undefined && (
          <>
            <div className="h-2" />
            <StatItem label="Avg Word Count" value={summary.avg_word_count} />
            <StatItem label="Avg Crawl Depth" value={summary.avg_crawl_depth} />
            <StatItem label="Max Crawl Depth" value={summary.max_crawl_depth} />
          </>
        )}
      </div>
    </div>
  );
}
