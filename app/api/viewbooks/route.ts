import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { createViewbook, listViewbooks } from '@/lib/viewbook/service'

export const dynamic = 'force-dynamic'

/** GET /api/viewbooks — admin index. Cookie-gated by global middleware. */
export const GET = withRoute(async () => {
  return NextResponse.json({ viewbooks: await listViewbooks() })
})

/** POST /api/viewbooks — create + seed a viewbook: { clientId, kind }. */
export const POST = withRoute(async (request: NextRequest) => {
  const operator = await requireOperatorEmail(request)
  const body = await parseJsonBody<{ clientId?: unknown; kind?: unknown }>(request)
  const clientId = typeof body.clientId === 'number' && Number.isInteger(body.clientId) && body.clientId > 0 ? body.clientId : null
  const kind = body.kind === 'new-build' || body.kind === 'upgrade' ? body.kind : null
  if (!clientId || !kind) throw new HttpError(400, 'invalid_request')
  const created = await createViewbook(clientId, kind, operator)
  return NextResponse.json({ viewbook: created }, { status: 201 })
})
