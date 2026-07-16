// lib/jobs/handlers/client-sweep.test.ts
//
// D8 weekly client sweep — fan-out handler. DB-backed, injected `deps.queue`
// (NO module mocking, Codex plan-fix #6). Mirrors robots-monitor-sweep.test's
// owned-prefix cleanup discipline over the shared dev DB.
//
// Isolation note: runClientSweep freezes its cohort from ALL active clients,
// so parallel suites' clients may also appear as members. Tests therefore
// assert only on THEIR OWN members (looked up by clientId), and drive the
// fake queue to a default 'queued' outcome so foreign members never error the
// run. Revalidation-specific cases (c/e/f/delisted/g) PRE-SEED the WeeklySweep
// membershipJson so the cohort is not rebuilt — exact control, zero foreign
// contamination.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import type { QueueRequestInput, QueueRequestResult } from '@/lib/ada-audit/queue-request'
import type { SweepMember, SweepMembership } from '@/lib/sweep/types'
import { parseMembership } from '@/lib/sweep/types'
import {
  runClientSweep,
  registerClientSweepHandler,
  CLIENT_SWEEP_JOB_TYPE,
  type ClientSweepDeps,
} from './client-sweep'
import { getJobHandler } from '../registry'

const PREFIX = 'task5sweep-'
const DOM = `t5s-${Date.now()}` // domain namespace unique to this run
let counter = 0
const clientIds: number[] = []
const slots: Date[] = []
const siteAuditIds: string[] = []

// Distinct slot per test — scheduledFor is @unique, so a shared slot would
// collide across tests. Base an hour back to stay clear of real rows.
const BASE = Date.now() - 3_600_000
function nextSlot(): Date {
  const slot = new Date(BASE + slots.length * 60_000)
  slots.push(slot)
  return slot
}

async function makeClient(domains: string[], archivedAt: Date | null = null) {
  const client = await prisma.client.create({
    data: {
      name: `${PREFIX}${Date.now()}-${counter++}`,
      domains: JSON.stringify(domains),
      archivedAt,
    },
  })
  clientIds.push(client.id)
  return client
}

/** Guarantee the sweep Schedule row exists immediately before a run (a
 *  concurrent system-schedules.test clear could otherwise delete it). */
async function ensureSweepSchedule(): Promise<string> {
  const existing = await prisma.schedule.findUnique({ where: { name: 'system-client-sweep' } })
  if (existing) return existing.id
  try {
    const created = await prisma.schedule.create({
      data: {
        name: 'system-client-sweep',
        jobType: CLIENT_SWEEP_JOB_TYPE,
        cadence: 'weekly:1@01:00',
        payload: '{}',
        enabled: true,
        nextRunAt: new Date(),
      },
    })
    return created.id
  } catch {
    return (await prisma.schedule.findUniqueOrThrow({ where: { name: 'system-client-sweep' } })).id
  }
}

async function seedSweep(slot: Date, members: SweepMember[]): Promise<void> {
  const membership: SweepMembership = { v: 1, expectedCount: members.length, members }
  await prisma.weeklySweep.create({
    data: { scheduledFor: slot, startedAt: new Date(), membershipJson: JSON.stringify(membership) },
  })
}

async function loadMembership(slot: Date): Promise<SweepMembership> {
  const row = await prisma.weeklySweep.findUniqueOrThrow({ where: { scheduledFor: slot } })
  const m = parseMembership(row.membershipJson)
  if (!m) throw new Error('membership failed to parse')
  return m
}

function memberFor(m: SweepMembership, clientId: number, domain: string): SweepMember {
  const found = m.members.find((x) => x.clientId === clientId && x.domain === domain)
  if (!found) throw new Error(`member not found: ${clientId}/${domain}`)
  return found
}

interface FakeQueue {
  fn: ClientSweepDeps['queue']
  calls: QueueRequestInput[]
}

function makeQueue(
  responder: (input: QueueRequestInput) => QueueRequestResult | Promise<QueueRequestResult>,
): FakeQueue {
  const calls: QueueRequestInput[] = []
  const fn = (async (input: QueueRequestInput) => {
    calls.push(input)
    return responder(input)
  }) as ClientSweepDeps['queue']
  return { fn, calls }
}

// Default: every domain enqueues cleanly with a deterministic id.
const okResponder = (input: QueueRequestInput): QueueRequestResult => ({
  kind: 'queued',
  id: `aud-${input.domain}`,
})

beforeAll(async () => {
  await ensureSweepSchedule()
})

