// lib/jobs/scheduler.ts
//
// Schedule tick: enqueue due jobs, advance nextRunAt.
//
// Exactly-once-per-slot comes from Job's durable @@unique([scheduleId,
// scheduledFor]) — NOT the active-window dedupKey, which a completed job
// exits. A crash between enqueue and advance replays the same slot on the
// next tick, hits the unique index, and is treated as already-enqueued.
//
// Missed slots collapse: nextRun() advances from `now`, so a week-long
// outage produces one run, not seven.

import { prisma } from '@/lib/db'
import { enqueueJob } from './queue'

export type Cadence =
  | { kind: 'every'; ms: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; dow: number; hour: number; minute: number }

const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 }

export function parseCadence(cadence: string): Cadence {
  const every = /^every:(\d+)(m|h|d)$/.exec(cadence)
  if (every) {
    const n = Number.parseInt(every[1], 10)
    if (n <= 0) throw new Error(`Cadence interval must be positive: ${cadence}`)
    return { kind: 'every', ms: n * UNIT_MS[every[2]] }
  }
  const daily = /^daily@(\d{2}):(\d{2})$/.exec(cadence)
  if (daily) {
    return { kind: 'daily', hour: parseClock(daily[1], 23, cadence), minute: parseClock(daily[2], 59, cadence) }
  }
  const weekly = /^weekly:([0-6])@(\d{2}):(\d{2})$/.exec(cadence)
  if (weekly) {
    return {
      kind: 'weekly',
      dow: Number.parseInt(weekly[1], 10),
      hour: parseClock(weekly[2], 23, cadence),
      minute: parseClock(weekly[3], 59, cadence),
    }
  }
  throw new Error(`Unrecognized cadence: ${cadence}`)
}

function parseClock(value: string, max: number, cadence: string): number {
  const n = Number.parseInt(value, 10)
  if (n > max) throw new Error(`Out-of-range time component in cadence: ${cadence}`)
  return n
}

/** Next run strictly after `from` (server-local time for daily/weekly). */
export function nextRun(cadence: string, from: Date): Date {
  const c = parseCadence(cadence)
  if (c.kind === 'every') return new Date(from.getTime() + c.ms)
  const next = new Date(from)
  next.setHours(c.hour, c.minute, 0, 0)
  if (c.kind === 'daily') {
    if (next <= from) next.setDate(next.getDate() + 1)
    return next
  }
  // weekly
  while (next.getDay() !== c.dow || next <= from) {
    next.setDate(next.getDate() + 1)
    next.setHours(c.hour, c.minute, 0, 0)
  }
  return next
}

let tickRunning = false

export async function tickSchedules(now: Date = new Date()): Promise<void> {
  if (tickRunning) return
  tickRunning = true
  try {
    const due = await prisma.schedule.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
    })
    for (const sched of due) {
      try {
        let payload: unknown = {}
        try {
          payload = JSON.parse(sched.payload)
        } catch {
          console.warn(`[jobs] schedule ${sched.id} has unparseable payload; enqueuing {}`)
        }
        const { id: jobId } = await enqueueJob({
          type: sched.jobType,
          payload,
          scheduleId: sched.id,
          scheduledFor: sched.nextRunAt,
          groupKey: `schedule:${sched.id}`,
        })
        // Conditional advance: if another tick already moved this schedule,
        // match 0 rows and leave it alone.
        await prisma.schedule.updateMany({
          where: { id: sched.id, nextRunAt: sched.nextRunAt },
          data: { nextRunAt: nextRun(sched.cadence, now), lastRunAt: now, lastJobId: jobId },
        })
      } catch (err) {
        // Enqueue or advance failed — leave nextRunAt as-is; next tick retries.
        console.warn(`[jobs] schedule tick failed for ${sched.id}:`, (err as Error).message)
      }
    }
  } finally {
    tickRunning = false
  }
}
