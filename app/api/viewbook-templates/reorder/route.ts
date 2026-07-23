import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { requireJsonObject } from '@/lib/viewbook/route-utils'
import { reorderSections } from '@/lib/viewbook/template-service'

export const dynamic = 'force-dynamic'

function parseItems(raw: unknown): Array<{ id: number; version: number; sortOrder: number }> {
  if (!Array.isArray(raw)) throw new HttpError(400, 'invalid_content')
  return raw.map((item) => {
    if (item === null || typeof item !== 'object') throw new HttpError(400, 'invalid_content')
    const { id, version, sortOrder } = item as Record<string, unknown>
    return { id: id as number, version: version as number, sortOrder: sortOrder as number }
  })
}

/**
 * POST /api/viewbook-templates/reorder — { items: [{ id, version, sortOrder }] }.
 * Route validation is shape-only (array of objects); reorderSections owns
 * the deep validation (integer values, non-empty, duplicate-id rejection)
 * and the all-or-nothing version-guarded swap.
 */
export const POST = withRoute(async (request: NextRequest) => {
  await requireOperatorEmail(request)
  const body = requireJsonObject(await parseJsonBody(request))
  const items = parseItems(body.items)
  await reorderSections(items)
  return NextResponse.json({ ok: true })
})
