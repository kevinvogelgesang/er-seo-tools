// lib/jobs/handlers/robots-monitor.test.ts
//
// D5 per-domain monitor. Injectable deps seam (spec Codex #3) — fully
// transport-free; runAndStore/getCheck are stubs backed by real DB rows so
// marker fencing and slot-scoped reuse run against the real schema.
import { describe, it, expect, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import type { RobotsCheckDetail } from '@/lib/robots-check/types'
import type { StoredRobotsCheck } from '@/lib/robots-check/service'
import { runRobotsMonitor, ROBOTS_MONITOR_JOB_TYPE, type RobotsMonitorDeps } from './robots-monitor'

const PREFIX = 'd5mon-'
let counter = 0
const createdJobIds: string[] = []
// The slot boundary every test payload carries (one hour ago — rows created
// during the test are inside the slot; rows explicitly backdated are not).
const SLOT = Date.now() - 3_600_000

function pay(clientId: number, over: Record<string, unknown> = {}) {
  return { clientId, domain: 'mon.example', slotStartedAt: SLOT, ...over }
}

function detailFixture(robotsHash: string): RobotsCheckDetail {
  return {
    v: 1, domain: 'mon.example',
    robots: { status: 'ok', httpStatus: 200, failure: null, contentHash: robotsHash, issues: [], blockedBots: [], sitemapUrls: [] },
    sitemaps: [], sitemapsSkipped: 0, timeBudgetExhausted: false,
    totals: { sitemapUrlTotal: null, errors: 0, warnings: 0 },
  }
}

async function makeClient(domains: string[] = ['mon.example'], archivedAt: Date | null = null) {
  return prisma.client.create({
    data: { name: `${PREFIX}${Date.now()}-${counter++}`, domains: JSON.stringify(domains), archivedAt },
  })
}

/** Insert a real RobotsCheck row and return a StoredRobotsCheck-shaped view. */
async function makeCheckRow(clientId: number, opts: {
  source?: string; robotsHash?: string; createdAt?: Date; changed?: boolean | null
} = {}): Promise<StoredRobotsCheck> {
  const detail = detailFixture(opts.robotsHash ?? 'h1')
  const row = await prisma.robotsCheck.create({
    data: {
      clientId, domain: 'mon.example', source: opts.source ?? 'scheduled',
      robotsStatus: 'ok', robotsContentHash: detail.robots.contentHash,
      robotsContent: 'User-agent: *', sitemapUrlTotal: null, errorCount: 0, warningCount: 0,
      detailJson: JSON.stringify(detail),
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  })
  return {
    summary: {
      id: row.id, domain: row.domain, source: row.source, robotsStatus: 'ok',
      sitemapUrlTotal: null, errorCount: 0, warningCount: 0,
      changed: opts.changed === undefined ? true : opts.changed,
      createdAt: row.createdAt.toISOString(),
    },
    detail,
    changeSummary: {
      robotsStatus: null, robotsContentChanged: true,
      robotsDiff: { added: ['Disallow: /x'], removed: [], truncated: false },
      blockedBots: null, sitemaps: null, sitemapUrlTotal: null, counts: null,
    },
  }
}

/** Only the payload-boundary FALLBACK test needs a real Job row. */
async function makeJob(createdAt: Date) {
  const job = await prisma.job.create({
    data: { type: ROBOTS_MONITOR_JOB_TYPE, payload: '{}', status: 'running', createdAt },
  })
  createdJobIds.push(job.id)
  return job
}

function makeDeps(overrides: Partial<RobotsMonitorDeps> = {}): {
  deps: RobotsMonitorDeps
  sent: Array<{ to: string; subject: string }>
  runAndStore: ReturnType<typeof vi.fn>
  getCheck: ReturnType<typeof vi.fn>
} {
  const sent: Array<{ to: string; subject: string }> = []
  const runAndStore = vi.fn()
  const getCheck = vi.fn()
  const deps: RobotsMonitorDeps = {
    runAndStore, getCheck,
    send: vi.fn(async (args: { to: string; content: { subject: string } }) => { sent.push({ to: args.to, subject: args.content.subject }) }) as unknown as RobotsMonitorDeps['send'],
    notifyEnabled: () => true,
    adminEmail: () => 'admin@example.com',
    now: () => new Date(),
    ...overrides,
  }
  return { deps, sent, runAndStore, getCheck }
}

afterAll(async () => {
  // Delete ONLY rows this suite created (recorded ids / PREFIX-scoped
  // clients; RobotsCheck rows cascade from Client) — plan-Codex #6.
  if (createdJobIds.length) await prisma.job.deleteMany({ where: { id: { in: createdJobIds } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

describe('runRobotsMonitor', () => {
  it('changed:false -> no email (row inside the slot is reused, no refetch)', async () => {
    const client = await makeClient()
    const stored = await makeCheckRow(client.id, { changed: false })
    const { deps, sent, runAndStore, getCheck } = makeDeps()
    getCheck.mockResolvedValue(stored)
    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(runAndStore).not.toHaveBeenCalled() // reuse hit
    expect(getCheck).toHaveBeenCalledWith(client.id, stored.summary.id)
    expect(sent).toHaveLength(0)
  })

  it('changed:null (first check / corrupt predecessor) -> silent (Codex #8)', async () => {
    const client = await makeClient()
    const stored = await makeCheckRow(client.id, { changed: null })
    const { deps, sent, getCheck } = makeDeps()
    getCheck.mockResolvedValue(stored)
    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(sent).toHaveLength(0)
  })

  it('changed:true -> one email, marker stamped, second run sends nothing', async () => {
    const client = await makeClient()
    const stored = await makeCheckRow(client.id)
    const { deps, sent, runAndStore, getCheck } = makeDeps()
    getCheck.mockResolvedValue(stored)

    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('admin@example.com')
    expect(runAndStore).not.toHaveBeenCalled() // slot-scoped reuse found the row

    const row = await prisma.robotsCheck.findUnique({ where: { id: stored.summary.id } })
    expect(row!.alertSentAt).not.toBeNull()

    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(sent).toHaveLength(1) // marker fence held
  })

  it('a PRIOR slot row (createdAt < slotStartedAt) is never reused (Codex #1)', async () => {
    const client = await makeClient()
    await makeCheckRow(client.id, { createdAt: new Date(SLOT - 86_400_000) }) // last week's row
    const { deps, runAndStore, getCheck } = makeDeps()
    // The fresh run creates its row INSIDE the mock, after the reuse miss.
    runAndStore.mockImplementation(async () => makeCheckRow(client.id, { changed: false }))
    getCheck.mockImplementation(async (_cid: number, id: number) => {
      const view = await makeCheckRow(client.id, { changed: false })
      return { ...view, summary: { ...view.summary, id } }
    })
    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(runAndStore).toHaveBeenCalledTimes(1) // old row failed the >= boundary
  })

  it('missing slotStartedAt falls back to this job row own createdAt', async () => {
    const client = await makeClient()
    const job = await makeJob(new Date(SLOT))
    const stored = await makeCheckRow(client.id, { changed: false }) // created now, >= job.createdAt
    const { deps, runAndStore, getCheck } = makeDeps()
    getCheck.mockResolvedValue(stored)
    await runRobotsMonitor({ clientId: client.id, domain: 'mon.example' }, { jobId: job.id }, deps)
    expect(runAndStore).not.toHaveBeenCalled() // fallback boundary reused the row
  })

  it('archived client -> no fetch, no reuse, no email (revalidation first; Codex #1)', async () => {
    const client = await makeClient(['mon.example'], new Date())
    await makeCheckRow(client.id)
    const { deps, sent, runAndStore, getCheck } = makeDeps()
    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(runAndStore).not.toHaveBeenCalled()
    expect(getCheck).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  it('delisted domain -> no-op', async () => {
    const client = await makeClient(['other.example'])
    const { deps, sent, runAndStore } = makeDeps()
    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(runAndStore).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  it('stored domains are normalized before membership (case-variant list; plan-Codex #2)', async () => {
    const client = await makeClient(['Mon.Example']) // legacy casing in the stored list
    const stored = await makeCheckRow(client.id, { changed: false })
    const { deps, runAndStore, getCheck } = makeDeps()
    getCheck.mockResolvedValue(stored)
    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(getCheck).toHaveBeenCalled() // revalidation passed via normalization
    expect(runAndStore).not.toHaveBeenCalled()
  })

  it('manual single-flight winner -> silent complete (Codex #2)', async () => {
    const client = await makeClient()
    const { deps, sent, runAndStore, getCheck } = makeDeps()
    // No scheduled row inside the slot -> fresh run; the joiner got a MANUAL row.
    runAndStore.mockImplementation(async () => makeCheckRow(client.id, { source: 'manual' }))
    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(runAndStore).toHaveBeenCalledTimes(1)
    expect(getCheck).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  it('dark notify env -> permanent suppression: no stamp now, no back-send next week (Codex #6/#8)', async () => {
    const client = await makeClient()
    const stored = await makeCheckRow(client.id)
    const { deps, sent, getCheck } = makeDeps({ notifyEnabled: () => false })
    getCheck.mockResolvedValue(stored)
    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(sent).toHaveLength(0)
    const row = await prisma.robotsCheck.findUnique({ where: { id: stored.summary.id } })
    expect(row!.alertSentAt).toBeNull()

    // Next weekly slot, notify now LIT: the new row compares against the
    // changed row and reads unchanged -> still no email (no catch-up).
    const nextSlot = Date.now() - 1_000
    const nextStored = await makeCheckRow(client.id, { changed: false })
    const lit = makeDeps({ notifyEnabled: () => true })
    lit.getCheck.mockResolvedValue(nextStored)
    await runRobotsMonitor(pay(client.id, { slotStartedAt: nextSlot }), { jobId: 'job-x' }, lit.deps)
    expect(lit.sent).toHaveLength(0)
  })

  it('send failure -> throws (worker retry), marker not stamped', async () => {
    const client = await makeClient()
    const stored = await makeCheckRow(client.id)
    const { deps, getCheck } = makeDeps({
      send: vi.fn(async () => { throw new Error('mailgun 500') }) as unknown as RobotsMonitorDeps['send'],
    })
    getCheck.mockResolvedValue(stored)
    await expect(runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)).rejects.toThrow('mailgun 500')
    const row = await prisma.robotsCheck.findUnique({ where: { id: stored.summary.id } })
    expect(row!.alertSentAt).toBeNull()
  })

  it('malformed payload -> silent no-op', async () => {
    const { deps, sent, runAndStore } = makeDeps()
    await runRobotsMonitor({ nope: true }, { jobId: 'job-x' }, deps)
    expect(runAndStore).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })
})
