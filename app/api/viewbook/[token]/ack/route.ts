// Public section-ack route (v2 PR5 spec §4 / Task 5). Preflight chain is
// load-bearing and MUST stay in this order: requireSameSite →
// requireJsonContentType → requireViewbookToken (token preflight) →
// checkWriteThrottle → readBoundedJson → the core. `acknowledgeSection`
// (lib/viewbook/ack.ts) is itself commit-time fenced; this route is a thin
// shell.
//
// Status-as-signal (Codex-reviewed contract): `pcCompleted` on the response
// body is passed through HONESTLY from the core — it means "the viewbook is
// CURRENTLY post-contract-complete", true on both a fresh completion and a
// later replay of the section that completed it. The HTTP status is the
// event signal: only 201 (a genuinely new ack) may be treated by a caller as
// "this call just completed the viewbook"; 200 (replay) must never be
// presented as a fresh completion event even when `pcCompleted` is true.
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { requireJsonObject } from '@/lib/viewbook/route-utils'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { requireCanWrite } from '@/lib/viewbook/principal'
import {
  checkWriteThrottle,
  readBoundedJson,
  requireJsonContentType,
  requireSameSite,
  validateClientMutationId,
} from '@/lib/viewbook/public-write-guard'
import { acknowledgeSection, type AcknowledgeSectionInput } from '@/lib/viewbook/ack'

export const dynamic = 'force-dynamic'

const BODY_CAP_BYTES = 2 * 1024

type RouteParams = { params: Promise<{ token: string }> }

function parseInput(raw: unknown): AcknowledgeSectionInput {
  const body = requireJsonObject(raw)
  if (typeof body.sectionKey !== 'string' || !body.sectionKey) {
    throw new HttpError(400, 'invalid_section')
  }
  const clientMutationId = validateClientMutationId(body.clientMutationId)
  if (!clientMutationId) throw new HttpError(400, 'invalid_client_mutation_id')
  return { sectionKey: body.sectionKey, clientMutationId }
}

export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  requireSameSite(request)
  requireJsonContentType(request)
  const token = (await params).token
  const viewbook = await requireViewbookToken(token)
  const principal = await requireCanWrite(request, viewbook)
  checkWriteThrottle(token)
  const input = parseInput(await readBoundedJson(request, BODY_CAP_BYTES))
  const result = await acknowledgeSection(viewbook, token, input, { principal })
  return NextResponse.json(
    { acknowledged: result.acknowledged, pcCompleted: result.pcCompleted },
    { status: result.replayed ? 200 : 201, headers: { 'Cache-Control': 'no-store' } },
  )
})
