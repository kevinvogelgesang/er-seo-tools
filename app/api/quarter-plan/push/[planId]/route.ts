import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyQuarterPushToken, QuarterPushTokenError } from '@/lib/quarter-push-token'
import { sortAssignments } from '@/lib/quarter-grid/state'
import { getWeekDates } from '@/lib/quarter-grid/grid-ops'

export const dynamic = 'force-dynamic'

function tokenErrorCode(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('expired')) return 'token_expired'
  if (m.includes('does not match')) return 'token_wrong_plan_id'
  if (m.includes('signature')) return 'token_invalid_signature'
  return 'token_invalid'
}

function bearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(qct_\S+)$/)
  return match ? match[1] : null
}

/**
 * GET /api/quarter-plan/push/[planId] — the cycle export the er-handoff-memo
 * skill consumes. Bearer qct_ token, scope 'read', sub === planId. Only the
 * LATEST plan is exportable (singleton facade). Assignments: planned weeks on
 * ACTIVE clients only; completed rows are included (completed: true) so the
 * skill can skip them transparently and count them in the receipt.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params

  const token = bearerToken(req)
  if (!token) return NextResponse.json({ error: 'auth_missing_or_malformed' }, { status: 401 })

  let payload
  try {
    payload = await verifyQuarterPushToken(token, planId)
  } catch (err) {
    if (err instanceof QuarterPushTokenError) return NextResponse.json({ error: tokenErrorCode(err.message) }, { status: 401 })
    return NextResponse.json({ error: 'token_service_unavailable' }, { status: 500 })
  }
  const scopes = Array.isArray(payload.scope) ? (payload.scope as string[]) : []
  if (!scopes.includes('read')) return NextResponse.json({ error: 'token_missing_scope' }, { status: 401 })

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
