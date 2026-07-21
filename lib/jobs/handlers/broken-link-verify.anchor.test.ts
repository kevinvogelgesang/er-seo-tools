import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { runBrokenLinkVerify, type VerifyDeps } from './broken-link-verify'

const DOMAIN = 'anchorblv.example.com'

async function clean() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.harvestedLink.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}
beforeEach(clean)
afterEach(async () => { await prisma.scoringWeights.deleteMany({ where: { id: 1 } }) })
afterAll(clean)

type Row = { targetUrl: string; sourcePageUrl: string; anchorText: string | null; kind?: string }
async function seed(rows: Row[]) {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: null } })
  if (rows.length)
    await prisma.harvestedLink.createMany({
      data: rows.map((r) => ({
        siteAuditId: sa.id, targetUrl: r.targetUrl, sourcePageUrl: r.sourcePageUrl,
        kind: r.kind ?? 'internal-link', anchorText: r.anchorText,
      })),
    })
  return sa.id
}

// All internal targets resolve 'ok' (we're asserting anchor findings, not broken).
const okDeps = (): VerifyDeps => ({
  resolve: async (url: string) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
  resolveExternal: async (url: string) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
  now: () => 0,
  sleep: async () => {},
})

const liveRun = (id: string) =>
  prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId: id, tool: 'seo-parser' } },
    include: { findings: true },
  })

const runCount = (findings: { scope: string; type: string; count: number }[], type: string) =>
  findings.find((f) => f.scope === 'run' && f.type === type)?.count

describe('runBrokenLinkVerify — anchor-text findings', () => {
  it('emits empty=2, non-descriptive=1, single-variation=11 and stamps anchorSummaryJson', async () => {
    const B = `https://${DOMAIN}`
    const rows: Row[] = [
      // (1) empty: 2 distinct targets, empty anchor, 2 different source pages.
      { targetUrl: `${B}/empty-1`, sourcePageUrl: `${B}/p-e1`, anchorText: '' },
      { targetUrl: `${B}/empty-2`, sourcePageUrl: `${B}/p-e2`, anchorText: '' },
      // (3) multiple=true control: same target, two DIFFERENT non-empty anchors → excluded from single-variation.
      { targetUrl: `${B}/multi`, sourcePageUrl: `${B}/p-m1`, anchorText: 'Nursing Program' },
      { targetUrl: `${B}/multi`, sourcePageUrl: `${B}/p-m2`, anchorText: 'RN Program' },
    ]
    // (2) single-variation set: 11 distinct targets, each ONE distinct non-empty anchor, linked once.
    // Make ONE of the 11 non-descriptive ('click here') so it ALSO counts as non_descriptive
    // WITHOUT adding a 12th single-variation target.
    for (let i = 0; i < 11; i++) {
      rows.push({
        targetUrl: `${B}/sv-${i}`, sourcePageUrl: `${B}/p-sv-${i}`,
        anchorText: i === 0 ? 'click here' : `Unique Anchor ${i}`,
      })
    }
    const id = await seed(rows)
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, okDeps())

    const run = await liveRun(id)
    expect(run).not.toBeNull()
    expect(runCount(run!.findings, 'empty_anchor_text')).toBe(2)
    expect(runCount(run!.findings, 'non_descriptive_anchor_text')).toBe(1)
    // The multiple-anchor target is excluded; the 11 single-anchor targets (incl. the
    // non-descriptive one) qualify → count 11 (> 10 threshold).
    expect(runCount(run!.findings, 'single_anchor_variation')).toBe(11)
    expect(run!.anchorSummaryJson).not.toBeNull()
    const summary = JSON.parse(run!.anchorSummaryJson!)
    expect(summary.v).toBe(1)
    expect(summary.targetsObserved).toBe(12) // 11 single + 1 multiple (empty anchors never enter the map)
  })

  it('legacy rows (all anchorText null) → no anchor findings, null marker', async () => {
    const B = `https://${DOMAIN}`
    const id = await seed([
      { targetUrl: `${B}/a`, sourcePageUrl: `${B}/p1`, anchorText: null },
      { targetUrl: `${B}/b`, sourcePageUrl: `${B}/p2`, anchorText: null },
    ])
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, okDeps())

    const run = await liveRun(id)
    expect(run).not.toBeNull()
    const anchorTypes = ['empty_anchor_text', 'non_descriptive_anchor_text', 'single_anchor_variation']
    expect(run!.findings.filter((f) => anchorTypes.includes(f.type))).toEqual([])
    expect(run!.anchorSummaryJson).toBeNull()
  })
})
