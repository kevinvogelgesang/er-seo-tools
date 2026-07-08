// app/api/site-audit/[id]/seo-only-invariant.test.ts
//
// C11 Task 11: end-to-end invariant test for "SEO-only scan mode".
//
// A seoOnly SiteAudit skips axe/screenshots/PDF/PSI entirely, so it must
// NEVER produce an ada-audit findings run, and the ADA-only export routes
// must reject it the same way they reject any pre-A2/no-run audit. Once the
// broken-link-verify job builds its live-scan CrawlRun (simulated here by
// inserting the row directly — driving the real job would require a live
// browser scan, which this suite never does), that run must be the one
// discoverable through the seo-parser history surface.
//
// DB-backed (real prisma), domain-prefixed for isolated cleanup — same
// convention as the sibling csv/vpat/report route tests.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET as getDetail } from './route'
import { GET as getCsv } from './csv/route'
import { GET as getVpat } from './vpat/route'
import { POST as postReport } from './report/route'
import { GET as getHistory } from '@/app/api/parse/history/route'

const PREFIX = 'c11inv-'
const DOMAIN = `${PREFIX}client-site.example.com`

const siteAuditIds: string[] = []

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

async function cleanup() {
  // CrawlRun before origin SiteAudit — subtree cascades from CrawlRun only.
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
}

beforeAll(cleanup)
afterAll(async () => {
  await cleanup()
  if (siteAuditIds.length) {
    await prisma.siteAudit.deleteMany({ where: { id: { in: siteAuditIds } } })
  }
})

describe('C11 seoOnly scan mode — end-to-end invariant', () => {
  it('never produces an ada-audit CrawlRun, surfaces its live-scan run in history, and 409s the ADA-only exports', async () => {
    // A completed seoOnly audit, as the finalizer would leave it: axe/PDF/PSI
    // counters all stay at their zero defaults, no ada-audit run is written.
    const audit = await prisma.siteAudit.create({
      data: {
        domain: DOMAIN,
        status: 'complete',
        wcagLevel: 'wcag21aa',
        seoOnly: true,
        seoIntent: true,
        pagesTotal: 3,
        pagesComplete: 3,
        summary: null,
        startedAt: new Date('2026-07-01T00:00:00Z'),
        completedAt: new Date('2026-07-01T00:05:00Z'),
      },
    })
    siteAuditIds.push(audit.id)

    // --- (a) no ada-audit CrawlRun exists for this audit ---
    const adaRun = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId: audit.id, tool: 'ada-audit' } },
      select: { id: true },
    })
    expect(adaRun).toBeNull()

    // --- (c) ADA-only export routes 409 no_findings_run BEFORE the live-scan
    // run exists — these are regression guards: Tasks 1-4 already ensure a
    // seoOnly audit carries no ada-audit run, so the shared no_findings_run
    // gate in each export route (pre-existing, not seoOnly-aware) is already
    // green here. This test drives it against a real seoOnly row for the
    // first time.
    const csvRes = await getCsv(
      new NextRequest(`http://localhost/api/site-audit/${audit.id}/csv`),
      makeParams(audit.id),
    )
    expect(csvRes.status).toBe(409)
    expect(await csvRes.json()).toEqual({ error: 'no_findings_run' })

    const vpatRes = await getVpat(
      new NextRequest(`http://localhost/api/site-audit/${audit.id}/vpat`),
      makeParams(audit.id),
    )
    expect(vpatRes.status).toBe(409)
    expect(await vpatRes.json()).toEqual({ error: 'no_findings_run' })

    const reportRes = await postReport(
      new NextRequest(`http://localhost/api/site-audit/${audit.id}/report`, { method: 'POST' }),
      makeParams(audit.id),
    )
    expect(reportRes.status).toBe(409)
    expect(await reportRes.json()).toEqual({ error: 'no_findings_run' })

    // --- simulate broken-link-verify's output: the single live-scan run
    // builder writes a tool:'seo-parser' / source:'live-scan' CrawlRun onto
    // this SiteAudit (real job requires a live browser scan — never run here
    // per the "never scan a third-party site" rule; simulation is the
    // documented lighter-weight alternative for this invariant test).
    const liveRun = await prisma.crawlRun.create({
      data: {
        siteAuditId: audit.id,
        tool: 'seo-parser',
        source: 'live-scan',
        seoIntent: true,
        domain: DOMAIN,
        status: 'complete',
        score: 82,
        pagesTotal: 3,
        completedAt: new Date('2026-07-01T00:05:30Z'),
      },
    })

    // --- (b) the live-scan run is now the audit's liveScanRunId ... ---
    const detailRes = await getDetail({} as never, makeParams(audit.id))
    const detailBody = await detailRes.json()
    expect(detailBody.seoOnly).toBe(true)
    expect(detailBody.liveScanRunId).toBe(liveRun.id)

    // ... and (b) it is discoverable through the seo-parser history surface,
    // which selects live-scan runs by `tool:'seo-parser', source:'live-scan',
    // seoIntent:true` — the same shape broken-link-verify writes in prod.
    const historyRes = await getHistory()
    const historyBody = await historyRes.json()
    const historyEntry = (historyBody as Array<{ id: string; source: string; siteName: string | null }>).find(
      (e) => e.id === liveRun.id,
    )
    expect(historyEntry).toBeDefined()
    expect(historyEntry?.source).toBe('live-scan')
    expect(historyEntry?.siteName).toBe(DOMAIN)

    // --- (a), re-confirmed: writing the live-scan run must never create an
    // ada-audit run for the same audit (the C6 compound-unique lets both
    // coexist by design, but seoOnly must never populate the ada slot).
    const adaRunAfter = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId: audit.id, tool: 'ada-audit' } },
      select: { id: true },
    })
    expect(adaRunAfter).toBeNull()

    // --- (c), re-confirmed: exports still 409 after the live-scan run
    // exists — the ADA export gate keys on tool:'ada-audit' specifically, a
    // live-scan run must never satisfy it.
    const csvResAfter = await getCsv(
      new NextRequest(`http://localhost/api/site-audit/${audit.id}/csv`),
      makeParams(audit.id),
    )
    expect(csvResAfter.status).toBe(409)
    expect(await csvResAfter.json()).toEqual({ error: 'no_findings_run' })
  })
})
