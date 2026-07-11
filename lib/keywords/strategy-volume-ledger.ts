// lib/keywords/strategy-volume-ledger.ts
//
// KS-5 Task 4: the volume-spend ledger — the money-integrity core of the
// billable volume-lookup endpoint. It guards real DataForSEO spend by
// reserving budget BEFORE the provider call, settling exactly-once after, and
// replaying stored responses on idempotent retries. Aggregate counters alone
// cannot distinguish retry / partial success / crash / duplicate settlement on
// a stateless-JWT-fronted endpoint — the KeywordStrategyVolumeRequest rows are
// the audit trail.
//
// HOUSE RULES honored here:
//   - Array-form prisma.$transaction([...]) ONLY; all conditions live IN the
//     SQL (EXISTS / cap predicates). No interactive transactions (SQLite write
//     lock across event-loop round-trips — 2026-06-10 prod incident).
//   - Tagged $executeRaw / $queryRaw templates only (never *Unsafe).
//   - Raw SQL bypasses @updatedAt: every raw write sets updatedAt manually.
//     DateTime columns are stored as INTEGER Unix-ms in this SQLite DB (verified
//     against the Session table + a round-trip probe), so createdAt/updatedAt
//     are written and compared as integer ms via Date#getTime()/Date.now().
//   - Request-row ids are generated with crypto.randomUUID() because a raw
//     INSERT bypasses Prisma's cuid() default.
//
// Spec: docs/superpowers/specs/2026-07-11-ks5-keyword-strategy-export-design.md §8.
import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export const VOLUME_SESSION_KEYWORD_CAP_DEFAULT = 1500
export const VOLUME_MONTHLY_KEYWORD_CEILING_DEFAULT = 25000

/** Per-session reservation cap, read from env at CALL time (KS-2 precedent). */
export function sessionKeywordCap(): number {
  return Number(process.env.VOLUME_SESSION_KEYWORD_CAP) || VOLUME_SESSION_KEYWORD_CAP_DEFAULT
}

/** Advisory global monthly ceiling, read from env at CALL time. */
export function monthlyKeywordCeiling(): number {
  return Number(process.env.VOLUME_MONTHLY_KEYWORD_CEILING) || VOLUME_MONTHLY_KEYWORD_CEILING_DEFAULT
}

/** responseJson replay guard: stored only when at or below this length. */
const RESPONSE_JSON_MAX_CHARS = 1_000_000
const DAY_MS = 24 * 60 * 60 * 1000

export type ReserveResult =
  | { ok: true; requestId: string }
  | { ok: false; reason: 'budget_exhausted'; used: number; cap: number }
  | { ok: false; reason: 'duplicate_request'; priorState: 'reserved' | 'unresolved' }
  | { ok: false; reason: 'duplicate_settled'; responseJson: string | null }

/**
 * SQLite SQLITE_CONSTRAINT_UNIQUE (extended code 2067) surfaced through a raw
 * query as PrismaClientKnownRequestError P2010. Observed shape:
 *   { code: 'P2010', meta: { code: '2067', message: 'UNIQUE constraint failed: …' } }
 * Kept narrow: the raw-error class + the extended SQLite code, with the message
 * substring as a defensive fallback.
 */
function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (err.code !== 'P2010') return false
  const meta = err.meta as { code?: unknown; message?: unknown } | undefined
  return (
    meta?.code === '2067' ||
    String(meta?.message ?? '').includes('UNIQUE constraint failed')
  )
}

/** Probe the (session, key) row to classify a non-reserving reserve attempt. */
async function probeReserve(
  sessionId: string,
  idempotencyKey: string,
): Promise<ReserveResult> {
  const existing = await prisma.keywordStrategyVolumeRequest.findUnique({
    where: { strategySessionId_idempotencyKey: { strategySessionId: sessionId, idempotencyKey } },
    select: { state: true, responseJson: true },
  })
  if (existing) {
    if (existing.state === 'settled') {
      return { ok: false, reason: 'duplicate_settled', responseJson: existing.responseJson }
    }
    // reserved | unresolved — never double-reserve.
    return { ok: false, reason: 'duplicate_request', priorState: existing.state as 'reserved' | 'unresolved' }
  }
  // Genuinely absent → the cap predicate failed: budget exhausted.
  const session = await prisma.keywordStrategySession.findUnique({
    where: { id: sessionId },
    select: { volumeKeywordsUsed: true, volumeKeywordCap: true },
  })
  return {
    ok: false,
    reason: 'budget_exhausted',
    used: session?.volumeKeywordsUsed ?? 0,
    cap: session?.volumeKeywordCap ?? 0,
  }
}

