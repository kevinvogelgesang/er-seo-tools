import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { AUTH_COOKIE_NAME, isValidAuthCookie } from '@/lib/auth'
import { mintQuarterPushToken, QuarterPushTokenError } from '@/lib/quarter-push-token'

export const dynamic = 'force-dynamic'

/**
 * POST /api/quarter-plan/push/mint-token — mint a qct_ handoff token for the
 * latest plan. 409s when there is nothing pushable, so a token is never minted
 * for a no-op payload. Pushable = planned week + not completed + active client
 * with a Teamwork tasklist.
 */
export async function POST(req: NextRequest) {
  if (!(await isValidAuthCookie(req.cookies.get(AUTH_COOKIE_NAME)?.value))) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  }

  try {
    const plan = await prisma.quarterPlan.findFirst({ orderBy: { id: 'desc' }, select: { id: true } })
    if (!plan) return NextResponse.json({ error: 'no_plan' }, { status: 409 })

    const pushable = await prisma.quarterAssignment.findFirst({
      where: {
        planId: plan.id,
        week: { not: null },
        completedAt: null,
        client: { is: { archivedAt: null, teamworkTasklistId: { not: null } } },
      },
      select: { id: true },
    })
    if (!pushable) return NextResponse.json({ error: 'nothing_planned' }, { status: 409 })

    const minted = await mintQuarterPushToken(String(plan.id))
    return NextResponse.json({ ...minted, planId: plan.id })
  } catch (err) {
    if (err instanceof QuarterPushTokenError) {
      console.error('[quarter-push-token] mint failed:', err.message)
      return NextResponse.json({ error: 'token_service_unavailable' }, { status: 500 })
    }
    console.error('POST /api/quarter-plan/push/mint-token error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
