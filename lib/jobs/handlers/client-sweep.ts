// lib/jobs/handlers/client-sweep.ts
//
// D8 weekly client sweep — fan-out job. Fired by the system-client-sweep
// schedule (weekly:1@01:00). Freezes a cohort of every active client's
// registered domains BEFORE any enqueue (Codex #2), then queues one full
// site audit per member through the shared request helper, collapsing
// shared-domain duplicates and recording a per-member outcome so a retry
// reprocesses ONLY the pending/error members (idempotent fan-out).
//
// The slot (WeeklySweep.scheduledFor) is the campaign key: the handler reads
// it from its OWN job row's scheduledFor (never manufactured — Codex #4), so
// a retry re-attaches to the same WeeklySweep row and a manual re-fire must
// carry the intended scheduledFor explicitly.

import { prisma } from '@/lib/db'
import { registerJobHandler } from '../registry'
import { queueSiteAuditRequest } from '@/lib/ada-audit/queue-request'
import { buildCohort, registeredDomains } from '@/lib/sweep/cohort'
import { CLIENT_SWEEP_JOB_TYPE, SWEEP_SCAN_PROFILE, parseMembership } from '@/lib/sweep/types'

export { CLIENT_SWEEP_JOB_TYPE }

export interface ClientSweepDeps {
  queue: typeof queueSiteAuditRequest
  now: () => Date
}

const realDeps: ClientSweepDeps = { queue: queueSiteAuditRequest, now: () => new Date() }

export async function runClientSweep(slot: Date, deps: ClientSweepDeps = realDeps): Promise<void> {
  // 0. Resolve the sweep Schedule row once — attribution + retention marker on
  //    every enqueued audit. Missing = misconfigured boot (seedSystemSchedules
  //    should always have created it) → throw (Codex #3).
  const sweepSchedule = await prisma.schedule.findUnique({
    where: { name: 'system-client-sweep' },
    select: { id: true },
  })
  if (!sweepSchedule) throw new Error('[sweep] system-client-sweep schedule row missing')
  const sweepScheduleId = sweepSchedule.id

  // 1. Upsert the slot row (idempotent under re-fire, Codex #? / test h).
  const sweep = await prisma.weeklySweep.upsert({
    where: { scheduledFor: slot },
    create: { scheduledFor: slot, startedAt: deps.now() },
    update: {},
  })

  // 2. Freeze the cohort BEFORE any enqueue (Codex #2). Once frozen, a retry
  //    reuses the SAME membership — a client added later is never admitted.
  let membership = parseMembership(sweep.membershipJson)
  if (!membership) {
    const clients = await prisma.client.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true, domains: true },
    })
    membership = buildCohort(clients)
    await prisma.weeklySweep.update({
      where: { id: sweep.id },
      data: {
        membershipJson: JSON.stringify(membership),
        startedAt: sweep.startedAt ?? deps.now(),
      },
    })
  }

  // 3. Process pending/error members; persist after EACH outcome so a crash
  //    mid-fan-out resumes without re-queuing already-enqueued members.
  const byDomainAudit = new Map<string, string>() // normalized domain -> siteAuditId
  for (const m of membership.members) {
    // Already-settled members: seed the shared-domain map with their audit id
    // (including ids recovered from terminal members on a retry) and skip.
    if (
      m.outcome === 'enqueued' ||
      m.outcome === 'duplicate' ||
      m.outcome === 'shared-domain' ||
      m.outcome.startsWith('skipped') ||
      m.outcome === 'invalid-domain'
    ) {
      if (m.siteAuditId) byDomainAudit.set(m.domain, m.siteAuditId)
      continue
    }

    // Revalidate against the CURRENT client state (Codex #12): the cohort was
    // frozen earlier, so a client archived / a domain delisted since then must
    // not be scanned.
    const client = await prisma.client.findUnique({
      where: { id: m.clientId },
      select: { archivedAt: true, domains: true },
    })
    if (!client || client.archivedAt) {
      m.outcome = 'skipped-archived'
    } else if (!registeredDomains(client.domains).has(m.domain)) {
      m.outcome = 'skipped-delisted'
    } else if (byDomainAudit.has(m.domain)) {
      // Another client this run already scanned this exact domain — collapse.
      m.outcome = 'shared-domain'
      m.siteAuditId = byDomainAudit.get(m.domain)!
    } else {
      try {
        const res = await deps.queue({
          domain: m.domain,
          clientId: m.clientId,
          ...SWEEP_SCAN_PROFILE,
          requestedBy: 'sweep',
          scheduleId: sweepScheduleId,
        })
        if (res.kind === 'queued') {
          m.outcome = 'enqueued'
          m.siteAuditId = res.id
          byDomainAudit.set(m.domain, res.id)
        } else if (res.kind === 'duplicate') {
          // Reuse an in-flight audit ONLY if it's a full (non-seoOnly) audit
          // owned by nobody or by this same client (Codex #13). A seoOnly or
          // foreign-client in-flight audit is a genuine conflict, not a reuse.
          const dup = await prisma.siteAudit.findUnique({
            where: { id: res.existingId },
            select: { seoOnly: true, clientId: true },
          })
          if (dup && !dup.seoOnly && (dup.clientId === null || dup.clientId === m.clientId)) {
            m.outcome = 'duplicate'
            m.siteAuditId = res.existingId
            byDomainAudit.set(m.domain, res.existingId)
          } else {
            m.outcome = 'skipped-conflict'
            m.reason = dup?.seoOnly ? 'seo-only-in-flight' : 'foreign-client-in-flight'
          }
        } else {
          m.outcome = 'invalid-domain'
          m.reason = res.reason
        }
      } catch (err) {
        m.outcome = 'error'
        m.reason = String(err)
      }
    }

    await prisma.weeklySweep.update({
      where: { id: sweep.id },
      data: { membershipJson: JSON.stringify(membership) },
    })
  }

  // 4. Finish or throw-at-end (Codex #14). Any residual 'error' member re-runs
  //    the whole handler on the worker's retry; fanoutCompletedAt is stamped
  //    only when every member reached a non-error terminal outcome.
  const errors = membership.members.filter((m) => m.outcome === 'error')
  if (errors.length === 0) {
    await prisma.weeklySweep.updateMany({
      where: { id: sweep.id, fanoutCompletedAt: null },
      data: { fanoutCompletedAt: deps.now() },
    })
  } else {
    throw new Error(`[sweep] ${errors.length} member(s) failed to enqueue; retrying`)
  }
}

export function registerClientSweepHandler(): void {
  registerJobHandler({
    type: CLIENT_SWEEP_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 3,
    timeoutMs: 120_000,
    handler: async (_payload, ctx) => {
      // The slot is the campaign key — read it from THIS job's own row. No
      // fallback slot (Codex #4): a null scheduledFor means a manual job was
      // enqueued without a slot, and manufacturing "today at 01:00" could
      // attach it to the wrong campaign.
      const job = await prisma.job.findUnique({
        where: { id: ctx.jobId },
        select: { scheduledFor: true },
      })
      if (!job?.scheduledFor) throw new Error('[sweep] client-sweep job has no scheduledFor slot')
      await runClientSweep(job.scheduledFor)
    },
  })
}
