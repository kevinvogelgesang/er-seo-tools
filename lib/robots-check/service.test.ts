// lib/robots-check/service.test.ts
//
// D4 service tests. Runner is mocked (unit seam); DB is the per-worker
// SQLite test DB. PREFIX-scoped clients, cascade delete cleans RobotsCheck.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import type { RobotsCheckDetail } from './types'

vi.mock('./runner', () => ({
  runRobotsCheck: vi.fn(),
}))
import { runRobotsCheck } from './runner'
import { runAndStoreRobotsCheck, listRobotsChecks, getRobotsCheck } from './service'

const mockRun = vi.mocked(runRobotsCheck)
const PREFIX = 'd4svc-'
let counter = 0

async function makeClient() {
  return prisma.client.create({ data: { name: `${PREFIX}${Date.now()}-${counter++}` } })
}

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

function detailFixture(overrides: {
  robotsHash?: string | null
  robotsStatus?: 'ok' | 'missing' | 'unreachable'
  sitemaps?: Array<{ url: string; contentHash: string | null; childrenHash: string | null }>
} = {}): RobotsCheckDetail {
  const sitemaps = (overrides.sitemaps ?? [{ url: 'https://x.com/s.xml', contentHash: 'h1', childrenHash: null }]).map(
    (s) => ({
      url: s.url, source: 'robots' as const, ok: s.contentHash !== null,
      httpStatus: 200, failure: null, isIndex: s.childrenHash !== null,
      urlCount: 3, childrenTotal: 0, childrenExcluded: 0, childrenFailed: 0,
      childrenSkipped: 0, contentHash: s.contentHash, children: [],
      childrenHash: s.childrenHash, issues: [],
    }),
  )
  return {
    v: 1, domain: 'x.com',
    robots: {
      status: overrides.robotsStatus ?? 'ok', httpStatus: 200, failure: null,
      contentHash: overrides.robotsHash === undefined ? 'rh1' : overrides.robotsHash,
      issues: [], blockedBots: [], sitemapUrls: [],
    },
    sitemaps, sitemapsSkipped: 0, timeBudgetExhausted: false,
    totals: { sitemapUrlTotal: 3, errors: 0, warnings: 1 },
  }
}

function arm(detail: RobotsCheckDetail, robotsContent: string | null = 'User-agent: *\n') {
  mockRun.mockResolvedValueOnce({ detail, robotsContent })
}

beforeEach(() => {
  mockRun.mockReset()
})

describe('runAndStoreRobotsCheck', () => {
  it('persists scalars incl. robotsContent and returns summary+detail; first check changed=null', async () => {
    const client = await makeClient()
    arm(detailFixture(), 'User-agent: *\nDisallow: /x\n')
    const { summary, detail } = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(summary.robotsStatus).toBe('ok')
    expect(summary.changed).toBeNull()
    expect(summary.source).toBe('manual')
    expect(detail.v).toBe(1)
    const row = await prisma.robotsCheck.findUnique({ where: { id: summary.id } })
    expect(row?.robotsContent).toBe('User-agent: *\nDisallow: /x\n')
    expect(row?.robotsContentHash).toBe('rh1')
    expect(row?.sitemapUrlTotal).toBe(3)
    expect(row?.warningCount).toBe(1)
  })

  it('rejects an invalid source', async () => {
    const client = await makeClient()
    await expect(
      // @ts-expect-error runtime validation test
      runAndStoreRobotsCheck(client.id, 'x.com', { source: 'cron' }),
    ).rejects.toThrow('invalid_source')
  })

  it('single-flight: two concurrent calls -> one runner invocation, one row, same result', async () => {
    const client = await makeClient()
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    mockRun.mockImplementationOnce(async () => {
      await gate
      return { detail: detailFixture(), robotsContent: null }
    })
    const p1 = runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    const p2 = runAndStoreRobotsCheck(client.id, 'x.com', { source: 'scheduled' })
    release()
    const [r1, r2] = await Promise.all([p1, p2])
    expect(mockRun).toHaveBeenCalledTimes(1)
    expect(r1.summary.id).toBe(r2.summary.id)
    expect(r1.summary.source).toBe('manual') // first caller's source stored
    expect(await prisma.robotsCheck.count({ where: { clientId: client.id } })).toBe(1)
  })

  it('a rejected run clears the in-flight slot (next call runs fresh) and does not write a row', async () => {
    const client = await makeClient()
    mockRun.mockRejectedValueOnce(new Error('boom'))
    await expect(runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })).rejects.toThrow('boom')
    expect(await prisma.robotsCheck.count({ where: { clientId: client.id } })).toBe(0)
    arm(detailFixture())
    const ok = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(ok.summary.robotsStatus).toBe('ok')
  })
})

