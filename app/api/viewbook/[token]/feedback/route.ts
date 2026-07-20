import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { requireJsonObject } from '@/lib/viewbook/route-utils'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import {
  checkWriteThrottle,
  readBoundedJson,
  requireJsonContentType,
  requireSameSite,
  validateClientMutationId,
} from '@/lib/viewbook/public-write-guard'
import { insertClientFeedback, type ClientFeedbackInput } from '@/lib/viewbook/public-writes'
import {
  MAX_ASSET_BYTES,
  deleteViewbookAssets,
  saveViewbookAsset,
  sniffImageType,
} from '@/lib/viewbook/assets'

export const dynamic = 'force-dynamic'

const BODY_CAP_BYTES = 6 * 1024
const MAX_FEEDBACK_IMAGES = 3
// Multipart cap: text fields + up to 3 pre-encode images + boundary overhead.
const MULTIPART_CAP_BYTES = MAX_FEEDBACK_IMAGES * MAX_ASSET_BYTES + 64 * 1024

type RouteParams = { params: Promise<{ token: string }> }

interface RawFields {
  reviewLinkId: unknown
  body: unknown
  authorName: unknown
  clientMutationId: unknown
}

function parseFields(raw: RawFields): ClientFeedbackInput {
  if (!Number.isInteger(raw.reviewLinkId) || (raw.reviewLinkId as number) <= 0) {
    throw new HttpError(400, 'invalid_feedback')
  }
  if (typeof raw.body !== 'string' || !raw.body.trim() || Buffer.byteLength(raw.body, 'utf8') > 4096) {
    throw new HttpError(400, 'invalid_feedback')
  }
  const authorName = raw.authorName == null ? null : raw.authorName
  if (authorName !== null && (typeof authorName !== 'string' || Buffer.byteLength(authorName, 'utf8') > 120)) {
    throw new HttpError(400, 'invalid_feedback')
  }
  const clientMutationId = validateClientMutationId(raw.clientMutationId)
  if (!clientMutationId) throw new HttpError(400, 'invalid_client_mutation_id')
  return {
    reviewLinkId: raw.reviewLinkId as number,
    body: raw.body,
    authorName: authorName as string | null,
    clientMutationId,
  }
}

function parseJsonInput(raw: unknown): ClientFeedbackInput {
  const body = requireJsonObject(raw)
  return parseFields({
    reviewLinkId: body.reviewLinkId,
    body: body.body,
    authorName: body.authorName,
    clientMutationId: body.clientMutationId,
  })
}

// Multipart branch: screenshots ride the SAME request as the feedback text so
// a file on disk always has a committed row racing at most one transaction —
// no standalone-upload orphan channel (docs.ts file-before-row precedent).
async function parseMultipartInput(
  request: NextRequest,
): Promise<{ input: ClientFeedbackInput; files: Buffer[] }> {
  const contentLength = Number(request.headers.get('content-length') ?? Number.NaN)
  if (!Number.isFinite(contentLength) || contentLength > MULTIPART_CAP_BYTES) {
    throw new HttpError(413, 'payload_too_large')
  }
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new HttpError(400, 'invalid_feedback')
  }
  const reviewLinkIdRaw = form.get('reviewLinkId')
  const input = parseFields({
    reviewLinkId: typeof reviewLinkIdRaw === 'string' && /^[1-9][0-9]*$/.test(reviewLinkIdRaw)
      ? Number(reviewLinkIdRaw)
      : reviewLinkIdRaw,
    body: form.get('body'),
    authorName: form.get('authorName'),
    clientMutationId: form.get('clientMutationId'),
  })

  const entries = form.getAll('images')
  if (entries.length > MAX_FEEDBACK_IMAGES) throw new HttpError(400, 'too_many_images')
  const files: Buffer[] = []
  for (const entry of entries) {
    if (!(entry instanceof File)) throw new HttpError(400, 'invalid_image')
    const buf = Buffer.from(await entry.arrayBuffer())
    if (buf.length === 0 || buf.length > MAX_ASSET_BYTES || !sniffImageType(buf)) {
      throw new HttpError(400, 'invalid_image')
    }
    files.push(buf)
  }
  return { input, files }
}

export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  requireSameSite(request)
  const contentType = request.headers.get('content-type') ?? ''
  const isMultipart = contentType.toLowerCase().startsWith('multipart/form-data')
  if (!isMultipart) requireJsonContentType(request)

  const token = (await params).token
  const viewbook = await requireViewbookToken(token)
  checkWriteThrottle(token)

  let input: ClientFeedbackInput
  let saved: string[] = []
  if (isMultipart) {
    const parsed = await parseMultipartInput(request)
    input = parsed.input
    // Files BEFORE the row (docs.ts precedent); every non-attached file below
    // is deleted best-effort.
    const scope = String(viewbook.id)
    for (const buf of parsed.files) {
      saved.push((await saveViewbookAsset(scope, buf)).filename)
    }
    input.images = saved
  } else {
    input = parseJsonInput(await readBoundedJson(request, BODY_CAP_BYTES))
  }

  let result: Awaited<ReturnType<typeof insertClientFeedback>>
  try {
    result = await insertClientFeedback(viewbook, token, input)
  } catch (err) {
    if (saved.length > 0) await deleteViewbookAssets(String(viewbook.id), saved)
    throw err
  }
  // A replayed request (or a race that attached nothing) leaves this
  // request's fresh files unreferenced — retire them.
  const orphans = saved.filter((filename) => !result.images.includes(filename))
  if (orphans.length > 0) await deleteViewbookAssets(String(viewbook.id), orphans)

  return NextResponse.json(
    { feedback: { ...result.feedback, images: result.images } },
    { status: result.replayed ? 200 : 201, headers: { 'Cache-Control': 'no-store' } },
  )
})
