import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyQuarterPushToken, QuarterPushTokenError } from '@/lib/quarter-push-token'

export const dynamic = 'force-dynamic'

function tokenErrorCode(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('expired')) return 'token_expired'
  if (m.includes('does not match')) return 'token_wrong_plan_id'
  if (m.includes('signature')) return 'token_invalid_signature'
  return 'token_invalid'
}

const clamp = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0

/**
 * POST /api/quarter-plan/push/[planId]/receipt — the skill posts push counts
 * back after creating Teamwork tasks. Bearer qct_, scope 'receipt-write',
 * sub === planId, and the plan must still be the LATEST (a valid old token
 * must never write push metadata onto a superseded plan).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params

  const authHeader = req.headers.get('authorization')
  const match = authHeader?.match(/^Bearer\s+(qct_\S+)$/)
  if (!match) return NextResponse.json({ error: 'auth_missing_or_malformed' }, { status: 401 })

  let payload
  try {
    payload = await verifyQuarterPushToken(match[1], planId)
  } catch (err) {
    if (err instanceof QuarterPushTokenError) return NextResponse.json({ error: tokenErrorCode(err.message) }, { status: 401 })
    return NextResponse.json({ error: 'token_service_unavailable' }, { status: 500 })
  }
  const scopes = Array.isArray(payload.scope) ? (payload.scope as string[]) : []
  if (!scopes.includes('receipt-write')) return NextResponse.json({ error: 'token_missing_scope' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const summary = {
    created: clamp(b.created),
    skippedExisting: clamp(b.skippedExisting),
    skippedNoTasklist: clamp(b.skippedNoTasklist),
    skippedCompleted: clamp(b.skippedCompleted),
  }

  try {
    const plan = await prisma.quarterPlan.findFirst({ orderBy: { id: 'desc' }, select: { id: true } })
    if (!plan || String(plan.id) !== planId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    await prisma.quarterPlan.update({
      where: { id: plan.id },
      data: { teamworkPushedAt: new Date(), teamworkPushSummary: JSON.stringify(summary) },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('POST /api/quarter-plan/push/[planId]/receipt error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