describe('changed flag', () => {
  it('robots hash change / status change / sitemap-set change / childrenHash-only change all flip changed', async () => {
    const client = await makeClient()
    arm(detailFixture({ robotsHash: 'rh1' }))
    await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })

    arm(detailFixture({ robotsHash: 'rh2' }))
    const b = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(b.summary.changed).toBe(true)

    arm(detailFixture({ robotsHash: 'rh2' }))
    const c = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(c.summary.changed).toBe(false)

    // childrenHash-only change (index byte-identical, child churn) — Codex #2
    arm(detailFixture({ robotsHash: 'rh2', sitemaps: [{ url: 'https://x.com/s.xml', contentHash: 'h1', childrenHash: 'agg1' }] }))
    await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    arm(detailFixture({ robotsHash: 'rh2', sitemaps: [{ url: 'https://x.com/s.xml', contentHash: 'h1', childrenHash: 'agg2' }] }))
    const e = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(e.summary.changed).toBe(true)
  })

  it('robotsStatus change flips changed even with identical hashes (plan-Codex #6)', async () => {
    const client = await makeClient()
    arm(detailFixture({ robotsHash: null, robotsStatus: 'missing' }))
    await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    arm(detailFixture({ robotsHash: null, robotsStatus: 'unreachable' }))
    const b = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(b.summary.changed).toBe(true)
  })

  it('sitemap-set change (url added) flips changed (plan-Codex #6)', async () => {
    const client = await makeClient()
    arm(detailFixture({ sitemaps: [{ url: 'https://x.com/a.xml', contentHash: 'h1', childrenHash: null }] }))
    await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    arm(detailFixture({
      sitemaps: [
        { url: 'https://x.com/a.xml', contentHash: 'h1', childrenHash: null },
        { url: 'https://x.com/b.xml', contentHash: 'h2', childrenHash: null },
      ],
    }))
    const b = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(b.summary.changed).toBe(true)
  })

  it('corrupt predecessor detailJson -> changed null, never a throw (both syntactic and structural corruption)', async () => {
    const client = await makeClient()
    arm(detailFixture())
    const first = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    await prisma.robotsCheck.update({ where: { id: first.summary.id }, data: { detailJson: '{not json' } })
    arm(detailFixture())
    const second = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(second.summary.changed).toBeNull()
    // Structural corruption: valid JSON, malformed shape (plan-Codex #2)
    await prisma.robotsCheck.update({ where: { id: second.summary.id }, data: { detailJson: '{"v":1,"sitemaps":[null]}' } })
    arm(detailFixture())
    const third = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(third.summary.changed).toBeNull()
  })

  it('changed is per (client,domain): another domain does not become the predecessor', async () => {
    const client = await makeClient()
    arm(detailFixture({ robotsHash: 'other' }))
    await runAndStoreRobotsCheck(client.id, 'other.com', { source: 'manual' })
    arm(detailFixture({ robotsHash: 'rh1' }))
    const first = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(first.summary.changed).toBeNull()
  })
})

