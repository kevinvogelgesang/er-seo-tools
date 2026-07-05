import { NextRequest, NextResponse } from 'next/server'
import { sanitizePlanPayload } from '@/lib/quarter-grid/state'
import { loadPlanResponse, persistPlan } from '@/lib/quarter-grid/persist'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'

export const dynamic = 'force-dynamic'

/**
 * POST /api/quarter-plan/import — one-time localStorage import.
 * Refuses with 409 when any plan exists (including losing a creation race),
 * so a second browser can never clobber an already-imported plan.
 */
export const POST = withRoute(async (request: NextRequest) => {
  const body = await parseJsonBody(request)
  const result = sanitizePlanPayload(body)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  const persisted = await persistPlan(result.payload, { createOnly: true })
  if (persisted.status === 'conflict') {
    throw new HttpError(409, 'A quarter plan already exists')
  }
  return NextResponse.json(await loadPlanResponse(), { status: 201 })
})
