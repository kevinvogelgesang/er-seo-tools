// app/api/keyword-strategy/[id]/volumes/route.ts
// KS-5 Task 7 — the BILLABLE volumes POST (scope 'volume-lookup'). Real
// DataForSEO spend flows through here, so the order is contractual (spec §8):
//   body validation (before auth) → auth → dark gate → session → locale →
//   filter/dedupe → monthly precheck → reserve → call → settle.
// The `try` begins IMMEDIATELY after a successful reserve so the `finally`
// settle runs whether the provider call returned ok, returned an error union,
// or threw — no early return may sit between reserve and try (plan-Codex).
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import { authenticateStrategyRequest } from '@/lib/keyword-strategy-route-auth'
import { getKeywordProfile } from '@/lib/services/keyword-profile'
import { isVolumeEnabled, KEYWORD_MAX_CHARS, KEYWORD_MAX_WORDS } from '@/lib/keywords/volume-config'
import { normalizeKeyword } from '@/lib/keywords/volume-normalize'
import { getKeywordVolumes, type GetKeywordVolumesResult, type SkippedKeyword } from '@/lib/keywords/volume'
import {
  reserveVolumeBudget,
  settleVolumeRequest,
  monthlyUsedKeywords,
  monthlyKeywordCeiling,
} from '@/lib/keywords/strategy-volume-ledger'

export const dynamic = 'force-dynamic'

const MAX_IDEMPOTENCY_KEY_CHARS = 64
const MAX_KEYWORDS = 300

type RouteParams = { params: Promise<{ id: string }> }
type SettleOutcome = Parameters<typeof settleVolumeRequest>[0]['outcome']

/** Retained work per the ledger's clamp: MAX(0, MIN(fetched, n)). */
function retainedFor(fetched: number, n: number): number {
  return Math.max(0, Math.min(fetched, n))
}

