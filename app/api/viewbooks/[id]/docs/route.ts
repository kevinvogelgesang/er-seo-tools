import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { prisma } from '@/lib/db'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { MAX_DOC_BYTES } from '@/lib/viewbook/assets'
import { createViewbookDoc, listViewbookDocs } from '@/lib/viewbook/docs'
import { fileBufferFromForm, parseId } from '@/lib/viewbook/route-utils'

export const dynamic = 'force-dynamic'
const MAX_MULTIPART_BYTES = MAX_DOC_BYTES + 64 * 1024
type RouteParams = { params: Promise<{ id: string }> }

async function requireViewbook(id: number, mutating: boolean): Promise<void> {
  const row = await prisma.viewbook.findUnique({
    where: { id },
    select: { client: { select: { archivedAt: true } } },
  })
  if (!row) throw new HttpError(404, 'not_found')
  if (mutating && row.client.archivedAt) throw new HttpError(409, 'client_archived')
}

function requireBoundedContentLength(request: NextRequest): void {
  const raw = request.headers.get('content-length')
  if (!raw || !/^[0-9]+$/.test(raw) || Number(raw) > MAX_MULTIPART_BYTES) {
    throw new HttpError(413, 'payload_too_large')
  }
}

export const GET = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const id = parseId((await params).id)
  await requireViewbook(id, false)
  return NextResponse.json({ docs: await listViewbookDocs(id) })
})

export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const createdBy = await requireOperatorEmail(request)
  const id = parseId((await params).id)
  await requireViewbook(id, true)
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
  const buf = await fileBufferFromForm(form, MAX_DOC_BYTES)
  const doc = await createViewbookDoc({
    viewbookId: id,
    title: title.trim(),
    blurb: blurb?.trim() || null,
    buf,
    createdBy,
  })
  return NextResponse.json({ doc }, { status: 201 })
})
