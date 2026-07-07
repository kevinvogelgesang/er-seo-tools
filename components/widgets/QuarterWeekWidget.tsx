'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { resolveCurrentWeek } from '@/lib/quarter-grid/current-week'
import { getWeekRange } from '@/lib/quarter-grid/grid-ops'
import { StatusPill } from '@/components/ui/StatusPill'
import type { WidgetSize } from '@/lib/widgets/types'

// Mirrors the QuarterPlanGetResponse contract: startDate is string | null
// (lib/quarter-grid/state.ts) and assignments carry a nullable slot position
// (Codex fix 3).
interface Assignment { clientId: number; week: number | null; position: number | null; priority: number; status: string; completed: boolean }
interface Plan { startDate: string | null }

const STATUS_TONE: Record<string, 'neutral' | 'running' | 'success' | 'error' | 'warning'> = {
  not_started: 'neutral', in_progress: 'running', on_hold: 'warning', blocked: 'error', complete: 'success',
}

export function QuarterWeekWidget({ size }: { size: WidgetSize }) {
  const [state, setState] = useState<
    { plan: Plan | null; assignments: Assignment[]; names: Map<number, string> } | null
  >(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let live = true
    Promise.all([
      fetch('/api/quarter-plan').then((r) => { if (!r.ok) throw new Error('plan'); return r.json() }),
      fetch('/api/clients').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ])
      .then(([planRes, clientsRes]: [{ plan: Plan | null; assignments?: Assignment[] }, Array<{ id: number; name: string }>]) => {
        if (!live) return
        const names = new Map<number, string>()
        if (Array.isArray(clientsRes)) for (const c of clientsRes) names.set(c.id, c.name)
        setState({ plan: planRes.plan, assignments: planRes.assignments ?? [], names })
      })
      .catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [])

  if (error) return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Couldn&apos;t load the quarter plan.</p>
  if (!state) return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Loading…</p>
  if (!state.plan) {
    return (
      <div className="flex h-full flex-col items-start justify-center gap-2">
        <p className="text-[13px] font-body text-gray-400 dark:text-white/40">No quarter plan yet.</p>
        <Link href="/quarter-grid" className="text-[13px] font-body font-semibold text-orange hover:underline">Open Quarter Grid →</Link>
      </div>
    )
  }

  const startDate = state.plan.startDate
  const week = startDate ? resolveCurrentWeek(startDate, new Date()) : null
  const range = week && startDate ? getWeekRange(startDate, week) : null
  // Preserve the planned slot order: sort by grid position first (nulls last),
  // then priority, then clientId for a stable tiebreak (Codex fix 3).
  const clients =
    week == null
      ? []
      : state.assignments
          .filter((a) => a.week === week)
          .sort(
            (a, b) =>
              (a.position ?? Infinity) - (b.position ?? Infinity) ||
              a.priority - b.priority ||
              a.clientId - b.clientId,
          )
  const detailed = size !== 'sm'

  return (
    <div className="flex h-full flex-col gap-2">
      <p className="text-[12px] font-body text-gray-500 dark:text-white/50">
        {week == null ? 'Outside the planned quarter' : `Week ${week}${range ? ` · ${range}` : ''}`}
      </p>
      {clients.length === 0 ? (
        <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Nothing scheduled this week.</p>
      ) : (
        <ul className="space-y-1 overflow-auto">
          {(detailed ? clients : clients.slice(0, 3)).map((a) => (
            <li key={a.clientId} className="flex items-center justify-between gap-2 text-[13px] font-body">
              <span className="truncate text-navy dark:text-white">{state.names.get(a.clientId) ?? `Client #${a.clientId}`}</span>
              <StatusPill label={a.status.replace('_', ' ')} tone={STATUS_TONE[a.status] ?? 'neutral'} />
            </li>
          ))}
        </ul>
      )}
      <Link href="/quarter-grid" className="mt-auto text-[12px] font-body font-semibold text-orange hover:underline">Open Quarter Grid →</Link>
    </div>
  )
}
