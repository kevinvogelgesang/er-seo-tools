// lib/services/client-quarter.ts — quarter-grid context for the client dashboard (B5).
// Pure read layer over QuarterPlan/QuarterAssignment + derived activity.
import { prisma } from '@/lib/db'
import { getWeekRange } from '@/lib/quarter-grid/grid-ops'
import { getQuarterActivity, activityWindowStart, type ActivityKind } from './quarter-activity'
import type { ClientStatus } from '@/lib/quarter-grid/state'

export type QuarterContext = {
  planName: string
  startDate: string | null
  week: number | null // null = in pool
  weekRange: string | null
  priority: number
  status: ClientStatus
  note: string
  completed: boolean
  completedAt: string | null
  latestActivity: { kind: ActivityKind; at: string } | null
}

/** Latest plan's context for one client, or null when no plan / no assignment row. */
export async function getClientQuarterContext(clientId: number): Promise<QuarterContext | null> {
  const plan = await prisma.quarterPlan.findFirst({ orderBy: { id: 'desc' } })
  if (!plan) return null
  const a = await prisma.quarterAssignment.findUnique({ where: { planId_clientId: { planId: plan.id, clientId } } })
  if (!a) return null
  const activity = await getQuarterActivity([clientId], activityWindowStart(plan))
  const latest = activity.get(clientId)?.latest ?? null
  return {
    planName: plan.name,
    startDate: plan.startDate,
    week: a.week,
    weekRange: a.week != null && plan.startDate ? getWeekRange(plan.startDate, a.week) : null,
    priority: a.priority,
    status: a.status as ClientStatus,
    note: a.note,
    completed: a.completedAt != null,
    completedAt: a.completedAt?.toISOString() ?? null,
    latestActivity: latest ? { kind: latest.kind, at: latest.at.toISOString() } : null,
  }
}
