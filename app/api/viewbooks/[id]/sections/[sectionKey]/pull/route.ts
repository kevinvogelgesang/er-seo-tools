import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { pullSectionFromTemplate } from '@/lib/viewbook/instance-service'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; sectionKey: string }> }

/**
 * POST /api/viewbooks/:id/sections/:sectionKey/pull `{version}` — pull the
 * section instance up to the CURRENT template (versioned merge, spec §6).
 * `version` is the section's AGGREGATE content-tree version; a stale value is
 * a 409 `version_conflict`. Equal-version pulls are legal (the "Refresh from
 * template" repair path). Cookie-gated by omission from the public matchers.
 */
export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const { id: rawId, sectionKey } = await params
  const id = parseId(rawId)
  const body = requireJsonObject(await parseJsonBody<Record<string, unknown>>(request))
  if (!Number.isInteger(body.version)) throw new HttpError(400, 'invalid_content')

  const result = await pullSectionFromTemplate(id, sectionKey, body.version as number, operator)
  return NextResponse.json(result)
})