describe('listRobotsChecks / getRobotsCheck', () => {
  it('lists newest-first capped at the history limit with pairwise changed', async () => {
    const client = await makeClient()
    arm(detailFixture({ robotsHash: 'a' }))
    await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    arm(detailFixture({ robotsHash: 'b' }))
    await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    arm(detailFixture({ robotsHash: 'b' }))
    await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'scheduled' })
    const list = await listRobotsChecks(client.id, 'x.com')
    expect(list).toHaveLength(3)
    expect(list[0].changed).toBe(false)
    expect(list[1].changed).toBe(true)
    expect(list[2].changed).toBeNull()
    expect(list[0].source).toBe('scheduled')
  })

  it('interleaved domains: predecessor outside the fetched window is still found (plan-Codex #1)', async () => {
    const client = await makeClient()
    // Domain y.com gets ONE old check, then x.com fills the whole window.
    arm(detailFixture({ robotsHash: 'y-old' }))
    await runAndStoreRobotsCheck(client.id, 'y.com', { source: 'manual' })
    const { ROBOTS_CHECK_HISTORY_LIMIT } = await import('./types')
    for (let i = 0; i < ROBOTS_CHECK_HISTORY_LIMIT; i++) {
      arm(detailFixture({ robotsHash: 'x' }))
      await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    }
    arm(detailFixture({ robotsHash: 'y-new' }))
    await runAndStoreRobotsCheck(client.id, 'y.com', { source: 'manual' })
    // Unfiltered list: newest row is y.com; its y.com predecessor sits beyond
    // the LIMIT+1 window behind the x.com rows — must still resolve changed.
    const list = await listRobotsChecks(client.id)
    expect(list[0].domain).toBe('y.com')
    expect(list[0].changed).toBe(true) // y-old vs y-new — NOT null
  })

  it('getRobotsCheck enforces ownership and returns null on corrupt detail', async () => {
    const clientA = await makeClient()
    const clientB = await makeClient()
    arm(detailFixture())
    const { summary } = await runAndStoreRobotsCheck(clientA.id, 'x.com', { source: 'manual' })
    expect(await getRobotsCheck(clientB.id, summary.id)).toBeNull()
    const got = await getRobotsCheck(clientA.id, summary.id)
    expect(got?.detail.v).toBe(1)
    await prisma.robotsCheck.update({ where: { id: summary.id }, data: { detailJson: 'nope' } })
    expect(await getRobotsCheck(clientA.id, summary.id)).toBeNull()
  })
})

describe('changeSummary (D5)', () => {
  it('first check ever -> changeSummary null', async () => {
    const client = await makeClient()
    arm(detailFixture())
    const stored = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(stored.changeSummary).toBeNull()
  })

  it('second check computes the summary against the exact predecessor, on both paths', async () => {
    const client = await makeClient()
    arm(detailFixture({ robotsHash: 'a' }), 'Allow: /')
    await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    arm(detailFixture({ robotsHash: 'b' }), 'Disallow: /x')
    const second = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })

    expect(second.summary.changed).toBe(true)
    expect(second.changeSummary).not.toBeNull()
    expect(second.changeSummary!.robotsContentChanged).toBe(true)
    expect(second.changeSummary!.robotsDiff!.added).toEqual(['Disallow: /x'])
    expect(second.changeSummary!.robotsDiff!.removed).toEqual(['Allow: /'])

    // GET path returns the identical summary shape.
    const got = await getRobotsCheck(client.id, second.summary.id)
    expect(got!.changeSummary).toEqual(second.changeSummary)
  })

  it('corrupt predecessor detail -> changeSummary null (matches changed:null)', async () => {
    const client = await makeClient()
    arm(detailFixture())
    const first = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    await prisma.robotsCheck.update({ where: { id: first.summary.id }, data: { detailJson: '{"v":2}' } })
    arm(detailFixture({ robotsHash: 'zz' }))
    const second = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(second.summary.changed).toBeNull()
    expect(second.changeSummary).toBeNull()
  })
})
