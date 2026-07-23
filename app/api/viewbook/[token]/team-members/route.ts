// Public team-member invite route (v2 PR5 spec §8 / Task 5), body-dispatched
// between add and resend. Preflight chain is load-bearing (requireSameSite →
// requireJsonContentType → requireViewbookToken → checkWriteThrottle →
// readBoundedJson → the core). Both `addTeamMember` and `resendInvite`
// (lib/viewbook/team-members.ts) are commit-time fenced with SQL-enforced
// caps and already throw correctly-coded HttpErrors (duplicate_email/
// team_member_limit_reached/resend_limit_reached → 409, invite_limit_reached
// → 429, invalid_name/invalid_email/invalid_client_mutation_id → 400,
// not_found → 404) — `withRoute` serializes them verbatim, no extra mapping
// needed here.
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
import { addTeamMember, resendInvite, type AddTeamMemberInput, type ResendInviteInput } from '@/lib/viewbook/team-members'

export const dynamic = 'force-dynamic'

const BODY_CAP_BYTES = 4 * 1024

type RouteParams = { params: Promise<{ token: string }> }

type ParsedInput = ({ mode: 'create' } & AddTeamMemberInput) | ({ mode: 'resend' } & ResendInviteInput)

function parseInput(raw: unknown): ParsedInput {
  const body = requireJsonObject(raw)
  if (body.mode === 'create') {
    if (typeof body.name !== 'string') throw new HttpError(400, 'invalid_name')
    if (typeof body.email !== 'string') throw new HttpError(400, 'invalid_email')
    const clientMutationId = validateClientMutationId(body.clientMutationId)
    if (!clientMutationId) throw new HttpError(400, 'invalid_client_mutation_id')
    return { mode: 'create', name: body.name, email: body.email, clientMutationId }
  }
  if (body.mode === 'resend') {
    // No clientMutationId — resend has no durable idempotency (team-members.ts).
    if (typeof body.memberId !== 'number') throw new HttpError(404, 'not_found')
    return { mode: 'resend', memberId: body.memberId }
  }
  throw new HttpError(400, 'invalid_mode')
}

export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  requireSameSite(request)
  requireJsonContentType(request)
  const token = (await params).token
  const viewbook = await requireViewbookToken(token)
  const principal = await requireCanWrite(request, viewbook)
  checkWriteThrottle(token)
  const input = parseInput(await readBoundedJson(request, BODY_CAP_BYTES))
  if (input.mode === 'create') {
    const result = await addTeamMember(viewbook, token, input, { principal })
    return NextResponse.json(
      { member: result.member, delivered: result.delivered },
      { status: result.replayed ? 200 : 201, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  const result = await resendInvite(viewbook, token, input, { principal })
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
})
