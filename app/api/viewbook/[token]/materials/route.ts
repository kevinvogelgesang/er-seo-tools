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
import { insertClientMaterial, type ClientMaterialInput } from '@/lib/viewbook/public-writes'

export const dynamic = 'force-dynamic'

const BODY_CAP_BYTES = 2 * 1024
type RouteParams = { params: Promise<{ token: string }> }

function parseInput(raw: unknown): ClientMaterialInput {
  const body = requireJsonObject(raw)
  if (typeof body.label !== 'string' || !body.label.trim() || Buffer.byteLength(body.label, 'utf8') > 256) {
    throw new HttpError(400, 'invalid_material')
  }
  let url: string
  try {
    const parsed = new URL(String(body.url))
    if (parsed.protocol !== 'https:') throw new Error('not https')
    url = parsed.toString()
  } catch {
    throw new HttpError(400, 'invalid_material')
  }
  const clientMutationId = validateClientMutationId(body.clientMutationId)
  if (!clientMutationId) throw new HttpError(400, 'invalid_client_mutation_id')
  return { label: body.label.trim(), url, clientMutationId }
}

export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  requireSameSite(request)
  requireJsonContentType(request)
  const token = (await params).token
  const viewbook = await requireViewbookToken(token)
  const principal = await requireCanWrite(request, viewbook)
  checkWriteThrottle(token)
  const input = parseInput(await readBoundedJson(request, BODY_CAP_BYTES))
  const result = await insertClientMaterial(viewbook, token, input, { principal })
  return NextResponse.json(
    { material: result.material },
    { status: result.replayed ? 200 : 201, headers: { 'Cache-Control': 'no-store' } },
  )
})
