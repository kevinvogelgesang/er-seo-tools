import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireHandoffToken } from '@/lib/handoff/route-auth'

export const dynamic = 'force-dynamic'

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

  const auth = await requireHandoffToken(req, 'qct', planId, 'receipt-write')
  if (!auth.ok) return auth.response

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
