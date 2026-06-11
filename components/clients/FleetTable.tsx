'use client'

// components/clients/FleetTable.tsx
//
// The "Monday morning" fleet table: all clients × latest scores × alerts.
// Client component for client-side sorting over server-passed props. Local
// prop interfaces (repo convention: don't import from server-only services).

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { RelativeTime } from '@/app/pillar-analysis/[id]/components/RelativeTime'

interface SeriesProp {
  latest: number | null
  previous: number | null
  delta: number | null
  latestAt: string | null
  points: { date: string; score: number }[]
}

export interface FleetTableRow {
  id: number
  name: string
  firstDomain: string | null
  seo: SeriesProp
  ada: SeriesProp
  adaSource: 'site' | 'page' | null
  pillarScore: number | null
  pillarAt: string | null
  lastActivityAt: string | null
  alerts: { kind: 'score-drop' | 'error' | 'stale'; detail: string }[]
}

type SortKey = 'default' | 'name' | 'seo' | 'ada' | 'pillar' | 'activity'

const ALERT_CLASSES: Record<FleetTableRow['alerts'][number]['kind'], string> = {
  error: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  'score-drop': 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  stale: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60',
}

function DeltaChip({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return null
  return (
    <span
      className={`ml-1.5 px-1 py-0.5 rounded text-[10px] font-semibold tabular-nums ${
        delta > 0
          ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
          : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
      }`}
    >
      {delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
    </span>
  )
}

function ScoreCell({ series, suffix }: { series: SeriesProp; suffix?: string }) {
  if (series.latest === null) return <span className="text-gray-300 dark:text-white/20">—</span>
  return (
    <span className="tabular-nums">
      <span className="font-semibold text-[#1c2d4a] dark:text-white">{series.latest}</span>
      {suffix && (
        <span className="ml-1 px-1 py-0.5 rounded text-[10px] font-semibold uppercase bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50">
          {suffix}
        </span>
      )}
      <DeltaChip delta={series.delta} />
    </span>
  )
}

export function FleetTable({ rows }: { rows: FleetTableRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('default')
  const [asc, setAsc] = useState(false)

  const sorted = useMemo(() => {
    const copy = [...rows]
    const num = (v: number | null) => (v === null ? -1 : v)
    const str = (v: string | null) => v ?? ''
    switch (sortKey) {
      case 'name':
        copy.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'seo':
        copy.sort((a, b) => num(b.seo.latest) - num(a.seo.latest))
        break
      case 'ada':
        copy.sort((a, b) => num(b.ada.latest) - num(a.ada.latest))
        break
      case 'pillar':
        copy.sort((a, b) => num(b.pillarScore) - num(a.pillarScore))
        break
      case 'activity':
        copy.sort((a, b) => str(b.lastActivityAt).localeCompare(str(a.lastActivityAt)))
        break
      default:
        // Alerts first (most alerts at top), then name.
        copy.sort((a, b) => b.alerts.length - a.alerts.length || a.name.localeCompare(b.name))
    }
    if (asc && sortKey !== 'default') copy.reverse()
    return copy
  }, [rows, sortKey, asc])

  function clickSort(key: SortKey) {
    if (key === sortKey) setAsc(!asc)
    else {
      setSortKey(key)
      setAsc(false)
    }
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-10 text-center">
        <p className="text-sm text-gray-500 dark:text-white/60">
          No clients yet —{' '}
          <Link href="/clients/manage" className="text-[#f5a623] hover:text-[#e09415] font-semibold">add one →</Link>
        </p>
      </div>
    )
  }

  const header = (label: string, key: SortKey, align: 'left' | 'right' = 'left') => (
    // Full class literals (not `text-${align}`) so Tailwind's scanner sees them.
    <th className={`px-5 py-3 font-semibold ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => clickSort(key)}
        className={`uppercase tracking-wide text-xs ${sortKey === key ? 'text-[#f5a623]' : 'text-gray-400 dark:text-white/40'} hover:text-[#f5a623]`}
      >
        {label}{sortKey === key ? (asc ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  )

  return (
    <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-navy-border text-left">
              {header('Client', 'name')}
              {header('SEO', 'seo', 'right')}
              {header('ADA', 'ada', 'right')}
              {header('Pillar', 'pillar', 'right')}
              {header('Last activity', 'activity')}
              <th className="px-5 py-3 font-semibold text-left text-xs uppercase tracking-wide text-gray-400 dark:text-white/40">Alerts</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="border-b border-gray-50 dark:border-navy-border/50 last:border-0 hover:bg-gray-50 dark:hover:bg-navy-light/40 transition-colors">
                <td className="px-5 py-3">
                  <Link href={`/clients/${r.id}`} className="font-semibold text-[#1c2d4a] dark:text-white hover:text-[#f5a623] dark:hover:text-[#f5a623] transition-colors">
                    {r.name}
                  </Link>
                  {r.firstDomain && <div className="text-[11px] text-gray-400 dark:text-white/40">{r.firstDomain}</div>}
                </td>
                <td className="px-5 py-3 text-right"><ScoreCell series={r.seo} /></td>
                <td className="px-5 py-3 text-right"><ScoreCell series={r.ada} suffix={r.adaSource === 'page' ? 'page' : undefined} /></td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {r.pillarScore === null
                    ? <span className="text-gray-300 dark:text-white/20">—</span>
                    : <span className="font-semibold text-[#1c2d4a] dark:text-white">{r.pillarScore}<span className="text-gray-400 dark:text-white/40 font-normal">/10</span></span>}
                </td>
                <td className="px-5 py-3 text-gray-500 dark:text-white/60">
                  {r.lastActivityAt ? <RelativeTime value={r.lastActivityAt} /> : <span className="text-gray-300 dark:text-white/20">—</span>}
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-1">
                    {r.alerts.map((a, i) => (
                      <span key={i} title={a.detail} className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${ALERT_CLASSES[a.kind]}`}>
                        {a.kind === 'score-drop' ? 'drop' : a.kind}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
