// app/api/keyword-strategy/[id]/route.ts
// KS-5 Task 7 — PUBLIC token-authed export GET (scope 'read'). Assembles the
// five-block strategy export (spec §7) for the er-handoff-memo skill. Auth is
// the shared kst_ Bearer wall; the middleware allowlist (Task 8) opens this
// path publicly.
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { authenticateStrategyRequest } from '@/lib/keyword-strategy-route-auth'
import { loadStrategyExport } from '@/lib/keywords/strategy-export'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

export const GET = withRoute(async (req: NextRequest, { params }: RouteParams) => {
  const { id } = await params

  const auth = await authenticateStrategyRequest(req, id, 'read')
  if (!auth.ok) return auth.response

  const payload = await loadStrategyExport(id)
  if (!payload) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json(payload)
})
