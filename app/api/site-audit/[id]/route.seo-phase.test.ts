// app/api/site-audit/[id]/route.seo-phase.test.ts
//
// DB-backed tests for the C11 PR 2b `seoPhase` field on GET
// /api/site-audit/[id]. Model on route.fallback.test.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { BROKEN_LINK_VERIFY_JOB_TYPE } from '@/lib/jobs/handlers/broken-link-verify'
import { GET } from './route'

const DOMAIN = 'c11pr2b-route-seoph.example'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

async function clearState() {
  const audits = await prisma.siteAudit.findMany({
    where: { domain: { startsWith: 'c11pr2b-route-seoph' } },
    select: { id: true },
  })
  const ids = audits.map((a) => a.id)
  await prisma.crawlRun.deleteMany({ where: { siteAuditId: { in: ids } } })
  await prisma.job.deleteMany({ where: { groupKey: { in: ids.map((id) => `site-audit:${id}`) } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'c11pr2b-route-seoph' } } })
}

describe('GET /api/site-audit/[id] — C11 PR 2b seoPhase', () => {
  beforeEach(clearState)
  afterEach(clearState)

  it('returns seoPhase.state "done" when a live-scan CrawlRun exists', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', wcagLevel: 'wcag21aa' },
    })
    await prisma.crawlRun.create({
      data: {
        siteAuditId: site.id,
        tool: 'seo-parser',
        source: 'live-scan',
        domain: DOMAIN,
        status: 'complete',
      },
    })

    const res = await GET({} as never, makeParams(site.id))
    const body = await res.json()
    expect(body.seoPhase.state).toBe('done')
    expect(body.seoPhase.progress).toBeNull()
    expect(body.seoPhase.message).toBeNull()
  })

  it('returns seoPhase.state "running" with progress when a verify job is running and no run exists', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', wcagLevel: 'wcag21aa' },
    })
    await prisma.job.create({
      data: {
        type: BROKEN_LINK_VERIFY_JOB_TYPE,
        groupKey: `site-audit:${site.id}`,
        status: 'running',
        progress: 55,
        progressMessage: 'Checked 55/100 links',
      },
    })

    const res = await GET({} as never, makeParams(site.id))
    const body = await res.json()
    expect(body.seoPhase.state).toBe('running')
    expect(body.seoPhase.progress).toBe(55)
    expect(body.seoPhase.message).toBe('Checked 55/100 links')
  })

  it('returns seoPhase.state "unavailable" when there is neither a run nor a job', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', wcagLevel: 'wcag21aa' },
    })

    const res = await GET({} as never, makeParams(site.id))
    const body = await res.json()
    expect(body.seoPhase.state).toBe('unavailable')
  })
})
