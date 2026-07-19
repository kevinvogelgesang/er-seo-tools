// Public shared-collapse route (v2 PR2 spec §6). Preflight chain is
// load-bearing and MUST stay in this order: requireSameSite →
// requireJsonContentType → requireViewbookToken (token preflight) →
// checkWriteThrottle (a DEDICATED `collapse:<token>` bucket, so collapse
// spam never starves the ack/materials/setup routes' shared per-token
// bucket) → readBoundedJson (bounded body parsed BEFORE resolving optional
// operator status — operator resolution is additive and must never weaken
// token authorization) → the core. `setSectionCollapsedShared`
// (lib/viewbook/collapse.ts) is itself commit-time fenced; this route is a
// thin shell.
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { requireJsonObject } from '@/lib/viewbook/route-utils'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { resolveOperatorEmail } from '@/lib/viewbook/operator'
import { checkWriteThrottle, readBoundedJson, requireJsonContentType, requireSameSite } from '@/lib/viewbook/public-write-guard'
import { setSectionCollapsedShared } from '@/lib/viewbook/collapse'

export const dynamic = 'force-dynamic'

const BODY_CAP_BYTES = 1024

type RouteParams = { params: Promise<{ token: string }> }

function parseInput(raw: unknown): { sectionKey: string; collapsed: boolean } {
  const body = requireJsonObject(raw)
  if (typeof body.sectionKey !== 'string' || !body.sectionKey) throw new HttpError(400, 'invalid_section')
  if (typeof body.collapsed !== 'boolean') throw new HttpError(400, 'invalid_request')
  return { sectionKey: body.sectionKey, collapsed: body.collapsed }
}

export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  requireSameSite(request)
  requireJsonContentType(request)
  const token = (await params).token
  const viewbook = await requireViewbookToken(token)
  checkWriteThrottle(`collapse:${token}`) // dedicated bucket — never starves ack/materials/setup
  const input = parseInput(await readBoundedJson(request, BODY_CAP_BYTES))
  const isOperator = (await resolveOperatorEmail(request)) != null
  const result = await setSectionCollapsedShared(viewbook, token, { ...input, isOperator })
  return NextResponse.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } })
})
