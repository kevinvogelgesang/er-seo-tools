// app/api/clients/[id]/keyword-strategy/mint-token/route.ts
// KS-5 Task 6: cookie-gated mint route for the client-facing keyword
// strategy export/memo/volume-lookup flow. Order: guards → best-effort GSC
// refresh → create the session row → mint the kst_ token → respond. If
// minting throws (e.g. the token secret is missing in prod), the just-created
// row is best-effort deleted before the rethrow — the dashboard must never be
// left polling a token-less 'processing' row (Codex #6, spec §6).
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { prisma } from '@/lib/db'
import { refreshGscSnapshot } from '@/lib/keywords/gsc-snapshot'
import { sessionKeywordCap } from '@/lib/keywords/strategy-volume-ledger'
import { mintKeywordStrategyToken } from '@/lib/keyword-strategy-token'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

// KS-3 precedent (app/api/clients/[id]/keyword-profile/route.ts): strict
// integer parse — rejects NaN, leading zeros ('01'), and trailing garbage
// ('1abc') that parseInt alone would silently accept.
function parseClientId(id: string): number | null {
  const n = parseInt(id, 10)
  return Number.isInteger(n) && n > 0 && String(n) === id.trim() ? n : null
}

/**
 * POST /api/clients/:id/keyword-strategy/mint-token
 * → { token, expiresAt, strategyId }. Cookie-gated by global middleware.
 */
export const POST = withRoute(async (_request: NextRequest, { params }: RouteParams) => {
  const { id } = await params
  const clientId = parseClientId(id)
  if (clientId === null) return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { archivedAt: true } })
  if (!client) return NextResponse.json({ error: 'client_not_found' }, { status: 404 })
  if (client.archivedAt) return NextResponse.json({ error: 'client_archived' }, { status: 409 })

  // Best-effort — a GSC refresh failure (any throw or a non-ok result) must
  // never block minting. Only the outcome is recorded.
  let gscRefreshed = false
  try {
    const result = await refreshGscSnapshot(clientId)
    gscRefreshed = result?.ok === true
  } catch {
    gscRefreshed = false
  }

  const row = await prisma.keywordStrategySession.create({
    data: {
      clientId,
      status: 'processing',
      tokenMintedAt: new Date(),
      gscRefreshed,
      volumeKeywordCap: sessionKeywordCap(),
    },
  })

  let minted
  try {
    minted = await mintKeywordStrategyToken(row.id)
  } catch (err) {
    try {
      await prisma.keywordStrategySession.delete({ where: { id: row.id } })
    } catch {
      // Best-effort cleanup only — the row is orphaned but harmless if this
      // second failure happens; the mint error is what the caller needs.
    }
    throw err
  }

  return NextResponse.json({ token: minted.token, expiresAt: minted.expiresAt, strategyId: row.id })
})
