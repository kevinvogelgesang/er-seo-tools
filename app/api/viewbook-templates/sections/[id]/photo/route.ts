import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { MAX_ASSET_BYTES } from '@/lib/viewbook/assets'
import { fileBufferFromForm, parseId, requireBoundedContentLength } from '@/lib/viewbook/route-utils'
import { attachTemplateTeamPhoto } from '@/lib/viewbook/template-service'

export const dynamic = 'force-dynamic'
const MAX_MULTIPART_BYTES = MAX_ASSET_BYTES + 64 * 1024

type RouteParams = { params: Promise<{ id: string }> }

/**
 * POST /api/viewbook-templates/sections/:id/photo — multipart
 * { memberName, version, file }, mirroring
 * app/api/viewbook-content/team-photo/route.ts's bound-then-buffer shape. A
 * non-integer version is a 400 here (attachTemplateTeamPhoto's guard just
 * feeds it straight into a Prisma `where`, which would otherwise throw a raw
 * validation error instead of a clean version_conflict/invalid_content).
 */
export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const sectionId = parseId((await params).id)
  requireBoundedContentLength(request, MAX_MULTIPART_BYTES)
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new HttpError(400, 'invalid_upload')
  }
  const memberName = form.get('memberName')
  if (typeof memberName !== 'string' || !memberName) throw new HttpError(400, 'invalid_upload')
  const rawVersion = form.get('version')
  if (typeof rawVersion !== 'string' || !/^[0-9]+$/.test(rawVersion)) throw new HttpError(400, 'invalid_content')
  const version = Number(rawVersion)
  const buf = await fileBufferFromForm(form, MAX_ASSET_BYTES)
  const filename = await attachTemplateTeamPhoto(sectionId, memberName, buf, operator, version)
  return NextResponse.json({ ok: true, filename })
})