afterAll(async () => {
  await prisma.weeklySweep.deleteMany({ where: { scheduledFor: { in: slots } } })
  if (siteAuditIds.length) {
    await prisma.siteAudit.deleteMany({ where: { id: { in: siteAuditIds } } })
  }
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

describe('runClientSweep', () => {
  it('(a) freezes the cohort then enqueues with the sweep profile, sets fanoutCompletedAt', async () => {
    const scheduleId = await ensureSweepSchedule()
    const domain = `${DOM}-a.example`
    const client = await makeClient([domain])
    const slot = nextSlot()
    const q = makeQueue(okResponder)

    await runClientSweep(slot, { queue: q.fn, now: () => new Date() })

    const membership = await loadMembership(slot)
    const mine = memberFor(membership, client.id, domain)
    expect(mine.outcome).toBe('enqueued')
    expect(mine.siteAuditId).toBe(`aud-${domain}`)

    const call = q.calls.find((c) => c.domain === domain)!
    expect(call).toBeDefined()
    expect(call.wcagLevel).toBe('wcag21aa')
    expect(call.seoIntent).toBe(true)
    expect(call.seoOnly).toBe(false)
    expect(call.requestedBy).toBe('sweep')
    expect(call.scheduleId).toBe(scheduleId)
    expect(call.clientId).toBe(client.id)

    const row = await prisma.weeklySweep.findUniqueOrThrow({ where: { scheduledFor: slot } })
    expect(row.fanoutCompletedAt).not.toBeNull()
  })

  it('(b) a client added AFTER the freeze is not admitted on retry', async () => {
    const domain = `${DOM}-b.example`
    await makeClient([domain])
    const slot = nextSlot()
    const q = makeQueue(okResponder)

    await runClientSweep(slot, { queue: q.fn, now: () => new Date() }) // freeze
    const lateClient = await makeClient([`${DOM}-b-late.example`]) // added after freeze
    await runClientSweep(slot, { queue: q.fn, now: () => new Date() }) // retry reuses frozen cohort

    const membership = await loadMembership(slot)
    expect(membership.members.some((m) => m.clientId === lateClient.id)).toBe(false)
  })

  it('(c) reprocesses an error member on retry; leaves an enqueued member untouched', async () => {
    const errDomain = `${DOM}-c-err.example`
    const okDomain = `${DOM}-c-ok.example`
    const client = await makeClient([errDomain, okDomain])
    const slot = nextSlot()
    await ensureSweepSchedule()
    await seedSweep(slot, [
      { clientId: client.id, clientName: client.name, domain: errDomain, siteAuditId: null, outcome: 'pending' },
      { clientId: client.id, clientName: client.name, domain: okDomain, siteAuditId: 'preexisting-B', outcome: 'enqueued' },
    ])

    // Run 1: throws for errDomain -> that member errors -> handler throws.
    const throwing = makeQueue((input) => {
      if (input.domain === errDomain) throw new Error('boom')
      return okResponder(input)
    })
    await expect(runClientSweep(slot, { queue: throwing.fn, now: () => new Date() })).rejects.toThrow()
    let membership = await loadMembership(slot)
    expect(memberFor(membership, client.id, errDomain).outcome).toBe('error')
    expect(memberFor(membership, client.id, okDomain).siteAuditId).toBe('preexisting-B')
    // The enqueued member is never re-queued.
    expect(throwing.calls.some((c) => c.domain === okDomain)).toBe(false)

    // Run 2: errDomain now succeeds; okDomain stays untouched.
    const q2 = makeQueue(okResponder)
    await runClientSweep(slot, { queue: q2.fn, now: () => new Date() })
    membership = await loadMembership(slot)
    expect(memberFor(membership, client.id, errDomain).outcome).toBe('enqueued')
    expect(memberFor(membership, client.id, errDomain).siteAuditId).toBe(`aud-${errDomain}`)
    expect(memberFor(membership, client.id, okDomain).siteAuditId).toBe('preexisting-B')
    expect(q2.calls.some((c) => c.domain === okDomain)).toBe(false)
  })

  it('(d) two clients sharing a domain -> one enqueue + one shared-domain', async () => {
    const domain = `${DOM}-d-shared.example`
    const clientA = await makeClient([domain])
    const clientB = await makeClient([domain])
    const slot = nextSlot()
    const q = makeQueue(okResponder)

    await runClientSweep(slot, { queue: q.fn, now: () => new Date() })

    const membership = await loadMembership(slot)
    const a = memberFor(membership, clientA.id, domain)
    const b = memberFor(membership, clientB.id, domain)
    // A sorts first (lower id) -> enqueued; B collapses to shared-domain.
    expect(a.outcome).toBe('enqueued')
    expect(b.outcome).toBe('shared-domain')
    expect(b.siteAuditId).toBe(a.siteAuditId)
    // Queue called exactly once for the shared domain.
    expect(q.calls.filter((c) => c.domain === domain)).toHaveLength(1)
  })

  it('(e) an in-flight seoOnly duplicate -> skipped-conflict', async () => {
    const domain = `${DOM}-e.example`
    const client = await makeClient([domain])
    const dup = await prisma.siteAudit.create({
      data: { domain, status: 'running', seoOnly: true, clientId: null },
    })
    siteAuditIds.push(dup.id)
    const slot = nextSlot()
    await ensureSweepSchedule()
    await seedSweep(slot, [
      { clientId: client.id, clientName: client.name, domain, siteAuditId: null, outcome: 'pending' },
    ])

    const q = makeQueue((): QueueRequestResult => ({ kind: 'duplicate', existingId: dup.id }))
    await runClientSweep(slot, { queue: q.fn, now: () => new Date() })

    const membership = await loadMembership(slot)
    const m = memberFor(membership, client.id, domain)
    expect(m.outcome).toBe('skipped-conflict')
    expect(m.reason).toBe('seo-only-in-flight')
  })

  it('(f) a client archived after the freeze -> skipped-archived', async () => {
    const domain = `${DOM}-f.example`
    const client = await makeClient([domain])
    const slot = nextSlot()
    await ensureSweepSchedule()
    await seedSweep(slot, [
      { clientId: client.id, clientName: client.name, domain, siteAuditId: null, outcome: 'pending' },
    ])
    await prisma.client.update({ where: { id: client.id }, data: { archivedAt: new Date() } })

    const q = makeQueue(okResponder)
    await runClientSweep(slot, { queue: q.fn, now: () => new Date() })

    const membership = await loadMembership(slot)
    expect(memberFor(membership, client.id, domain).outcome).toBe('skipped-archived')
    expect(q.calls).toHaveLength(0)
  })

  it('(f2) a domain delisted after the freeze -> skipped-delisted', async () => {
    const domain = `${DOM}-f2.example`
    const client = await makeClient([domain])
    const slot = nextSlot()
    await ensureSweepSchedule()
    await seedSweep(slot, [
      { clientId: client.id, clientName: client.name, domain, siteAuditId: null, outcome: 'pending' },
    ])
    await prisma.client.update({ where: { id: client.id }, data: { domains: JSON.stringify([`${DOM}-f2-other.example`]) } })

    const q = makeQueue(okResponder)
    await runClientSweep(slot, { queue: q.fn, now: () => new Date() })

    const membership = await loadMembership(slot)
    expect(memberFor(membership, client.id, domain).outcome).toBe('skipped-delisted')
    expect(q.calls).toHaveLength(0)
  })

  it('(g) a residual error member -> handler throws, fanoutCompletedAt stays null', async () => {
    const domain = `${DOM}-g.example`
    const client = await makeClient([domain])
    const slot = nextSlot()
    await ensureSweepSchedule()
    await seedSweep(slot, [
      { clientId: client.id, clientName: client.name, domain, siteAuditId: null, outcome: 'pending' },
    ])

    const q = makeQueue(() => { throw new Error('always fails') })
    await expect(runClientSweep(slot, { queue: q.fn, now: () => new Date() })).rejects.toThrow()

    const row = await prisma.weeklySweep.findUniqueOrThrow({ where: { scheduledFor: slot } })
    expect(row.fanoutCompletedAt).toBeNull()
    const membership = parseMembership(row.membershipJson)!
    expect(memberFor(membership, client.id, domain).outcome).toBe('error')
  })

  it('(h) re-firing the same slot upserts — never a second WeeklySweep row', async () => {
    const domain = `${DOM}-h.example`
    await makeClient([domain])
    const slot = nextSlot()
    const q = makeQueue(okResponder)

    await runClientSweep(slot, { queue: q.fn, now: () => new Date() })
    await runClientSweep(slot, { queue: q.fn, now: () => new Date() })

    const rows = await prisma.weeklySweep.findMany({ where: { scheduledFor: slot } })
    expect(rows).toHaveLength(1)
  })
})

describe('registerClientSweepHandler', () => {
  it('registers a concurrency-1 handler', () => {
    registerClientSweepHandler()
    const h = getJobHandler(CLIENT_SWEEP_JOB_TYPE)
    expect(h).toBeDefined()
    expect(h!.concurrency).toBe(1)
    expect(h!.maxAttempts).toBe(3)
  })

  it('(i) a job with no scheduledFor slot throws and creates no WeeklySweep row', async () => {
    registerClientSweepHandler()
    const h = getJobHandler(CLIENT_SWEEP_JOB_TYPE)!
    const job = await prisma.job.create({
      data: { type: CLIENT_SWEEP_JOB_TYPE, payload: '{}', status: 'running', scheduledFor: null },
    })
    const before = await prisma.weeklySweep.count()
    const ctx = {
      jobId: job.id,
      attempt: 1,
      signal: new AbortController().signal,
      reportProgress: () => {},
    }
    await expect(h.handler({}, ctx)).rejects.toThrow('client-sweep job has no scheduledFor slot')
    const after = await prisma.weeklySweep.count()
    expect(after).toBe(before)
    await prisma.job.delete({ where: { id: job.id } })
  })
})
