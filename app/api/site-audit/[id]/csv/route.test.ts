// app/api/site-audit/[id]/csv/route.test.ts
//
// DB-backed tests for the C4 CSV export route. Seeds real SiteAudit +
// CrawlRun/CrawlPage/Finding/Violation rows (domain prefix c4csv-) and calls
// the handler directly with a NextRequest.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { pageFindingKey, normalizeFindingUrl } from '@/lib/findings/keys'
import { GET } from './route'

const PREFIX = 'c4csv-'
const siteAuditIds: string[] = []

beforeAll(async () => {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
})

afterAll(async () => {
  // CrawlRun by domain BEFORE origin rows (subtree cascades from CrawlRun).
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  if (siteAuditIds.length) {
    await prisma.siteAudit.deleteMany({ where: { id: { in: siteAuditIds } } })
  }
})

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function get(id: string, query = '') {
  return GET(new NextRequest(`http://localhost/api/site-audit/${id}/csv${query}`), makeParams(id))
}

interface SeedFinding {
  type: string
  severity?: string
  /** When set, a Violation row is created alongside the Finding. */
  violation?: { impact: string; help?: string; helpUrl?: string; wcagTags?: string[]; nodeCount?: number }
}

interface SeedPage {
  url: string
  findings?: SeedFinding[]
}

async function seedAudit(opts: {
  domain: string
  status?: string
  completedAt?: Date
  withRun?: boolean
  pages?: SeedPage[]
}) {
  const audit = await prisma.siteAudit.create({
    data: {
      domain: opts.domain,
      status: opts.status ?? 'complete',
      wcagLevel: 'wcag21aa',
      completedAt: opts.completedAt ?? new Date('2026-06-01T00:00:00Z'),
    },
  })
  siteAuditIds.push(audit.id)
  if (opts.withRun === false) return { siteAuditId: audit.id, runId: null }

  const run = await prisma.crawlRun.create({
    data: {
      tool: 'ada-audit', source: 'site-audit', domain: opts.domain, wcagLevel: 'wcag21aa',
      status: 'complete', pagesTotal: opts.pages?.length ?? 0,
      completedAt: opts.completedAt ?? new Date('2026-06-01T00:00:00Z'),
      siteAuditId: audit.id,
    },
  })
  for (const p of opts.pages ?? []) {
    const url = normalizeFindingUrl(p.url)
    const page = await prisma.crawlPage.create({
      data: { runId: run.id, url, status: 'complete' },
    })
    for (const f of p.findings ?? []) {
      const finding = await prisma.finding.create({
        data: {
          runId: run.id, pageId: page.id, scope: 'page', type: f.type,
          severity: f.severity ?? 'critical', url,
          dedupKey: pageFindingKey(f.type, url),
        },
      })
      if (f.violation) {
        await prisma.violation.create({
          data: {
            findingId: finding.id, runId: run.id, pageId: page.id,
            ruleId: f.type, impact: f.violation.impact,
            wcagTags: JSON.stringify(f.violation.wcagTags ?? []),
            help: f.violation.help ?? null, helpUrl: f.violation.helpUrl ?? null,
            nodeCount: f.violation.nodeCount ?? 1,
          },
        })
      }
    }
  }
  return { siteAuditId: audit.id, runId: run.id }
}

