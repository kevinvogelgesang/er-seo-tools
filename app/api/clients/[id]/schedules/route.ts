// GET  /api/clients/[id]/schedules — list scan schedules + last-run info
// POST /api/clients/[id]/schedules — RETIRED (410). C2 per-client scan
//      schedules are superseded by the weekly sweep, which scans every
//      active client automatically. GET stays (lists any surviving rows);
//      the item route's PATCH/DELETE stay (pause/remove stragglers).
//
// Internal UI-facing routes: cookie-gated by the middleware (NOT in
// isPublicPath).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getClientSchedules } from '@/lib/services/client-schedules'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'

type Params = { params: Promise<{ id: string }> }

function parseClientId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function GET(_request: NextRequest, { params }: Params) {
  const clientId = parseClientId((await params).id)
  if (clientId === null) return NextResponse.json({ error: 'invalid_client' }, { status: 400 })
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } })
  if (!client) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ schedules: await getClientSchedules(clientId) })
}

// Creating new per-client scan schedules is retired: the weekly sweep
// (system-owned) scans every active client automatically, so there is no
// per-client cadence to configure. Any stale caller gets a clear,
// non-retryable 410 rather than a silently-ignored write.
export const POST = withRoute(async () => {
  throw new HttpError(410, 'schedule_retired')
})
