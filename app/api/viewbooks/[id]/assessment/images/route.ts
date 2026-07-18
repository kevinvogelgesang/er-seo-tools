import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { MAX_ASSET_BYTES } from '@/lib/viewbook/assets'
import { fileBufferFromForm, parseId, requireBoundedContentLength } from '@/lib/viewbook/route-utils'
import { addAssessmentImage } from '@/lib/viewbook/assessment-notes'

export const dynamic = 'force-dynamic'
const MAX_MULTIPART_BYTES = MAX_ASSET_BYTES + 64 * 1024

type RouteParams = { params: Promise<{ id: string }> }

/**
 * POST /api/viewbooks/:id/assessment/images — multipart { file } upload to
 * the user-behaviour gallery. Same Content-Length-before-buffering +
 * File.size cap discipline as `/assets`; `addAssessmentImage` owns the
 * magic-byte sniff (rejects non-images), re-encode, and syncVersion bump.
 */
export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const actor = await requireOperatorEmail(request)
  const id = parseId((await params).id)
  requireBoundedContentLength(request, MAX_MULTIPART_BYTES)
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new HttpError(400, 'invalid_upload')
  }
  const buf = await fileBufferFromForm(form, MAX_ASSET_BYTES)
  const { filename } = await addAssessmentImage(id, buf, actor)
  return NextResponse.json({ filename })
})