/**
 * Reserve budget for `keywordCount` keywords under the session cap. One
 * array-form transaction, statement order load-bearing (plan-Codex #2):
 *   1. INSERT..SELECT the reserved request row, gated on the cap predicate.
 *   2. UPDATE the session counter, fenced on BOTH the cap predicate AND
 *      EXISTS(that request row, state='reserved').
 * Affected-count contract: (1,1)=ok; (0,0)=probe; (1,0)/(0,1)=internal error.
 * A raw unique violation rolls back the whole txn → catch → same probe.
 */
export async function reserveVolumeBudget(args: {
  sessionId: string
  idempotencyKey: string
  keywordCount: number
}): Promise<ReserveResult> {
  const { sessionId, idempotencyKey, keywordCount } = args
  const rid = randomUUID()
  const nowMs = Date.now()

  try {
    const [insertCount, updateCount] = await prisma.$transaction([
      prisma.$executeRaw`
        INSERT INTO "KeywordStrategyVolumeRequest"
          ("id", "createdAt", "updatedAt", "strategySessionId", "idempotencyKey", "state", "keywordCount")
        SELECT ${rid}, ${nowMs}, ${nowMs}, ${sessionId}, ${idempotencyKey}, 'reserved', ${keywordCount}
        WHERE (
          SELECT "volumeKeywordsUsed" + ${keywordCount} <= "volumeKeywordCap"
          FROM "KeywordStrategySession" WHERE "id" = ${sessionId}
        )
      `,
      prisma.$executeRaw`
        UPDATE "KeywordStrategySession"
        SET "volumeKeywordsUsed" = "volumeKeywordsUsed" + ${keywordCount}, "updatedAt" = ${nowMs}
        WHERE "id" = ${sessionId}
          AND "volumeKeywordsUsed" + ${keywordCount} <= "volumeKeywordCap"
          AND EXISTS (
            SELECT 1 FROM "KeywordStrategyVolumeRequest"
            WHERE "id" = ${rid} AND "state" = 'reserved'
          )
      `,
    ])

    if (insertCount === 1 && updateCount === 1) {
      return { ok: true, requestId: rid }
    }
    if (insertCount === 0 && updateCount === 0) {
      return probeReserve(sessionId, idempotencyKey)
    }
    // Mismatched pair — the two fences disagreed. Never treat as success.
    throw new Error(
      `[ks5-ledger] reserve statement mismatch: insert=${insertCount} update=${updateCount} session=${sessionId}`,
    )
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Duplicate key with budget available → INSERT aborted the whole txn
      // (rollback, no half-reserve). Classify via the same probe.
      return probeReserve(sessionId, idempotencyKey)
    }
    throw err
  }
}

/**
 * Settle a reserved request exactly-once. One array-form transaction, statement
 * order load-bearing (spec §8.4): the session refund (with its EXISTS fence)
 * runs BEFORE the request-row state flip, so the fence reads state='reserved'
 * before the flip clears it. `retained`/`refund` derive from the STORED row's
 * keywordCount IN SQL — the caller's numbers are never trusted for the refund
 * arithmetic (plan-Codex #3): retained = clamp(fetched, [0, keywordCount]),
 * refund = keywordCount − retained, floored by MAX(0, …). Double-settle no-ops.
 */
