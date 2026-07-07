// components/widgets/NeedsAttentionWidget.tsx
// A8 PR 3.5 — worst-movers list. Client widget, fetches /api/fleet/needs-attention
// once. sm = top 3, lg = top 8 with score deltas (spec §3.3). Negative deltas use
// StatusPill tone="error" (red) — a drop is a problem, not a mild "warning" amber
// (Codex fix 6).
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ScoreRing } from '@/components/ui/ScoreRing'
import { StatusPill } from '@/components/ui/StatusPill'
import type { WidgetSize } from '@/lib/widgets/types'
import type { NeedsAttentionRow } from '@/lib/services/fleet-aggregates'

export function NeedsAttentionWidget({ size }: { size: WidgetSize }) {
  const [rows, setRows] = useState<NeedsAttentionRow[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/fleet/needs-attention')
      .then((r) => { if (!r.ok) throw new Error(`status ${r.status}`); return r.json() })
      .then((d: unknown) => { if (live) setRows(Array.isArray(d) ? (d as NeedsAttentionRow[]) : []) })
      .catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [])

  if (error) return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Couldn&apos;t load fleet status.</p>
  if (!rows) return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Loading…</p>
  if (rows.length === 0) {
    return (
      <p className="flex h-full items-center text-[14px] font-body text-gray-500 dark:text-white/60">
        All clear — no clients need attention.
      </p>
    )
  }

  const detailed = size !== 'sm'
  const limit = size === 'sm' ? 3 : 8

  return (
    <ul className="space-y-2 overflow-auto">
      {rows.slice(0, limit).map((r) => {
        const subtitle = r.topAlert ?? r.firstDomain
        return (
          <li key={r.clientId}>
            <Link
              href={`/clients/${r.clientId}`}
              className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-gray-50 dark:hover:bg-white/5"
            >
              <ScoreRing score={r.score} size={detailed ? 40 : 34} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[13px] font-semibold text-navy dark:text-white">
                  {r.name}
                </p>
                {detailed && subtitle && (
                  <p className="truncate text-[11px] font-body text-gray-400 dark:text-white/40">{subtitle}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {r.delta != null && r.delta < 0 && (
                  <StatusPill label={`↓${Math.abs(r.delta)}`} tone="error" />
                )}
                {r.openCritical > 0 && (
                  <StatusPill label={`${r.openCritical} crit`} tone="warning" />
                )}
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
