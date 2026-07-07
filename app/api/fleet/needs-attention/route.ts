// app/api/fleet/needs-attention/route.ts
// A8 PR 3.5 — worst-movers list for the Needs-attention widget. The loader
// returns the full ranked list; the route caps at 12 (widgets slice to 3/8 by
// size). Cookie-gated by middleware omission (NOT in isPublicPath).
import { NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { getNeedsAttention } from '@/lib/services/fleet-aggregates'

export const dynamic = 'force-dynamic'

const MAX_ROWS = 12

export const GET = withRoute(async () => {
  const rows = await getNeedsAttention()
  return NextResponse.json(rows.slice(0, MAX_ROWS))
})
