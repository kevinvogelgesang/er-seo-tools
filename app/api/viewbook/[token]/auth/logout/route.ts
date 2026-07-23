import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { revokeSessionByCookie } from '@/lib/viewbook/auth-consume'
import { memberCookieName } from '@/lib/viewbook/auth-secrets'
import { requireSameSite } from '@/lib/viewbook/public-write-guard'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ token: string }> }

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const value = part.trim()
    const separator = value.indexOf('=')
    if (separator < 0 || value.slice(0, separator) !== name) continue
    try {
      return decodeURIComponent(value.slice(separator + 1))
    } catch {
      return null
    }
  }
  return null
}

export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  requireSameSite(request)
  const token = (await params).token
  const viewbook = await requireViewbookToken(token)
  const name = memberCookieName(viewbook.id)
  const rawSession = cookieValue(request, name)
  if (rawSession) await revokeSessionByCookie(rawSession)

  const response = new NextResponse(null, { status: 204 })
  response.cookies.set(name, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
})
