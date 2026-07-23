import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { requireJsonObject } from '@/lib/viewbook/route-utils'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { createViewbook, listViewbooks } from '@/lib/viewbook/service'
import {
  DEFAULT_OFFERINGS,
  offeringAvailability,
  type ViewbookOfferings,
} from '@/lib/viewbook/instance-snapshot'
import { loadTemplateTreeRaw } from '@/lib/viewbook/template-service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/viewbooks — admin index. Cookie-gated by global middleware.
 * F2: carries template-derived offering `availability` so the create form can
 * disable checkboxes with no matching template content (spec §7).
 */
export const GET = withRoute(async () => {
  const [viewbooks, raw] = await Promise.all([listViewbooks(), loadTemplateTreeRaw()])
  return NextResponse.json({ viewbooks, availability: offeringAvailability(raw) })
})

// F2 (spec §5/§7): optional `offerings` — a plain object whose present
// website/va/ppc keys must be booleans (anything else → 400); missing keys
// take the website-only default. All-false / unavailable enforcement lives in
// the service (400 invalid_offerings / 409 offering_unavailable).
function parseOfferings(raw: unknown): ViewbookOfferings {
  if (raw === undefined) return DEFAULT_OFFERINGS
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new HttpError(400, 'invalid_request')
  const body = raw as Record<string, unknown>
  const offerings = { ...DEFAULT_OFFERINGS }
  for (const key of ['website', 'va', 'ppc'] as const) {
    const value = body[key]
    if (value === undefined) continue
    if (typeof value !== 'boolean') throw new HttpError(400, 'invalid_request')
    offerings[key] = value
  }
  return offerings
}

/** POST /api/viewbooks — create + seed a viewbook: { clientId, kind, offerings? }. */
export const POST = withRoute(async (request: NextRequest) => {
  const operator = await requireOperatorEmail(request)
  const body = requireJsonObject(
    await parseJsonBody<{ clientId?: unknown; kind?: unknown; offerings?: unknown }>(request),
  )
  const clientId = typeof body.clientId === 'number' && Number.isInteger(body.clientId) && body.clientId > 0 ? body.clientId : null
  const kind = body.kind === 'new-build' || body.kind === 'upgrade' ? body.kind : null
  if (!clientId || !kind) throw new HttpError(400, 'invalid_request')
  const offerings = parseOfferings(body.offerings)
  const created = await createViewbook(clientId, kind, operator, offerings)
  return NextResponse.json({ viewbook: created }, { status: 201 })
})
