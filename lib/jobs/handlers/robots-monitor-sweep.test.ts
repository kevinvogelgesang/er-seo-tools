// lib/jobs/handlers/robots-monitor-sweep.test.ts
//
// D5 sweep: fan-out one robots-monitor job per (active client, normalized
// registered domain). Codex #5: normalize, skip malformed, dedupe.
import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { runRobotsMonitorSweep } from './robots-monitor-sweep'
import { ROBOTS_MONITOR_JOB_TYPE } from './robots-monitor'

const PREFIX = 'd5sweep-'
let counter = 0
const clientIds: number[] = []
const SLOT = new Date(Date.now() - 3_600_000) // one hour ago; fixed per suite

async function makeClient(domains: unknown, archivedAt: Date | null = null) {
  const client = await prisma.client.create({
    data: {
      name: `${PREFIX}${Date.now()}-${counter++}`,
      domains: typeof domains === 'string' ? domains : JSON.stringify(domains),
      archivedAt,
    },
  })
  clientIds.push(client.id)
  return client
}

async function jobsFor(clientId: number) {
  // dedupKey embeds the clientId — payload-owned identifier, never a
  // type-wide scan (plan-Codex #6 cleanup rule applies to reads too).
  return prisma.job.findMany({
    where: { type: ROBOTS_MONITOR_JOB_TYPE, dedupKey: { startsWith: `robots-monitor:${clientId}:` } },
  })
}

afterAll(async () => {
  // Delete ONLY this suite's jobs (by owned clientIds), never every job of
  // the type — parallel suites share nothing but must not be clobbered.
  for (const id of clientIds) {
    await prisma.job.deleteMany({
      where: { type: ROBOTS_MONITOR_JOB_TYPE, dedupKey: { startsWith: `robots-monitor:${id}:` } },
    })
  }
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

describe('runRobotsMonitorSweep', () => {
  it('enqueues one job per normalized domain with the dedupKey shape and the slot boundary in the payload', async () => {
    const client = await makeClient(['acme-a.example', 'acme-b.example'])
    await runRobotsMonitorSweep(SLOT)
    const jobs = await jobsFor(client.id)
    expect(jobs).toHaveLength(2)
    const keys = jobs.map((j) => j.dedupKey).sort()
    expect(keys).toEqual([
      `robots-monitor:${client.id}:acme-a.example`,
      `robots-monitor:${client.id}:acme-b.example`,
    ])
    for (const j of jobs) {
      expect((JSON.parse(j.payload) as { slotStartedAt: number }).slotStartedAt).toBe(SLOT.getTime())
    }
  })

  it('skips archived clients entirely', async () => {
    const client = await makeClient(['archived.example'], new Date())
    await runRobotsMonitorSweep(SLOT)
    expect(await jobsFor(client.id)).toHaveLength(0)
  })

  it('normalizes, skips malformed entries, dedupes (Codex #5)', async () => {
    const client = await makeClient(['Dupe.example', 'dupe.example', 'not a domain!!', 42 as unknown as string])
    await runRobotsMonitorSweep(SLOT)
    const jobs = await jobsFor(client.id)
    expect(jobs).toHaveLength(1)
    expect((JSON.parse(jobs[0].payload) as { domain: string }).domain).toBe('dupe.example')
  })

  it('tolerates malformed domains JSON (treated as no domains)', async () => {
    const client = await makeClient('{{{not json')
    await runRobotsMonitorSweep(SLOT)
    expect(await jobsFor(client.id)).toHaveLength(0)
  })

  it('partial retry re-enqueues only missing jobs (dedup no-ops live ones; Codex #8)', async () => {
    const client = await makeClient(['retry.example'])
    await runRobotsMonitorSweep(SLOT)
    await runRobotsMonitorSweep(SLOT) // second pass = the retry
    expect(await jobsFor(client.id)).toHaveLength(1)
  })

  it('retry after a child went terminal re-enqueues with the SAME slot boundary (plan-Codex #1)', async () => {
    const client = await makeClient(['term.example'])
    await runRobotsMonitorSweep(SLOT)
    const [first] = await jobsFor(client.id)
    await prisma.job.update({ where: { id: first.id }, data: { status: 'complete' } })
    await runRobotsMonitorSweep(SLOT) // dedup is active-window only -> new child
    const jobs = await jobsFor(client.id)
    expect(jobs).toHaveLength(2)
    for (const j of jobs) {
      // Same boundary on BOTH children: the monitor's reuse predicate will
      // find the first child's check row instead of refetching.
      expect((JSON.parse(j.payload) as { slotStartedAt: number }).slotStartedAt).toBe(SLOT.getTime())
    }
  })
})
