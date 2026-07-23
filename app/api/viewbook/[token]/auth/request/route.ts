import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { requestMagicLink } from '@/lib/viewbook/auth-request'
import { canonicalMailbox } from '@/lib/viewbook/global-content-keys'
import {
  readBoundedJson,
  requireJsonContentType,
  requireSameSite,
} from '@/lib/viewbook/public-write-guard'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { requireJsonObject } from '@/lib/viewbook/route-utils'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ token: string }> }

export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  requireSameSite(request)
  requireJsonContentType(request)
  const token = (await params).token
  const viewbook = await requireViewbookToken(token)
  const body = requireJsonObject(await readBoundedJson(request, 4_096))
  const email = canonicalMailbox(body.email)
  if (email) await requestMagicLink(viewbook, email)
  return NextResponse.json({ ok: true })
})
