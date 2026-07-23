import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { MAX_ASSET_BYTES } from '@/lib/viewbook/assets'
import { fileBufferFromForm, requireBoundedContentLength } from '@/lib/viewbook/route-utils'
import { attachTeamPhotoBridged } from '@/lib/viewbook/template-service'

export const dynamic = 'force-dynamic'
const MAX_MULTIPART_BYTES = MAX_ASSET_BYTES + 64 * 1024

/**
 * POST /api/viewbook-content/team-photo — one atomic multipart update:
 * fields { memberName } + file. Save → fenced roster stamp → old-file delete;
 * conflict/miss deletes the new file (no orphan sweeper needed).
 */
export const POST = withRoute(async (request: NextRequest) => {
  const operator = await requireOperatorEmail(request)
  requireBoundedContentLength(request, MAX_MULTIPART_BYTES)
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new HttpError(400, 'invalid_upload')
  }
  const memberName = form.get('memberName')
  if (typeof memberName !== 'string' || !memberName) throw new HttpError(400, 'invalid_upload')
  const buf = await fileBufferFromForm(form, MAX_ASSET_BYTES)
  const filename = await attachTeamPhotoBridged(memberName, buf, operator)
  return NextResponse.json({ filename })
})
