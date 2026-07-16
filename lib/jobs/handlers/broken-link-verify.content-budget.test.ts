// lib/jobs/handlers/broken-link-verify.content-budget.test.ts
//
// Task 8 (stage-B memory fix part 2): contentText is loaded SEPARATELY from
// the main seoRows select, chunked, under CONTENT_TEXT_TOTAL_BYTE_BUDGET
// (default 24MB). Strict-prefix admission in url order (Codex plan-fix #4):
// once the running total would overflow the budget, that page AND every
// later page (in url order) is skipped. These tests pin: (a) a tiny budget
// admits a strict prefix and stamps inputCapped/budgetSkippedPages on the
// three content-text wrappers without flipping run status to 'partial'; (b)
// a budget so tiny nothing is admitted persists a capped STUB
// ({ unavailable: true }) instead of a bare null; (c) the default (generous)
// budget leaves Task 6's characterization behavior byte-identical.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { runBrokenLinkVerify, type VerifyDeps } from './broken-link-verify'
import * as embeddings from '@/lib/services/pillarAnalysis/embeddings'

const BUDGET_DOMAIN = 'content-budget.test'

async function cleanBudget() {
  await prisma.crawlRun.deleteMany({ where: { domain: BUDGET_DOMAIN } })
  await prisma.harvestedPageSeo.deleteMany({ where: { siteAudit: { domain: BUDGET_DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: BUDGET_DOMAIN } })
}
beforeEach(cleanBudget)

// Save/restore: several tests set CONTENT_TEXT_TOTAL_BYTE_BUDGET and MUST NOT
// leak it into sibling test files sharing the same vitest worker.
const ORIGINAL_BUDGET_ENV = process.env.CONTENT_TEXT_TOTAL_BYTE_BUDGET
afterEach(async () => {
  if (ORIGINAL_BUDGET_ENV === undefined) delete process.env.CONTENT_TEXT_TOTAL_BYTE_BUDGET
  else process.env.CONTENT_TEXT_TOTAL_BYTE_BUDGET = ORIGINAL_BUDGET_ENV
  vi.restoreAllMocks()
  await prisma.scoringWeights.deleteMany({ where: { id: 1 } })
  await cleanBudget()
})

// n unique words with a distinguishing prefix — long enough to clear both
// computeContentSimilarity's minTokens (50) and be a legitimate topic-overlap
// candidate (non-empty sigText from title/h1/desc is set separately below).
const wordsPage = (prefix: string, n = 60): string =>
  Array.from({ length: n }, (_, i) => `${prefix}word${i}`).join(' ')

const bRow = (siteAuditId: string, path: string, contentText: string) => ({
  siteAuditId, url: `https://${BUDGET_DOMAIN}${path}`, statusCode: 200, isHtml: true,
  robotsNoindex: false, xRobotsNoindex: false, loginLike: false,
  title: `Title ${path}`, h1: `H1 ${path}`, metaDescription: `Meta ${path}`,
  wordCount: 500, schemaCount: 0, contentText, contentTruncated: false,
})

const bDeps: VerifyDeps = {
  resolve: async (url: string) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
  resolveExternal: async (url: string) => ({ result: 'ok' as const, finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
  now: () => 0,
  sleep: async () => {},
}

const budgetRun = (id: string) =>
  prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId: id, tool: 'seo-parser' } },
    select: { status: true, contentSignalsJson: true, contentSimilarityJson: true, topicOverlapJson: true },
  })

