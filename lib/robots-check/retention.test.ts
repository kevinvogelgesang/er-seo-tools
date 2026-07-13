// lib/robots-check/retention.test.ts
//
// D4 retention: keep newest HISTORY_LIMIT+1 per (client, domain) by
// (createdAt DESC, id DESC) — the +1 hidden predecessor keeps the oldest
// VISIBLE row's changed flag stable across pruning (Codex #3).
import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { pruneRobotsChecks } from './retention'
import { listRobotsChecks } from './service'
import { ROBOTS_CHECK_HISTORY_LIMIT } from './types'

const PREFIX = 'd4ret-'
let counter = 0

async function makeClient() {
  return prisma.client.create({ data: { name: `${PREFIX}${Date.now()}-${counter++}` } })
}

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

/** Structurally valid minimal detail (passes the service's parseDetail guard). */
function validDetailJson(hash: string): string {
  return JSON.stringify({
    v: 1, domain: 'x.com',
    robots: { status: 'ok', httpStatus: 200, failure: null, contentHash: hash, issues: [], blockedBots: [], sitemapUrls: [] },
    sitemaps: [], sitemapsSkipped: 0, timeBudgetExhausted: false,
    totals: { sitemapUrlTotal: null, errors: 0, warnings: 0 },
  })
}

function makeCheck(clientId: number, domain: string, createdAt: Date, hash = 'h') {
  return prisma.robotsCheck.create({
    data: {
      clientId, domain, source: 'manual', robotsStatus: 'ok',
      robotsContentHash: hash, robotsContent: 'User-agent: *\n',
      sitemapUrlTotal: 1, errorCount: 0, warningCount: 0,
      detailJson: validDetailJson(hash), createdAt,
    },
  })
}

describe('pruneRobotsChecks', () => {
  it('keeps LIMIT+1 newest per (client, domain); other domains and clients untouched', async () => {
    const clientA = await makeClient()
    const clientB = await makeClient()
    const base = Date.now() - 10_000_000
    const n = ROBOTS_CHECK_HISTORY_LIMIT + 5
    for (let i = 0; i < n; i++) {
      await makeCheck(clientA.id, 'x.com', new Date(base + i * 1000))
    }
    await makeCheck(clientA.id, 'y.com', new Date(base))
    await makeCheck(clientB.id, 'x.com', new Date(base))

    await pruneRobotsChecks()

    const aX = await prisma.robotsCheck.findMany({
      where: { clientId: clientA.id, domain: 'x.com' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    expect(aX).toHaveLength(ROBOTS_CHECK_HISTORY_LIMIT + 1)
    // newest survived, oldest pruned
    expect(aX[0].createdAt.getTime()).toBe(base + (n - 1) * 1000)
    expect(await prisma.robotsCheck.count({ where: { clientId: clientA.id, domain: 'y.com' } })).toBe(1)
    expect(await prisma.robotsCheck.count({ where: { clientId: clientB.id } })).toBe(1)
  })

  it('oldest VISIBLE row keeps a non-null changed after pruning (the +1 hidden predecessor — Codex #3, plan-Codex #6)', async () => {
    const client = await makeClient()
    const base = Date.now() - 10_000_000
    // LIMIT+3 rows, alternating hashes so every pair is changed:true
    for (let i = 0; i < ROBOTS_CHECK_HISTORY_LIMIT + 3; i++) {
      await makeCheck(client.id, 'x.com', new Date(base + i * 1000), i % 2 === 0 ? 'ha' : 'hb')
    }
    await pruneRobotsChecks()
    const list = await listRobotsChecks(client.id, 'x.com')
    expect(list).toHaveLength(ROBOTS_CHECK_HISTORY_LIMIT)
    const oldestVisible = list[list.length - 1]
    expect(oldestVisible.changed).toBe(true) // predecessor survived as the hidden +1 row
  })
})
