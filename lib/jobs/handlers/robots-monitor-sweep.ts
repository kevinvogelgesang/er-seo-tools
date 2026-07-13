// lib/jobs/handlers/robots-monitor-sweep.ts
//
// D5 weekly fan-out: one robots-monitor job per (active client, normalized
// registered domain). Fired by the system-robots-monitor schedule. Enqueue-
// only — a partial failure retried is safe because the per-domain dedupKey
// no-ops jobs that are still active (Codex #5/#8).

import { prisma } from '@/lib/db'
import { normalizeClientDomain, InvalidDomainError } from '@/lib/security/domain-validation'
import { registerJobHandler } from '../registry'
import { enqueueJob } from '../queue'
import { ROBOTS_MONITOR_JOB_TYPE } from './robots-monitor'

export const ROBOTS_MONITOR_SWEEP_JOB_TYPE = 'robots-monitor-sweep'

/** `slotStartedAt` (the SWEEP job row's createdAt) is the durable slot
 *  boundary carried to every child (plan-Codex #1): a sweep retry re-attempts
 *  the SAME job row, so a child re-enqueued after an early sibling went
 *  terminal carries the SAME boundary — the monitor's reuse predicate still
 *  finds the first run's check row. A child job's own createdAt could not
 *  promise that. */
export async function runRobotsMonitorSweep(slotStartedAt: Date): Promise<void> {
  const clients = await prisma.client.findMany({
    where: { archivedAt: null },
    select: { id: true, domains: true },
  })
  for (const client of clients) {
    const domains = new Set<string>()
    let raw: unknown = []
    try { raw = JSON.parse(client.domains) } catch { /* malformed -> no domains */ }
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (typeof entry !== 'string') continue
        try {
          domains.add(normalizeClientDomain(entry))
        } catch (err) {
          if (err instanceof InvalidDomainError) continue // malformed legacy value (Codex #5)
          throw err
        }
      }
    }
    for (const domain of domains) {
      await enqueueJob({
        type: ROBOTS_MONITOR_JOB_TYPE,
        payload: { clientId: client.id, domain, slotStartedAt: slotStartedAt.getTime() },
        dedupKey: `robots-monitor:${client.id}:${domain}`,
      })
    }
  }
}

export function registerRobotsMonitorSweepHandler(): void {
  registerJobHandler({
    type: ROBOTS_MONITOR_SWEEP_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 3, // enqueue-only; per-domain dedup makes retries idempotent
    timeoutMs: 30_000,
    handler: async (_payload, ctx) => {
      const job = await prisma.job.findUnique({ where: { id: ctx.jobId }, select: { createdAt: true } })
      await runRobotsMonitorSweep(job?.createdAt ?? new Date())
    },
  })
}
