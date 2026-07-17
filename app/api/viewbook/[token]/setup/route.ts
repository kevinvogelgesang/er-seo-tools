// Public pc-setup notify-recipients route (v2 PR5 spec §5/§8 / Task 5).
// Preflight chain is load-bearing (requireSameSite → requireJsonContentType
// → requireViewbookToken → checkWriteThrottle → readBoundedJson → the
// core). `setNotifyEmails` (lib/viewbook/setup.ts) validates the posted
// array against the shared allowed-recipient set and is value-idempotent —
// no replayed/created distinction, always 200.
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { requireJsonObject } from '@/lib/viewbook/route-utils'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import {
  checkWriteThrottle,
  readBoundedJson,
  requireJsonContentType,
  requireSameSite,
  validateClientMutationId,
} from '@/lib/viewbook/public-write-guard'
import { setNotifyEmails, type SetNotifyEmailsInput } from '@/lib/viewbook/setup'

export const dynamic = 'force-dynamic'

const BODY_CAP_BYTES = 4 * 1024

type RouteParams = { params: Promise<{ token: string }> }

function parseInput(raw: unknown): SetNotifyEmailsInput {
  const body = requireJsonObject(raw)
  const clientMutationId = validateClientMutationId(body.clientMutationId)
  return { notifyEmails: body.notifyEmails, clientMutationId: clientMutationId ?? undefined }
}

export const PATCH = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  requireSameSite(request)
  requireJsonContentType(request)
  const token = (await params).token
  const viewbook = await requireViewbookToken(token)
  checkWriteThrottle(token)
  const input = parseInput(await readBoundedJson(request, BODY_CAP_BYTES))
  const result = await setNotifyEmails(viewbook, token, input)
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
})
