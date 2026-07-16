import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { requireJsonObject } from '@/lib/viewbook/route-utils'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import {
  checkWriteThrottle,
  readBoundedJson,
  requireJsonContentType,
  requireSameSite,
  validateClientMutationId,
} from '@/lib/viewbook/public-write-guard'
import { insertClientFeedback, type ClientFeedbackInput } from '@/lib/viewbook/public-writes'

export const dynamic = 'force-dynamic'

const BODY_CAP_BYTES = 6 * 1024

type RouteParams = { params: Promise<{ token: string }> }

function parseInput(raw: unknown): ClientFeedbackInput {
  const body = requireJsonObject(raw)
  if (!Number.isInteger(body.reviewLinkId) || (body.reviewLinkId as number) <= 0) {
    throw new HttpError(400, 'invalid_feedback')
  }
  if (typeof body.body !== 'string' || !body.body.trim() || Buffer.byteLength(body.body, 'utf8') > 4096) {
    throw new HttpError(400, 'invalid_feedback')
  }
  const authorName = body.authorName == null ? null : body.authorName
  if (authorName !== null && (typeof authorName !== 'string' || Buffer.byteLength(authorName, 'utf8') > 120)) {
    throw new HttpError(400, 'invalid_feedback')
  }
  const clientMutationId = validateClientMutationId(body.clientMutationId)
  if (!clientMutationId) throw new HttpError(400, 'invalid_client_mutation_id')
  return {
    reviewLinkId: body.reviewLinkId as number,
    body: body.body,
    authorName: authorName as string | null,
    clientMutationId,
  }
}

export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  requireSameSite(request)
  requireJsonContentType(request)
  const token = (await params).token
  const viewbook = await requireViewbookToken(token)
  checkWriteThrottle(token)
  const input = parseInput(await readBoundedJson(request, BODY_CAP_BYTES))
  const result = await insertClientFeedback(viewbook, token, input)
  return NextResponse.json(
    { feedback: result.feedback },
    { status: result.replayed ? 200 : 201, headers: { 'Cache-Control': 'no-store' } },
  )
})
