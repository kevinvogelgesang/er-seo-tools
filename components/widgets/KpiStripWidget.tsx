// components/widgets/KpiStripWidget.tsx
// A8 PR 3.5 — fleet-wide KPI strip. Client widget (like the other 7), fetches
// /api/fleet/kpi once on mount. Fault isolation: activeScans renders "—" when
// the queue sub-fetch failed server-side, while the fleet scores still show.
'use client'
import { useEffect, useState } from 'react'
import type { WidgetSize } from '@/lib/widgets/types'
import type { FleetKpi } from '@/lib/services/fleet-aggregates'

const TILES: { key: keyof FleetKpi; label: string }[] = [
  { key: 'activeScans', label: 'Active scans' },
  { key: 'avgAda', label: 'Avg ADA' },
  { key: 'avgSeo', label: 'Avg SEO' },
  { key: 'openCriticals', label: 'Open criticals' },
]

export function KpiStripWidget({ size }: { size: WidgetSize }) {
  const [data, setData] = useState<FleetKpi | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/fleet/kpi')
      .then((r) => { if (!r.ok) throw new Error(`status ${r.status}`); return r.json() })
      .then((d: FleetKpi) => { if (live) setData(d) })
      .catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [])

  if (error) return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Couldn&apos;t load fleet KPIs.</p>
  if (!data) return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Loading…</p>

  // xl spans 4 desktop columns → 1×4 row; wide spans 2 → 2×2 grid.
  const cols = size === 'xl' ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2'

  return (
    <div className={`grid ${cols} gap-3 h-full`}>
      {TILES.map(({ key, label }) => {
        const value = data[key]
        return (
          <div
            key={key}
            className="flex flex-col justify-center rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-3 dark:border-navy-border dark:bg-navy-deep/40"
          >
            <span className="font-display text-[28px] font-extrabold leading-none text-navy dark:text-white">
              {value == null ? '—' : value}
            </span>
            <span className="mt-1 text-[11px] font-body font-semibold uppercase tracking-wide text-gray-400 dark:text-white/40">
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
