// app/api/keyword-strategy/[id]/memo/route.ts
// KS-5 Task 7 — PUBLIC token-authed memo PATCH-back (scope 'memo-write'). The
// skill posts the rendered 8-section strategy doc here. Body is validated
// BEFORE auth (400 beats 401 — same posture as the keyword-memo PATCH). No
// `error` column on KeywordStrategySession (unlike KeywordResearchSession), so
// none is cleared here.
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { prisma } from '@/lib/db'
import { authenticateStrategyRequest } from '@/lib/keyword-strategy-route-auth'

export const dynamic = 'force-dynamic'

const MAX_MEMO_CHARS = 50_000
const MAX_STRUCTURED_CHARS = 200_000

type RouteParams = { params: Promise<{ id: string }> }

export const PATCH = withRoute(async (req: NextRequest, { params }: RouteParams) => {
  const { id } = await params

  // 1. Body validation BEFORE auth (malformed JSON → 400 invalid_json even
  //    with no Authorization header).
  const body = await parseJsonBody<{ memo?: unknown; structured?: unknown }>(req)
  if (typeof body.memo !== 'string' || body.memo.length === 0) {
    throw new HttpError(400, 'memo_required')
  }
  if (body.memo.length > MAX_MEMO_CHARS) {
    throw new HttpError(400, 'memo_too_long')
  }
  const memoMarkdown = body.memo

  let structured: string | undefined
  if (body.structured !== undefined) {
    // Reject a primitive / pre-stringified value to avoid double-encoding.
    if (typeof body.structured !== 'object' || body.structured === null) {
      throw new HttpError(400, 'structured_invalid')
    }
    structured = JSON.stringify(body.structured)
    if (structured.length > MAX_STRUCTURED_CHARS) {
      throw new HttpError(400, 'structured_too_long')
    }
  }

  // 2. Auth (scope 'memo-write').
  const auth = await authenticateStrategyRequest(req, id, 'memo-write')
  if (!auth.ok) return auth.response

  // 3. Row must exist.
  const existing = await prisma.keywordStrategySession.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const now = new Date()
  const updated = await prisma.keywordStrategySession.update({
    where: { id },
    data: {
      memoMarkdown,
      ...(structured !== undefined ? { structured } : {}),
      status: 'complete',
      memoUpdatedAt: now,
    },
  })

  return NextResponse.json({ ok: true, updatedAt: (updated.memoUpdatedAt ?? now).toISOString() })
})
