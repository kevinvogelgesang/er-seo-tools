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
import {
  AnswerConflictError,
  applyAnswerEdit,
  proposeAmendment,
  type AnswerValueInput,
} from '@/lib/viewbook/answers'

export const dynamic = 'force-dynamic'

const BODY_CAP_BYTES = 10 * 1024

type RouteParams = { params: Promise<{ token: string }> }

type ParsedInput =
  | { mode: 'edit'; fieldId: number; value: AnswerValueInput; expectedVersion: number }
  | { mode: 'amend'; fieldId: number; value: Exclude<AnswerValueInput, null>; clientMutationId: string }

function parseInput(raw: unknown): ParsedInput {
  const body = requireJsonObject(raw)
  if (!Number.isInteger(body.fieldId) || (body.fieldId as number) <= 0) {
    throw new HttpError(400, 'invalid_answer')
  }
  if (body.mode === 'edit') {
    if (!Number.isInteger(body.expectedVersion) || (body.expectedVersion as number) < 0) {
      throw new HttpError(400, 'invalid_answer')
    }
    return {
      mode: 'edit',
      fieldId: body.fieldId as number,
      value: body.value as AnswerValueInput,
      expectedVersion: body.expectedVersion as number,
    }
  }
  if (body.mode === 'amend') {
    const clientMutationId = validateClientMutationId(body.clientMutationId)
    if (!clientMutationId || body.value === null) throw new HttpError(400, 'invalid_answer')
    return {
      mode: 'amend',
      fieldId: body.fieldId as number,
      value: body.value as Exclude<AnswerValueInput, null>,
      clientMutationId,
    }
  }
  throw new HttpError(400, 'invalid_answer_mode')
}

function conflictResponse(error: AnswerConflictError): NextResponse {
  return NextResponse.json(
    { error: error.code, current: error.current },
    { status: 409, headers: { 'Cache-Control': 'no-store' } },
  )
}

const patchWithRoute = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  requireSameSite(request)
  requireJsonContentType(request)
  const token = (await params).token
  const viewbook = await requireViewbookToken(token)
  const principal = await requireCanWrite(request, viewbook)
  checkWriteThrottle(token)
  const input = parseInput(await readBoundedJson(request, BODY_CAP_BYTES))
  try {
    if (input.mode === 'edit') {
      const result = await applyAnswerEdit(viewbook, token, input, { principal })
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
    }
    const result = await proposeAmendment(viewbook, token, input, { principal })
    return NextResponse.json(
      { amendment: result.amendment },
      { status: result.replayed ? 200 : 201, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof AnswerConflictError) return conflictResponse(error)
    throw error
  }
})

// Keep even withRoute-generated validation/500 responses out of caches.
export const PATCH = async (request: NextRequest, context: RouteParams): Promise<Response> => {
  const response = await patchWithRoute(request, context)
  response.headers.set('Cache-Control', 'no-store')
  return response
}
