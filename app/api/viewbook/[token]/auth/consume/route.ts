import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { SESSION_TTL_MS } from '@/lib/viewbook/auth-config'
import { consumeGrant } from '@/lib/viewbook/auth-consume'
import { memberCookieName } from '@/lib/viewbook/auth-secrets'
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
  const rawGrant = body.g
  if (typeof rawGrant !== 'string' || rawGrant.length === 0 || rawGrant.length > 128) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 401 })
  }

  const result = await consumeGrant(viewbook, rawGrant)
  if (!result) return NextResponse.json({ error: 'invalid_grant' }, { status: 401 })

  const response = NextResponse.json({ ok: true })
  response.cookies.set(memberCookieName(viewbook.id), result.rawSession, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1_000),
  })
  return response
})
