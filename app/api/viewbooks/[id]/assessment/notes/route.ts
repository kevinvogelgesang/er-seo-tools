import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireBoundedContentLength, requireJsonObject } from '@/lib/viewbook/route-utils'
import { setAssessmentNote, type AssessmentNoteField } from '@/lib/viewbook/assessment-notes'

export const dynamic = 'force-dynamic'

// Rich-text assessment notes are operator-authored prose (headings,
// paragraphs, lists) — generous but bounded so an authenticated request
// cannot feed unbounded HTML into the sanitizer (Codex plan-review fix 3).
// No repo-wide rich-text byte cap exists yet (OVERRIDE_BODY_CAP in
// global-content.ts is a plain-text char cap and isn't exported); this is
// the local cap for this route, sized generously above realistic note length.
const MAX_NOTE_BYTES = 64 * 1024

type RouteParams = { params: Promise<{ id: string }> }

function noteField(raw: unknown): AssessmentNoteField {
  if (raw !== 'general' && raw !== 'userBehaviour') throw new HttpError(400, 'invalid_field')
  return raw
}

/**
 * PATCH /api/viewbooks/:id/assessment/notes — { field: 'general' |
 * 'userBehaviour', html: string }. Bounded raw body BEFORE parsing so an
 * authenticated request can't feed unbounded HTML into the sanitizer; the
 * sanitize + syncVersion bump ride inside `setAssessmentNote`.
 */
export const PATCH = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const actor = await requireOperatorEmail(request)
  const id = parseId((await params).id)
  requireBoundedContentLength(request, MAX_NOTE_BYTES)
  const body = requireJsonObject(await parseJsonBody<Record<string, unknown>>(request))
  const field = noteField(body.field)
  if (typeof body.html !== 'string') throw new HttpError(400, 'invalid_html')
  await setAssessmentNote(id, field, body.html, actor)
  return NextResponse.json({ ok: true })
})
