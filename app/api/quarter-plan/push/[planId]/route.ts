import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireHandoffToken } from '@/lib/handoff/route-auth'
import { sortAssignments } from '@/lib/quarter-grid/state'
import { getWeekDates } from '@/lib/quarter-grid/grid-ops'

export const dynamic = 'force-dynamic'

/**
 * GET /api/quarter-plan/push/[planId] — the cycle export the er-handoff-memo
 * skill consumes. Bearer qct_ token, scope 'read', sub === planId. Only the
 * LATEST plan is exportable (singleton facade). Assignments: planned weeks on
 * ACTIVE clients only; completed rows are included (completed: true) so the
 * skill can skip them transparently and count them in the receipt.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params

  const auth = await requireHandoffToken(req, 'qct', planId, 'read')
  if (!auth.ok) return auth.response

  try {
    const plan = await prisma.quarterPlan.findFirst({ orderBy: { id: 'desc' } })
    if (!plan || String(plan.id) !== planId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const rows = await prisma.quarterAssignment.findMany({
      where: { planId: plan.id, week: { not: null }, client: { is: { archivedAt: null } } },
      include: { client: { select: { name: true, teamworkTasklistId: true } } },
    })

    const assignments = sortAssignments(rows).map((a) => {
      const dates = plan.startDate && a.week != null ? getWeekDates(plan.startDate, a.week) : null
      return {
        clientId: a.clientId,
        clientName: a.client.name,
        week: a.week,
        weekStart: dates?.weekStart ?? null,
        weekEnd: dates?.weekEnd ?? null,
        priority: a.priority,
        status: a.status,
        note: a.note,
        completed: a.completedAt != null,
        tasklistId: a.client.teamworkTasklistId,
      }
    })

    return NextResponse.json({
      planId: plan.id,
      planName: plan.name,
      startDate: plan.startDate,
      generatedAt: new Date().toISOString(),
      assignments,
      teamwork: {
        taskType: 'task', // top-level task in the client's tasklist, not a subtask
        rules: { addTimeEstimates: false, usePriorityFlags: false },
        titleFormat: plan.startDate
          ? '[SEO] Quarter Cycle — Week {week} ({range})'
          : '[SEO] Quarter Cycle — Week {week}',
        markerFormat: 'quarter-cycle:{planId}:{clientId}:{week}',
      },
    })
  } catch (error) {
    console.error('GET /api/quarter-plan/push/[planId] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
