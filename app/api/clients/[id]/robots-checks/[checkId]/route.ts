// GET /api/clients/[id]/robots-checks/[checkId] — one check's summary+detail.
// Cookie-gated by the middleware; ownership enforced in the service
// (checkId AND clientId must match). 404 covers not-found, unowned, and
// corrupt-detail alike — no information leak about other clients' rows.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withRoute } from '@/lib/api/with-route'
import { getRobotsCheck } from '@/lib/robots-check/service'

type Params = { params: Promise<{ id: string; checkId: string }> }

// Strict id parser (plan-Codex #4) — same contract as the list route.
function parsePositiveInt(raw: string): number | null {
  return /^[1-9][0-9]*$/.test(raw) ? Number(raw) : null
}

export const GET = withRoute(async (_request: NextRequest, { params }: Params) => {
  const { id, checkId: rawCheckId } = await params
  const clientId = parsePositiveInt(id)
  const checkId = parsePositiveInt(rawCheckId)
  if (clientId === null || checkId === null) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  }
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } })
  if (!client) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const stored = await getRobotsCheck(clientId, checkId)
  if (!stored) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(stored)
})
