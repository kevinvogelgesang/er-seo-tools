'use client';

import dynamic from 'next/dynamic';
import { RelativeTime } from '@/app/pillar-analysis/[id]/components/RelativeTime';

// Local interface matching the shape returned by lib/services/client-seo-history.ts.
// Defined locally to avoid importing from a server-only module into a client component.
interface SeoHistorySession {
  id: string;
  createdAt: string;
  siteName: string | null;
  siteHost: string | null;
  totalUrls: number | null;
  criticalCount: number | null;
  warningCount: number | null;
  noticeCount: number | null;
}

interface Props {
  sessions: SeoHistorySession[];
  latestTwo: [string, string] | null;
  lastAuditedAt: string | null;
}

const SeoHistoryChart = dynamic(
  () => import('./SeoHistoryChart').then((m) => ({ default: m.SeoHistoryChart })),
  { ssr: false }
);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function SeoHistoryView({ sessions, latestTwo, lastAuditedAt }: Props) {
  if (sessions.length === 0) {
    return (
      <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-10 text-center">
        <p className="text-sm text-gray-500 dark:text-white/60">No completed SEO audits for this client yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Last audited + compare action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {lastAuditedAt && (
          <p className="text-sm text-gray-500 dark:text-white/60">
            Last audited:{' '}
            <RelativeTime value={lastAuditedAt} className="font-semibold text-[#1c2d4a] dark:text-white" />
          </p>
        )}
        {latestTwo && (
          <a
            href={`/seo-parser/diff?a=${latestTwo[0]}&b=${latestTwo[1]}`}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1c2d4a] hover:bg-[#0f1d30] text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Compare latest two crawls
          </a>
        )}
      </div>

      {/* Trend chart */}
      <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6">
        <h3 className="text-sm font-semibold text-[#1c2d4a] dark:text-white uppercase tracking-wide mb-4">
          Issue Trend
        </h3>
        <SeoHistoryChart sessions={sessions} />
      </div>

      {/* Session table */}
      <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-navy-border text-left text-xs uppercase tracking-wide text-gray-400 dark:text-white/40">
                <th className="px-5 py-3 font-semibold">Date</th>
                <th className="px-5 py-3 font-semibold text-right">Total URLs</th>
                <th className="px-5 py-3 font-semibold text-right">Critical</th>
                <th className="px-5 py-3 font-semibold text-right">Warnings</th>
                <th className="px-5 py-3 font-semibold text-right">Notices</th>
                <th className="px-5 py-3 font-semibold text-right">Report</th>
              </tr>
            </thead>
            <tbody>
              {sessions
                .slice()
                .reverse()
                .map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-gray-50 dark:border-navy-border/50 last:border-0 hover:bg-gray-50 dark:hover:bg-navy-light/40 transition-colors"
                  >
                    <td className="px-5 py-3 text-[#1c2d4a] dark:text-white whitespace-nowrap">{formatDate(s.createdAt)}</td>
                    <td className="px-5 py-3 text-right text-gray-600 dark:text-white/70 tabular-nums">{s.totalUrls ?? '—'}</td>
                    <td className="px-5 py-3 text-right font-semibold text-red-600 dark:text-red-400 tabular-nums">{s.criticalCount ?? '—'}</td>
                    <td className="px-5 py-3 text-right font-semibold text-orange-500 dark:text-orange-400 tabular-nums">{s.warningCount ?? '—'}</td>
                    <td className="px-5 py-3 text-right font-semibold text-blue-600 dark:text-blue-400 tabular-nums">{s.noticeCount ?? '—'}</td>
                    <td className="px-5 py-3 text-right">
                      <a
                        href={`/seo-parser/results/${s.id}`}
                        className="text-[#f5a623] hover:text-[#e09415] font-semibold transition-colors"
                      >
                        View
                      </a>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
