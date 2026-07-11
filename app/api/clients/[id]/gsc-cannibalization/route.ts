import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { getCannibalizationReport } from '@/lib/keywords/gsc-snapshot'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * GET /api/clients/:id/gsc-cannibalization
 * Full query×page cannibalization report re-derived from the latest stored
 * GSC snapshot (Increment A). 404 ONLY when the client does not exist;
 * unmapped/no-snapshot return 200 with gscMapped/report reflecting state.
 * Cookie-gated by global middleware.
 */
export const GET = withRoute(async (_request: NextRequest, { params }: RouteParams) => {
  const { id } = await params
  // Strict positive-integer parse (Codex #1 — parseInt would let "5junk"/"1.2"/"-1" through).
  if (!/^[1-9][0-9]*$/.test(id)) {
    return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 })
  }
  const clientId = Number(id)
  const { clientExists, gscMapped, report } = await getCannibalizationReport(clientId)
  if (!clientExists) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }
  return NextResponse.json({ gscMapped, report })
})
