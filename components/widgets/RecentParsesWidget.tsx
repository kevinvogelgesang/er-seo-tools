// components/widgets/RecentParsesWidget.tsx
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ScoreRing } from '@/components/ui/ScoreRing'
import { StatusPill } from '@/components/ui/StatusPill'
import type { WidgetSize } from '@/lib/widgets/types'

interface ParseRow {
  id: string
  kind: 'session' | 'run'
  source: 'sf-upload' | 'live-scan'
  createdAt: string
  status: string
  siteName: string | null
  clientName: string | null
  healthScore?: number
  urlCount?: number
}

function hrefFor(row: ParseRow): string {
  // Live-scan runs deep-link to their run results page (the id is a CrawlRun id);
  // sessions to the session results page.
  return row.kind === 'session'
    ? `/seo-parser/results/${row.id}`
    : `/seo-parser/results/run/${row.id}`
}

export function RecentParsesWidget({ size }: { size: WidgetSize }) {
  const [rows, setRows] = useState<ParseRow[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/parse/history')
      .then((r) => { if (!r.ok) throw new Error(`status ${r.status}`); return r.json() })
      .then((d: unknown) => { if (live) setRows(Array.isArray(d) ? (d as ParseRow[]) : []) })
      .catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [])

  if (error) return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Couldn&apos;t load recent parses.</p>
  if (!rows) return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Loading…</p>
  if (rows.length === 0) return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">No recent parses yet.</p>

  const limit = size === 'sm' ? 3 : 8

  return (
    <ul className="space-y-2 overflow-auto">
      {rows.slice(0, limit).map((row) => (
        <li key={`${row.kind}-${row.id}`}>
          <Link href={hrefFor(row)} className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-gray-50 dark:hover:bg-white/5">
            <ScoreRing score={row.healthScore ?? null} size={size === 'sm' ? 34 : 40} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[13px] font-semibold text-navy dark:text-white">
                {row.siteName ?? row.clientName ?? 'Untitled'}
              </p>
              <div className="flex items-center gap-2">
                <StatusPill label={row.source === 'live-scan' ? 'live scan' : 'SF upload'} tone={row.source === 'live-scan' ? 'warning' : 'neutral'} />
                {row.urlCount != null && (
                  <span className="text-[11px] font-body text-gray-400 dark:text-white/40">{row.urlCount} URLs</span>
                )}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
