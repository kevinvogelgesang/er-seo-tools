import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { MAX_ASSET_BYTES } from '@/lib/viewbook/assets'
import { fileBufferFromForm, parseId, requireBoundedContentLength } from '@/lib/viewbook/route-utils'
import '@/lib/viewbook/theme-server'
import { attachSectionHero, attachViewbookLogo } from '@/lib/viewbook/service'

export const dynamic = 'force-dynamic'
const MAX_MULTIPART_BYTES = MAX_ASSET_BYTES + 64 * 1024

type RouteParams = { params: Promise<{ id: string }> }

/**
 * POST /api/viewbooks/:id/assets — multipart atomic attachment (never a bare
 * save): fields { kind: 'logo' | 'hero', sectionKey? } + file. The service
 * owns file-write → theme-stamp → old-file-delete (+ orphan cleanup).
 */
export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const id = parseId((await params).id)
  requireBoundedContentLength(request, MAX_MULTIPART_BYTES)
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new HttpError(400, 'invalid_upload')
  }
  const buf = await fileBufferFromForm(form, MAX_ASSET_BYTES)
  const kind = form.get('kind')
  if (kind === 'logo') {
    return NextResponse.json({ theme: await attachViewbookLogo(id, buf) })
  }
  if (kind === 'hero') {
    const sectionKey = form.get('sectionKey')
    if (typeof sectionKey !== 'string') throw new HttpError(400, 'invalid_upload')
    return NextResponse.json({ theme: await attachSectionHero(id, sectionKey, buf) })
  }
  throw new HttpError(400, 'invalid_upload')
})
