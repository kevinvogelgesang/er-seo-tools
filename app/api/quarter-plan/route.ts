import { NextRequest, NextResponse } from 'next/server'
import { sanitizePlanPayload } from '@/lib/quarter-grid/state'
import { loadPlanResponse, persistPlan } from '@/lib/quarter-grid/persist'

export const dynamic = 'force-dynamic'

/** GET /api/quarter-plan — the latest plan + assignments, or { plan: null } */
export async function GET() {
  try {
    return NextResponse.json(await loadPlanResponse())
  } catch (error) {
    console.error('GET /api/quarter-plan error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** PUT /api/quarter-plan — full-state save, last-write-wins (creates the singleton plan if none exists) */
export async function PUT(request: NextRequest) {
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
    await persistPlan(result.payload)
    return NextResponse.json(await loadPlanResponse())
  } catch (error) {
    console.error('PUT /api/quarter-plan error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
