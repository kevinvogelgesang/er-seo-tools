// app/api/clients/[id]/keyword-strategy/route.ts
// KS-5 Task 6: cookie-gated poll route — the dashboard card's initial-load
// and polling read of the latest KeywordStrategySession for a client.
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { getLatestKeywordStrategySession } from '@/lib/keywords/strategy-export'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

function parseClientId(id: string): number | null {
  const n = parseInt(id, 10)
  return Number.isInteger(n) && n > 0 && String(n) === id.trim() ? n : null
}

/**
 * GET /api/clients/:id/keyword-strategy
 * → { session: { id, status, tokenMintedAt, memoMarkdown, memoUpdatedAt } | null }
 * Latest session by (createdAt desc, id desc). No client-existence 404 — a
 * missing/unknown client just returns { session: null }, matching the
 * gsc-snapshot GET's lenient poll-surface posture. Cookie-gated by global
 * middleware.
 */
export const GET = withRoute(async (_request: NextRequest, { params }: RouteParams) => {
  const { id } = await params
  const clientId = parseClientId(id)
  if (clientId === null) return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })

  // Single query definition shared with the dashboard page's initial load
  // (lib/keywords/strategy-export.ts). NextResponse.json serializes the
  // helper's Date fields to the same ISO strings the inline query produced.
  const session = await getLatestKeywordStrategySession(clientId)

  return NextResponse.json({ session: session ?? null })
})