describe('runBrokenLinkVerify — contentText byte budget (Task 8)', () => {
  it('tiny budget admits a strict prefix: wrappers carry inputCapped + budgetSkippedPages, run stays complete', async () => {
    const textA = wordsPage('a')
    const textB = wordsPage('b')
    const textC = wordsPage('c')
    // Budget fits exactly A+B (url order /a,/b,/c) — C overflows and every
    // subsequent page (none here) would also be skipped under strict prefix.
    process.env.CONTENT_TEXT_TOTAL_BYTE_BUDGET = String(
      Buffer.byteLength(textA, 'utf8') + Buffer.byteLength(textB, 'utf8'),
    )
    vi.spyOn(embeddings, 'embedTexts').mockImplementation(async (texts: string[]) => texts.map(() => [1, 0]))

    const sa = await prisma.siteAudit.create({
      data: { domain: BUDGET_DOMAIN, status: 'complete', pagesTotal: 3, pagesComplete: 3, pagesError: 0 },
    })
    await prisma.harvestedPageSeo.createMany({
      data: [bRow(sa.id, '/a', textA), bRow(sa.id, '/b', textB), bRow(sa.id, '/c', textC)],
    })

    await runBrokenLinkVerify({ siteAuditId: sa.id, domain: BUDGET_DOMAIN }, bDeps)
    const run = await budgetRun(sa.id)

    expect(run!.status).toBe('complete') // budget alone never flips partial

    const signals = JSON.parse(run!.contentSignalsJson!)
    expect(signals.inputCapped).toBe(true)
    expect(signals.budgetSkippedPages).toBe(1)
    expect(signals.observedPages).toBe(2) // only /a and /b admitted text

    const sim = JSON.parse(run!.contentSimilarityJson!)
    expect(sim.inputCapped).toBe(true)
    expect(sim.budgetSkippedPages).toBe(1)
    expect(sim.pagesEligible).toBe(2)

    const overlap = JSON.parse(run!.topicOverlapJson!)
    expect(overlap.inputCapped).toBe(true)
    expect(overlap.budgetSkippedPages).toBe(1)
  })

  it('budget admits nothing: signals/similarity/topicOverlap persist a capped stub, never a bare null', async () => {
    process.env.CONTENT_TEXT_TOTAL_BYTE_BUDGET = '1' // smallest positive value parsePositiveInt accepts

    const sa = await prisma.siteAudit.create({
      data: { domain: BUDGET_DOMAIN, status: 'complete', pagesTotal: 2, pagesComplete: 2, pagesError: 0 },
    })
    const text = wordsPage('z')
    await prisma.harvestedPageSeo.createMany({
      data: [bRow(sa.id, '/x', text), bRow(sa.id, '/y', text)],
    })

    await runBrokenLinkVerify({ siteAuditId: sa.id, domain: BUDGET_DOMAIN }, bDeps)
    const run = await budgetRun(sa.id)

    expect(run!.status).toBe('complete') // budget alone never flips partial

    for (const json of [run!.contentSignalsJson, run!.contentSimilarityJson, run!.topicOverlapJson]) {
      expect(json).not.toBeNull()
      const parsed = JSON.parse(json!)
      expect(parsed.v).toBe(1)
      expect(parsed.unavailable).toBe(true)
      expect(parsed.inputCapped).toBe(true)
      expect(parsed.budgetSkippedPages).toBeGreaterThan(0)
    }
  })

  it('generous (default) budget: no budgetSkippedPages/inputCapped stamped, matches Task 6 characterization shape', async () => {
    delete process.env.CONTENT_TEXT_TOTAL_BYTE_BUDGET // force the 24MB default
    vi.spyOn(embeddings, 'embedTexts').mockImplementation(async (texts: string[]) => texts.map(() => [1, 0]))

    const sa = await prisma.siteAudit.create({
      data: { domain: BUDGET_DOMAIN, status: 'complete', pagesTotal: 2, pagesComplete: 2, pagesError: 0 },
    })
    const dup = wordsPage('dup', 80)
    await prisma.harvestedPageSeo.createMany({
      data: [bRow(sa.id, '/a', dup), bRow(sa.id, '/b', dup)],
    })

    await runBrokenLinkVerify({ siteAuditId: sa.id, domain: BUDGET_DOMAIN }, bDeps)
    const run = await budgetRun(sa.id)

    const sim = JSON.parse(run!.contentSimilarityJson!)
    expect(sim.exactDuplicateGroups[0].urls.sort()).toEqual([`https://${BUDGET_DOMAIN}/a`, `https://${BUDGET_DOMAIN}/b`])
    expect(sim.budgetSkippedPages).toBeUndefined()
    expect(sim.inputCapped).toBeUndefined()

    const signals = JSON.parse(run!.contentSignalsJson!)
    expect(signals.observedPages).toBe(2)
    expect(signals.budgetSkippedPages).toBeUndefined()
    expect(signals.inputCapped).toBeUndefined()

    const overlap = JSON.parse(run!.topicOverlapJson!)
    expect(overlap.budgetSkippedPages).toBeUndefined()
    expect(overlap.inputCapped).toBe(false) // the analyzer's own field — untouched when nothing was budget-skipped
  })
})
