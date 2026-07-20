// lib/sweep/fanout.ts
//
// Shared fan-out core for the weekly client sweep — used by BOTH the scheduled
// client-sweep handler (origin='scheduled') and the manual-sweep handler
// (origin='manual'). Extracted verbatim from client-sweep.ts; the scheduled
// path is behaviorally identical (client-sweep.test.ts is the characterization
// gate). The ONLY parametrized differences: origin (set on create + asserted),
// requestedBy, and scheduleId — all passed in by the caller (the scheduled
// wrapper still resolves the system-client-sweep schedule id itself).

import { prisma } from '@/lib/db'
import { queueSiteAuditRequest } from '@/lib/ada-audit/queue-request'
import { buildCohort, registeredDomains } from '@/lib/sweep/cohort'
import { SWEEP_SCAN_PROFILE, parseMembership, type SweepOrigin } from '@/lib/sweep/types'

export interface SweepFanoutInput {
  slot: Date
  origin: SweepOrigin
  requestedBy: string
  scheduleId: string | null
}
export interface SweepFanoutDeps {
  queue: typeof queueSiteAuditRequest
  now: () => Date
}
const realDeps: SweepFanoutDeps = { queue: queueSiteAuditRequest, now: () => new Date() }

export async function runSweepFanout(input: SweepFanoutInput, deps: SweepFanoutDeps = realDeps): Promise<void> {
  // 1. Upsert the slot row (idempotent under re-fire). origin set ONLY on create.
  const sweep = await prisma.weeklySweep.upsert({
    where: { scheduledFor: input.slot },
    create: { scheduledFor: input.slot, origin: input.origin, startedAt: deps.now() },
    update: {},
  })
  // Never let a fan-out adopt a pre-created row of the OTHER origin sharing the
  // same slot. A cross-origin slot collision is a hard error, not a merge.
  if (sweep.origin !== input.origin) {
    throw new Error(
      `[sweep] slot ${input.slot.toISOString()} origin mismatch: row=${sweep.origin} fanout=${input.origin}`,
    )
  }

  // 2. Freeze the cohort BEFORE any enqueue. Once frozen, a retry reuses the
  //    SAME membership — a client added later is never admitted.
  let membership = parseMembership(sweep.membershipJson)
  if (!membership) {
    if (sweep.membershipJson !== null) {
      throw new Error('[sweep] membershipJson is present but failed to parse — refusing to rebuild cohort')
    }
    const clients = await prisma.client.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true, domains: true },
    })
    const built = buildCohort(clients)
    // Fence the FIRST publish on membershipJson still being null; on a lost race
    // adopt the WINNER's frozen cohort (never our own).
    const { count } = await prisma.weeklySweep.updateMany({
      where: { id: sweep.id, membershipJson: null },
      data: { membershipJson: JSON.stringify(built), startedAt: sweep.startedAt ?? deps.now() },
    })
    if (count === 0) {
      const row = await prisma.weeklySweep.findUnique({
        where: { id: sweep.id },
        select: { membershipJson: true },
      })
      const winner = parseMembership(row?.membershipJson ?? null)
      if (!winner) throw new Error('[sweep] cohort publish raced but winner cohort is unreadable')
      membership = winner
    } else {
      membership = built
    }
  }

  // 3. Process pending/error members; persist after EACH outcome.
  const byDomainAudit = new Map<string, string>() // normalized domain -> siteAuditId
  for (const m of membership.members) {
    if (m.siteAuditId) byDomainAudit.set(m.domain, m.siteAuditId)
  }
  for (const m of membership.members) {
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

    const client = await prisma.client.findUnique({
      where: { id: m.clientId },
      select: { archivedAt: true, domains: true },
    })
    if (!client || client.archivedAt) {
      m.outcome = 'skipped-archived'
    } else if (!registeredDomains(client.domains).has(m.domain)) {
      m.outcome = 'skipped-delisted'
    } else if (byDomainAudit.has(m.domain)) {
      m.outcome = 'shared-domain'
      m.siteAuditId = byDomainAudit.get(m.domain)!
    } else {
      try {
        const res = await deps.queue({
          domain: m.domain,
          clientId: m.clientId,
          ...SWEEP_SCAN_PROFILE,
          requestedBy: input.requestedBy,
          scheduleId: input.scheduleId,
        })
        if (res.kind === 'queued') {
          m.outcome = 'enqueued'
          m.siteAuditId = res.id
          byDomainAudit.set(m.domain, res.id)
        } else if (res.kind === 'duplicate') {
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

  // 4. Finish or throw-at-end. fanoutCompletedAt is stamped only when every
  //    member reached a non-error terminal outcome.
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
