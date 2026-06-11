import { NextRequest, NextResponse } from 'next/server'
import { sanitizePlanPayload } from '@/lib/quarter-grid/state'
import { loadPlanResponse, persistPlan } from '@/lib/quarter-grid/persist'

export const dynamic = 'force-dynamic'

/**
 * POST /api/quarter-plan/import — one-time localStorage import.
 * Refuses with 409 when any plan exists (including losing a creation race),
 * so a second browser can never clobber an already-imported plan.
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const result = sanitizePlanPayload(body)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    const persisted = await persistPlan(result.payload, { createOnly: true })
    if (persisted.status === 'conflict') {
      return NextResponse.json({ error: 'A quarter plan already exists' }, { status: 409 })
    }
    return NextResponse.json(await loadPlanResponse(), { status: 201 })
  } catch (error) {
    console.error('POST /api/quarter-plan/import error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