export async function settleVolumeRequest(args: {
  sessionId: string
  requestId: string
  outcome:
    | { kind: 'accounted'; fetched: number; fromCache: number; providerCost: number | null; responseJson: string | null }
    | { kind: 'unresolved' }
}): Promise<void> {
  const { sessionId, requestId, outcome } = args
  const nowMs = Date.now()

  if (outcome.kind === 'unresolved') {
    // A request went out but no accounting came back: hold the full
    // reservation (refund 0), mark unresolved. settledKeywords stays NULL.
    await prisma.$transaction([
      prisma.$executeRaw`
        UPDATE "KeywordStrategySession"
        SET "updatedAt" = ${nowMs}
        WHERE "id" = ${sessionId}
          AND EXISTS (
            SELECT 1 FROM "KeywordStrategyVolumeRequest"
            WHERE "id" = ${requestId} AND "state" = 'reserved'
          )
      `,
      prisma.$executeRaw`
        UPDATE "KeywordStrategyVolumeRequest"
        SET "state" = 'unresolved', "updatedAt" = ${nowMs}
        WHERE "id" = ${requestId} AND "state" = 'reserved'
      `,
    ])
    return
  }

  const { fetched, fromCache, providerCost } = outcome
  const responseJson =
    outcome.responseJson != null && outcome.responseJson.length <= RESPONSE_JSON_MAX_CHARS
      ? outcome.responseJson
      : null

  await prisma.$transaction([
    // (1) Refund = keywordCount − clamp(fetched, [0, keywordCount]), derived
    // from the stored keywordCount; MAX(0, …) floor keeps a corrupt counter
    // non-negative. Fenced on the row still being 'reserved'.
    prisma.$executeRaw`
      UPDATE "KeywordStrategySession"
      SET "volumeKeywordsUsed" = MAX(0, "volumeKeywordsUsed" - (
            SELECT "keywordCount" - MAX(0, MIN(${fetched}, "keywordCount"))
            FROM "KeywordStrategyVolumeRequest" WHERE "id" = ${requestId}
          )),
          "updatedAt" = ${nowMs}
      WHERE "id" = ${sessionId}
        AND EXISTS (
          SELECT 1 FROM "KeywordStrategyVolumeRequest"
          WHERE "id" = ${requestId} AND "state" = 'reserved'
        )
    `,
    // (2) settledKeywords = the SAME clamped retained value (SQL, not caller).
    prisma.$executeRaw`
      UPDATE "KeywordStrategyVolumeRequest"
      SET "state" = 'settled',
          "settledKeywords" = MAX(0, MIN(${fetched}, "keywordCount")),
          "fetched" = ${fetched},
          "fromCache" = ${fromCache},
          "providerCost" = ${providerCost},
          "responseJson" = ${responseJson},
          "updatedAt" = ${nowMs}
      WHERE "id" = ${requestId} AND "state" = 'reserved'
    `,
  ])
}

/**
 * SUM(COALESCE(settledKeywords, keywordCount)) over ALL request rows whose
 * createdAt falls on/after the UTC month-start of `now` — request-row spend
 * time, NOT session createdAt (Codex #4). Global (the ceiling is a runaway
 * guard across the whole tool, not per-client).
 */
export async function monthlyUsedKeywords(now: Date): Promise<number> {
  const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  const rows = await prisma.$queryRaw<{ total: bigint | number | null }[]>`
    SELECT COALESCE(SUM(COALESCE("settledKeywords", "keywordCount")), 0) AS total
    FROM "KeywordStrategyVolumeRequest"
    WHERE "createdAt" >= ${monthStartMs}
  `
  return Number(rows[0]?.total ?? 0)
}

/**
 * Crash-window sweeper: reserved rows older than 24h → 'unresolved' with NO
 * session refund (spec §8.6). A crash between reserve and settle means spend is
 * unknown; holding the budget is the safe direction. Returns the flip count.
 */
export async function sweepStaleReservations(now: Date): Promise<number> {
  const cutoffMs = now.getTime() - DAY_MS
  const nowMs = now.getTime()
  const count = await prisma.$executeRaw`
    UPDATE "KeywordStrategyVolumeRequest"
    SET "state" = 'unresolved', "updatedAt" = ${nowMs}
    WHERE "state" = 'reserved' AND "createdAt" < ${cutoffMs}
  `
  return count
}
