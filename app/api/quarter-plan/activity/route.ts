import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getQuarterActivity, activityWindowStart } from '@/lib/services/quarter-activity'

export const dynamic = 'force-dynamic'

/**
 * GET /api/quarter-plan/activity — derived tool activity for the latest plan's
 * clients since the cycle window start. Read-only; { activity: {} } when no plan.
 */
export async function GET() {
  try {
    const plan = await prisma.quarterPlan.findFirst({ orderBy: { id: 'desc' }, select: { id: true, startDate: true, createdAt: true } })
    if (!plan) return NextResponse.json({ activity: {} })
    const rows = await prisma.quarterAssignment.findMany({ where: { planId: plan.id }, select: { clientId: true } })
    const map = await getQuarterActivity(rows.map((r) => r.clientId), activityWindowStart(plan))
    const activity: Record<number, { latest: { kind: string; at: string }; kinds: Record<string, string> }> = {}
    for (const [clientId, a] of map) {
      const kinds: Record<string, string> = {}
      for (const [kind, at] of Object.entries(a.kinds) as [string, Date][]) kinds[kind] = at.toISOString()
      activity[clientId] = { latest: { kind: a.latest.kind, at: a.latest.at.toISOString() }, kinds }
    }
    return NextResponse.json({ activity })
  } catch (error) {
    console.error('GET /api/quarter-plan/activity error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
