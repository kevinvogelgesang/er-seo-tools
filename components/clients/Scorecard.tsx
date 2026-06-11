'use client'

// components/clients/Scorecard.tsx
//
// One dashboard scorecard: big score + delta vs previous run + sparkline +
// "as of" link to the source run. Client component because the sparkline is a
// dynamic ssr:false import (Recharts).

import dynamic from 'next/dynamic'
import { RelativeTime } from '@/app/pillar-analysis/[id]/components/RelativeTime'
import type { ReactNode } from 'react'

const Sparkline = dynamic(() => import('./Sparkline').then((m) => ({ default: m.Sparkline })), { ssr: false })

export interface ScorecardProps {
  label: string
  score: number | null
  max: 100 | 10
  delta: number | null
  asOf: string | null // ISO of the latest point
  href: string | null // detail view of the latest source run
  points: { date: string; score: number }[]
  sourceNote?: string // e.g. "page audits" for the standalone-ADA fallback
  children?: ReactNode // extra chips (SEO issue counts)
}

function scoreColor(score: number, max: 100 | 10): string {
  const [green, amber] = max === 100 ? [90, 70] : [8, 5]
  if (score >= green) return 'text-green-600 dark:text-green-400'
  if (score >= amber) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

export function Scorecard({ label, score, max, delta, asOf, href, points, sourceNote, children }: ScorecardProps) {
  return (
    <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-white/40">{label}</h3>
        {sourceNote && (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60">
            {sourceNote}
          </span>
        )}
      </div>
      {score === null ? (
        <p className="mt-4 text-sm text-gray-400 dark:text-white/40">No runs yet</p>
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-5xl font-display font-bold ${scoreColor(score, max)}`}>{score}</span>
            <span className="text-sm text-gray-400 dark:text-white/40">/{max}</span>
            {delta !== null && delta !== 0 && (
              <span
                className={`px-1.5 py-0.5 rounded text-[11px] font-semibold tabular-nums ${
                  delta > 0
                    ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
                    : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
                }`}
              >
                {delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`}
              </span>
            )}
          </div>
          <Sparkline points={points} />
          {asOf && (
            <p className="mt-1 text-[11px] text-gray-400 dark:text-white/40">
              as of <RelativeTime value={asOf} className="text-gray-500 dark:text-white/60" />
              {href && (
                <>
                  {' · '}
                  <a href={href} className="text-[#f5a623] hover:text-[#e09415] font-semibold">View →</a>
                </>
              )}
            </p>
          )}
          {children}
        </>
      )}
    </div>
  )
}
