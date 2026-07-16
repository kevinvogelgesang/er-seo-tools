import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { fileBufferFromForm } from '@/lib/viewbook/route-utils'
import { attachTeamPhoto } from '@/lib/viewbook/global-content'

export const dynamic = 'force-dynamic'

/**
 * POST /api/viewbook-content/team-photo — one atomic multipart update:
 * fields { memberName } + file. Save → fenced roster stamp → old-file delete;
 * conflict/miss deletes the new file (no orphan sweeper needed).
 */
export const POST = withRoute(async (request: NextRequest) => {
  const operator = await requireOperatorEmail(request)
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new HttpError(400, 'invalid_upload')
  }
  const memberName = form.get('memberName')
  if (typeof memberName !== 'string' || !memberName) throw new HttpError(400, 'invalid_upload')
  const buf = await fileBufferFromForm(form)
  const filename = await attachTeamPhoto(memberName, buf, operator)
  return NextResponse.json({ filename })
})
