'use client'

// components/clients/IssueTrendCard.tsx
//
// Issue-count trend (full session history — covers pre-A2 runs that have no
// score) + the compare-latest-two link. Extracted from the retired
// SeoHistoryView; reuses SeoHistoryChart unchanged.

import dynamic from 'next/dynamic'

interface SeoHistorySession {
  id: string
  createdAt: string
  siteName: string | null
  siteHost: string | null
  totalUrls: number | null
  criticalCount: number | null
  warningCount: number | null
  noticeCount: number | null
}

const SeoHistoryChart = dynamic(
  () => import('./SeoHistoryChart').then((m) => ({ default: m.SeoHistoryChart })),
  { ssr: false },
)

export function IssueTrendCard({ sessions, latestTwo }: { sessions: SeoHistorySession[]; latestTwo: [string, string] | null }) {
  if (sessions.length === 0) return null
  return (
    <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold text-navy dark:text-white uppercase tracking-wide">Issue Trend</h3>
        {latestTwo && (
          <a
            href={`/seo-audits/diff?a=${latestTwo[0]}&b=${latestTwo[1]}`}
            className="text-xs font-semibold text-orange hover:text-orange-dark transition-colors"
          >
            Compare latest two crawls →
          </a>
        )}
      </div>
      <SeoHistoryChart sessions={sessions} />
    </div>
  )
}
