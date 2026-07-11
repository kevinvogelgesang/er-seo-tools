// lib/cleanup.ks5-wiring.test.ts
//
// KS-5 Task 9: asserts runCleanup wires in pruneKeywordStrategySessions
// (lib/keywords/retention.ts) and sweepStaleReservations
// (lib/keywords/strategy-volume-ledger.ts). Module-mock only (never
// vi.spyOn on prisma) — mirrors lib/jobs/handlers/cleanup.test.ts's
// delegation-mock style. Everything else runCleanup calls runs for real
// against the local dev DB (Promise.allSettled isolates any failure), same
// DB-backed convention as the rest of the keywords retention suite. Kept in
// its own file (not lib/cleanup.test.ts) because vi.mock is file-scoped and
// would otherwise shadow the real pruneKeywordStrategySessions used by the
// DB-backed assertions in lib/keywords/retention.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const pruneKeywordStrategySessionsMock = vi.fn().mockResolvedValue(undefined)
const sweepStaleReservationsMock = vi.fn().mockResolvedValue(0)

vi.mock('@/lib/keywords/retention', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/keywords/retention')>()
  return {
    ...actual,
    pruneKeywordStrategySessions: (...args: unknown[]) => pruneKeywordStrategySessionsMock(...args),
  }
})

vi.mock('@/lib/keywords/strategy-volume-ledger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/keywords/strategy-volume-ledger')>()
  return {
    ...actual,
    sweepStaleReservations: (...args: unknown[]) => sweepStaleReservationsMock(...args),
  }
})

import { runCleanup } from '@/lib/cleanup'

describe('runCleanup KS-5 wiring', () => {
  beforeEach(() => {
    pruneKeywordStrategySessionsMock.mockClear()
    sweepStaleReservationsMock.mockClear()
  })

  it('invokes pruneKeywordStrategySessions and sweepStaleReservations exactly once', async () => {
    await runCleanup()

    expect(pruneKeywordStrategySessionsMock).toHaveBeenCalledTimes(1)
    expect(sweepStaleReservationsMock).toHaveBeenCalledTimes(1)
    expect(sweepStaleReservationsMock.mock.calls[0][0]).toBeInstanceOf(Date)
  })
})
