import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { MAX_DOC_BYTES } from '@/lib/viewbook/assets'
import { createViewbookDoc, listGlobalViewbookDocs } from '@/lib/viewbook/docs'
import { fileBufferFromForm } from '@/lib/viewbook/route-utils'

export const dynamic = 'force-dynamic'
const MAX_MULTIPART_BYTES = MAX_DOC_BYTES + 64 * 1024

function requireBoundedContentLength(request: NextRequest): void {
  const raw = request.headers.get('content-length')
  if (!raw || !/^[0-9]+$/.test(raw) || Number(raw) > MAX_MULTIPART_BYTES) {
    throw new HttpError(413, 'payload_too_large')
  }
}

async function readUpload(request: NextRequest): Promise<{ title: string; blurb: string | null; buf: Buffer }> {
  requireBoundedContentLength(request)
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new HttpError(400, 'invalid_upload')
  }
  const title = form.get('title')
  const blurb = form.get('blurb')
  if (typeof title !== 'string' || title.trim().length === 0) throw new HttpError(400, 'invalid_request')
  if (blurb != null && typeof blurb !== 'string') throw new HttpError(400, 'invalid_request')
  return { title: title.trim(), blurb: blurb?.trim() || null, buf: await fileBufferFromForm(form, MAX_DOC_BYTES) }
}

export const GET = withRoute(async (request: NextRequest) => {
  await requireOperatorEmail(request)
  return NextResponse.json({ docs: await listGlobalViewbookDocs() })
})

export const POST = withRoute(async (request: NextRequest) => {
  const createdBy = await requireOperatorEmail(request)
  const upload = await readUpload(request)
  const doc = await createViewbookDoc({ viewbookId: null, createdBy, ...upload })
  return NextResponse.json({ doc }, { status: 201 })
})
