// PR2 live sync: public poll-target — the client page checks this cheap
// endpoint to learn whether its cached copy is stale. Token failures keep
// requireViewbookToken's indistinguishable-404 contract (unknown, revoked,
// archived-client all read the same).
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { requireCanRead } from '@/lib/viewbook/principal'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ token: string }> }

export const GET = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const { token } = await params
  const vb = await requireViewbookToken(token)
  await requireCanRead(request, vb)
  return NextResponse.json({ v: vb.syncVersion }, { headers: { 'Cache-Control': 'no-store' } })
})