describe('GET /api/site-audit/[id]/csv — violations sheet', () => {
  const domain = `${PREFIX}a.example.com`

  it('exports violations: BOM, exact header, unknown impact last, formula help neutralized', async () => {
    const { siteAuditId } = await seedAudit({
      domain,
      pages: [
        {
          url: `https://${domain}/p1`,
          findings: [{
            type: 'image-alt', severity: 'critical',
            violation: {
              impact: 'critical', help: '=SUM(A1)', helpUrl: 'https://dequeuniversity.example/image-alt',
              wcagTags: ['wcag2a', 'wcag111'], nodeCount: 3,
            },
          }],
        },
        {
          url: `https://${domain}/p2`,
          findings: [{
            type: 'zzz-rule', severity: 'notice',
            violation: { impact: 'unknown', help: 'Some help', wcagTags: ['best-practice'], nodeCount: 1 },
          }],
        },
      ],
    })

    const res = await get(siteAuditId)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toContain(`ada-violations-${PREFIX}a.example.com-`)

    // Response.text() strips a leading UTF-8 BOM per spec — assert raw bytes.
    const buf = Buffer.from(await res.arrayBuffer())
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const lines = buf.subarray(3).toString('utf8').split('\r\n')
    expect(lines[0]).toBe('page_url,rule_id,impact,severity,wcag_tags,help,help_url,node_count')
    expect(lines).toHaveLength(3)
    // critical row first; unknown-impact row sorts LAST
    expect(lines[1]).toContain('image-alt')
    expect(lines[1]).toContain('wcag2a|wcag111')
    expect(lines[1]).toContain("'=SUM(A1)") // formula injection neutralized
    expect(lines[2]).toContain('zzz-rule')
    expect(lines[2]).toContain('unknown')
  })

  it('?sheet=changes with no previous run → 409 no_previous_run', async () => {
    // domain a has only one run (seeded above)
    const audit = await prisma.siteAudit.findFirst({ where: { domain }, select: { id: true } })
    const res = await get(audit!.id, '?sheet=changes')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'no_previous_run' })
  })

  it('non-complete audit → 409 not_complete', async () => {
    const { siteAuditId } = await seedAudit({
      domain: `${PREFIX}running.example.com`, status: 'running', withRun: false,
    })
    const res = await get(siteAuditId)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'not_complete' })
  })

  it('complete audit with no CrawlRun → 409 no_findings_run', async () => {
    const { siteAuditId } = await seedAudit({
      domain: `${PREFIX}prea2.example.com`, withRun: false,
    })
    const res = await get(siteAuditId)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'no_findings_run' })
  })

  it('unknown id → 404', async () => {
    const res = await get('c4csv-no-such-audit')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Site audit not found' })
  })
})

describe('GET /api/site-audit/[id]/csv?sheet=changes', () => {
  it('classifies new / resolved / not-rescanned rows from the previous run', async () => {
    const domain = `${PREFIX}b.example.com`
    const base = `https://${domain}`
    await seedAudit({
      domain, completedAt: new Date('2026-05-01T00:00:00Z'),
      pages: [
        { url: `${base}/a`, findings: [{ type: 'rule-resolved' }] },
        { url: `${base}/gone`, findings: [{ type: 'rule-x' }] },
        { url: `${base}/b` },
      ],
    })
    const current = await seedAudit({
      domain, completedAt: new Date('2026-06-01T00:00:00Z'),
      pages: [
        { url: `${base}/a` }, // rescanned clean → rule-resolved resolved
        { url: `${base}/b`, findings: [{ type: 'rule-reg' }] }, // page scanned before → regressed ('new')
        // /gone not rescanned → rule-x not-rescanned
      ],
    })

    const res = await get(current.siteAuditId, '?sheet=changes')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain(`ada-changes-${PREFIX}b.example.com-`)

    // text() strips the BOM; strip defensively anyway.
    const body = (await res.text()).replace(/^﻿/, '')
    const lines = body.split('\r\n')
    expect(lines[0]).toBe('change,rule_id,severity,page_url')
    const rows = lines.slice(1).map((l) => l.split(','))
    expect(rows).toHaveLength(3)
    expect(rows).toContainEqual(['new', 'rule-reg', 'critical', normalizeFindingUrl(`${base}/b`)])
    expect(rows).toContainEqual(['resolved', 'rule-resolved', 'critical', normalizeFindingUrl(`${base}/a`)])
    expect(rows).toContainEqual(['not-rescanned', 'rule-x', 'critical', normalizeFindingUrl(`${base}/gone`)])
  })
})
