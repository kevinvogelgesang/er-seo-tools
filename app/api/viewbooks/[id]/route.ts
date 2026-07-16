import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import {
  deleteViewbook,
  getViewbookAdmin,
  updateViewbookSettings,
  updateViewbookTheme,
  type ViewbookKind,
} from '@/lib/viewbook/service'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

/** GET /api/viewbooks/:id — full admin subtree + parsed theme. */
export const GET = withRoute(async (_request: NextRequest, { params }: RouteParams) => {
  const id = parseId((await params).id)
  return NextResponse.json({ viewbook: await getViewbookAdmin(id) })
})

/** PATCH /api/viewbooks/:id — { theme? } and/or { welcomeNote?, notifyEmail?, kind? }. */
export const PATCH = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const id = parseId((await params).id)
  const body = requireJsonObject(await parseJsonBody<Record<string, unknown>>(request))
  let handled = false
  let theme = null
  if ('theme' in body) {
    theme = await updateViewbookTheme(id, body.theme)
    handled = true
  }
  const settings: { welcomeNote?: string | null; notifyEmail?: string | null; kind?: ViewbookKind } = {}
  if ('welcomeNote' in body) settings.welcomeNote = body.welcomeNote as string | null
  if ('notifyEmail' in body) settings.notifyEmail = body.notifyEmail as string | null
  if ('kind' in body) settings.kind = body.kind as ViewbookKind
  if (Object.keys(settings).length > 0) {
    await updateViewbookSettings(id, settings)
    handled = true
  }
  if (!handled) throw new HttpError(400, 'invalid_request')
  return NextResponse.json({ ok: true, theme })
})

/** DELETE /api/viewbooks/:id — deletes the subtree + its asset files. */
export const DELETE = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const id = parseId((await params).id)
  await deleteViewbook(id)
  return NextResponse.json({ ok: true })
})
