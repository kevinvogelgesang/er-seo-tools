// lib/keywords/strategy-export.test.ts
//
// DB-backed tests for the KS-5 export assembly service (Task 5). prisma is
// real against the local SQLite dev DB. Each of the five blocks degrades
// independently; the framing fields are pinned to the session/client rows.
// House convention: prefix-named rows, cleaned in beforeAll/afterAll.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { loadStrategyExport } from './strategy-export'
import { ONPAGE_FINDING_TYPE_SET, BROKEN_FINDING_TYPE_SET } from '@/lib/findings/finding-type-sets'

const PREFIX = 'ks5exp-'
let counter = 0

async function makeClient(overrides: Record<string, unknown> = {}): Promise<number> {
  const client = await prisma.client.create({
    data: { name: `${PREFIX}${Date.now()}-${counter++}`, ...overrides },
  })
  return client.id
}

async function makeSession(
  clientId: number,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const session = await prisma.keywordStrategySession.create({
    data: {
      clientId,
      tokenMintedAt: new Date(),
      volumeKeywordCap: 1500,
      volumeKeywordsUsed: 0,
      gscRefreshed: true,
      ...overrides,
    },
  })
  return session.id
}

async function makeLiveScanRun(
  clientId: number,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'seo-parser',
      source: 'live-scan',
      status: 'complete',
      clientId,
      domain: 'example.edu',
      score: 82,
      pagesTotal: 3,
      ...overrides,
    },
  })
  return run.id
}

