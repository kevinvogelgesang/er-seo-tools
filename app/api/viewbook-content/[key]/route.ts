import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { requireJsonObject } from '@/lib/viewbook/route-utils'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import {
  GLOBAL_CONTENT_KEYS,
  getGlobalContent,
  putGlobalContent,
  type GlobalContentKey,
} from '@/lib/viewbook/global-content'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ key: string }> }

function parseKey(raw: string): GlobalContentKey {
  if (!(GLOBAL_CONTENT_KEYS as readonly string[]).includes(raw)) throw new HttpError(404, 'not_found')
  return raw as GlobalContentKey
}

/** GET /api/viewbook-content/:key — current global content (null when unset/corrupt). */
export const GET = withRoute(async (_request: NextRequest, { params }: RouteParams) => {
  const key = parseKey((await params).key)
  return NextResponse.json({ key, content: await getGlobalContent(key) })
})

/** PUT /api/viewbook-content/:key — { content } typed per key. */
export const PUT = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const key = parseKey((await params).key)
  const body = requireJsonObject(await parseJsonBody<{ content?: unknown }>(request))
  await putGlobalContent(key, body.content, operator)
  return NextResponse.json({ ok: true })
})