export const POST = withRoute(async (req: NextRequest, { params }: RouteParams) => {
  const { id } = await params

  // 1. Body validation BEFORE auth (400 beats 401).
  const body = await parseJsonBody<{ idempotencyKey?: unknown; keywords?: unknown }>(req)
  if (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length === 0) {
    throw new HttpError(400, 'idempotency_key_required')
  }
  if (body.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_CHARS) {
    throw new HttpError(400, 'idempotency_key_too_long')
  }
  const idempotencyKey = body.idempotencyKey
  if (!Array.isArray(body.keywords)) {
    throw new HttpError(400, 'keywords_required')
  }
  if (body.keywords.length > MAX_KEYWORDS) {
    throw new HttpError(400, 'too_many_keywords')
  }
  const rawKeywords = body.keywords

  // 2. Auth (scope 'volume-lookup').
  const auth = await authenticateStrategyRequest(req, id, 'volume-lookup')
  if (!auth.ok) return auth.response

  // 3a. Dark gate FIRST — before ANY reservation.
  if (!isVolumeEnabled()) {
    return NextResponse.json({ error: 'volume_disabled' }, { status: 409 })
  }

  // 3b. Session row must exist.
  const session = await prisma.keywordStrategySession.findUnique({
    where: { id },
    select: { clientId: true },
  })
  if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // 3c. Locale is fixed server-side from the client profile; any body-supplied
  //     locale is IGNORED (never read).
  const profile = await getKeywordProfile(session.clientId)
  const locale = profile?.locale
  if (!locale) return NextResponse.json({ error: 'locale_not_configured' }, { status: 409 })
  const lookupLocale = { locationCode: locale.locationCode, languageCode: locale.languageCode }

  // 4. Route-side candidate filtering (Codex #5 — one contract; KS-2 re-skips
  //    identically under the same constants, so reserve never counts a keyword
  //    that can't be sent). Normalize → dedupe → drop empties/over-limit.
  const seen = new Set<string>()
  const candidates: string[] = []
  const routeSkipped: SkippedKeyword[] = []
  for (const raw of rawKeywords) {
    const norm = normalizeKeyword(typeof raw === 'string' ? raw : String(raw))
    if (seen.has(norm)) continue
    seen.add(norm)
    if (norm.length === 0) {
      routeSkipped.push({ keyword: norm, reason: 'empty' })
    } else if (norm.length > KEYWORD_MAX_CHARS) {
      routeSkipped.push({ keyword: norm, reason: 'too_long' })
    } else if (norm.split(' ').length > KEYWORD_MAX_WORDS) {
      routeSkipped.push({ keyword: norm, reason: 'too_many_words' })
    } else {
      candidates.push(norm)
    }
  }
  if (candidates.length === 0) {
    return NextResponse.json({ error: 'no_valid_keywords', skipped: routeSkipped }, { status: 400 })
  }
  const n = candidates.length

  // 5. Monthly ceiling precheck (advisory; request-row spend time).
  const monthlyUsed = await monthlyUsedKeywords(new Date())
  if (monthlyUsed + n > monthlyKeywordCeiling()) {
    return NextResponse.json({ error: 'volume_monthly_ceiling' }, { status: 429 })
  }

  // 6. Reserve.
  const reserved = await reserveVolumeBudget({ sessionId: id, idempotencyKey, keywordCount: n })
  if (!reserved.ok) {
    if (reserved.reason === 'duplicate_settled') {
      if (reserved.responseJson == null) {
        return NextResponse.json({ error: 'duplicate_request' }, { status: 409 })
      }
      try {
        return NextResponse.json(JSON.parse(reserved.responseJson))
      } catch {
        return NextResponse.json({ error: 'duplicate_request' }, { status: 409 })
      }
    }
    if (reserved.reason === 'duplicate_request') {
      return NextResponse.json({ error: 'duplicate_request' }, { status: 409 })
    }
    // budget_exhausted
    return NextResponse.json(
      { error: 'volume_budget_exhausted', used: reserved.used, cap: reserved.cap },
      { status: 429 },
    )
  }

  // 7. Call + settle. The try opens IMMEDIATELY after the successful reserve.
  let outcome: SettleOutcome = { kind: 'unresolved' }
  try {
    const result = await getKeywordVolumes(candidates, lookupLocale)

    // budget.used reflects the refund: the reserve added n, the settle will
    // refund (n − retained). We read the post-reserve counter and subtract the
    // same refund the ledger will apply, so the reply (and the stored replay
    // body) match the post-settle DB state without re-reading after the write.
    const { used: usedAfterReserve, cap } = await readBudget(id)
    const retained = retainedFor(result.fetched, n)
    const budget = { used: usedAfterReserve - (n - retained), cap }

    if (result.ok) {
      const responseBody = {
        ok: true,
        volumes: result.volumes,
        accounting: {
          fromCache: result.fromCache,
          fetched: result.fetched,
          skipped: [...routeSkipped, ...result.skipped],
          providerCost: result.providerCost,
        },
        budget,
      }
      outcome = {
        kind: 'accounted',
        fetched: result.fetched,
        fromCache: result.fromCache,
        providerCost: result.providerCost,
        responseJson: JSON.stringify(responseBody),
      }
      return NextResponse.json(responseBody)
    }

    // ok:false but KS-2 always reports numeric accounting → accounted (retains
    // fetched work); responseJson null (nothing to replay for a failure).
    outcome = {
      kind: 'accounted',
      fetched: result.fetched,
      fromCache: result.fromCache,
      providerCost: result.providerCost,
      responseJson: null,
    }
    const status = result.reason === 'rate_limited' ? 429 : result.reason === 'disabled' ? 409 : 502
    return NextResponse.json(
      { ok: false, reason: result.reason, message: result.message, budget },
      { status },
    )
  } finally {
    // A throw leaves outcome 'unresolved' (full reservation held). The sweeper
    // is the backstop if this settle itself fails — never rethrow into caller.
    await settleVolumeRequest({ sessionId: id, requestId: reserved.requestId, outcome }).catch(
      (err) => logError({ route: 'ks5.volumes.settle', sessionId: id, requestId: reserved.requestId }, err),
    )
  }
})

async function readBudget(sessionId: string): Promise<{ used: number; cap: number }> {
  const row = await prisma.keywordStrategySession.findUnique({
    where: { id: sessionId },
    select: { volumeKeywordsUsed: true, volumeKeywordCap: true },
  })
  return { used: row?.volumeKeywordsUsed ?? 0, cap: row?.volumeKeywordCap ?? 0 }
}