async function cleanup(): Promise<void> {
  // CrawlRun/Session carry clientId as SetNull — delete them via the client
  // relation BEFORE the client row is removed, then sweep any orphaned test
  // runs left behind by a prior aborted run (reserved test domain).
  await prisma.crawlRun.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.crawlRun.deleteMany({ where: { clientId: null, domain: 'example.edu' } })
  await prisma.session.deleteMany({ where: { id: { startsWith: PREFIX } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}

beforeAll(cleanup)
afterAll(cleanup)

describe('loadStrategyExport — framing + full assembly', () => {
  it('returns null when the session row is gone', async () => {
    expect(await loadStrategyExport('does-not-exist-xyz')).toBeNull()
  })

  it('pins framing fields to the session + client rows, assembles all blocks', async () => {
    const clientId = await makeClient({
      name: `${PREFIX}Full ${Date.now()}`,
      institutionType: 'trade',
      programsJson: JSON.stringify([{ name: 'Welding', confirmed: true, source: 'manual' }]),
      kwLocationCode: 2840,
      kwLanguageCode: 'en',
      kwMarketLabel: 'US / English',
    })
    const clientName = (await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).name
    const sessionId = await makeSession(clientId, {
      volumeKeywordCap: 1234,
      volumeKeywordsUsed: 56,
      gscRefreshed: true,
    })

    const runId = await makeLiveScanRun(clientId, {
      score: 77,
      pagesTotal: 3,
      programEntitiesJson: JSON.stringify({
        v: 1,
        entities: [{ name: 'Welding', url: 'https://example.edu/programs/welding' }],
      }),
    })
    // Two indexable pages + one non-indexable
    await prisma.crawlPage.createMany({
      data: [
        { runId, url: 'https://example.edu/a', indexable: true, title: 'A', wordCount: 500, crawlDepth: 1, faqEvidence: 'not-detected' },
        { runId, url: 'https://example.edu/programs/welding', indexable: true, title: 'Welding', wordCount: 900, crawlDepth: 2, faqEvidence: null },
        { runId, url: 'https://example.edu/hidden', indexable: false, title: 'Hidden', wordCount: 10, crawlDepth: 3, faqEvidence: null },
      ],
    })
    await prisma.finding.createMany({
      data: [
        { runId, scope: 'run', type: 'missing_title', severity: 'warning', count: 2, url: null, dedupKey: `${runId}-mt` },
        { runId, scope: 'run', type: 'broken_internal_links', severity: 'critical', count: 4, url: 'https://example.edu/a', dedupKey: `${runId}-bil` },
        { runId, scope: 'page', type: 'missing_title', severity: 'warning', count: 1, url: 'https://example.edu/a', dedupKey: `${runId}-mt-page` },
      ],
    })

    // Semrush session
    await prisma.session.create({
      data: {
        id: `${PREFIX}sess-${Date.now()}`,
        status: 'complete',
        files: '[]',
        workflow: 'keyword-research',
        clientId,
        result: JSON.stringify({ crawl_summary: { total_urls: 42 }, metadata: { site_name: 'SemSite' } }),
      },
    })

    const prevLogin = process.env.DATAFORSEO_LOGIN
    const prevPass = process.env.DATAFORSEO_PASSWORD
    process.env.DATAFORSEO_LOGIN = 'x'
    process.env.DATAFORSEO_PASSWORD = 'y'
    let out
    try {
      out = await loadStrategyExport(sessionId)
    } finally {
      if (prevLogin === undefined) delete process.env.DATAFORSEO_LOGIN
      else process.env.DATAFORSEO_LOGIN = prevLogin
      if (prevPass === undefined) delete process.env.DATAFORSEO_PASSWORD
      else process.env.DATAFORSEO_PASSWORD = prevPass
    }
    if (!out) throw new Error('expected export')

    // Framing pinned
    expect(out.id).toBe(sessionId)
    expect(out.clientId).toBe(clientId)
    expect(out.siteName).toBe(clientName)
    expect(typeof out.generatedAt).toBe('string')
    expect(out.gsc?.refreshedAtMint).toBe(true)
    expect(out.volumeLookup.cap).toBe(1234)
    expect(out.volumeLookup.used).toBe(56)
    expect(out.volumeLookup.enabled).toBe(true)
    expect(out.volumeLookup.endpoint).toBe(`/api/keyword-strategy/${sessionId}/volumes`)
    expect(out.volumeLookup.locale).toEqual({ locationCode: 2840, languageCode: 'en' })

    // Profile
    expect(out.profile.institutionType).toBe('trade')
    expect(out.profile.programs).toHaveLength(1)
    expect(out.profile.locale).toEqual({ locationCode: 2840, languageCode: 'en', marketLabel: 'US / English' })

    // Inventory (2 indexable pages, url-sorted, programEntity upgrade applied)
    expect(out.inventory?.runId).toBe(runId)
    expect(out.inventory?.runScore).toBe(77)
    expect(out.inventory?.pagesTotal).toBe(3)
    expect(out.inventory?.indexablePages).toBe(2)
    expect(out.inventory?.domain).toBe('example.edu')
    expect(out.inventory?.pages).toHaveLength(2)
    const welding = out.inventory?.pages.find((p) => p.url === 'https://example.edu/programs/welding')
    expect(welding?.pageType).toBe('program') // programEntityUrls upgrade

    // Findings split (run-scope only)
    expect(out.findings?.onPage.map((f) => f.type)).toEqual(['missing_title'])
    expect(out.findings?.brokenLinks.map((f) => f.type)).toEqual(['broken_internal_links'])
    expect(out.findings?.onPage[0]).toMatchObject({ type: 'missing_title', severity: 'warning', scope: 'run', count: 2, url: null })

    // Semrush
    expect(out.semrush?.crawl_summary.total_urls).toBe(42)
    expect(out.semrush?.site_name).toBe('SemSite')
  })
})

describe('loadStrategyExport — independent degradation', () => {
  it('no gsc mapping → gsc.gscMapped false, summary null; inventory still assembles', async () => {
    const clientId = await makeClient() // no gscSiteUrl
    const sessionId = await makeSession(clientId, { gscRefreshed: false })
    await makeLiveScanRun(clientId)

    const out = await loadStrategyExport(sessionId)
    expect(out?.gsc?.gscMapped).toBe(false)
    expect(out?.gsc?.summary).toBeNull()
    expect(out?.gsc?.refreshedAtMint).toBe(false)
    expect(out?.inventory).not.toBeNull()
  })

  it('no live-scan run → inventory and findings both null; other blocks present', async () => {
    const clientId = await makeClient({ institutionType: 'university' })
    const sessionId = await makeSession(clientId)

    const out = await loadStrategyExport(sessionId)
    expect(out?.inventory).toBeNull()
    expect(out?.findings).toBeNull()
    expect(out?.profile.institutionType).toBe('university')
  })

  it('no semrush session → semrush block null', async () => {
    const clientId = await makeClient()
    const sessionId = await makeSession(clientId)
    const out = await loadStrategyExport(sessionId)
    expect(out?.semrush).toBeNull()
  })

  it('corrupt semrush JSON → semrush block null (parse-throw degrades)', async () => {
    const clientId = await makeClient()
    const sessionId = await makeSession(clientId)
    await prisma.session.create({
      data: {
        id: `${PREFIX}corrupt-${Date.now()}`,
        status: 'complete',
        files: '[]',
        workflow: 'keyword-research',
        clientId,
        result: '{not valid json',
      },
    })
    const out = await loadStrategyExport(sessionId)
    expect(out?.semrush).toBeNull()
  })

  it('corrupt programEntitiesJson still yields inventory without the program upgrade', async () => {
    const clientId = await makeClient()
    const sessionId = await makeSession(clientId)
    const runId = await makeLiveScanRun(clientId, { programEntitiesJson: '{bad json' })
    await prisma.crawlPage.create({
      data: { runId, url: 'https://example.edu/programs/nursing', indexable: true, title: 'Nursing', wordCount: 800, crawlDepth: 2, faqEvidence: null },
    })
    const out = await loadStrategyExport(sessionId)
    expect(out?.inventory?.pages).toHaveLength(1)
    // Without a valid entity upgrade, a /programs/ slug still classifies via slug rules,
    // but crucially the load did not throw and inventory is present.
    expect(out?.inventory?.pages[0].url).toBe('https://example.edu/programs/nursing')
  })
})

describe('loadStrategyExport — findings shared-set fidelity', () => {
  it('a stray technical_noise run-scope finding appears in neither list', async () => {
    const clientId = await makeClient()
    const sessionId = await makeSession(clientId)
    const runId = await makeLiveScanRun(clientId)
    await prisma.finding.createMany({
      data: [
        { runId, scope: 'run', type: 'thin_content', severity: 'notice', count: 1, url: null, dedupKey: `${runId}-tc` },
        { runId, scope: 'run', type: 'broken_images', severity: 'critical', count: 2, url: null, dedupKey: `${runId}-bi` },
        { runId, scope: 'run', type: 'technical_noise', severity: 'notice', count: 9, url: null, dedupKey: `${runId}-tn` },
      ],
    })
    const out = await loadStrategyExport(sessionId)
    const onPageTypes = out?.findings?.onPage.map((f) => f.type) ?? []
    const brokenTypes = out?.findings?.brokenLinks.map((f) => f.type) ?? []
    expect(onPageTypes).toContain('thin_content')
    expect(brokenTypes).toContain('broken_images')
    expect(onPageTypes).not.toContain('technical_noise')
    expect(brokenTypes).not.toContain('technical_noise')
    // Sanity: every reported type belongs to its shared set.
    expect(onPageTypes.every((t) => ONPAGE_FINDING_TYPE_SET.has(t))).toBe(true)
    expect(brokenTypes.every((t) => BROKEN_FINDING_TYPE_SET.has(t))).toBe(true)
  })
})

describe('loadStrategyExport — semrush tie-break', () => {
  it('two complete sessions with the same createdAt → higher id wins', async () => {
    const clientId = await makeClient()
    const sessionId = await makeSession(clientId)
    const sameTime = new Date('2026-07-01T00:00:00.000Z')
    // Ids chosen so lexical ordering is unambiguous: 'zzz' > 'aaa'.
    await prisma.session.create({
      data: {
        id: `${PREFIX}aaa-${Date.now()}`,
        status: 'complete', files: '[]', workflow: 'keyword-research', clientId,
        createdAt: sameTime,
        result: JSON.stringify({ crawl_summary: { total_urls: 1 }, metadata: { site_name: 'LOW' } }),
      },
    })
    await prisma.session.create({
      data: {
        id: `${PREFIX}zzz-${Date.now()}`,
        status: 'complete', files: '[]', workflow: 'keyword-research', clientId,
        createdAt: sameTime,
        result: JSON.stringify({ crawl_summary: { total_urls: 2 }, metadata: { site_name: 'HIGH' } }),
      },
    })
    const out = await loadStrategyExport(sessionId)
    expect(out?.semrush?.site_name).toBe('HIGH')
  })
})

describe('loadStrategyExport — volumeLookup.enabled follows env', () => {
  it('enabled false when DataForSEO creds unset', async () => {
    const clientId = await makeClient()
    const sessionId = await makeSession(clientId)
    const prevLogin = process.env.DATAFORSEO_LOGIN
    const prevPass = process.env.DATAFORSEO_PASSWORD
    delete process.env.DATAFORSEO_LOGIN
    delete process.env.DATAFORSEO_PASSWORD
    try {
      const out = await loadStrategyExport(sessionId)
      expect(out?.volumeLookup.enabled).toBe(false)
    } finally {
      if (prevLogin !== undefined) process.env.DATAFORSEO_LOGIN = prevLogin
      if (prevPass !== undefined) process.env.DATAFORSEO_PASSWORD = prevPass
    }
  })
})
